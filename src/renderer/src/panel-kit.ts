import {t} from '../../shared/i18n'
export const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text=''):HTMLElementTagNameMap[K]=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n}
export const button=(text:string,cls='button button-secondary'):HTMLButtonElement=>{const n=el('button',cls,text);n.type='button';return n}
export function field(parent:HTMLElement,label:string,control:HTMLElement,help=''):HTMLLabelElement{const wrap=el('label','mcp-field');wrap.append(el('span','',label),control);if(help)wrap.append(el('small','',help));parent.append(wrap);return wrap}
export function input(value='',placeholder=''):HTMLInputElement{const n=el('input');n.value=value;n.placeholder=placeholder;return n}
export function select(items:readonly (readonly [string,string])[]):HTMLSelectElement{const n=el('select');for(const[value,text]of items){const option=el('option','',text);option.value=value;n.append(option)}return n}
export function panel(title:string,description:string,onClose:()=>void){
 const dialog=el('dialog','settings-dialog studio-dialog'),header=el('header','settings-header'),heading=el('h2','',title),intro=el('p','',description);heading.id='studio-title';dialog.setAttribute('aria-labelledby',heading.id);header.append(heading,intro)
 const body=el('div','studio-body'),message=el('p','settings-message'),footer=el('footer','settings-footer'),close=button(t('Закрыть'));message.setAttribute('role','status');footer.append(close);dialog.append(header,body,message,footer);document.body.append(dialog)
 let busy=false,dirty=false,closed=false
 const status=(text:string,error=false):void=>{message.textContent=text;message.dataset.error=String(error)}
 const canLeave=():boolean=>{if(busy)return false;if(dirty){status(t('Есть несохранённые изменения. Сохраните их или нажмите «Отменить» в форме.'),true);return false}return true}
 const setBusy=(value:boolean):void=>{busy=value;close.disabled=value;dialog.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(n=>{n.disabled=value||n.dataset.readonly==='true'||n.dataset.draftBlocked==='true'});header.querySelectorAll<HTMLButtonElement>('button').forEach(n=>{n.disabled=value||n.dataset.unavailable==='true'})}
 const dismiss=():void=>{if(closed||!canLeave())return;closed=true;dialog.close();dialog.remove();onClose()};close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss()});dialog.showModal()
 const perform=async<T>(fn:()=>Promise<T>,then:(value:T)=>void):Promise<void>=>{if(busy||closed)return;setBusy(true);try{const result=await fn();if(!closed)then(result)}catch(e){if(!closed)status(e instanceof Error?e.message:String(e),true)}finally{if(!closed)setBusy(false)}}
 return{dialog,header,body,message,footer,status,canLeave,dismiss,perform,setBusy,setDirty:(value:boolean)=>{dirty=value},isBusy:()=>busy,isClosed:()=>closed}
}
export function confirmAction(title:string,text:string,action:()=>Promise<void>):void{
 const d=el('dialog','chat-dialog'),actions=el('div','chat-dialog-actions'),cancel=button(t('Отмена')),confirm=button(t('Удалить'),'button button-danger'),message=el('p','chat-dialog-error');d.append(el('h2','',title),el('p','',text),message,actions);actions.append(cancel,confirm);document.body.append(d)
 const close=():void=>{d.close();d.remove()};cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();if(!confirm.disabled)close()});confirm.onclick=async()=>{if(confirm.disabled)return;confirm.disabled=true;cancel.disabled=true;try{await action();close()}catch(e){message.textContent=e instanceof Error?e.message:String(e);confirm.disabled=false;cancel.disabled=false}};d.showModal()
}
