import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,rm,writeFile,readFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {query} from '@qwen-code/sdk'
import {harness} from './main-harness.mjs'
test('fresh install verifies a model through bundled SDK with empty PATH, no project, no tools/hooks/MCP, and no history',{timeout:60000},async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-fresh-sdk-')),requests=[],stderr=[];let deny=false
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body)
  if(deny){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid API key',type:'authentication_error'}}));return}
  if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const packet=delta=>({id:'check-one',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:null}]});res.write('data: '+JSON.stringify(packet({role:'assistant',content:'OK'}))+'\n\n');const end=packet({});end.choices[0].finish_reason='stop';res.end('data: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n')}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'check-one',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:1,total_tokens:6}}))}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const home=join(base,'home/.qwen'),marker=join(base,'hook-must-not-run');await mkdir(home,{recursive:true})
 await writeFile(join(home,'settings.json'),JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:`node -e "require('fs').writeFileSync('${marker.replace(/\\/g,'/')}','bad')"`}]}]},mcpServers:{mustNotStart:{command:'this-command-does-not-exist'}},memory:{enableManagedAutoMemory:true}}))
 const h=await harness({userData:base,folder:join(base,'unused-project'),query:config=>query({prompt:config.prompt,options:{...config.options,safeMode:true,env:{...config.options.env,...(process.env.QWEN_TEST_INSTALLED_CLI?{QWEN_DESKTOP_CLI_ENTRY:process.env.QWEN_TEST_INSTALLED_CLI}:{}),QWEN_HOME:home,NATIVE_TEST_KEY:'project-test-key',PATH:''},stderr:t=>stderr.push(t)}})})
 try{
  const view=(await h.invoke('get-studio','user')).value;const saved=await h.invoke('save-model',{revision:view.revision,id:null,label:'Fresh test',model:'fresh-onboarding-test',provider:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,keySource:'stored',envKey:'',apiKey:'local-test-key'});assert.equal(saved.ok,true,saved.error);const id=saved.value.profiles[0].id
  let result=await h.invoke('test-connection',id);assert.equal(result.ok,true,result.error);assert.equal(result.value.verified,true,JSON.stringify({result,stderr}));assert.equal(requests.length,1);assert.equal(requests[0].model,'fresh-onboarding-test');assert.equal((requests[0].tools??[]).length,0);assert.equal(h.events.length,0);assert.equal((await h.view()).chat,null);await assert.rejects(access(marker))
  // Existing project routes must be checked in that project, while safe mode still disables customizations.
  const project=join(base,'unused-project');await mkdir(join(project,'.qwen'),{recursive:true});await writeFile(join(project,'.qwen/settings.json'),JSON.stringify({security:{auth:{selectedType:'openai'}},model:{name:'project-native'},modelProviders:{openai:[{id:'project-native',name:'Project native',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,envKey:'NATIVE_TEST_KEY'}]}}));await h.invoke('select-folder');result=await h.invoke('test-connection',null);assert.equal(result.value.verified,true,JSON.stringify({result,stderr}));assert.equal(requests.at(-1).model,'project-native');assert.equal((await h.view()).chat.turns.length,0)
  // The same connection and runtime must work immediately after the wizard.
  const completed=await h.invoke('complete-onboarding',id,false);assert.equal(completed.ok,true,completed.error)
  await h.start('first-after-setup','Hello immediately after setup');await h.done('first-after-setup',25000)
  assert.equal((await h.view()).chat.status,'done',JSON.stringify({events:h.events,stderr}));assert.equal((await h.view()).modelProfileId,id)
  deny=true;result=await h.invoke('test-connection',id);assert.equal(result.value.verified,false);assert.equal(result.value.code,'auth');assert.equal(JSON.stringify(result).includes('local-test-key'),false);assert.equal((await h.invoke('get-connection-state')).value.preferences.onboardingCompleted,true)
 }finally{await h.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(base,{recursive:true,force:true})}
})
