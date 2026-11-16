import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadTypeScript} from './load-typescript.mjs'
import {harness} from './main-harness.mjs'
const {DesktopStore}=loadTypeScript('src/main/desktop-store.ts'),{StudioStore}=loadTypeScript('src/main/studio-store.ts'),{SettingsStore}=loadTypeScript('src/main/settings-store.ts')
async function fixture(){const base=await mkdtemp(join(tmpdir(),'qwen-onboarding-'));return {base,home:join(base,'home'),project:join(base,'project')}}
const profile={id:null,label:'First model',model:'test-first',provider:'openai',baseUrl:'http://127.0.0.1:7788/v1',keySource:'stored',envKey:'',apiKey:'test-secret-do-not-expose'}
test('desktop language and onboarding survive restart; bad preferences are not overwritten',async()=>{
 const f=await fixture();try{const file=join(f.base,'preferences.json'),s=new DesktopStore(file,'zh-TW');assert.equal(s.read().language,'zh-CN');assert.equal(s.read().onboardingCompleted,false);s.language('en');s.complete();assert.deepEqual(structuredClone(new DesktopStore(file,'ru').read()),{version:1,language:'en',onboardingCompleted:true});assert.throws(()=>s.language('bad'),/язык/);await writeFile(file,'damaged');assert.throws(()=>s.language('ru'));assert.equal(await readFile(file,'utf8'),'damaged')}finally{await rm(f.base,{recursive:true,force:true})}
})
test('default model applies without a chat, to future chats, and respects explicit native/per-chat choices',async()=>{
 const f=await fixture();try{const codec={available:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()},s=new StudioStore(join(f.base,'studio.json'),codec);s.saveModel({...profile,revision:s.view(null,null).revision});const id=s.view(null,null).profiles[0].id;s.setDefault(id);assert.equal(s.view(null,null).selectedModelId,id);assert.equal(s.view('new-chat',f.project).selectedModelId,id);assert.equal(s.runtime('new-chat',f.project).model,'test-first');s.select('native-chat',null);assert.equal(s.runtime('native-chat',f.project).model,undefined);assert.equal(s.runtime('new-chat',f.project,{},null).model,undefined);assert.equal(new StudioStore(join(f.base,'studio.json'),codec).view('new-chat',f.project).selectedModelId,id);s.removeModel(id,s.view(null,null).revision);assert.equal(s.view(null,null).defaultModelId,null)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('onboarding can configure and verify a model before selecting a folder, without global CLI, chat events or keys in views',async()=>{
 const f=await fixture(),launches=[];const h=await harness({userData:f.base,folder:f.project,query:config=>{launches.push(config);return {initialized:Promise.resolve(),close:async()=>{},async *[Symbol.asyncIterator](){yield {type:'result',subtype:'success',is_error:false,result:'OK',session_id:crypto.randomUUID()}}}}})
 try{
  let state=(await h.invoke('get-connection-state')).value;assert.equal(state.runtimeReady,true);assert.equal(state.preferences.onboardingCompleted,false);assert.equal(state.configurationFound,false)
  const saved=await h.invoke('save-model',{...profile,revision:(await h.invoke('get-studio','user')).value.revision});assert.equal(saved.ok,true,saved.error);const id=saved.value.profiles[0].id
  let checked=await h.invoke('test-connection',id);assert.equal(checked.value.verified,true);assert.equal(h.events.length,0);assert.equal(launches.length,1);assert.ok(launches[0].options.pathToQwenExecutable.endsWith('qwen-bootstrap.cjs'));assert.equal(launches[0].options.env.QWEN_CODE_SAFE_MODE,'true');assert.equal(launches[0].options.env.QWEN_USAGE_STATISTICS_ENABLED,'false');assert.equal(launches[0].options.env.QWEN_TELEMETRY_ENABLED,'false');assert.equal(launches[0].options.maxToolCalls,0);assert.equal((await launches[0].options.canUseTool()).behavior,'deny')
  const complete=await h.invoke('complete-onboarding',id,false);assert.equal(complete.ok,true,complete.error);state=complete.value;assert.equal(state.configurationFound,true);assert.equal(state.preferences.onboardingCompleted,true);assert.equal(JSON.stringify(state).includes(profile.apiKey),false);assert.equal((await h.invoke('load')).value.chat,null)
  await mkdir(f.project);await h.invoke('select-folder');assert.equal((await h.invoke('load')).value.modelProfileId,id)
 }finally{await h.close();await rm(f.base,{recursive:true,force:true})}
})
test('checks are cancellable and exclude conflicting mutations; missing credentials are not marked verified',async()=>{
 const f=await fixture();const h=await harness({userData:f.base,folder:f.project,query:({options})=>({initialized:Promise.resolve(),close:async()=>{},async *[Symbol.asyncIterator](){await new Promise(r=>options.abortController.signal.addEventListener('abort',r,{once:true}))}})})
 try{const pending=h.invoke('test-connection',null);await new Promise(r=>setTimeout(r,40));assert.equal((await h.invoke('set-ui-language','en')).ok,false);assert.equal((await h.invoke('cancel-connection-test')).ok,true);const r=await pending;assert.equal(r.value.verified,false);assert.equal(r.value.code,'cancelled');assert.equal((await h.invoke('get-connection-state')).value.preferences.onboardingCompleted,false);assert.equal((await h.invoke('complete-onboarding',null,true)).ok,true);assert.equal((await h.invoke('get-connection-state')).value.configurationFound,false)}finally{await h.close();await rm(f.base,{recursive:true,force:true})}
})
test('native setup detection requires credentials and a model, not CLI presence',async()=>{
 const f=await fixture();try{await mkdir(join(f.home,'.qwen'),{recursive:true});const s=new SettingsStore(f.home,{QWEN_CODE_SYSTEM_SETTINGS_PATH:join(f.base,'system.json')});assert.equal(s.connectionConfigured(null,{}),false);await writeFile(join(f.home,'.qwen/settings.json'),JSON.stringify({security:{auth:{selectedType:'openai'}},model:{name:'example'}}));assert.equal(s.connectionConfigured(null,{}),false);assert.equal(s.connectionConfigured(null,{OPENAI_API_KEY:'not-real'}),true);await writeFile(join(f.home,'.qwen/settings.json'),JSON.stringify({security:{auth:{selectedType:'qwen-oauth'}}}));assert.equal(s.connectionConfigured(null,{}),false);await writeFile(join(f.home,'.qwen/oauth_creds.json'),'{}');assert.equal(s.connectionConfigured(null,{}),true)}finally{await rm(f.base,{recursive:true,force:true})}
})
test('startup detection restores the last chat before inspecting its explicit model profile',async()=>{
 const f=await fixture();let h=await harness({userData:f.base,folder:f.project,query:()=>{throw Error('No model call expected')}})
 try{
  await mkdir(f.project);await h.invoke('select-folder');const saved=await h.invoke('save-model',{...profile,revision:(await h.invoke('get-studio','user')).value.revision});const id=saved.value.profiles[0].id;await h.invoke('select-model',id);await h.invoke('complete-onboarding',null,true);await h.close()
  h=await harness({userData:f.base,folder:f.project,query:()=>{throw Error('No model call expected')}})
  const state=await h.invoke('get-connection-state');assert.equal(state.ok,true,state.error);assert.equal(state.value.selectedModelId,id);assert.equal(state.value.configurationFound,true);assert.equal(state.value.preferences.onboardingCompleted,true)
 }finally{await h.close();await rm(f.base,{recursive:true,force:true})}
})

test('native folder dialog title follows the chosen interface language',async()=>{const f=await fixture(),dialogs=[];const h=await harness({userData:f.base,folder:f.project,onDialog:d=>dialogs.push(d)});try{await mkdir(f.project);await h.invoke('set-ui-language','zh-CN');await h.invoke('select-folder');assert.equal(dialogs.at(-1).title,'选择工作目录')}finally{await h.close();await rm(f.base,{recursive:true,force:true})}})

test('choosing a new default preserves existing chat routes while future chats inherit it',async()=>{const f=await fixture();try{const s=new StudioStore(join(f.base,'studio.json'),{available:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});s.saveModel({...profile,revision:s.view(null,null).revision});const id=s.view(null,null).profiles[0].id;s.setDefault(id,['old-native-chat']);assert.equal(s.view('old-native-chat',f.project).selectedModelId,null);assert.equal(s.view('future-chat',f.project).selectedModelId,id);s.select('explicit-native',null);s.setDefault(id,['explicit-native']);assert.equal(s.view('explicit-native',f.project).selectedModelId,null)}finally{await rm(f.base,{recursive:true,force:true})}})
