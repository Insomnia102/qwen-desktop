import {t,msg} from '../../shared/i18n'
import type {QwenAPI,Reply} from '../../shared/qwen'
import type {SkillDocument,SkillFile,SkillPathChange} from '../../shared/studio'
import type {SettingsScope} from '../../shared/settings'
import {el,button,input,panel,confirmAction} from './panel-kit'
const val=<T>(r:Reply<T>):T=>{if(!r.ok)throw new Error(r.error);return r.value}
const size=(n:number):string=>n<1024?msg`${n} Б`:n<1048576?msg`${(n/1024).toFixed(1)} КБ`:msg`${(n/1048576).toFixed(1)} МБ`
export function skillFiles(api:QwenAPI,p:ReturnType<typeof panel>,scope:SettingsScope,doc:SkillDocument,selected:string,onRefresh:(doc:SkillDocument,path:string,message:string)=>void,onSelect:(path:string)=>void):HTMLElement {
 const section=el('section','skill-files'),heading=el('div','skill-package-heading');heading.append(el('h4','',t('Файлы пакета')),el('span','',msg`${doc.files.filter(f=>f.kind==='file').length} файлов`));section.append(heading,el('p','mcp-help',t('SKILL.md — точка входа. scripts, references, assets, rules и другие папки редактируются здесь. Скрипты при редактировании не запускаются.')))
 const layout=el('div','skill-package-layout'),tree=el('nav','skill-file-tree'),workspace=el('div','skill-file-workspace');tree.setAttribute('aria-label',t('Файлы и папки skill'));layout.append(tree,workspace)
 const tools=el('fieldset','skill-path-tools');tools.dataset.readonly=String(!doc.entry.editable)
 const path=input('',t('Например, scripts/check.py'));path.id='skill-file-name';path.setAttribute('aria-label',t('Путь нового файла, папки или новое имя'))
 const add=button(t('+ Файл')),folder=button(t('+ Папка')),upload=button(t('Добавить с диска')),rename=button(t('Переименовать / переместить')),remove=button(t('Убрать'),'button mcp-remove'),reload=button(t('Обновить дерево'))
 add.id='skill-file-add';folder.id='skill-folder-add';upload.id='skill-file-import';rename.id='skill-path-rename';remove.id='skill-path-remove';reload.id='skill-tree-reload';tools.append(path,add,folder,upload,rename,remove);section.append(tools,reload,layout)
 let current:SkillFile|undefined,chosen=doc.files.find(f=>f.path===selected)?.path??'SKILL.md',draft=false
 const fields=el('fieldset','mcp-form-fields'),editor=el('textarea','studio-editor');editor.readOnly=!doc.entry.editable;editor.id='skill-file-text';editor.rows=18;editor.spellcheck=false;editor.setAttribute('aria-label',t('Содержимое выбранного файла'))
 const title=el('h5','skill-file-title'),meta=el('p','mcp-help'),content=el('div','skill-file-content'),actions=el('div','mcp-form-actions'),save=button(t('Сохранить файл'),'button button-primary'),cancel=button(t('Отменить'));save.id='skill-file-save';cancel.id='skill-file-cancel';actions.append(cancel,save);fields.append(title,meta,content,actions);workspace.append(fields)
 function guardForm(blocked:boolean):void {const main=section.parentElement?.querySelector<HTMLFieldSetElement>('.mcp-form fieldset');if(main){main.dataset.draftBlocked=String(blocked);main.disabled=blocked||!doc.entry.editable}draft=blocked;p.setDirty(blocked)}
 function mark():void {if(!doc.entry.editable)return;guardForm(true);p.status(t('Есть несохранённые изменения файла.'))}
 editor.oninput=mark;editor.onkeydown=e=>{if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');mark()}}
 const apply=(r:Reply<SkillDocument>,selection:string,message:string):void=>{const next=val(r);guardForm(false);onRefresh(next,selection,message)}
 function request(change:Omit<SkillPathChange,'revision'>,selection:string,message:string):void {if(p.canLeave())void p.perform(()=>api.changeSkillPath(scope,doc.entry.id,{...change,revision:doc.treeRevision}),r=>apply(r,selection,message))}
 function highlight():void {tree.querySelectorAll<HTMLElement>('[data-path]').forEach(n=>n.setAttribute('aria-current',String(n.dataset.path===chosen)))}
 function startFile(file:SkillFile):void {current=file;editor.value=file.text;content.replaceChildren(editor);meta.textContent=`${file.encoding??'utf8'} · ${file.lineEnding??'LF'} · ${size(doc.files.find(f=>f.path===file.path)?.size??0)}`;actions.hidden=!doc.entry.editable}
 function select(path:string,initial=false):void {
  if(!initial&&!p.canLeave())return
  chosen=path;onSelect(path);highlight();title.textContent=path||t('Корень пакета');current=undefined;actions.hidden=true;content.replaceChildren();meta.textContent=''
  const node=doc.files.find(f=>f.path===path);rename.disabled=!path||path==='SKILL.md';remove.disabled=rename.disabled
  if(!path||node?.kind==='directory'){meta.textContent=t('Папка. «Добавить с диска» помещает файл сюда. Для переименования укажите новый относительный путь выше.');return}
  if(initial&&path==='SKILL.md'){startFile({path,text:doc.raw,revision:doc.entry.revision,encoding:'utf8',lineEnding:doc.raw.includes('\r\n')?'CRLF':'LF'});return}
  void p.perform(async()=>{const asset=val(await api.inspectSkillFile(scope,doc.entry.id,path));return {asset,file:asset.kind==='text'?val(await api.getSkillFile(scope,doc.entry.id,path)):undefined}},({asset,file})=>{
   if(file){startFile(file);return}
   meta.textContent=msg`${size(asset.size)} · двоичный файл · хранится без изменений`
   if(asset.kind==='image'&&asset.dataUrl){const image=el('img','skill-asset-preview');image.alt=path;image.src=asset.dataUrl;content.append(image)}
   else content.append(el('p','mcp-help',t('Этот формат хранится как ресурс. Для замены уберите файл в архив и добавьте новую версию с диска. Текстовый редактор: UTF-8 и UTF-16 с BOM, до 512 КБ.')))
  })
 }
 function build(parent:string,container:HTMLElement):void {
  const ul=el('ul');container.append(ul)
  for(const node of doc.files.filter(f=>f.path.slice(0,Math.max(0,f.path.lastIndexOf('/')))===parent).sort((a,b)=>a.kind===b.kind?a.path.localeCompare(b.path):a.kind==='directory'?-1:1)){
   const li=el('li');ul.append(li);const name=node.path.split('/').pop()!
   if(node.kind==='directory'){const details=el('details'),summary=el('summary','skill-tree-folder',name);summary.dataset.path=node.path;summary.title=node.path;details.open=true;summary.onclick=e=>{if(p.isBusy()||draft){e.preventDefault();p.canLeave();return}select(node.path)};details.append(summary);li.append(details);build(node.path,details)}
   else{const b=button(name,'skill-tree-file');b.dataset.path=node.path;b.title=node.path+' · '+size(node.size);b.onclick=()=>select(node.path);li.append(b)}
  }
 }
 const root=button(t('Пакет /'),'skill-tree-root');root.onclick=()=>select('');tree.append(root);build('',tree)
 add.onclick=()=>request({action:'file',path:path.value.trim()},path.value.trim(),t('Пустой файл создан. Добавьте содержимое и сохраните.'))
 folder.onclick=()=>request({action:'directory',path:path.value.trim()},path.value.trim(),t('Папка создана.'))
 rename.onclick=()=>{if(chosen)request({action:'rename',path:chosen,target:path.value.trim()},path.value.trim(),t('Путь изменён. Обновите ссылки на него в инструкциях и скриптах при необходимости.'))}
 remove.onclick=()=>{if(!chosen||!p.canLeave())return;const deleting=chosen;confirmAction(msg`Убрать ${deleting}?`,t('Файл или папка со всем содержимым будет перенесена в desktop-skill-file-trash рядом с skills. Можно восстановить вручную.'),async()=>{apply(await api.changeSkillPath(scope,doc.entry.id,{action:'remove',path:deleting,revision:doc.treeRevision}),'SKILL.md',t('Перемещено в архив. Ссылки в инструкциях автоматически не изменяются.'))})}
 reload.onclick=()=>{if(p.canLeave())void p.perform(()=>api.getSkill(scope,doc.entry.id),r=>apply(r,chosen,t('Дерево обновлено.')))}
 upload.onclick=()=>{if(!p.canLeave())return;const selected=doc.files.find(f=>f.path===chosen),directory=selected?.kind==='directory'?chosen:chosen.includes('/')?chosen.slice(0,chosen.lastIndexOf('/')):'';void p.perform(()=>api.importSkillFile(scope,doc.entry.id,directory,doc.treeRevision),r=>{const next=val(r);if(next)onRefresh(next,chosen,t('Файл добавлен без изменения содержимого.'))})}
 cancel.onclick=()=>{if(current&&!p.isBusy()){editor.value=current.text;guardForm(false);p.status(t('Изменения файла отменены.'))}}
 save.onclick=()=>{if(!current||!doc.entry.editable)return;const file=current;void p.perform(async()=>{if(file.path==='SKILL.md')return api.saveRawSkill(scope,doc.entry.id,file.revision,editor.value);val(await api.saveSkillFile(scope,doc.entry.id,{...file,text:editor.value}));return api.getSkill(scope,doc.entry.id)},r=>apply(r,file.path,t('Файл skill сохранён. Применится со следующего запроса.')))}
 if(chosen==='SKILL.md')select(chosen,true);else void Promise.resolve().then(()=>{if(section.isConnected&&!p.isClosed())select(chosen,true)})
 return section
}
