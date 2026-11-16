import {spawn} from 'node:child_process'
import {readFileSync,realpathSync,statSync,accessSync,constants} from 'node:fs'
import {mkdir,rm,rename} from 'node:fs/promises'
import {delimiter,dirname,isAbsolute,join,resolve} from 'node:path'
import type {RuntimeStatus,RuntimePhase} from '../shared/desktop'

type Runner=(command:string,args:string[],options:{signal?:AbortSignal;timeout:number;cwd?:string})=>Promise<string>
export function runProgram(command:string,args:string[],options:{signal?:AbortSignal;timeout:number;cwd?:string}):Promise<string>{
 return new Promise((resolve,reject)=>{
  if(options.signal?.aborted){reject(new Error('Runtime operation cancelled.'));return}
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',QWEN_CODE_NO_RELAUNCH:'true',QWEN_USAGE_STATISTICS_ENABLED:'false',QWEN_TELEMETRY_ENABLED:'false',OTEL_SDK_DISABLED:'true',QWEN_CODE_MODELS_DEV_REFRESH:'off'}
  const child=spawn(command,args,{cwd:options.cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'})
  let text='',settled=false
  const finish=(error?:Error):void=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolve(text.trim())}
  const stop=():void=>{
   if(!child.pid)return
   if(process.platform==='win32'){
    // Only the process tree started by this operation is terminated.
    const killer=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});killer.on('error',()=>{child.kill()})
   }else{try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}
  }
  const cancel=():void=>{stop();finish(new Error('Runtime operation cancelled.'))}
  const timer=setTimeout(()=>{stop();finish(new Error('Runtime operation timed out.'))},options.timeout)
  child.stdout.on('data',data=>{text=(text+data.toString()).slice(-32_000)})
  // npm diagnostics may contain registry credentials; never send them to IPC or logs.
  child.stderr.resume()
  child.on('error',()=>finish(new Error('Could not start the runtime command.')))
  child.on('close',code=>finish(code===0?undefined:new Error('Runtime command failed. Check Node.js, npm and access to the npm registry.')))
  options.signal?.addEventListener('abort',cancel,{once:true})
  if(options.signal?.aborted)cancel()
 })
}
function file(path:string):boolean{try{return statSync(path).isFile()}catch{return false}}
export function pathExecutable(name:string,path=process.env.PATH??'',platform=process.platform):string|null{
 for(const raw of path.split(platform==='win32'?';':delimiter)){
  const dir=raw.replace(/^"|"$/g,'');if(!dir||!isAbsolute(dir))continue
  const candidate=join(dir,platform==='win32'?name+'.exe':name)
  if(file(candidate)){try{accessSync(candidate,constants.X_OK);return candidate}catch{}}
 }
 return null
}
function npmEntry(node:string,path=process.env.PATH??''):string|null{
 const dirs=[dirname(node),...path.split(delimiter).map(p=>p.replace(/^"|"$/g,''))].filter(p=>p&&isAbsolute(p))
 for(const dir of dirs){
  for(const candidate of [join(dir,'node_modules/npm/bin/npm-cli.js'),join(dir,'../lib/node_modules/npm/bin/npm-cli.js'),join(dir,'npm')]){
   try{const real=realpathSync(candidate);if(real.endsWith('npm-cli.js')&&file(real))return real}catch{}
  }
 }
 return null
}
export class RuntimeManager{
 private selected:string|null=null
 private snapshot:RuntimeStatus|null=null
 private tools:{node:string;npm:string}|null=null
 private readonly directory:string
 constructor(private readonly options:{directory:string;version:string;run?:Runner;node?:()=>string|null;npm?:(node:string)=>string|null}){this.directory=join(options.directory,'qwen-'+options.version)}
 private run:Runner=(command,args,options)=>(this.options.run??runProgram)(command,args,options)
 private packageAt(root:string):{entry:string;version:string}|null{
  try{const base=join(root,'@qwen-code/qwen-code'),pkg=JSON.parse(readFileSync(join(base,'package.json'),'utf8'));if(pkg.name!=='@qwen-code/qwen-code'||typeof pkg.version!=='string')return null
   const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.qwen
   if(typeof bin!=='string'||!bin||isAbsolute(bin))return null
   const binEntry=resolve(base,bin);if(!binEntry.startsWith(resolve(base)+ (process.platform==='win32'?'\\':'/'))||!file(binEntry))return null
   // cli-entry.js synchronously relaunches Node on Windows. The SDK must own
   // one direct CLI child, so use its implementation entry through our bootstrap.
   const entry=join(base,'cli.js');if(!file(entry))return null
   return{entry,version:pkg.version}
  }catch{return null}
 }
 private use(candidate:{entry:string;version:string}|null,source:'managed'|'system'):boolean{
  if(!candidate)return false
  if(this.snapshot)this.snapshot.detectedCliVersion=candidate.version
  if(candidate.version!==this.options.version)return false
  this.selected=candidate.entry
  Object.assign(this.snapshot!,{ready:true,source,cliVersion:candidate.version,issue:null})
  return true
 }
 async inspect(signal?:AbortSignal):Promise<RuntimeStatus>{
  const node=(this.options.node??(()=>pathExecutable('node')))();let npm=node?(this.options.npm??npmEntry)(node):null
  this.tools=null
  this.snapshot={ready:false,source:null,cliVersion:null,detectedCliVersion:null,requiredVersion:this.options.version,nodeVersion:null,npmVersion:null,issue:'cli-missing'};this.selected=null
  if(node){try{this.snapshot.nodeVersion=await this.run(node,['--version'],{signal,timeout:10_000})}catch{}}
  if(node&&!npm){try{const actual=await this.run(node,['-p','process.execPath'],{signal,timeout:10_000});if(isAbsolute(actual))npm=(this.options.npm??npmEntry)(actual)}catch{}}
  if(npm&&node)this.tools={node,npm}
  if(npm&&node){try{this.snapshot.npmVersion=await this.run(node,[npm,'--version'],{signal,timeout:10_000})}catch{}}
  let broken=false
  const accept=async(candidate:{entry:string;version:string}|null,source:'managed'|'system'):Promise<boolean>=>{
   if(!candidate)return false;this.snapshot!.detectedCliVersion=candidate.version
   if(candidate.version!==this.options.version)return false
   try{const reported=await this.run(node??process.execPath,[candidate.entry,'--version'],{signal,timeout:10_000});if(!reported.split(/\s+/).includes(this.options.version)){broken=true;return false}}catch{broken=true;return false}
   return this.use(candidate,source)
  }
  if(await accept(this.packageAt(join(this.directory,'node_modules')),'managed'))return{...this.snapshot}
  if(npm&&node){try{const root=await this.run(node,[npm,'root','-g'],{signal,timeout:10_000});if(isAbsolute(root)&&await accept(this.packageAt(root),'system'))return{...this.snapshot}}catch{}}
  this.snapshot.issue=!node||!this.snapshot.nodeVersion?'node-missing':Number(this.snapshot.nodeVersion.replace(/^v/,'').split('.')[0])<22?'node-old':!this.snapshot.npmVersion?'npm-missing':broken?'cli-broken':this.snapshot.detectedCliVersion?'cli-incompatible':'cli-missing'
  return{...this.snapshot}
 }
 cached():RuntimeStatus|null{return this.snapshot&&{...this.snapshot,ready:Boolean(this.selected&&file(this.selected))}}
 entry():string{
  if(!this.selected||!file(this.selected))throw new Error('Qwen CLI is unavailable. Open Model connection to install it.')
  return this.selected
 }
 async prepare(signal:AbortSignal,progress:(phase:RuntimePhase)=>void):Promise<RuntimeStatus>{
  progress('checking');const status=await this.inspect(signal);if(signal.aborted)throw new Error('Runtime operation cancelled.');if(status.ready)return status
  if(['node-missing','node-old','npm-missing'].includes(status.issue??''))return status
  if(!this.tools)throw new Error('Could not start the runtime command.')
  const {node,npm}=this.tools
  // A staging directory prevents a cancelled installation from appearing ready.
  const staging=this.directory+'.installing'
  await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true})
  try{
   progress('installing')
   await this.run(node,[npm,'install','--prefix',staging,'--no-audit','--no-fund','--no-package-lock','--ignore-scripts','--',`@qwen-code/qwen-code@${this.options.version}`],{signal,timeout:300_000,cwd:staging})
   if(signal.aborted)throw new Error('Runtime operation cancelled.')
   const installed=this.packageAt(join(staging,'node_modules'))
   if(!installed||installed.version!==this.options.version)throw new Error('The installed Qwen CLI could not be verified.')
   progress('verifying')
   const version=await this.run(node,[installed.entry,'--version'],{signal,timeout:30_000,cwd:staging})
   if(!version.split(/\s+/).includes(this.options.version))throw new Error('The installed Qwen CLI could not be verified.')
   if(signal.aborted)throw new Error('Runtime operation cancelled.')
   await rm(this.directory,{recursive:true,force:true});await rename(staging,this.directory)
   if(!this.use(this.packageAt(join(this.directory,'node_modules')),'managed'))throw new Error('The installed Qwen CLI could not be verified.')
   return{...this.snapshot!}
  }finally{await rm(staging,{recursive:true,force:true}).catch(()=>{})}
 }
}
