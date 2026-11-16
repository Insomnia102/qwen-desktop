import{test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{query}from'@qwen-code/sdk';import{harness,root}from'./main-harness.mjs';
test('real SDK applies model profiles, system prompt changes on resume, auto skill calls and native /skill expansion',{timeout:90000},async(t)=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-real-studio-')),requests=[],diagnostics=[];let phase='auto',round=0
 const server=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push({phase,body,auth:req.headers.authorization});round++
  let fn;if(phase==='auto'&&round===1){const tool=body.tools?.find(t=>t.function?.name==='skill');assert.ok(tool,'Skill tool not offered');fn={name:'skill',arguments:JSON.stringify({skill:'demo-task-brief'})}}
  const content=phase==='auto'?'SKILL_CHECK: demo-task-brief':phase==='manual'?'SKILL_CHECK: demo-command-report':'MODEL_SWITCHED'
  const call={id:'studio-call-'+phase,type:'function',function:fn},finish=fn?'tool_calls':'stop';if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const packet=delta=>({id:'chatcmpl-studio',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:null}]});res.write('data: '+JSON.stringify(packet(fn?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content}))+'\n\n');const end=packet({});end.choices[0].finish_reason=finish;end.usage={prompt_tokens:10,completion_tokens:10,total_tokens:20};res.end('data: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n')}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'chatcmpl-studio',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:fn?null:content,...fn?{tool_calls:[call]}:{}},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}))}
 }catch(e){res.writeHead(500);res.end(String(e))}});await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const h=await harness({userData:join(base,'app'),folder:base,query:config=>query({prompt:config.prompt,options:{...config.options,env:{...config.options.env,QWEN_HOME:join(base,'app/home/.qwen')},stderr:t=>diagnostics.push(t)}})})
 // Query.close() requests child termination; Windows may still hold its cwd.
 // A teardown hook also keeps a failed scenario visible if cleanup itself fails.
 t.after(async()=>{
  await h.close()
  server.closeAllConnections()
  await new Promise(r=>server.close(r))
  await rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:200})
 })
 try{
  await h.invoke('select-folder');await mkdir(join(base,'.qwen'),{recursive:true});await writeFile(join(base,'.qwen/settings.json'),JSON.stringify({memory:{enableManagedAutoMemory:false,enableManagedAutoDream:false,enableAutoSkill:false},security:{auth:{baseUrl:'http://127.0.0.1:1/wrong',apiKey:'wrong-key'}},modelProviders:{openai:[{id:'fixture-one',name:'CLI conflicting entry',baseUrl:'http://127.0.0.1:1/wrong',envKey:'THIS_KEY_IS_NOT_SET'}]}}));await h.invoke('set-mode','yolo');let view=(await h.invoke('get-studio','user')).value
  const conflict=await h.invoke('save-model',{revision:view.revision,id:null,label:'Conflicting route',model:'fixture-one',provider:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,keySource:'stored',envKey:'',apiKey:'fake'});assert.equal(conflict.ok,false);assert.match(conflict.error,/modelProviders/);const saved=await h.invoke('save-model',{revision:view.revision,id:null,label:'Fixture One',model:'fixture-fresh',provider:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,keySource:'stored',envKey:'',apiKey:'fixture-stored-token'});assert.equal(saved.ok,true,saved.error);await h.invoke('select-model',saved.value.profiles[0].id)
  view=(await h.invoke('get-studio','project')).value;assert.equal((await h.invoke('save-prompt',{revision:view.revision,scope:'project',prompt:{mode:'append',text:'SYSTEM_PROMPT_MARKER_ONE'}})).ok,true)
  // Import actual authored demo skills through the same store used by the picker.
  const {loadTypeScript}=await import('./load-typescript.mjs');const{SkillsStore}=loadTypeScript('src/main/skills-store.ts');const store=new SkillsStore(join(base,'app/home'))
  store.importDirectory('project',join(root,'tests/fixtures/skills/demo-task-brief'),base);store.importDirectory('project',join(root,'tests/fixtures/skills/demo-command-report'),base)
  await h.start('auto','Составь план функции уведомлений, разложи идею на три шага.');await h.done('auto',25000)
  assert.equal((await h.view()).chat.status,'done',JSON.stringify(h.events));assert.equal(requests[0].body.model,'fixture-fresh');assert.equal(requests[0].auth,'Bearer fixture-stored-token');assert.ok(JSON.stringify(requests[0].body.messages).includes('SYSTEM_PROMPT_MARKER_ONE'))
  const tool=h.events.find(e=>e.type==='tool'&&e.name==='skill'&&e.state==='done');assert.ok(tool,'Skill did not run');assert.equal(tool.input.skill,'demo-task-brief');assert.ok(requests.some(r=>JSON.stringify(r.body.messages).includes('SKILL_CHECK: demo-task-brief')),'Skill body was not injected into context')
  const firstChat=(await h.view()).chat.id,firstSession=(await h.view()).chat.sessionId
  await h.invoke('new-chat');await h.invoke('select-model',saved.value.profiles[0].id);phase='manual';round=0
  await h.start('manual','/demo-command-report проверка slash-команды');await h.done('manual',25000);assert.equal((await h.view()).chat.status,'done')
  assert.ok(requests.filter(r=>r.phase==='manual').some(r=>JSON.stringify(r.body.messages).includes('SKILL_CHECK: demo-command-report')),'Native slash did not expand SKILL.md')
  assert.ok(requests.filter(r=>r.phase==='manual').some(r=>JSON.stringify(r.body.messages).includes('проверка slash-команды')),'Arguments lost')
  const beforeContext=requests.length;await h.start('context','/context');await h.done('context',15000);assert.equal((await h.view()).chat.status,'done');assert.equal(requests.length,beforeContext,'/context unexpectedly called the model')
  await h.invoke('select-chat',firstChat);view=(await h.invoke('get-studio','user')).value
  const second=await h.invoke('save-model',{revision:view.revision,id:null,label:'Fixture Two',model:'fixture-two',provider:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,keySource:'stored',envKey:'',apiKey:'fixture-second-token'});assert.equal(second.ok,true,second.error);await h.invoke('select-model',second.value.profiles.find(p=>p.label==='Fixture Two').id)
  view=(await h.invoke('get-studio','project')).value;await h.invoke('save-prompt',{revision:view.revision,scope:'project',prompt:{mode:'replace',text:'SYSTEM_PROMPT_MARKER_TWO'}})
  phase='switch';round=0;await h.start('switch','Continue the same conversation.');await h.done('switch',25000)
  assert.equal((await h.view()).chat.sessionId,firstSession);const last=requests.filter(r=>r.phase==='switch').at(-1);assert.equal(last.body.model,'fixture-two');assert.equal(last.auth,'Bearer fixture-second-token');assert.ok(JSON.stringify(last.body.messages).includes('SYSTEM_PROMPT_MARKER_TWO'))
 }catch(error){console.error('REQUEST_PHASES',requests.map(r=>({phase:r.phase,model:r.body.model,tools:r.body.tools?.map(t=>t.function?.name)})));console.error(diagnostics.join('').slice(-11000));throw error}
})
