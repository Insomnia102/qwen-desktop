import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parse } from 'jsonc-parser'
import { loadTypeScript } from './load-typescript.mjs'
import { harness } from './main-harness.mjs'
const { McpStore, validateMcpConfig } = loadTypeScript('src/main/mcp-store.ts')
const { probeMcp } = loadTypeScript('src/main/mcp-client.ts')
const fixture = fileURLToPath(new URL('./mcp-stdio-fixture.mjs', import.meta.url))
async function setup() {
 const base=await mkdtemp(join(tmpdir(),'qwen-mcp-v1-')),home=join(base,'home'),project=join(base,'project'); await mkdir(join(home,'.qwen'),{recursive:true}); await mkdir(join(project,'.qwen'),{recursive:true})
 return {base,home,project,user:join(home,'.qwen/settings.json'),file:join(project,'.qwen/settings.json'),store:new McpStore(home,{QWEN_CODE_SYSTEM_SETTINGS_PATH:join(base,'system.json')})}
}
test('MCP CRUD preserves JSONC/auth/skills/native policies; toggling retains credentials and settings survive restart',async()=>{
 const f=await setup();try {
  await writeFile(f.user,'{ // preserved comment\n"auth":{"secret":"keep"},"tools":{"disabled":["edit"]},"memory":{"enableAutoSkill":true},"mcpServers":{"existing":{"httpUrl":"https://example.test/mcp","oauth":{"custom":"untouched"}}}}')
  let v=f.store.loadMcp('user',f.project)
  const config={command:process.execPath,args:[fixture],env:{MCP_KEY:'$MY_TOKEN'},trust:false,description:'<script>plain</script>',customFutureOption:{keep:true}}
  v=f.store.mutateMcp({scope:'user',revision:v.revision,name:'my.tools',action:'save',create:true,config},f.project)
  assert.equal(v.servers.find(s=>s.name==='my.tools').enabled,true)
  v=f.store.mutateMcp({scope:'user',revision:v.revision,name:'my.tools',action:'toggle',enabled:false},f.project)
  assert.equal(v.servers.find(s=>s.name==='my.tools').enabled,false)
  let saved=parse(await readFile(f.user,'utf8'));assert.deepEqual(saved.mcpServers['my.tools'],config);assert.equal(saved.auth.secret,'keep');assert.equal(saved.memory.enableAutoSkill,true);assert.deepEqual(saved.tools.disabled,['edit']);assert.equal(saved.mcpServers.existing.oauth.custom,'untouched')
  assert.ok((await readFile(f.user,'utf8')).includes('// preserved comment'));assert.ok(await readFile(f.user+'.desktop.bak','utf8'))
  v=f.store.mutateMcp({scope:'user',revision:v.revision,name:'my.tools',action:'toggle',enabled:true},f.project)
  const restarted=new McpStore(f.home,{QWEN_CODE_SYSTEM_SETTINGS_PATH:join(f.base,'system.json')});assert.equal(restarted.loadMcp('user',f.project).servers.find(s=>s.name==='my.tools').enabled,true)
  assert.throws(()=>f.store.mutateMcp({scope:'user',revision:'old',name:'my.tools',action:'remove'},f.project),/изменились/)
  v=f.store.mutateMcp({scope:'user',revision:v.revision,name:'my.tools',action:'remove'},f.project);assert.equal(v.servers.some(s=>s.name==='my.tools'),false);assert.equal(v.servers.length,1)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('MCP layers, .mcp.json, wildcard restrictions and scope locks match native precedence',async()=>{
 const f=await setup();try {
  await writeFile(f.user,JSON.stringify({mcpServers:{a:{command:'node',args:['a.js']},shared:{command:'node',args:['old.js']}},mcp:{excluded:['a*'],allowed:['a','shared','fromfile']}}))
  await writeFile(join(f.project,'.mcp.json'),JSON.stringify({mcpServers:{fromfile:{httpUrl:'http://localhost:3333/mcp'},shared:{command:'node',args:['file.js']}}}))
  await writeFile(f.file,JSON.stringify({mcpServers:{shared:{command:'node',args:['project.js']},other:{command:'node'}},mcp:{excluded:['other']}}))
  let v=f.store.loadMcp('project',f.project)
  const a=v.servers.find(s=>s.name==='a');assert.equal(a.enabled,false);assert.equal(a.toggleLocked,true);assert.equal(a.editable,false)
  assert.equal(v.servers.find(s=>s.name==='shared').config.args[0],'project.js');assert.equal(v.servers.find(s=>s.name==='shared').editable,true)
  assert.equal(v.servers.find(s=>s.name==='fromfile').editable,false);assert.equal(v.servers.find(s=>s.name==='fromfile').enabled,true)
  assert.equal(v.servers.find(s=>s.name==='other').toggleLocked,true)
  assert.throws(()=>f.store.mutateMcp({scope:'project',revision:v.revision,action:'toggle',name:'a',enabled:true},f.project),/ограничен/)
  v=f.store.mutateMcp({scope:'project',revision:v.revision,action:'toggle',name:'fromfile',enabled:false},f.project);assert.equal(v.servers.find(s=>s.name==='fromfile').enabled,false)
  assert.throws(()=>f.store.mutateMcp({scope:'project',revision:v.revision,action:'remove',name:'fromfile'},f.project),/выбранной/)
  const old=v.contextRevision;await writeFile(f.user,'{"mcpServers":{}}');assert.throws(()=>f.store.probeConfig('project','shared',old,f.project),/изменились/)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('invalid config, duplicate names and prototype keys never modify settings',async()=>{
 const f=await setup();try {
  const v=f.store.loadMcp('user',null)
  for (const config of [{},{command:'node',httpUrl:'http://localhost/mcp'},{httpUrl:'file:///etc/passwd'},{command:'node',args:'a b'},{command:'node',env:{X:4}},{command:'node',timeout:0}]) assert.throws(()=>validateMcpConfig(config))
  assert.throws(()=>f.store.mutateMcp({scope:'user',revision:v.revision,action:'save',name:'__proto__',create:true,config:{command:'node'}},null),/Некорректный/)
  const x=f.store.mutateMcp({scope:'user',revision:v.revision,action:'save',name:'valid',create:true,config:{command:'node'}},null)
  assert.throws(()=>f.store.mutateMcp({scope:'user',revision:x.revision,action:'save',name:'valid',create:true,config:{command:'node'}},null),/существует/)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('real stdio probe lists paginated tools, applies filters and never executes tools',async()=>{
 const result=await probeMcp('fixture',{command:process.execPath,args:[fixture],excludeTools:['blocked'],timeout:5000},null,new AbortController().signal)
 assert.equal(result.serverName,'desktop-test-server');assert.equal(result.tools.length,2);assert.equal(result.tools[0].name,'echo_status');assert.equal(result.tools.find(t=>t.name==='blocked').enabled,false)
})
test('real HTTP MCP handshake and authorization headers work without any model call',async()=>{
 let auth, calls=0, terminated=false
 const server=createServer(async(req,res)=>{
  if(req.method==='DELETE'){terminated=true;res.writeHead(200);res.end();return}
  if(req.method==='GET'){res.writeHead(405);res.end();return}
  let text='';for await (const chunk of req)text+=chunk
  const msg=JSON.parse(text);auth=req.headers.authorization
  if(msg.id===undefined){res.writeHead(202);res.end();return}
  calls++
  const result=msg.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'http-fixture',version:'1'}}:{tools:[{name:'http_tool',description:'Remote fixture',inputSchema:{type:'object'}}]}
  res.writeHead(200,{'Content-Type':'application/json','Mcp-Session-Id':'fixture-session'});res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}))
 });await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{ const result=await probeMcp('http',{httpUrl:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer fixture-only'},timeout:5000},null,new AbortController().signal);assert.equal(auth,'Bearer fixture-only');assert.equal(calls,2);assert.equal(result.tools[0].name,'http_tool');assert.equal(terminated,true) }
 finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('probe cancellation is bounded, secrets do not leak in errors, and missing env has a clear message',async()=>{
 const controller=new AbortController();const work=probeMcp('hang',{command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeout:5000},null,controller.signal);setTimeout(()=>controller.abort(),100)
 await assert.rejects(work,/отменена/)
 await assert.rejects(probeMcp('env',{httpUrl:'http://127.0.0.1:1/mcp',headers:{Authorization:'$QWEN_MISSING_FIXTURE_TOKEN'},timeout:1000},null,new AbortController().signal),/переменная QWEN_MISSING/)
 await assert.rejects(probeMcp('secret',{httpUrl:'http://127.0.0.1:1/secret-token-in-url',headers:{Authorization:'VERY_SECRET'},timeout:1000},null,new AbortController().signal),error=>!String(error).includes('VERY_SECRET')&&!String(error).includes('secret-token-in-url'))
})
test('IPC saves MCP in the selected workdir and rejects probe/mutation during active generation',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-mcp-ipc-'));let release;const gate=new Promise(r=>release=r)
 const h=await harness({userData:join(base,'app'),folder:base,query:()=>({initialized:Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:async()=>{},async *[Symbol.asyncIterator](){await gate;yield {type:'result',subtype:'success',is_error:false,result:'done',session_id:crypto.randomUUID()}}})})
 try{await h.invoke('select-folder');let v=(await h.invoke('get-mcp','project')).value;const saved=await h.invoke('mutate-mcp',{scope:'project',revision:v.revision,name:'fixture',action:'save',create:true,config:{command:process.execPath,args:[fixture]}});assert.equal(saved.ok,true,saved.error)
 const probe=await h.invoke('probe-mcp',{scope:'project',contextRevision:saved.value.contextRevision,name:'fixture'});assert.equal(probe.ok,true,probe.error);assert.equal(probe.value.tools.length,2)
 await h.start('busy');assert.equal((await h.invoke('probe-mcp',{scope:'project',name:'fixture',contextRevision:saved.value.contextRevision})).ok,false)
 assert.equal((await h.invoke('mutate-mcp',{scope:'project',revision:saved.value.revision,name:'fixture',action:'toggle',enabled:false})).ok,false);release();await h.done('busy')
 }finally{release();await h.close();await rm(base,{recursive:true,force:true})}
})

test('project MCP consent survives restart, is scoped to its folder and invalidates every external configuration edit',async()=>{
 const {McpConsent}=loadTypeScript('src/main/mcp-consent.ts'),f=await setup()
 try{const file=join(f.base,'consent.json'),config={command:'node',args:['server.js'],env:{KEY:'not-stored-verbatim'}}
 let consent=new McpConsent(file);assert.equal(consent.has(f.project,'server',config),false);consent.grant(f.project,'server',config)
 consent=new McpConsent(file);assert.equal(consent.has(f.project,'server',config),true);assert.equal(consent.has(f.project+'-other','server',config),false)
 assert.equal(consent.has(f.project,'server',{...config,args:['edited.js']}),false);assert.equal(consent.has(f.project,'server',{...config,trust:true}),false)
 assert.equal((await readFile(file,'utf8')).includes('not-stored-verbatim'),false)
 }finally{await rm(f.base,{recursive:true,force:true})}
})
test('legacy SSE MCP transport negotiates and lists tools',async()=>{
 const {Server}=await import('@modelcontextprotocol/sdk/server/index.js'),{SSEServerTransport}=await import('@modelcontextprotocol/sdk/server/sse.js'),{ListToolsRequestSchema}=await import('@modelcontextprotocol/sdk/types.js')
 let transport;const mcp=new Server({name:'sse-fixture',version:'1'},{capabilities:{tools:{}}});mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'legacy_tool',inputSchema:{type:'object'}}]}))
 const server=createServer(async(req,res)=>{try{if(req.url==='/sse'){transport=new SSEServerTransport('/messages',res);await mcp.connect(transport)}else if(req.url.startsWith('/messages'))await transport.handlePostMessage(req,res);else{res.writeHead(404);res.end()}}catch{res.writeHead(500);res.end()}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const result=await probeMcp('sse',{url:`http://127.0.0.1:${server.address().port}/sse`,timeout:5000},null,new AbortController().signal);assert.equal(result.serverName,'sse-fixture');assert.equal(result.tools[0].name,'legacy_tool')}
 finally{await mcp.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
})
