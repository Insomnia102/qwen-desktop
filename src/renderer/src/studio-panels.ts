import {t,msg} from '../../shared/i18n'
import type {QwenAPI,Reply} from '../../shared/qwen'
import type {StudioView,ModelProvider,KeySource,PromptMode} from '../../shared/studio'
import type {SettingsScope} from '../../shared/settings'
import {el,button,field,input,select,panel,confirmAction} from './panel-kit'
import {renderMarkdown} from './markdown'
const value=<T>(reply:Reply<T>):T=>{if(!reply.ok)throw new Error(reply.error);return reply.value}
export function openModels(api:QwenAPI,hasChat:boolean,onChanged:()=>void,onClose:()=>void):void{
 const p=panel(t('Модели'),t('Добавляйте API-модели и выбирайте профиль для каждого диалога. «Из настроек Qwen» сохраняет вашу текущую авторизацию CLI.'),onClose)
 p.dialog.classList.add('models-dialog');const add=button(t('+ Добавить модель'),'button button-primary');add.id='model-add';p.header.append(add)
 const list=el('nav','studio-list'),detail=el('section','studio-detail');p.body.append(list,detail)
 let view:StudioView|undefined,id:string|null=null,creating=false
 function renderList():void{
  list.replaceChildren();const def=button(t('Из настроек Qwen'),'studio-list-item');def.dataset.model='__default';def.onclick=()=>{if(p.canLeave()){id=null;creating=false;renderList();renderDetail()}};list.append(def)
  for(const profile of view?.profiles??[]){const b=button('','studio-list-item');b.dataset.model=profile.id;b.setAttribute('aria-current',String(profile.id===id));b.append(el('strong','',profile.label),el('small','',`${profile.provider} · ${profile.model}`));b.onclick=()=>{if(p.canLeave()){id=profile.id;creating=false;renderList();renderDetail()}};list.append(b)}
 }
 function renderDetail():void{
  detail.replaceChildren();const profile=view?.profiles.find(v=>v.id===id)
  if(!creating&&!profile){detail.append(el('h3','',t('Текущая конфигурация Qwen')),el('p','mcp-help',t('Без отдельного профиля SDK использует ваши штатные настройки модели и авторизации. Здесь не меняются сохранённые API-ключи и modelProviders Qwen CLI.')))
   const use=button(t('Использовать в этом диалоге'),'button button-primary');use.disabled=!hasChat;use.onclick=()=>{void p.perform(()=>api.selectModel(null),r=>{value(r);onChanged();p.status(t('Диалог использует настройки Qwen.'))})};detail.append(use);return}
  const form=el('form','mcp-form'),fields=el('fieldset','mcp-form-fields');form.append(fields);detail.append(form,el('p','mcp-help',t('Поддержка thinking и инструментов зависит от выбранной модели и API. Сохранение профиля не отправляет тестовый запрос и не расходует токены.')))
  detail.prepend(el('h3','',creating?t('Новая модель'):profile!.label))
  const label=input(profile?.label??'',t('Например, Qwen Coding'));label.required=true;label.id='model-label';field(fields,t('Название в интерфейсе'),label)
  const provider=select([['openai',t('OpenAI-совместимый API · Qwen / локальные модели')],['anthropic',t('Anthropic-совместимый API')],['gemini','Gemini API']]);provider.value=profile?.provider??'openai';provider.id='model-provider';field(fields,t('Протокол API'),provider)
  const model=input(profile?.model??'',t('Точный ID у провайдера'));model.required=true;model.id='model-id';field(fields,t('ID модели'),model)
  const baseUrl=input(profile?.baseUrl??'','https://provider.example/v1');baseUrl.id='model-url';const urlField=field(fields,t('Base URL'),baseUrl,t('Для OpenAI обычно заканчивается на /v1. Для Anthropic укажите адрес провайдера. Пусто — штатные настройки API. Для ID, уже зарегистрированного в modelProviders Qwen, оставьте адрес пустым и используйте наследование ключа.'))
  const keySource=select([['inherit',t('Ключ из настроек Qwen / окружения')],['environment',t('Своя переменная окружения')],['stored',t('Сохранить ключ в защищённом хранилище')]]);keySource.value=profile?.keySource??'inherit';keySource.id='model-key-source'
  if(!view?.secureStorage)keySource.querySelector<HTMLOptionElement>('[value="stored"]')!.disabled=true
  field(fields,t('Источник API-ключа'),keySource)
  const env=input(profile?.envKey??'','MY_API_KEY');env.id='model-env';const envField=field(fields,t('Имя переменной окружения'),env,t('После изменения окружения полностью перезапустите приложение.'))
  const secret=input('',profile?.hasKey?t('Ключ сохранён. Пусто — оставить прежний'):t('API-ключ'));secret.id='model-key';secret.type='password';secret.autocomplete='new-password';const secretField=field(fields,t('API-ключ'),secret,t('На Windows шифруется средствами текущей учётной записи. Ключ не возвращается в список моделей и не записывается в историю чата.'))
  const visibility=():void=>{envField.hidden=keySource.value!=='environment';secretField.hidden=keySource.value!=='stored';urlField.hidden=provider.value==='gemini';if(provider.value==='gemini')baseUrl.value=''};keySource.onchange=visibility;provider.onchange=visibility;visibility()
  const actions=el('div','mcp-form-actions'),cancel=button(t('Отменить')),save=button(t('Сохранить'),'button button-primary');save.type='submit';save.id='model-save';cancel.onclick=()=>{p.setDirty(false);creating=false;renderDetail();p.status('')};actions.append(cancel,save)
  if(profile){const use=button(t('Использовать в чате'));use.disabled=!hasChat;use.id='model-use';use.onclick=()=>{if(!p.canLeave())return;void p.perform(()=>api.selectModel(profile.id),r=>{value(r);onChanged();p.status(t('Модель выбрана для этого диалога.'))})};actions.prepend(use)
   const remove=button(t('Удалить'),'button mcp-remove');remove.id='model-remove';remove.onclick=()=>{if(!p.canLeave()||!view)return;confirmAction(t('Удалить профиль модели?'),t('История чатов сохранится. Диалоги с этим профилем вернутся к настройкам Qwen.'),async()=>{const r=value(await api.deleteModel(profile.id,view!.revision));view=r;id=null;p.setDirty(false);renderList();renderDetail();onChanged()})};fields.append(remove)}
  fields.append(actions);form.oninput=()=>{p.setDirty(true);p.status(t('Есть несохранённые изменения.'))};form.onchange=()=>{p.setDirty(true)}
  form.onsubmit=e=>{e.preventDefault();if(!view||!form.reportValidity())return;void p.perform(()=>api.saveModel({revision:view!.revision,id:profile?.id??null,label:label.value,model:model.value,provider:provider.value as ModelProvider,baseUrl:baseUrl.value,keySource:keySource.value as KeySource,envKey:env.value,apiKey:secret.value||undefined}),r=>{view=value(r);id=view.profiles.find(v=>v.label===label.value.trim()&&v.model===model.value.trim())?.id??null;creating=false;p.setDirty(false);renderList();renderDetail();onChanged();p.status(t('Профиль сохранён. Выберите его у поля ввода или нажмите «Использовать в чате».'))})}
 }
 add.onclick=()=>{if(p.canLeave()){creating=true;id=null;renderList();renderDetail()}}
 void p.perform(()=>api.getStudio('user'),r=>{view=value(r);id=view.selectedModelId;renderList();renderDetail()})
}
export function openSystemPrompt(api:QwenAPI,hasProject:boolean,onClose:()=>void):void{
 const p=panel(t('Системный промпт'),t('Постоянные инструкции для агента. Применяются со следующего запроса, включая продолжение существующего диалога.'),onClose)
 p.dialog.classList.add('prompt-dialog');p.body.classList.add('prompt-body')
 let scope:SettingsScope='user',view:StudioView|undefined
 const scopes=el('div','settings-scopes');for(const[s,label]of [['user',t('Для всех проектов')],['project',t('Для текущей папки')]] as const){const b=button(label,'');b.dataset.scope=s;b.dataset.unavailable=String(s==='project'&&!hasProject);b.disabled=s==='project'&&!hasProject;b.onclick=()=>{if(s!==scope&&p.canLeave())load(s)};scopes.append(b)}p.header.append(scopes)
 const form=el('form','mcp-form'),fields=el('fieldset','mcp-form-fields'),mode=select([['append',t('Дополнить штатный промпт Qwen')],['replace',t('Заменить штатный промпт своим')]]),text=el('textarea','studio-editor');mode.id='prompt-mode';text.id='system-prompt';text.rows=16;text.maxLength=100000
 field(fields,t('Режим'),mode,t('Дополнение сохраняет штатные инструкции Qwen по работе с кодом и инструментами. При замене эту основу задаёте вы; разрешения инструментов по-прежнему проверяет приложение.'))
 field(fields,t('Инструкции'),text,t('Например: «Отвечай по-русски. Сначала кратко объясняй план, после изменений указывай выполненные проверки».'))
 const source=el('p','mcp-source'),preview=el('div','markdown-body studio-preview'),previewDetails=el('details','mcp-advanced');previewDetails.append(el('summary','',t('Предпросмотр')),preview)
 const actions=el('div','mcp-form-actions'),reset=button(t('Наследовать / сбросить')),cancel=button(t('Отменить')),save=button(t('Сохранить'),'button button-primary');save.type='submit';save.id='prompt-save';actions.append(reset,cancel,save);fields.append(source,previewDetails,actions);form.append(fields);p.body.append(form)
 const fill=():void=>{if(!view)return;const prompt=view.localPrompt??view.prompt;mode.value=prompt.mode;text.value=prompt.text;source.textContent=scope==='project'&&!view.localPrompt?t('Наследуется общий промпт. Сохранение создаст отдельное значение для этой папки.'):msg`Область: ${scope==='user'?t('все проекты'):t('текущая папка')}.`;scopes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===scope)));renderMarkdown(preview,text.value)}
 const load=(s:SettingsScope):void=>{void p.perform(()=>api.getStudio(s),r=>{scope=s;view=value(r);p.setDirty(false);fill();p.status('')})}
 form.oninput=()=>{p.setDirty(true);renderMarkdown(preview,text.value);p.status(t('Есть несохранённые изменения.'))};form.onchange=()=>p.setDirty(true);cancel.onclick=()=>{p.setDirty(false);fill();p.status('')}
 form.onsubmit=e=>{e.preventDefault();if(!view)return;void p.perform(()=>api.savePrompt({scope,revision:view!.revision,prompt:{mode:mode.value as PromptMode,text:text.value}}),r=>{view=value(r);p.setDirty(false);fill();p.status(t('Сохранено. Новые инструкции применятся со следующего запроса.'))})}
 reset.onclick=()=>{if(!view)return;void p.perform(()=>api.savePrompt({scope,revision:view!.revision,prompt:null}),r=>{view=value(r);p.setDirty(false);fill();p.status(t('Локальное значение сброшено.'))})}
 load('user')
}
