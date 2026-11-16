import { createInterface } from 'node:readline'
const rl=createInterface({input:process.stdin})
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return
 let result
 if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'desktop-test-server',version:'1.0'}}
 else if(m.method==='tools/list')result=m.params?.cursor?{tools:[{name:'blocked',description:'Filtered fixture',inputSchema:{type:'object'}}]}:{tools:[{name:'echo_status',description:'Read-only fixture',inputSchema:{type:'object'}}],nextCursor:'page-2'}
 else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'No execution permitted in discovery fixture'}})+'\n');return}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n')
})
