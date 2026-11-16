import {createRequire} from 'node:module'
import {mkdtemp,mkdir,rm,readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {harness,root} from './main-harness.mjs'
const require=createRequire(import.meta.url),{JSDOM,VirtualConsole}=require('jsdom'),base=await mkdtemp(join(tmpdir(),'qwen-ui-setup-'))
const source=(await build({entryPoints:[join(root,'src/renderer/src/bootstrap.ts')],bundle:true,format:'iife',write:false,platform:'browser',target:'es2022'})).outputFiles[0].text
const html=await readFile(join(root,'out/renderer/index.html'),'utf8'),assets=await readdir(join(root,'out/renderer/assets')),css=await readFile(join(root,'out/renderer/assets',assets.find(n=>n.endsWith('.css'))),'utf8')
const errors=[],launches=[];let h,dom,listener,failCheck=false
const query=({prompt,options})=>{launches.push({prompt,options});return {initialized:Promise.resolve(),getSessionId:()=>crypto.randomUUID(),close:async()=>{},async *[Symbol.asyncIterator](){if(prompt.startsWith('Reply with exactly')){yield{type:'result',subtype:failCheck?'error_during_execution':'success',is_error:failCheck,result:failCheck?'':'OK',error:failCheck?{message:'401 unauthorized'}:undefined};return}const id=crypto.randomUUID(),text='Сохранить — user/model content stays unchanged';yield{type:'assistant',uuid:id,message:{id,content:[{type:'text',text}]}};yield{type:'result',subtype:'success',is_error:false,result:text,session_id:crypto.randomUUID()}}}}
const routes={prepareRuntime:'prepare-runtime',cancelRuntime:'cancel-runtime',getConnectionState:'get-connection-state',setUiLanguage:'set-ui-language',completeOnboarding:'complete-onboarding',testConnection:'test-connection',cancelConnectionTest:'cancel-connection-test',getStudio:'get-studio',saveModel:'save-model',deleteModel:'delete-model',selectModel:'select-model',savePrompt:'save-prompt',getCommands:'get-commands',getSkills:'get-skills',getSkill:'get-skill',saveSkill:'save-skill',saveRawSkill:'save-raw-skill',toggleSkill:'toggle-skill',deleteSkill:'delete-skill',importSkill:'import-skill',getSkillFile:'get-skill-file',inspectSkillFile:'inspect-skill-file',saveSkillFile:'save-skill-file',changeSkillPath:'change-skill-path',importSkillFile:'import-skill-file',load:'load',selectFolder:'select-folder',selectChat:'select-chat',selectWorkdir:'select-workdir',closeWorkdir:'close-workdir',renameChat:'rename-chat',deleteChat:'delete-chat',setMode:'set-mode',getSettings:'get-settings',saveSettings:'save-settings',getCoreTools:'get-core-tools',saveCoreTools:'save-core-tools',getMcp:'get-mcp',mutateMcp:'mutate-mcp',probeMcp:'probe-mcp',cancelMcpProbe:'cancel-mcp-probe',setTheme:'set-theme',newChat:'new-chat',start:'start',cancel:'cancel',approve:'approve'}
const el=s=>dom.window.document.querySelector(s),all=s=>Array.from(dom.window.document.querySelectorAll(s)),tick=()=>new Promise(r=>setTimeout(r,20))
async function wait(fn){const deadline=Date.now()+6000;while(!fn()){if(Date.now()>deadline)throw new Error('UI wait timed out: '+el('body').textContent.slice(-1800));await tick()}}
async function click(s){assert.ok(el(s),s);el(s).click();await tick()}
function fill(s,value){assert.ok(el(s),s);el(s).value=value;el(s).dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
async function boot(locale,appName='app'){h=await harness({userData:join(base,appName),folder:join(base,'project'),query,runtime:appName==='runtime-missing'?{status:{ready:false,source:null,cliVersion:null,detectedCliVersion:null,requiredVersion:'0.27.2',nodeVersion:'v24.0.0',npmVersion:'11',issue:'cli-missing'},async prepare(signal,progress){progress('installing');await new Promise(r=>setTimeout(r,100));if(signal.aborted)throw Error('cancelled');this.status={...this.status,ready:true,source:'managed',cliVersion:'0.27.2',issue:null};progress('verifying');return this.cached()}}:undefined,onEvent:event=>listener?.(event)});await h.invoke('set-ui-language',locale);const vc=new VirtualConsole();vc.on('jsdomError',e=>{errors.push(String(e))});dom=new JSDOM(html.replace('</head>',`<style>${css}</style></head>`),{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});dom.window.localStorage.setItem('qwen-desktop-language',locale);dom.window.structuredClone=structuredClone;dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};const api={onEvent:cb=>{listener=cb;return()=>{listener=undefined}}};for(const[name,route]of Object.entries(routes))api[name]=(...args)=>h.invoke(route,...args);dom.window.api=api;dom.window.eval(source);await wait(()=>el('#connection-onboarding')||el('#ui-language')&&!el('#choose-workdir').disabled)}
async function shutdown(){listener=undefined;dom?.window.close();await h?.close()}
async function closePanel(){all('.studio-dialog .settings-footer button,.settings-dialog .settings-footer button').find(b=>['Close','关闭','Закрыть'].includes(b.textContent))?.click();await wait(()=>!el('.settings-dialog'))}
try{
 await mkdir(join(base,'project'));await boot('en');await wait(()=>el('#onboarding-model'));assert.equal(launches.length,0);assert.match(el('#onboarding-title').textContent,/Connect/);assert.equal(el('.app-container').inert,true)
 fill('#onboarding-label','Сохранить');fill('#onboarding-model','example-model');fill('#onboarding-url','http://127.0.0.1:7777/v1');fill('#onboarding-key','SECRET_UI_TEST');el('#onboarding-language').value='zh-CN';el('#onboarding-language').dispatchEvent(new dom.window.Event('change'));await wait(()=>el('#onboarding-title').textContent==='连接你的编程助手');assert.equal(el('#onboarding-key').value,'SECRET_UI_TEST');assert.equal(el('#onboarding-label').value,'Сохранить')
 failCheck=true;await click('#onboarding-connect');await wait(()=>el('#onboarding-message').dataset.error==='true'&&!el('#onboarding-connect').disabled);assert.match(el('#onboarding-message').textContent,/身份验证/);assert.equal(el('#onboarding-key').value,'');assert.equal((await h.invoke('get-connection-state')).value.preferences.onboardingCompleted,false)
 failCheck=false;await click('#onboarding-connect');await wait(()=>!el('#connection-onboarding'));assert.equal((await h.invoke('get-connection-state')).value.preferences.onboardingCompleted,true);assert.equal((await h.invoke('get-connection-state')).value.configurationFound,true);assert.equal(h.events.length,0);const state=(await h.invoke('get-studio','user')).value;assert.equal(state.profiles[0].label,'Сохранить');assert.equal(JSON.stringify(state).includes('SECRET_UI_TEST'),false)
 await wait(()=>el('#choose-workdir')&&!el('#choose-workdir').disabled)
 await click('#choose-workdir');await wait(()=>!el('#chat-input').disabled)
 assert.equal(el('#model-profile').selectedOptions[0].textContent,'Сохранить')
 fill('#chat-input','First message immediately after onboarding');el('#chat-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
 await wait(()=>all('.messages > .message.assistant').length&&!el('#chat-input').disabled)
 assert.match(el('.message.assistant .message-content').textContent,/Сохранить — user\/model/)
 assert.equal(h.events.at(-1).type,'done');assert.equal(h.events.at(-1).cancelled,false)
 await shutdown()
 // Restart after verification: no onboarding and no automatic model request.
 const before=launches.length;await boot('zh-CN');assert.equal(el('#connection-onboarding'),null);assert.equal(launches.length,before);assert.equal(dom.window.document.documentElement.lang,'zh-CN');assert.equal(el('#choose-workdir').textContent,'+ 打开目录')
 await click('#open-settings');await wait(()=>all('.setting-row').length);assert.match(el('.settings-dialog').textContent,/默认权限模式/);assert.ok(!/[А-Яа-яЁё]/.test(el('.settings-dialog').textContent));await closePanel()
 await click('#open-core-tools');await wait(()=>all('.core-tool').length);assert.match(el('.settings-dialog').textContent,/读取文件/);assert.ok(!/[А-Яа-яЁё]/.test(el('.settings-dialog').textContent));await closePanel()
 await click('#nav-mcp');await wait(()=>el('.mcp-dialog'));assert.match(el('.mcp-dialog').textContent,/MCP 服务器/);assert.ok(!/[А-Яа-яЁё]/.test(el('.mcp-dialog').textContent));await closePanel()
 await click('#nav-skills');await wait(()=>el('.skills-dialog'));assert.match(el('.skills-dialog').textContent,/技能/);assert.ok(!/[А-Яа-яЁё]/.test(el('.skills-dialog').textContent));await closePanel()
 await click('#choose-workdir');await wait(()=>!el('#chat-input').disabled);assert.equal(el('#model-profile').selectedOptions[0].textContent,'Сохранить');fill('#chat-input','Сохранить');el('#chat-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>all('.messages > .message.assistant').length>=2&&all('.message.user .message-content').at(-1)?.textContent==='Сохранить'&&!el('#chat-input').disabled&&!el('#ui-language').disabled);assert.equal(all('.message.user .message-content').at(-1).textContent,'Сохранить');assert.match(el('.message.assistant .message-content').textContent,/Сохранить — user\/model/)
 // Footer language changes must update this same document, including dynamic chrome.
 const sameDocument=dom.window.document,modelText=all('.message-content').map(n=>n.textContent),callsBeforeLanguage=launches.length
 fill('#chat-input','Unsent черновик 保存');el('#chat-input').setSelectionRange(4,10)
 for(const [locale,folderLabel,settingsLabel,modelLabel]of [['en','+ Open folder','Settings','Model'],['ru','+ Открыть папку','Настройки','Модель'],['zh-CN','+ 打开目录','设置','模型']]){
  el('#ui-language').value=locale;el('#ui-language').dispatchEvent(new dom.window.Event('change'))
  await wait(()=>!el('#ui-language').disabled&&el('#choose-workdir').textContent===folderLabel)
  assert.equal(dom.window.document,sameDocument);assert.equal(el('#open-settings .nav-label').textContent,settingsLabel)
  assert.equal(el('.composer-model').firstChild.textContent,modelLabel)
  assert.equal(el('#chat-input').value,'Unsent черновик 保存');assert.equal(el('#chat-input').selectionStart,4);assert.equal(el('#chat-input').selectionEnd,10)
  assert.equal(el('#model-profile').selectedOptions[0].textContent,'Сохранить');assert.deepEqual(all('.message-content').map(n=>n.textContent),modelText)
  assert.equal(dom.window.document.documentElement.lang,locale);assert.equal(launches.length,callsBeforeLanguage)
 }
 // Four closed folders must remain in normal flow before the MCP/settings buttons.
 for(const name of ['plugin','python','scripts','test_workdir']){
  const folder=join(base,name);await mkdir(folder);h.folder=folder
  await click('#choose-workdir');await wait(()=>el('#workspace-name').textContent===name&&!el('#chat-input').disabled)
  await click('.selected-workdir .workdir-close');await wait(()=>el('#workspace-name').textContent==='project'&&!el('#chat-input').disabled)
 }
 h.folder=join(base,'project');fill('#chat-input','Unsent черновик 保存')
 await click('.closed-workdirs > summary');assert.equal(el('.closed-workdirs').open,true);assert.equal(all('.workdir-reopen').length,4)
 assert.equal(dom.window.getComputedStyle(el('.nav-group')).flexShrink,'0')
 assert.equal(dom.window.getComputedStyle(el('#nav-mcp')).flexShrink,'0')
 assert.equal(dom.window.getComputedStyle(el('.sidebar-footer')).flexShrink,'0')
 assert.equal(dom.window.getComputedStyle(el('.nav-menu')).overflow,'auto')
 el('#ui-language').value='en';el('#ui-language').dispatchEvent(new dom.window.Event('change'))
 await wait(()=>!el('#ui-language').disabled&&el('#choose-workdir').textContent==='+ Open folder')
 assert.equal(el('.closed-workdirs').open,true);assert.deepEqual(all('.workdir-reopen').map(n=>n.textContent),['plugin','python','scripts','test_workdir'])
 assert.match(el('.closed-workdirs > summary').textContent,/Closed folders \(4\)/)
 assert.equal(el('#chat-input').value,'Unsent черновик 保存')
 await shutdown();await boot('en');assert.equal(el('#connection-onboarding'),null);assert.equal(el('#choose-workdir').textContent,'+ Open folder');await click('#open-settings');await wait(()=>all('.setting-row').length);assert.match(el('.settings-dialog').textContent,/Default approval mode/);assert.ok(!/[А-Яа-яЁё]/.test(el('.settings-dialog').textContent));await closePanel();await shutdown()
 // A configured native installation still sees the welcome screen once; no config shows it again after Skip.
 await mkdir(join(base,'existing/home/.qwen'),{recursive:true});await writeFile(join(base,'existing/home/.qwen/settings.json'),JSON.stringify({security:{auth:{selectedType:'openai',apiKey:'native-key'}},model:{name:'native-model'}}))
 const calls=launches.length;await boot('en','existing');await wait(()=>el('#onboarding-profile'));assert.equal(el('[data-connection-mode="existing"]').getAttribute('aria-pressed'),'true');assert.equal(launches.length,calls);await click('#onboarding-skip');await wait(()=>!el('#connection-onboarding'));await shutdown();await boot('en','existing');assert.equal(el('#connection-onboarding'),null);await shutdown()
 await boot('ru','skip');await wait(()=>el('#onboarding-model'));await click('#onboarding-skip');await wait(()=>!el('#connection-onboarding'));await shutdown();await boot('ru','skip');await wait(()=>el('#connection-onboarding'));assert.equal((await h.invoke('get-connection-state')).value.configurationFound,false);await shutdown()
 // A missing CLI is prepared before connection checking; install status is visible and submit is locked.
 await boot('ru','runtime-missing');await wait(()=>el('#onboarding-cancel-install'))
 assert.equal(el('#onboarding-connect').disabled,true);assert.match(el('#onboarding-runtime').textContent,/Устанавливаем/)
 await wait(()=>el('#onboarding-runtime').dataset.ready==='true');assert.equal(el('#onboarding-connect').disabled,false)
 await click('#onboarding-skip');await wait(()=>el('#ui-language')&&!el('#choose-workdir').disabled);await shutdown()
 console.log('PASS: live footer RU/EN/ZH in the same document; draft/selection and model text preserved; four closed folders keep disclosure and non-shrinking navigation; first launch without CLI/folder; API setup, failed auth/retry, key privacy, three-language switch with draft, persisted default model/language, no re-onboarding or API call on restart, translated panels and unchanged user/model content')
 assert.deepEqual(errors,[])
}finally{await shutdown();await rm(base,{recursive:true,force:true})}
