import {mkdtemp,rm,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {query} from '@qwen-code/sdk'
import {waitFor,closeSession} from './async-lifecycle'
import {CORE_TOOLS} from '../shared/core-tools'
import type {ConnectionTestResult} from '../shared/desktop'
export async function checkConnection(options:{directory:string;cwd?:string;bootstrap:string;cli:string;model?:string;authType?:'openai'|'anthropic'|'gemini';env:Record<string,string>},abort:AbortController,launch:typeof query=query):Promise<ConnectionTestResult>{
 let cwd:string|undefined,session:ReturnType<typeof query>|undefined,timedOut=false
 const timer=setTimeout(()=>{timedOut=true;abort.abort()},30_000)
 try{
  await mkdir(options.directory,{recursive:true});cwd=await mkdtemp(join(options.directory,'check-'))
  session=launch({prompt:'Reply with exactly OK. Do not use any tools.',options:{
   cwd:options.cwd??cwd,pathToQwenExecutable:options.bootstrap,model:options.model,authType:options.authType,
   env:{...options.env,ELECTRON_RUN_AS_NODE:'1',FORK_MODE:'0',NO_COLOR:'1',FORCE_COLOR:'0',QWEN_CODE_NO_RELAUNCH:'true',QWEN_DESKTOP_CLI_ENTRY:options.cli,QWEN_CODE_SAFE_MODE:'true',QWEN_USAGE_STATISTICS_ENABLED:'false',QWEN_TELEMETRY_ENABLED:'false',OTEL_SDK_DISABLED:'true',QWEN_CODE_MODELS_DEV_REFRESH:'off'},
   permissionMode:'default',excludeTools:CORE_TOOLS.map(t=>t.name),canUseTool:async()=>({behavior:'deny',message:'Connection check does not allow tools'}),
   systemPrompt:'This is a connection check. Reply OK. Do not read or modify files or use tools.',
   abortController:abort,maxSessionTurns:1,maxToolCalls:0,extensions:[],allowedMcpServerNames:[],includePartialMessages:false,
   stderr:()=>{},logLevel:'error'
  }})
  await waitFor(session.initialized,abort.signal,30_000,'Connection initialization timed out')
  let success=false,detail=''
  const iterator=session[Symbol.asyncIterator]();while(true){const next=await waitFor(iterator.next(),abort.signal,30_000,'Connection request timed out');if(next.done)break;const message=next.value;if(abort.signal.aborted)break;if(message.type==='result'){success=!message.is_error&&Boolean(message.result?.trim());detail=message.is_error?message.error?.message??message.subtype:''}}
  if(abort.signal.aborted)return {verified:false,code:timedOut?'timeout':'cancelled'}
  if(success)return {verified:true,code:'ok'}
  return {verified:false,code:classify(detail)}
 }catch(error){return {verified:false,code:abort.signal.aborted?(timedOut?'timeout':'cancelled'):classify(error instanceof Error?error.message:'')}}
 finally{clearTimeout(timer);abort.abort();await closeSession(session);if(cwd)await rm(cwd,{recursive:true,force:true})}
}
function classify(text:string):ConnectionTestResult['code']{
 if(/401|403|unauthori|authentic|api.?key|credential|login|sign.?in/i.test(text))return 'auth'
 if(/404|model.?not.?found|unknown.?model|invalid.?model/i.test(text))return 'model'
 if(/fetch|ENOTFOUND|ECONN|network|socket|ETIMEDOUT|ENET/i.test(text))return 'network'
 return 'unknown'
}
