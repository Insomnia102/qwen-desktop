import type {QwenAPI,Reply} from '../../shared/qwen'
import type {ConnectionState,ConnectionTestResult,UiLanguage} from '../../shared/desktop'
import {getLanguage,setLanguage,t,msg} from '../../shared/i18n'
import {bindText,bindAttribute} from './interface-language'
import {el,button,field,input,select} from './panel-kit'
const value=<T>(r:Reply<T>):T=>{if(!r.ok)throw new Error(r.error);return r.value}
const languageNames=[['ru','Русский'],['en','English'],['zh-CN','简体中文']] as const
export function rememberLanguage(language:UiLanguage):void {setLanguage(language);document.documentElement.lang=language;try{localStorage.setItem('qwen-desktop-language',language)}catch{}}
export async function initDesktop(api:QwenAPI,onLanguageChanged:()=>Promise<void>,onConnectionChanged:()=>Promise<void>):Promise<void>{
 const state=value(await api.getConnectionState())
 rememberLanguage(state.preferences.language)
 const footer=document.querySelector('.sidebar-footer')
 const language=select(languageNames);language.id='ui-language';language.value=getLanguage();bindAttribute(language,'aria-label','Interface language')
 const row=el('label','theme-row');row.append(bindText(el('span'),'Interface language'),language);footer?.prepend(row)
 language.onchange=async()=>{
  if(language.disabled)return
  const selected=language.value as UiLanguage,previous=getLanguage(),app=document.querySelector<HTMLElement>('.app-container'),wasInert=app?.inert??false
  language.disabled=true;if(app)app.inert=true
  try{value(await api.setUiLanguage(selected));rememberLanguage(selected);await onLanguageChanged()}
  catch(e){language.value=getLanguage();console.error(e);if(getLanguage()===previous)rememberLanguage(previous)}
  finally{language.disabled=false;if(app)app.inert=wasInert}
 }
 const setup=bindText(button('','button button-secondary'),'Model connection');setup.id='open-connection-setup';footer?.append(setup)
 setup.onclick=()=>{const language=getLanguage();void api.getConnectionState().then(async r=>{await openOnboarding(api,value(r));if(language!==getLanguage())await onLanguageChanged();else await onConnectionChanged()}).catch(e=>{console.error(e)})}
}
export function openOnboarding(api:QwenAPI,initial:ConnectionState):Promise<void>{
 return new Promise(resolve=>{
  let info=initial,busy=false,checking=false,installing=false,closed=false,runtimeMessage='',profileId=info.selectedModelId??info.defaultModelId??(!info.nativeConfigurationFound?info.profiles[0]?.id??null:null),createdId:string|null=null
  let mode:'existing'|'new'=info.profiles.length||info.nativeConfigurationFound?'existing':'new'
  let draft={label:'',provider:'openai',model:'',baseUrl:'',keySource:info.secureStorage?'stored':'environment',envKey:'',apiKey:''}
  const shell=el('section','onboarding-shell');shell.id='connection-onboarding';shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');shell.setAttribute('aria-labelledby','onboarding-title')
  const app=document.querySelector<HTMLElement>('.app-container'),wasInert=app?.inert??false;const previousAria=app?.getAttribute('aria-hidden');if(app){app.inert=true;app.setAttribute('aria-hidden','true')}
  document.body.append(shell)
  const unsubscribe=api.onEvent(event=>{if(event.type==='runtime-progress'&&!closed){runtimeMessage=t(({checking:'Checking Qwen CLI…',installing:'Installing Qwen CLI…',verifying:'Verifying Qwen CLI…'} as const)[event.phase]);render(runtimeMessage)}})
  const finish=():void=>{if(closed)return;closed=true;unsubscribe();draft.apiKey='';shell.remove();if(app){app.inert=wasInert;if(previousAria==null)app.removeAttribute('aria-hidden');else app.setAttribute('aria-hidden',previousAria)}resolve()}
  function render(message='',error=false):void {
   shell.replaceChildren()
   const card=el('div','onboarding-card'),top=el('div','onboarding-top'),brand=el('div','onboarding-brand'),logo=el('img');logo.src=document.querySelector<HTMLImageElement>('.brand-logo')?.src??'./qwen.svg';logo.alt='';brand.append(logo,el('span','','Qwen Desktop'))
   const lang=select(languageNames);lang.id='onboarding-language';lang.value=getLanguage();lang.disabled=busy;lang.setAttribute('aria-label',t('Interface language'));top.append(brand,lang)
   lang.onchange=async()=>{capture();busy=true;lang.disabled=true;try{value(await api.setUiLanguage(lang.value as UiLanguage));rememberLanguage(lang.value as UiLanguage);busy=false;render(message,error)}catch(e){busy=false;render(e instanceof Error?e.message:String(e),true)}}
   const title=el('h1','',t('Connect your coding assistant'));title.id='onboarding-title'
   const lead=el('p','onboarding-lead',t('Choose a model connection. You can set this up before opening a project.'))
   const runtime=el('div','onboarding-runtime');runtime.id='onboarding-runtime';runtime.dataset.ready=String(info.runtimeReady)
   runtime.append(el('span','',info.runtimeReady?'✓':installing?'…':'!'),el('div','',info.runtimeReady?msg`Qwen CLI ${info.runtime.cliVersion} is ready`:runtimeMessage||t('Qwen CLI must be installed.')))
   runtime.append(el('small','',msg`Node.js: ${info.runtime.nodeVersion??'—'} · npm: ${info.runtime.npmVersion??'—'}`))
   runtime.append(el('small','',info.runtime.source==='system'?t('Using your compatible system installation.'):t('The app installs a compatible CLI in its own data folder. Administrator rights are not required.')))
   if(!info.runtimeReady){
    const retry=button(installing?t('Installing Qwen CLI…'):t('Recheck and install'),'button button-secondary');retry.id='onboarding-install';retry.disabled=busy;retry.onclick=()=>{void prepare()};runtime.append(retry)
    if(installing){const cancel=button(t('Cancel installation'));cancel.id='onboarding-cancel-install';cancel.onclick=()=>{void api.cancelRuntime()};runtime.append(cancel)}
    if(['node-missing','node-old','npm-missing'].includes(info.runtime.issue??'')){
     runtime.append(el('small','',t('Install Node.js 22 or newer with npm, restart this application, then retry.')))
     const link=el('a','',t('Download Node.js'));link.href='https://nodejs.org/en/download';link.target='_blank';link.rel='noreferrer';runtime.append(link)
    }
   }
   const tabs=el('div','onboarding-tabs');for(const [id,label]of [['new','Connect with an API key'],['existing','Use existing settings']] as const){const b=button(t(label));b.dataset.connectionMode=id;b.setAttribute('aria-pressed',String(mode===id));b.disabled=busy;b.onclick=()=>{capture();mode=id;render()};tabs.append(b)}
   const form=el('form','onboarding-form'),fields=el('fieldset');fields.disabled=busy;form.append(fields)
   if(mode==='existing'){
    const profiles=select([['__native',t('From Qwen settings')],...info.profiles.map(p=>[p.id,p.label+' · '+p.model] as const)]);profiles.id='onboarding-profile';profiles.value=profileId??'__native';field(fields,t('Connection'),profiles)
    profiles.onchange=()=>{profileId=profiles.value==='__native'?null:profiles.value}
    fields.append(el('p','mcp-help',info.nativeConfigurationFound?t('Existing Qwen settings were found. Check the connection to confirm that the model is available.'):t('No complete Qwen connection was detected. Select a saved profile or connect with an API key.')))
   }else{
    const label=input(draft.label,t('For example, My Qwen'));label.id='onboarding-label';label.required=true;label.maxLength=100;field(fields,t('Profile name'),label)
    const provider=select([['openai',t('OpenAI-compatible API')],['anthropic',t('Anthropic-compatible API')],['gemini','Gemini API']]);provider.value=draft.provider;provider.id='onboarding-provider';field(fields,t('API protocol'),provider)
    const model=input(draft.model,t('Exact model ID from your provider'));model.id='onboarding-model';model.required=true;model.maxLength=200;field(fields,t('Model ID'),model)
    const url=input(draft.baseUrl,'https://provider.example/v1');url.id='onboarding-url';url.maxLength=2000;const urlField=field(fields,t('Base URL'),url,t('Use the endpoint supplied by your provider. For OpenAI-compatible APIs this often ends in /v1.'))
    const source=select([['stored',t('Save key securely')],['environment',t('Read key from an environment variable')],['inherit',t('Inherit Qwen credentials')]]);source.id='onboarding-key-source';source.value=draft.keySource;if(!info.secureStorage)source.querySelector<HTMLOptionElement>('[value="stored"]')!.disabled=true;field(fields,t('API key source'),source)
    const secret=input(draft.apiKey,t('API key'));secret.type='password';secret.autocomplete='new-password';secret.id='onboarding-key';secret.maxLength=16000;const keyField=field(fields,t('API key'),secret,t('The saved key is encrypted by your operating system and is not added to chat history.'))
    const env=input(draft.envKey,'MY_API_KEY');env.id='onboarding-env';const envField=field(fields,t('Environment variable'),env)
    const visibility=():void=>{urlField.hidden=provider.value==='gemini';keyField.hidden=source.value!=='stored';envField.hidden=source.value!=='environment';secret.required=source.value==='stored'&&!createdId;env.required=source.value==='environment'};provider.onchange=visibility;source.onchange=visibility;visibility()
    if(!info.secureStorage)fields.append(el('p','mcp-help',t('Secure storage is unavailable. Use an environment variable or existing Qwen credentials.')))
   }
   fields.append(el('p','onboarding-test-note',t('The connection check sends one short model request and may use API credits. It does not run project tools or add a message to your chats.')))
   const status=el('p','onboarding-message',message);status.id='onboarding-message';status.setAttribute('role','status');status.dataset.error=String(error)
   const actions=el('div','onboarding-actions'),skip=button(t('Set up later')),submit=button(checking?t('Checking connection…'):t('Check and continue'),'button button-primary'),cancel=button(t('Cancel check'));submit.type='submit';submit.id='onboarding-connect';skip.id='onboarding-skip';cancel.id='onboarding-cancel';skip.disabled=busy;submit.disabled=busy||!info.runtimeReady;cancel.hidden=!checking;actions.append(skip,cancel,submit);fields.append(actions)
   // Cancellation must remain available while the rest of the form is locked.
   if(checking){cancel.disabled=false;fields.after(cancel)}
   cancel.onclick=()=>{void api.cancelConnectionTest()}
   skip.onclick=async()=>{busy=true;skip.disabled=true;try{value(await api.completeOnboarding(null,true));finish()}catch(e){busy=false;render(e instanceof Error?e.message:String(e),true)}}
   form.onsubmit=async e=>{
    e.preventDefault();if(busy||!form.reportValidity())return;capture();busy=true;checking=true;render(t('Checking connection…'))
    try{
     if(mode==='new'){
      const studio=value(await api.getStudio('user'))
      const saved=value(await api.saveModel({revision:studio.revision,id:createdId,label:draft.label,model:draft.model,provider:draft.provider as 'openai'|'anthropic'|'gemini',baseUrl:draft.provider==='gemini'?'':draft.baseUrl,keySource:draft.keySource as 'stored'|'inherit'|'environment',envKey:draft.envKey,apiKey:draft.apiKey||undefined}))
      profileId=saved.profiles.find(p=>p.label===draft.label.trim()&&p.model===draft.model.trim())?.id??null;createdId=profileId;draft.apiKey=''
     }
     const result=value(await api.testConnection(profileId))
     if(!result.verified){busy=false;checking=false;render(testMessage(result),true);return}
     value(await api.completeOnboarding(profileId,false));finish()
    }catch(error){busy=false;checking=false;render(error instanceof Error?error.message:String(error),true)}
   }
   card.append(top,el('span','onboarding-kicker',t('YOUR WORKSPACE, READY TO BEGIN')),title,lead,runtime,tabs,form,status);shell.append(card)
   if(checking)cancel.focus();else shell.querySelector<HTMLElement>('#onboarding-label,#onboarding-profile')?.focus()
  }
  function capture():void {for(const [key,id]of Object.entries({label:'label',provider:'provider',model:'model',baseUrl:'url',keySource:'key-source',envKey:'env',apiKey:'key'})){const control=shell.querySelector<HTMLInputElement|HTMLSelectElement>('#onboarding-'+id);if(control)(draft as Record<string,string>)[key]=control.value}}
  async function prepare():Promise<void>{
   if(busy||closed)return;capture();busy=true;installing=true;runtimeMessage=t('Checking Qwen CLI…');render(runtimeMessage)
   try{info=value(await api.prepareRuntime());runtimeMessage='';busy=false;installing=false;render(info.runtimeReady?t('Qwen CLI is ready.'):t('Qwen CLI is not ready. Check the requirements above.'),!info.runtimeReady)}
   catch(error){busy=false;installing=false;runtimeMessage='';render(error instanceof Error?error.message:String(error),true)}
  }
  render()
  if(!info.runtimeReady)void prepare()
 })
}
function testMessage(result:ConnectionTestResult):string {
 const messages:Record<ConnectionTestResult['code'],string>={ok:'Connection verified',cancelled:'Connection check cancelled.',timeout:'The connection timed out. Check your network and endpoint.',auth:'Authentication failed. Check the API key or sign-in in your existing Qwen configuration.',model:'The model was not found. Check the exact model ID and provider.',network:'Could not reach the provider. Check your network and Base URL.',runtime:'The bundled Qwen runtime is unavailable. Reinstall the application.',unknown:'The model did not complete the check. Check the connection settings and try again.'}
 return t(messages[result.code])
}
