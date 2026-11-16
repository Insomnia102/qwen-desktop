import {test} from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,readFile,rm,writeFile}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:http';import{query}from'@qwen-code/sdk';import{harness,root}from'./main-harness.mjs';
test('GUI project MCP is authorized by fingerprint, runs through real CLI, can be disabled, and external edits revoke its grant',{timeout:60000},async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-gui-mcp-')),marker=join(base,'executed.txt'),diagnostics=[],launches=[];let phase='enabled',round=0,executed=false
 const server=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);round++;const tools=(body.tools??[]).map(t=>t.function?.name),custom=tools.find(n=>n?.endsWith('echo_status'));let fn
  if(phase==='enabled'&&!executed){if(custom){fn={name:custom,arguments:'{}'};executed=true}else if(tools.includes('tool_search')&&round===1)fn={name:'tool_search',arguments:JSON.stringify({query:'select:mcp__gui_fixture__echo_status'})};else if(round<4&&tools.includes('tool_call')){fn={name:'tool_call',arguments:JSON.stringify({name:'mcp__gui_fixture__echo_status',arguments:{}})};executed=true}}
  if(phase==='disabled'&&round===1)fn={name:'tool_call',arguments:JSON.stringify({name:'mcp__gui_fixture__echo_status',arguments:{}})}
  const call={id:'mcp-'+phase+'-'+round,type:'function',function:fn},text='MCP check finished',finish=fn?'tool_calls':'stop'
  if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const packet=d=>({id:'fixture',object:'chat.completion.chunk',model:'fixture-qwen',created:1,choices:[{index:0,delta:d,finish_reason:null}]});res.write('data: '+JSON.stringify(packet(fn?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:text}))+'\n\n');const end=packet({});end.choices[0].finish_reason=finish;end.usage={prompt_tokens:10,completion_tokens:10,total_tokens:20};res.end('data: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n')}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'fixture-qwen',choices:[{index:0,message:{role:'assistant',content:fn?null:text,...fn?{tool_calls:[call]}:{}},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}))}
 }catch(e){res.writeHead(500);res.end(String(e))}});await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const h=await harness({userData:join(base,'app'),folder:base,query:config=>{launches.push(config.options);return query({prompt:config.prompt,options:{...config.options,authType:'openai',model:'fixture-qwen',env:{...config.options.env,QWEN_HOME:join(base,'isolated-qwen'),OPENAI_API_KEY:'local-fixture-only',OPENAI_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`},stderr:t=>diagnostics.push(t)}})}})
 try{
  await h.invoke('select-folder');await h.invoke('set-mode','yolo');let v=(await h.invoke('get-mcp','project')).value
  const saved=await h.invoke('mutate-mcp',{scope:'project',revision:v.revision,name:'gui_fixture',action:'save',create:true,config:{command:process.execPath,args:[join(root,'tests/mcp-call-fixture.mjs')],env:{QWEN_FIXTURE_MARKER:marker},trust:false}});assert.equal(saved.ok,true,saved.error);assert.equal(saved.value.servers[0].needsApproval,false)
  await h.start('enabled','Use the gui_fixture echo_status tool.');await h.done('enabled',25000)
  assert.equal((await h.view()).chat.status,'done',JSON.stringify(h.events));assert.ok(launches[0].mcpServers.gui_fixture)
  assert.match(await readFile(marker,'utf8'),/MCP_EXECUTED/);assert.ok(h.events.some(e=>e.type==='tool'&&(e.name.includes('echo_status')||e.input?.name?.includes('echo_status'))))
  v=(await h.invoke('get-mcp','project')).value
  assert.equal((await h.invoke('mutate-mcp',{scope:'project',revision:v.revision,name:'gui_fixture',action:'toggle',enabled:false})).ok,true)
  phase='disabled';round=0;await h.start('disabled','Reply without tools.');await h.done('disabled',20000);assert.equal(Object.keys(launches.at(-1).mcpServers).length,0);assert.equal((await readFile(marker,'utf8')).trim().split('\n').length,1,'Disabled server still executed')
  v=(await h.invoke('get-mcp','project')).value;await h.invoke('mutate-mcp',{scope:'project',revision:v.revision,name:'gui_fixture',action:'toggle',enabled:true})
  const path=join(base,'.qwen/settings.json'),data=JSON.parse(await readFile(path,'utf8'));data.mcpServers.gui_fixture.args.push('external-change');await writeFile(path,JSON.stringify(data))
  v=(await h.invoke('get-mcp','project')).value;assert.equal(v.servers[0].needsApproval,true)
  // A fresh process retains the grant only for the original exact configuration.
  await h.close()
 }catch(e){console.error(diagnostics.join('').slice(-10000));throw e}
 finally{await h.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(base,{recursive:true,force:true})}
})
