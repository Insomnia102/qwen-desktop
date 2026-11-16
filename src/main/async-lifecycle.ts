/** Bound startup/cleanup, not normal model or tool execution. */
export function waitFor<T>(work:PromiseLike<T>,signal:AbortSignal,milliseconds:number,message:string):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false
  const finish=(error?:Error,value?:T):void=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(value as T)}
  const cancel=():void=>finish(new Error('Operation cancelled'))
  const timer=setTimeout(()=>finish(new Error(message)),milliseconds)
  signal.addEventListener('abort',cancel,{once:true})
  Promise.resolve(work).then(value=>finish(undefined,value),error=>finish(new Error(error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:String(error))))
  if(signal.aborted)cancel()
 })
}
export async function closeSession(session:{close():Promise<void>}|undefined):Promise<void>{
 if(!session)return
 const abort=new AbortController()
 try{await waitFor(Promise.resolve().then(()=>session.close()),abort.signal,2_000,'Session cleanup timed out')}catch{}
}
