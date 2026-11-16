import type {QwenAPI,QwenEvent} from '../../shared/qwen'
import {dateLocale,getLanguage,t,translateMessage} from '../../shared/i18n'
export {dateLocale}
// Only explicitly registered UI nodes are translated. Message bodies, project
// names, user titles and tool output never enter this registry.
type Source=string|(()=>string)
const texts=new Map<Node,Source>()
const attributes=new Map<HTMLElement,Map<string,Source>>()
let capturedShell=false
const translated=(source:Source):string=>typeof source==='function'?source():t(source)
export function bindText<T extends Node>(node:T,source:Source):T {texts.set(node,source);node.textContent=translated(source);return node}
export function bindAttribute(node:HTMLElement,name:string,source:Source):void {let values=attributes.get(node);if(!values){values=new Map();attributes.set(node,values)}values.set(name,source);node.setAttribute(name,translated(source))}
export function localizeShell():void {
 document.documentElement.lang=getLanguage()
 if(!capturedShell){
  capturedShell=true
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
  let n:Node|null
  while((n=walker.nextNode())){if(n.parentElement?.closest('script,style'))continue;const raw=n.textContent??'',key=raw.trim();if(key){const source=key;texts.set(n,()=>raw.replace(source,t(source)))}}
  document.querySelectorAll<HTMLElement>('[title],[aria-label],[placeholder],[data-prompt]').forEach(node=>{for(const name of ['title','aria-label','placeholder','data-prompt']){const source=node.getAttribute(name);if(source)bindAttribute(node,name,source)}})
 }
 for(const[node,source]of texts){if(node.isConnected)node.textContent=translated(source);else texts.delete(node)}
 for(const[node,values]of attributes){if(!node.isConnected){attributes.delete(node);continue}for(const[name,source]of values)node.setAttribute(name,translated(source))}
}
export function localizedApi(api:QwenAPI):QwenAPI {
 const wrapped={} as Record<string,unknown>
 for(const [name,method]of Object.entries(api)){
  if(name==='onEvent')continue
  wrapped[name]=async(...args:unknown[])=>{try{const r=await (method as (...args:unknown[])=>Promise<unknown>)(...args);if(r&&typeof r==='object'&&'ok' in r&&!r.ok&&'error' in r)return {...r,error:translateMessage(String(r.error))};return r}catch(e){throw new Error(translateMessage(e instanceof Error?e.message:String(e)))}}
 }
 wrapped.onEvent=(callback:(event:QwenEvent)=>void)=>api.onEvent(event=>{
  if(event.type==='error'||event.type==='warning'||event.type==='storage-error')callback({...event,text:translateMessage(event.text)})
  else callback(event)
 })
 return wrapped as unknown as QwenAPI
}
