import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {harness} from './main-harness.mjs'
import {loadTypeScript} from './load-typescript.mjs'
const {waitFor}=loadTypeScript('src/main/async-lifecycle.ts')
test('startup deadline and cancellation release an unresolved handshake',async()=>{
 const abort=new AbortController()
 await assert.rejects(waitFor(new Promise(()=>{}),abort.signal,10,'initialization deadline'),/initialization deadline/)
 const work=waitFor(new Promise(()=>{}),abort.signal,1000,'deadline');abort.abort();await assert.rejects(work,/cancelled/)
})
test('missing handshake and stuck close produce error/done and allow the next prompt',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-handshake-'));let stuck=true,abort
 const h=await harness({userData:base,folder:base,startupMs:15,query:({options})=>{
  abort=options.abortController;return {initialized:stuck?new Promise(()=>{}):Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:()=>stuck?new Promise(()=>{}):Promise.resolve(),async *[Symbol.asyncIterator](){yield {type:'result',is_error:false,subtype:'success',result:'OK',session_id:crypto.randomUUID()}}}
 }})
 try{await h.invoke('select-folder');await h.start('stuck');await h.done('stuck',3500);const events=h.events.filter(e=>e.requestId==='stuck');assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).cancelled,false);assert.match(events.find(e=>e.type==='error').text,/45 секунд/);assert.equal(abort.signal.aborted,true);assert.equal((await h.view()).chat.status,'error');stuck=false;await h.start('next');await h.done('next');assert.equal((await h.view()).chat.status,'done')}
 finally{stuck=false;await h.close();await rm(base,{recursive:true,force:true})}
})
test('cancel while initialization is pending releases the chat even if SDK never acknowledges it',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-cancel-init-'))
 const h=await harness({userData:base,folder:base,query:()=>({initialized:new Promise(()=>{}),close:async()=>{}})})
 try{await h.invoke('select-folder');await h.start('cancel-init');await h.invoke('cancel');await h.done('cancel-init');assert.equal(h.events.at(-1).cancelled,true);assert.equal((await h.view()).chat.status,'stopped')}
 finally{await h.close();await rm(base,{recursive:true,force:true})}
})
