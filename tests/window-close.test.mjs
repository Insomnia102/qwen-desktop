import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {harness} from './main-harness.mjs'

test('closed and before-quit are safe when native window and webContents getters already throw',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-destroyed-idle-'))
 const h=await harness({userData:base,folder:base})
 try{
  h.destroyNative()
  assert.doesNotThrow(()=>h.stop())
  assert.doesNotThrow(()=>h.emitWindow('closed'))
  assert.doesNotThrow(()=>h.stop())
  assert.doesNotThrow(()=>h.emitWindow('closed'))
 }finally{await h.close();await rm(base,{recursive:true,force:true})}
})
test('closing after a completed answer preserves history and tolerates repeated shutdown',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-destroyed-done-'))
 let h=await harness({userData:base,folder:base,query:()=>({initialized:Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:async()=>{},async *[Symbol.asyncIterator](){yield {type:'result',subtype:'success',is_error:false,result:'Completed before closing',session_id:crypto.randomUUID()}}})})
 try{
  await h.invoke('select-folder');await h.start('completed');await h.done('completed')
  const before=await h.view();assert.equal(before.chat.status,'done')
  h.emitWindow('close');h.destroyNative();h.stop();h.emitWindow('closed');h.stop();await h.close()
  h=await harness({userData:base,folder:base});const after=await h.view()
  assert.equal(after.chat.id,before.chat.id);assert.equal(after.chat.sessionId,before.chat.sessionId);assert.equal(after.chat.turns[0].status,'done');assert.equal(after.chat.turns[0].events.filter(e=>e.type==='done').length,1)
 }finally{await h.close();await rm(base,{recursive:true,force:true})}
})
test('late SDK and permission callbacks after destruction save stopped history without sending to the dead renderer',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-destroyed-pending-'));let denied=false,closed=0
 let h=await harness({userData:base,folder:base,query:({options})=>({initialized:Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:async()=>{closed++},async *[Symbol.asyncIterator](){yield {type:'assistant',uuid:'partial',message:{id:'partial',content:[{type:'text',text:'Partial answer'}]}};const result=await options.canUseTool('run_shell_command',{command:'fixture'},{signal:options.abortController.signal});denied=result.behavior==='deny'}})})
 try{
  await h.invoke('select-folder');await h.start('pending-close');await h.wait(events=>events.some(e=>e.type==='permission'))
  const delivered=h.events.length;h.destroyNative();h.stop();h.emitWindow('closed');h.stop()
  // A destroyed renderer cannot issue IPC. Wait for the late SDK cleanup itself.
  await h.wait(()=>closed===1);assert.equal(denied,true);assert.equal(closed,1);assert.equal(h.events.length,delivered)
  await h.close();h=await harness({userData:base,folder:base});const view=await h.view(),turn=view.chat.turns.at(-1)
  assert.equal(turn.status,'stopped');assert.ok(turn.events.some(e=>e.type==='text'&&e.text==='Partial answer'));assert.equal(turn.events.find(e=>e.type==='permission-closed').allowed,false);assert.equal(turn.events.filter(e=>e.type==='done').length,1)
 }finally{await h.close();await rm(base,{recursive:true,force:true})}
})
test('closing cancels an in-flight CLI installation using the cached window identifier',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-destroyed-install-'));let installing=false,cancelled=false
 const h=await harness({userData:base,folder:base,runtime:{async prepare(signal){installing=true;await new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled=true;resolve()},{once:true}));throw Error('cancelled')}}})
 try{
  const work=h.invoke('prepare-runtime');await h.wait(()=>installing)
  h.destroyNative();h.stop();h.emitWindow('closed');assert.equal((await work).ok,false);assert.equal(cancelled,true)
 }finally{await h.close();await rm(base,{recursive:true,force:true})}
})
