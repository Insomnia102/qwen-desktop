import {test} from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,rm,readFile,writeFile,readdir,chmod,stat}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createCipheriv,createDecipheriv,randomBytes}from'node:crypto';import{loadTypeScript}from'./load-typescript.mjs';import{harness,root}from'./main-harness.mjs';
const{SkillsStore}=loadTypeScript('src/main/skills-store.ts'),{StudioStore}=loadTypeScript('src/main/studio-store.ts');
async function fixture(){const base=await mkdtemp(join(tmpdir(),'qwen-studio-')),home=join(base,'home'),project=join(base,'project');await mkdir(home);await mkdir(project);return{base,home,project,env:{QWEN_CODE_SYSTEM_SETTINGS_PATH:join(base,'system.json')}}}
const defaults={id:null,label:'Qwen fixture',model:'fixture-one',provider:'openai',baseUrl:'http://127.0.0.1:7777/v1',keySource:'stored',envKey:'',apiKey:'test-KEY-not-for-real-API'}
function codec(){const key=randomBytes(32);return{available:()=>true,encrypt:text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()])},decrypt:data=>{const d=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]).toString()}}}
test('skill CRUD, files, raw frontmatter, invocation flags, conflict checks and soft removal persist',async()=>{
 const f=await fixture();try{const s=new SkillsStore(f.home,f.env);let d=s.save({scope:'project',id:null,revision:null,name:'my-skill',description:'When explaining demo code',body:'# Test\n\nDo the task.',userInvocable:true,modelInvocable:false},f.project)
 assert.equal(d.entry.modelInvocable,false);assert.equal(d.entry.userInvocable,true);assert.match(d.raw,/disable-model-invocation: true/)
 d=s.saveRaw('project',d.entry.id,d.entry.revision,d.raw.replace('---\n\n','hooks: {}\ncustomField: keep\n---\n\n'),f.project)
 d=s.save({scope:'project',id:d.entry.id,revision:d.entry.revision,name:d.entry.name,description:'Edited description',body:'Changed body',userInvocable:false,modelInvocable:true},f.project);assert.match(d.raw,/customField: keep/);assert.match(d.raw,/hooks: \{\}/)
 const empty='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';let file=s.saveFile('project',d.entry.id,{path:'references/example.md',text:'Пример',revision:empty},f.project);assert.equal(file.text,'Пример');if(process.platform!=='win32'){const path=join(f.project,'.qwen/skills/my-skill/references/example.md');await chmod(path,0o700);file=s.saveFile('project',d.entry.id,{...file,text:'Edited executable reference'},f.project);assert.equal((await stat(path)).mode&0o100,0o100)}assert.throws(()=>s.saveFile('project',d.entry.id,{path:'../outside',text:'x',revision:empty},f.project),/путь/)
 assert.throws(()=>s.saveFile('project',d.entry.id,{...file,revision:'old'},f.project),/изменился/)
 assert.throws(()=>s.save({scope:'project',id:d.entry.id,revision:'old',name:d.entry.name,description:'x',body:'x',userInvocable:true,modelInvocable:true},f.project),/извне/)
 s.toggle('project',d.entry.id,false,d.entry.revision,f.project);assert.equal(new SkillsStore(f.home,f.env).list('project',f.project).entries[0].enabled,false)
 s.remove('project',d.entry.id,d.entry.revision,f.project);assert.equal(s.list('project',f.project).entries.length,0);assert.equal((await readdir(join(f.project,'.qwen/desktop-skill-trash'))).length,1)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('skill import uses native folders, project takes precedence and inherited disable cannot be lifted',async()=>{
 const f=await fixture();try{const s=new SkillsStore(f.home,f.env)
 const d=s.importDirectory('user',join(root,'tests/fixtures/skills/demo-task-brief'),f.project);assert.equal(d.entry.userInvocable,false)
 s.importDirectory('project',join(root,'tests/fixtures/skills/demo-task-brief'),f.project);assert.equal(s.effective(f.project).find(e=>e.name==='demo-task-brief').scope,'project')
 await mkdir(join(f.home,'.qwen'),{recursive:true});await writeFile(join(f.home,'.qwen/settings.json'),'{"skills":{"disabled":["demo-task-brief"]},"mcpServers":{"preserve":{}}}')
 const project=s.list('project',f.project).entries[0];assert.equal(project.locked,true);assert.equal(project.enabled,false);assert.throws(()=>s.toggle('project',project.id,true,project.revision,f.project),/ограничен/)
 assert.throws(()=>s.importDirectory('user',join(root,'tests/fixtures/skills/demo-task-brief'),f.project),/существует/)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('model profiles encrypt keys, redact views, switch independently per chat and survive restart',async()=>{
 const f=await fixture(),path=join(f.base,'studio.json'),c=codec();try{let s=new StudioStore(path,c),v=s.view('a',f.project);s.saveModel({...defaults,revision:v.revision});v=s.view('a',f.project);const id=v.profiles[0].id;s.select('a',id)
 assert.equal(JSON.stringify(v).includes(defaults.apiKey),false);assert.equal((await readFile(path,'utf8')).includes(defaults.apiKey),false);assert.equal(v.profiles[0].hasKey,true)
 s=new StudioStore(path,c);assert.equal(s.view('a',f.project).selectedModelId,id);assert.equal(s.view('b',f.project).selectedModelId,null);const runtime=s.runtime('a',f.project);assert.equal(runtime.env.OPENAI_API_KEY,defaults.apiKey);assert.equal(runtime.model,'fixture-one')
 assert.throws(()=>s.saveModel({...defaults,revision:'old'}),/изменились/);v=s.view('a',f.project);s.removeModel(id,v.revision);assert.equal(s.view('a',f.project).selectedModelId,null)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('prompt scopes append/replace/reset apply independently; missing environment and insecure storage are explicit errors',async()=>{
 const f=await fixture();try{const s=new StudioStore(join(f.base,'studio.json'),{available:()=>false,encrypt:()=>{throw Error()},decrypt:()=>{throw Error()}})
 let v=s.view('a',f.project);s.savePrompt({revision:v.revision,scope:'user',prompt:{mode:'append',text:'GLOBAL_MARKER'}},f.project);assert.match(s.runtime('a',f.project).systemPrompt.append,/GLOBAL_MARKER/)
 v=s.view('a',f.project,'project');s.savePrompt({revision:v.revision,scope:'project',prompt:{mode:'replace',text:'PROJECT_MARKER'}},f.project);assert.equal(typeof s.runtime('a',f.project).systemPrompt,'string');assert.match(s.runtime('a',f.project).systemPrompt,/PROJECT_MARKER/)
 v=s.view('a',f.project,'project');s.savePrompt({revision:v.revision,scope:'project',prompt:null},f.project);assert.match(s.runtime('a',f.project).systemPrompt.append,/GLOBAL_MARKER/)
 v=s.view('a',f.project);assert.throws(()=>s.saveModel({...defaults,revision:v.revision}),/хранилище/)
 s.saveModel({...defaults,revision:v.revision,keySource:'environment',envKey:'MY_MISSING_KEY',apiKey:undefined});v=s.view('a',f.project);s.select('a',v.profiles[0].id);assert.throws(()=>s.runtime('a',f.project,{}),/MY_MISSING_KEY/)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('IPC model/prompt/skill choices reach SDK; slash skills are offered only when user-invocable and enabled',async()=>{
 const f=await fixture(),launches=[];const h=await harness({userData:join(f.base,'app'),folder:f.project,query:config=>{launches.push(config);return{initialized:Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:async()=>{},async *[Symbol.asyncIterator](){yield{type:'result',subtype:'success',is_error:false,session_id:crypto.randomUUID(),result:'Done'}}}}})
 try{await h.invoke('select-folder');let v=(await h.invoke('get-studio','user')).value
 let r=await h.invoke('save-model',{...defaults,revision:v.revision});assert.equal(r.ok,true,r.error);await h.invoke('select-model',r.value.profiles[0].id)
 v=(await h.invoke('get-studio','project')).value;r=await h.invoke('save-prompt',{revision:v.revision,scope:'project',prompt:{mode:'append',text:'MY_SYSTEM_PROMPT'}});assert.equal(r.ok,true,r.error)
 const d=await h.invoke('save-skill',{scope:'project',id:null,revision:null,name:'manual-test',description:'Manual',body:'Instructions',userInvocable:true,modelInvocable:false});assert.equal(d.ok,true,d.error)
 const auto=await h.invoke('save-skill',{scope:'project',id:null,revision:null,name:'auto-test',description:'Auto',body:'Instructions',userInvocable:false,modelInvocable:true});assert.equal(auto.ok,true,auto.error)
 let cmds=(await h.invoke('get-commands')).value;assert.ok(cmds.some(c=>c.name==='manual-test'));assert.equal(cmds.some(c=>c.name==='auto-test'),false)
 await h.start('test','/manual-test argument preserved');await h.done('test');assert.equal(launches[0].prompt,'/manual-test argument preserved');assert.equal(launches[0].options.model,'fixture-one');assert.equal(launches[0].options.env.OPENAI_API_KEY,defaults.apiKey);assert.match(launches[0].options.systemPrompt.append,/MY_SYSTEM_PROMPT/)
 await h.invoke('toggle-skill','project',d.value.entry.id,false,d.value.entry.revision);cmds=(await h.invoke('get-commands')).value;assert.equal(cmds.some(c=>c.name==='manual-test'),false)
 }finally{await h.close();await rm(f.base,{recursive:true,force:true})}
})
