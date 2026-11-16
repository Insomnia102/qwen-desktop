import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises'
import {join,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {loadTypeScript} from './load-typescript.mjs'
const {RuntimeManager,runProgram,pathExecutable}=loadTypeScript('src/main/runtime-manager.ts')
const version='0.27.2'
async function pkg(root,v=version){const path=join(root,'@qwen-code/qwen-code');await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify({name:'@qwen-code/qwen-code',version:v,bin:{qwen:'cli-entry.js'}}));await writeFile(join(path,'cli-entry.js'),'');await writeFile(join(path,'cli.js'),'')}
async function fixture(){const base=await mkdtemp(join(tmpdir(),'qwen-runtime-')),calls=[];const global=join(base,'global');await mkdir(global);let installError=false
 const run=async(command,args,options)=>{calls.push({command,args,options});assert.equal(options.signal?.aborted??false,false)
  if(args[0].endsWith('cli.js')&&args[1]==='--version')return version;
  if(args[0]==='--version')return 'v24.0.0';if(args[1]==='--version')return '11.0.0';if(args[1]==='root')return global
  if(args[1]==='install'){assert.equal(args.at(-1),'@qwen-code/qwen-code@'+version);if(installError)throw new Error('Fixture registry unavailable');await pkg(join(args[args.indexOf('--prefix')+1],'node_modules'));return ''}
  if(args[0].endsWith('cli.js'))return version;throw Error(JSON.stringify(args))
 }
 const options={directory:join(base,'data with spaces'),version,run,node:()=>'/fixture/Node with spaces/node.exe',npm:()=>'/fixture/npm cli.js'}
 return{base,calls,global,options,fail:()=>{installError=true}}
}
test('detects compatible global CLI without installing and bypasses the Windows relaunch wrapper',async()=>{
 const f=await fixture();try{await pkg(f.global);const r=new RuntimeManager(f.options),s=await r.inspect();assert.equal(s.ready,true);assert.equal(s.source,'system');assert.ok(basename(r.entry())==='cli.js');await r.prepare(new AbortController().signal,()=>{});assert.equal(f.calls.some(c=>c.args[1]==='install'),false)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('incompatible global version installs a pinned app-local CLI atomically; restart and removal are detected',async()=>{
 const f=await fixture();try{await pkg(f.global,'0.26.0');const r=new RuntimeManager(f.options),s=await r.inspect();assert.equal(s.ready,false);assert.equal(s.issue,'cli-incompatible');const phases=[];await r.prepare(new AbortController().signal,p=>phases.push(p));assert.deepEqual(phases,['checking','installing','verifying']);assert.equal(r.cached().source,'managed');const entry=r.entry();assert.ok(entry.includes('data with spaces'));await assert.rejects(access(join(f.options.directory,'qwen-'+version+'.installing')));assert.equal((await new RuntimeManager(f.options).inspect()).source,'managed');assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(join(f.global,'@qwen-code/qwen-code/package.json'))).version,'0.26.0');await rm(entry);assert.equal(r.cached().ready,false);assert.throws(()=>r.entry(),/unavailable/)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('missing or old Node and missing npm are reported without starting installation',async()=>{
 const f=await fixture();try{let r=new RuntimeManager({...f.options,node:()=>null});assert.equal((await r.prepare(new AbortController().signal,()=>{})).issue,'node-missing');r=new RuntimeManager({...f.options,run:async()=> 'v20.0.0'});assert.equal((await r.prepare(new AbortController().signal,()=>{})).issue,'node-old');r=new RuntimeManager({...f.options,npm:()=>null});assert.equal((await r.prepare(new AbortController().signal,()=>{})).issue,'npm-missing');assert.equal(f.calls.some(c=>c.args[1]==='install'),false)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('registry failure and cancellation do not mark partial installs ready',async()=>{
 const f=await fixture();try{f.fail();const r=new RuntimeManager(f.options);await assert.rejects(r.prepare(new AbortController().signal,()=>{}),/registry/);assert.equal(r.cached().ready,false);await assert.rejects(access(join(f.options.directory,'qwen-'+version+'.installing')));const abort=new AbortController();abort.abort();await assert.rejects(r.prepare(abort.signal,()=>{}));assert.equal(r.cached().ready,false)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('process runner preserves literal args and bounds a hung installer without returning stderr secrets',async()=>{
 const text=await runProgram(process.execPath,['-e','process.stdout.write(process.argv[1]);process.stderr.write("SECRET")','literal $(not-a-shell) & "quoted"'],{timeout:2000});assert.equal(text,'literal $(not-a-shell) & "quoted"');await assert.rejects(runProgram(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:25}),/timed out/)
 const abort=new AbortController(),pending=runProgram(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:2000,signal:abort.signal});abort.abort();await assert.rejects(pending,/cancelled/)
})

test('a matching version with a broken CLI is replaced by a verified managed copy',async()=>{
 const f=await fixture();try{await pkg(f.global);const run=async(command,args,options)=>{if(args[0].startsWith(f.global)&&args[0].endsWith('cli.js'))throw Error('Fixture CLI chunk missing');return f.options.run(command,args,options)};const r=new RuntimeManager({...f.options,run});assert.equal((await r.inspect()).issue,'cli-broken');assert.equal((await r.prepare(new AbortController().signal,()=>{})).source,'managed');assert.equal(r.cached().ready,true)}finally{await rm(f.base,{recursive:true,force:true})}
})

test('a Node shim resolves its real npm entry and reuses it during installation',async()=>{
 const f=await fixture(),actual=join(f.base,'real-node/bin/node'),npm=join(f.base,'real-node/lib/node_modules/npm/bin/npm-cli.js')
 try{
  const run=async(command,args,options)=>args[0]==='-p'?actual:f.options.run(command,args,options)
  const r=new RuntimeManager({...f.options,run,npm:node=>node===actual?npm:null})
  const result=await r.prepare(new AbortController().signal,()=>{});assert.equal(result.ready,true)
  const install=f.calls.find(c=>c.args[1]==='install');assert.equal(install.args[0],npm)
 }finally{await rm(f.base,{recursive:true,force:true})}
})

test('POSIX discovery skips a non-executable node file instead of hiding a later valid installation',{skip:process.platform==='win32'},async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-path-permissions-'))
 try{const a=join(base,'bad'),b=join(base,'good');await mkdir(a);await mkdir(b);await writeFile(join(a,'node'),'not executable',{mode:0o600});await writeFile(join(b,'node'),'#!/bin/sh\n',{mode:0o700});assert.equal(pathExecutable('node',a+':'+b),join(b,'node'))}finally{await rm(base,{recursive:true,force:true})}
})
