import{createInterface}from'node:readline';import{appendFileSync}from'node:fs';const rl=createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result
 if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'gui-fixture',version:'1'}}
 else if(m.method==='tools/list')result={tools:[{name:'echo_status',description:'Get the GUI fixture connection status',inputSchema:{type:'object',properties:{}}}]}
 else if(m.method==='tools/call'){appendFileSync(process.env.QWEN_FIXTURE_MARKER,'MCP_EXECUTED\n');result={content:[{type:'text',text:'GUI MCP executed'}]}}
 else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unsupported fixture method'}})+'\n');return}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n')
});
