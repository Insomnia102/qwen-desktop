import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join,delimiter} from 'node:path'
import {tmpdir} from 'node:os'
import {loadTypeScript} from './load-typescript.mjs'
const {commandPath}=loadTypeScript('src/main/platform-env.ts')
test('GUI PATH keeps custom entries and discovers nvm/fnm/local/Volta without running a shell',async()=>{
 const home=await mkdtemp(join(tmpdir(),'qwen-gui-home-'))
 try{
  const paths=['.local/bin','.volta/bin','.nvm/versions/node/v22.0.0/bin','.nvm/versions/node/v26.12.1/bin','.local/share/fnm/node-versions/v26.1.0/installation/bin']
  for(const p of paths)await mkdir(join(home,p),{recursive:true})
  const existing=join(home,'existing');await mkdir(existing);const env={PATH:existing}
  for(const platform of ['darwin','linux']){
   const found=commandPath(home,env,platform).split(delimiter);assert.equal(found[0],existing)
   for(const p of paths)assert.ok(found.includes(join(home,p)),p)
   assert.ok(found.indexOf(join(home,paths[3]))<found.indexOf(join(home,paths[2])))
   assert.equal(new Set(found).size,found.length)
  }
  assert.equal(env.PATH,existing);assert.equal(commandPath(home,env,'win32'),existing)
 }finally{await rm(home,{recursive:true,force:true})}
})
test('missing shell managers are harmless and NVM_DIR is respected',async()=>{
 const home=await mkdtemp(join(tmpdir(),'qwen-env-custom-'));try{
  const custom=join(home,'custom-nvm');await mkdir(join(custom,'versions/node/v26.0.0/bin'),{recursive:true})
  const found=commandPath(home,{PATH:'',NVM_DIR:custom},'darwin').split(delimiter)
  assert.ok(found.includes(join(custom,'versions/node/v26.0.0/bin')))
  assert.doesNotThrow(()=>commandPath(join(home,'not-present'),{PATH:''},'linux'))
 }finally{await rm(home,{recursive:true,force:true})}
})
