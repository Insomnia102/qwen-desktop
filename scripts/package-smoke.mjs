// Validate the actual packaged Electron-as-Node path. No API calls or project tools.
import {readdir,readFile,mkdtemp,rm,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {verifyLegalBundle} from './release-legal.mjs'
const pkg=JSON.parse(await readFile('package.json','utf8')),directories=await readdir('dist')
let directory,executable
if(process.platform==='darwin'){
 directory=directories.find(n=>n==='mac'||n==='mac-'+process.arch)
 if(!directory)throw Error('Packaged macOS app not found')
 const app=(await readdir(join('dist',directory))).find(n=>n.endsWith('.app'));if(!app)throw Error('Missing .app')
 const bundle=join('dist',directory,app);executable=join(bundle,'Contents/MacOS','qwen-desktop');directory=join(bundle,'Contents/Resources')
}else{
 const prefix=process.platform==='win32'?'win':'linux';directory=directories.find(n=>n===prefix+'-unpacked'||n===prefix+'-'+process.arch+'-unpacked');if(!directory)throw Error('Packaged application directory not found')
 const app=join('dist',directory);executable=join(app,process.platform==='win32'?'qwen-desktop.exe':'qwen-desktop');directory=join(app,'resources')
}
executable=resolve(executable);directory=resolve(directory)
await verifyLegalBundle(directory,pkg)
console.log('PASS: packaged GPLv3, dependency notices and source metadata')
const unpacked=join(directory,'app.asar.unpacked'),bootstrap=join(unpacked,'resources/qwen-bootstrap.cjs'),cli=join(unpacked,'node_modules/@qwen-code/sdk/dist/cli/cli.js')
await stat(executable);await stat(bootstrap);await stat(cli)
const expected=(await readFile(join(unpacked,'node_modules/@qwen-code/sdk/dist/BUNDLED_CLI_VERSION'),'utf8')).trim(),home=await mkdtemp(join(tmpdir(),'qwen-packaged-smoke-'))
try{
 const output=await new Promise((resolve,reject)=>{
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',FORK_MODE:'0',QWEN_CODE_NO_RELAUNCH:'true',QWEN_DESKTOP_CLI_ENTRY:cli,QWEN_HOME:home,QWEN_USAGE_STATISTICS_ENABLED:'false',QWEN_TELEMETRY_ENABLED:'false',OTEL_SDK_DISABLED:'true',QWEN_CODE_MODELS_DEV_REFRESH:'off'}
  const child=spawn(executable,[bootstrap,'--version'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr=''
  const timer=setTimeout(()=>{child.kill();reject(Error('Packaged CLI did not finish within 30 seconds'))},30000)
  child.stdout.on('data',b=>{stdout+=b});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000)})
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(`Packaged runtime exited ${code}: ${stderr}`))})
 })
 if(!String(output).trim().split(/\s+/).includes(expected))throw Error('Packaged CLI version does not match the SDK')
 console.log(`PASS: packaged Electron/bootstrap/SDK CLI ${expected} (${process.platform}/${process.arch})`)
}finally{await rm(home,{recursive:true,force:true})}
