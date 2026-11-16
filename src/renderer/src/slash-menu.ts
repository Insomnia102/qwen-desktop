import {t} from '../../shared/i18n'
import type {QwenAPI} from '../../shared/qwen'
import type {SlashCommand} from '../../shared/studio'
import {el,button} from './panel-kit'
export function initSlashMenu(api:QwenAPI,input:HTMLTextAreaElement):{refresh:()=>Promise<void>;hide:()=>void;commands:()=>SlashCommand[]}{
 const menu=el('div','slash-menu');menu.id='slash-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',t('Команды чата'));menu.hidden=true
 input.parentElement!.insertBefore(menu,input);input.setAttribute('aria-controls',menu.id);input.setAttribute('aria-autocomplete','list')
 let commands:SlashCommand[]=[],matches:SlashCommand[]=[],index=0,navigated=false,revision=0
 const hide=():void=>{menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');navigated=false}
 const select=(command:SlashCommand):void=>{input.value=`/${command.name} `;hide();input.dispatchEvent(new Event('input',{bubbles:true}));hide();input.focus()}
 function render(reset=true):void{
  const match=/^\s*\/([^\s]*)$/.exec(input.value);if(!match||input.disabled){hide();return}
  const term=match[1].toLocaleLowerCase(),rank=(c:SlashCommand):number=>c.name.toLocaleLowerCase().startsWith(term)?0:c.name.toLocaleLowerCase().includes(term)?1:2
  matches=commands.filter(c=>`${c.name} ${c.description}`.toLocaleLowerCase().includes(term)).sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name)).slice(0,25)
  if(!matches.length){hide();return}if(reset){index=0;navigated=false}index=Math.min(index,matches.length-1);menu.replaceChildren()
  for(const[ordinal,command]of matches.entries()){
   const item=button('','slash-item');item.id=`slash-option-${ordinal}`;item.setAttribute('role','option');item.setAttribute('aria-selected',String(ordinal===index))
   const text=el('span');text.append(el('strong','',`/${command.name}`),el('small','',command.description));item.append(text,el('span','slash-kind',command.kind==='skill'?t('Skill'):command.kind==='desktop'?'Desktop':'Qwen'))
   item.onmousedown=e=>e.preventDefault();item.onclick=()=>select(command);menu.append(item)
  }
  menu.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant',`slash-option-${index}`)
 }
 input.addEventListener('input',()=>render())
 input.addEventListener('keydown',event=>{
  if(menu.hidden||event.isComposing)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hide();return}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopImmediatePropagation();index=(index+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;navigated=true;render(false);menu.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});return}
  const typed=input.value.trim().slice(1)
  if(event.key==='Tab'||event.key==='Enter'&&(navigated||!matches.some(c=>c.name===typed))){event.preventDefault();event.stopImmediatePropagation();select(matches[index])}
 },true)
 input.addEventListener('blur',()=>{setTimeout(()=>{if(!menu.contains(document.activeElement))hide()},100)})
 const refresh=async():Promise<void>=>{const ticket=++revision;const reply=await api.getCommands();if(ticket!==revision)return;if(reply.ok){commands=reply.value;render()}}
 return{refresh,hide,commands:()=>commands}
}
