import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { harness } from './main-harness.mjs'
const appRoot=dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const { JSDOM, VirtualConsole } = require('jsdom')
const base = await mkdtemp(join(tmpdir(), 'qwen-dom-history-'))
const folderA = join(base, 'Project A'), folderB = join(base, 'Project B')
await mkdir(folderA); await mkdir(folderB)
const output = join(appRoot,'out/renderer')
const names = await readdir(join(output, 'assets'))
const html = await readFile(join(output, 'index.html'), 'utf8')
const {build}=require('esbuild')
const source=(await build({stdin:{contents:"import './src/renderer/src/bootstrap.ts';import {EditorView} from '@codemirror/view';import {undo,redo} from '@codemirror/commands';globalThis.__skillEditorTest={EditorView,undo,redo}",resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})).outputFiles[0].text
const css = await readFile(join(output, 'assets', names.find(x => x.endsWith('.css'))), 'utf8')
const launches = [], errors = [], decisions = [], management = []
let h, dom, listener, savedTheme
const tick = () => new Promise(resolve => setTimeout(resolve, 25))
async function wait(predicate) {
  const until = Date.now() + 4000
  while (!predicate()) { if (Date.now() > until) throw new Error('UI wait timed out'); await tick() }
}
const query = ({ prompt, options }) => {
  const id = options.resume ?? randomUUID()
  launches.push({ prompt, options, id })
  return { initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
    async *[Symbol.asyncIterator]() {
      if (prompt.includes('with tools')) {
        yield { type: 'assistant', uuid: randomUUID(), message: { id: 'same-provider-id', content: [
          { type: 'text', text: 'Сначала проверю файлы.' }, { type: 'thinking', thinking: 'Saved thinking text' }, { type: 'tool_use', id: 'tool-1', name: 'tool_call',
            input: { name: 'mcp__custom__write_report', arguments: { file_path: 'report.md' } } }
        ] } }
        const permission = await options.canUseTool('mcp__custom__write_report', { file_path: 'report.md' }, { signal: options.abortController.signal })
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Saved MCP result', is_error: permission.behavior !== 'allow' }] } }
      }
      if (prompt.includes('with tools')) yield { type: 'assistant', uuid: randomUUID(), message: { id: 'progress-2', content: [{ type: 'text', text: 'Проверка завершена, готовлю итог.' }] } }
      const answer = `# Heading\n\n**Answer:** ${prompt}\n\n~~~js\n42\n~~~`
      yield { type: 'assistant', uuid: randomUUID(), message: { id: 'same-provider-id', content: [{ type: 'text', text: answer }] } }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: id, result: answer, permission_denials: [] }
    }
  }
}
const el = selector => dom.window.document.querySelector(selector)
const all = selector => [...dom.window.document.querySelectorAll(selector)]
const click = async selector => { assert.ok(el(selector), selector); el(selector).click(); await tick() }
const send = async text => {
  el('#chat-input').value = text
  el('#chat-input').dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  el('#chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await tick()
}
const idle = () => wait(() => !el('#chat-input').disabled)
async function boot() {
  h = await harness({ userData: join(base, 'app-data'), folder: folderA, query,
    onEvent: event => listener?.(event) })
  const vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(String(error)))
  dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), {
    url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  })
  if(savedTheme)dom.window.localStorage.setItem('qwen-desktop-theme',savedTheme)
  dom.window.localStorage.setItem('qwen-desktop-language','ru')
  dom.window.structuredClone = structuredClone
  dom.window.Range.prototype.getClientRects=()=>[]
  dom.window.Range.prototype.getBoundingClientRect=()=>new dom.window.DOMRect()
  dom.window.matchMedia = () => ({matches:true,addEventListener(){},removeEventListener(){}})
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  dom.window.api = {
    getSkillDirectory:(...args)=>h.invoke('get-skill-directory',...args),getSkillTests:()=>h.invoke('get-skill-tests'),onSkillTestEvent:()=>()=>{},
    prepareRuntime:()=>h.invoke('prepare-runtime'),cancelRuntime:()=>h.invoke('cancel-runtime'),
    getConnectionState:async()=>({ok:true,value:{preferences:{version:1,language:'ru',onboardingCompleted:true},runtimeReady:true,configurationFound:true,profiles:[],defaultModelId:null,selectedModelId:null,secureStorage:true,nativeConfigurationFound:true}}),setUiLanguage:l=>h.invoke('set-ui-language',l),completeOnboarding:(id,skip)=>h.invoke('complete-onboarding',id,skip),testConnection:id=>h.invoke('test-connection',id),cancelConnectionTest:()=>h.invoke('cancel-connection-test'),
    getStudio: scope => h.invoke('get-studio',scope), saveModel: r=>h.invoke('save-model',r), deleteModel:(id,rev)=>h.invoke('delete-model',id,rev), selectModel:id=>h.invoke('select-model',id), savePrompt:r=>h.invoke('save-prompt',r),
    getCommands:()=>h.invoke('get-commands'), getSkills:s=>h.invoke('get-skills',s), getSkill:(s,id)=>h.invoke('get-skill',s,id), saveSkill:r=>h.invoke('save-skill',r), saveRawSkill:(s,id,rev,raw)=>h.invoke('save-raw-skill',s,id,rev,raw), toggleSkill:(s,id,on,rev)=>h.invoke('toggle-skill',s,id,on,rev), deleteSkill:(s,id,rev)=>h.invoke('delete-skill',s,id,rev), importSkill:s=>h.invoke('import-skill',s), getSkillFile:(s,id,path)=>h.invoke('get-skill-file',s,id,path),saveSkillFile:(s,id,f)=>h.invoke('save-skill-file',s,id,f),inspectSkillFile:(s,id,path)=>h.invoke('inspect-skill-file',s,id,path),changeSkillPath:(s,id,r)=>h.invoke('change-skill-path',s,id,r),importSkillFile:(s,id,dir,rev)=>h.invoke('import-skill-file',s,id,dir,rev),
    setTheme: async value => h.invoke('set-theme', value),
    getMcp: scope => h.invoke('get-mcp', scope), mutateMcp: payload => h.invoke('mutate-mcp', payload), probeMcp: payload => h.invoke('probe-mcp', payload), cancelMcpProbe: () => h.invoke('cancel-mcp-probe'),
    load: () => h.invoke('load'), selectFolder: () => h.invoke('select-folder'),
    selectChat: id => h.invoke('select-chat', id), selectWorkdir: id => h.invoke('select-workdir', id), closeWorkdir: id => h.invoke('close-workdir', id),
    renameChat: (id, title) => { management.push({ mode: 'rename', id, title }); return h.invoke('rename-chat', id, title) },
    deleteChat: id => { management.push({ mode: 'delete', id }); return h.invoke('delete-chat', id) },
    setMode: mode => h.invoke('set-mode', mode),
    getSettings: scope => h.invoke('get-settings', scope), saveSettings: payload => h.invoke('save-settings', payload),
    getCoreTools: scope => h.invoke('get-core-tools', scope), saveCoreTools: payload => h.invoke('save-core-tools', payload),
    newChat: () => h.invoke('new-chat'), start: payload => h.invoke('start', payload), cancel: () => h.invoke('cancel'),
    approve: (id, decision) => { decisions.push(decision); return h.invoke('approve', id, decision) },
    onEvent: callback => { listener = callback; return () => { listener = undefined } }
  }
  dom.window.eval(source)
  await wait(() => el('#ui-language') && dom.window.document.documentElement.dataset.theme && !el('#choose-workdir').disabled)
}
async function shutdown() { savedTheme=dom?.window.localStorage.getItem('qwen-desktop-theme'); listener = undefined; dom?.window.close(); await h?.close() }
try {
  await boot()

  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark')
  await click('#theme-toggle')
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light')
  assert.equal(dom.window.localStorage.getItem('qwen-desktop-theme'), 'light')
  el('#theme-select').value = 'system'; el('#theme-select').dispatchEvent(new dom.window.Event('change'))
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark')
  assert.equal(el('.brand-logo').getAttribute('src'), './qwen.svg')
  await click('#nav-mcp')
  await wait(() => Boolean(el('.mcp-dialog')) && !el('#mcp-add').disabled)
  assert.equal(el('.mcp-dialog [data-scope="project"]').disabled, true)
  await click('#mcp-add')
  const fillMcp = (selector,value) => { el(selector).value=value; el(selector).dispatchEvent(new dom.window.Event('input',{bubbles:true})) }
  fillMcp('#mcp-name','my.tools'); fillMcp('#mcp-command', process.execPath)
  fillMcp('#mcp-args', join(appRoot,'tests','mcp-stdio-fixture.mjs'))
  el('.mcp-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
  await wait(() => Boolean(el('[data-server="my.tools"]')) && Boolean(el('#mcp-probe')) && !el('#mcp-probe').closest('fieldset').disabled)
  await click('#mcp-probe')
  await wait(() => all('[data-mcp-tool]').length===2)
  const tool = el('[data-mcp-tool="blocked"]'); tool.checked=false;tool.dispatchEvent(new dom.window.Event('change',{bubbles:true}))
  await wait(() => el('.mcp-dialog .settings-message').textContent.includes('Инструмент обновлён'))
  const mcpPath=join(base,'app-data/home/.qwen/settings.json')
  assert.deepEqual(JSON.parse(await readFile(mcpPath,'utf8')).mcpServers['my.tools'].excludeTools,['blocked'])
  await click('[data-mcp-toggle="my.tools"]')
  await wait(() => el('.mcp-status-chip').textContent==='Выключен')
  assert.deepEqual(JSON.parse(await readFile(mcpPath,'utf8')).mcp.excluded,['my.tools'])
  await click('[data-mcp-toggle="my.tools"]')
  await wait(() => el('.mcp-status-chip').textContent==='Включён')
  // Unsaved changes remain visible instead of silently disappearing on scope/close.
  fillMcp('#mcp-description','Uncommitted')
  await click('.mcp-dialog .settings-footer button:last-child')
  assert.ok(el('.mcp-dialog'));assert.ok(el('.mcp-dialog .settings-message').textContent.includes('несохранённые'))
  await click('.mcp-form-actions button:first-child')
  await click('#mcp-remove');await click('.chat-dialog button:last-child')
  await wait(() => !el('[data-server="my.tools"]'))
  await click('.mcp-dialog .settings-footer button:last-child');assert.equal(el('.mcp-dialog'),null)

  assert.equal(all('.saved-chat').length, 0)
  assert.equal(el('#open-settings').closest('.nav-menu'), el('.nav-menu'))
  assert.equal(el('#open-core-tools').closest('.nav-menu'), el('.nav-menu'))
  assert.equal(el('.sidebar-footer #open-settings'), null)
  assert.equal(el('#approval-mode').disabled, true)
  await click('#open-settings')
  await wait(() => Boolean(el('.settings-dialog [data-setting="tools.approvalMode"] select')))
  assert.equal(el('.settings-scopes [data-scope="project"]').disabled, true)
  const selectSetting = (key, value) => {
    const node = el(`.settings-dialog [data-setting="${key}"] select`)
    node.value = JSON.stringify(value)
    node.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  }
  const saveSettings = async () => {
    el('.settings-footer button:last-child').click()
    await wait(() => el('.settings-message').textContent.includes('Сохранено'))
    await tick()
  }
  selectSetting('tools.approvalMode', 'default')
  await saveSettings()
  const settingsPath = join(base, 'app-data/home/.qwen/settings.json')
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).tools.approvalMode, 'default')
  el('.settings-search').value = 'статистика'
  el('.settings-search').dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  assert.ok(el('[data-setting="privacy.usageStatisticsEnabled"]'))
  const privacy = el('[data-setting="privacy.usageStatisticsEnabled"] input')
  assert.equal(privacy.disabled, false)
  privacy.checked = false
  privacy.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await saveSettings()
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).privacy.usageStatisticsEnabled, false)
  assert.equal(all('.settings-fields [data-setting*="Skill"], .settings-fields [data-setting^="mcp."]').length, 0)
  await click('.settings-footer button:nth-child(2)')
  assert.equal(el('.settings-dialog'), null)
  await click('#choose-workdir'); await idle()

  assert.equal(el('#nav-skills').nextElementSibling.id,'open-skill-tests');assert.equal(el('#open-skill-tests').nextElementSibling.id,'open-system-prompt')
  assert.equal(el('#new-chat').closest('.chat-header'),el('.chat-header'))
  assert.equal(el('#stop-qwen').closest('.chat-header'),el('.chat-header'))
  const fillStudio=(selector,value)=>{const n=el(selector);assert.ok(n,selector);n.value=value;n.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
  const submitStudio=async()=>{el('.studio-dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick()}
  const closeStudio=async()=>{await click('.studio-dialog .settings-footer button:last-child');await wait(()=>!el('.studio-dialog'))}
  await click('#open-models');await wait(()=>el('#model-add')&&!el('#model-add').disabled)
  await click('#model-add');fillStudio('#model-label','UI fixture');fillStudio('#model-id','ui-model');fillStudio('#model-url','http://127.0.0.1:7777/v1')
  await submitStudio();await wait(()=>el('#model-use'))
  await click('#model-use');await wait(()=>el('.studio-dialog .settings-message').textContent.includes('выбрана'))
  await closeStudio();await wait(()=>el('#model-profile').selectedOptions[0].textContent==='UI fixture')
  const selectedProfile=(await h.invoke('get-studio','user')).value.selectedModelId
  await click('#open-system-prompt');await wait(()=>el('#system-prompt')&&!el('#prompt-save').closest('fieldset').disabled)
  fillStudio('#system-prompt','GLOBAL_UI_PROMPT');await submitStudio();await wait(()=>el('.studio-dialog .settings-message').textContent.includes('Сохранено'))
  await click('.prompt-dialog [data-scope="project"]');await wait(()=>el('.prompt-dialog [data-scope="project"]').getAttribute('aria-pressed')==='true')
  fillStudio('#system-prompt','PROJECT_UI_PROMPT');el('#prompt-mode').value='replace';el('#prompt-mode').dispatchEvent(new dom.window.Event('change',{bubbles:true}));await submitStudio();await wait(()=>el('.studio-dialog .settings-message').textContent.includes('Сохранено'))
  await closeStudio();assert.equal((await h.invoke('get-studio','project')).value.prompt.text,'PROJECT_UI_PROMPT')
  await click('#nav-skills');await wait(()=>el('#skill-add')&&!el('#skill-add').disabled)
  await click('#skill-add');fillStudio('#skill-name','ui-skill');fillStudio('#skill-description','UI test description');fillStudio('#skill-body','# UI skill body\n\nKeep this text.')
  el('#skill-model-invocable').checked=false;el('#skill-model-invocable').dispatchEvent(new dom.window.Event('change',{bubbles:true}));await submitStudio();await wait(()=>el('#skill-invoke'))
  assert.equal(el('#skill-name').readOnly,true);assert.equal(el('#skill-model-invocable').checked,false)
  // Settings first; switching files keeps drafts and automatically saves them.
  assert.equal(el('#skill-tab-general').getAttribute('aria-selected'),'true')
  fillStudio('#skill-description','UI test description updated')
  await click('#skill-tab-files');await wait(()=>el('#skill-file-text'))
  const pathDialog=async(button,name,directory='')=>{
    await click(button);await wait(()=>el('.skill-path-dialog'))
    if(name!==null)fillStudio('#skill-file-name',name)
    const directoryControl=el('#skill-file-directory');if(directoryControl)directoryControl.value=directory
    el('.skill-path-dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
    await wait(()=>!el('.skill-path-dialog'))
  }
  await pathDialog('#skill-file-add','references/example.md')
  await wait(()=>el('.skill-file-title')?.textContent==='references/example.md'&&el('#skill-file-text'))
  fillStudio('#skill-file-text','Reference content')
  assert.equal(el('#skill-body').closest('fieldset').disabled,false)
  await click('.skill-tree-file[data-path="SKILL.md"]');await wait(()=>el('.skill-file-title').textContent==='SKILL.md'&&el('#skill-file-text')?.value.startsWith('---'))
  await click('.skill-tree-file[data-path="references/example.md"]');await wait(()=>el('#skill-file-text')?.value==='Reference content')
  await click('#skill-save-all');await wait(()=>el('.studio-dialog .settings-message').textContent==='Все изменения сохранены')
  await pathDialog('#skill-folder-add','rules/nested')
  await pathDialog('#skill-file-add','check.py','rules/nested');await wait(()=>el('#skill-file-text'))
  const cm=dom.window.__skillEditorTest,code=cm.EditorView.findFromDOM(el('.skill-text-pane:not([hidden]) .cm-editor'))
  assert.ok(code)
  code.dispatch({changes:{from:0,to:code.state.doc.length,insert:'draft'}})
  assert.equal(el('#skill-file-text').value,'draft')
  assert.equal(cm.undo(code),true);assert.equal(el('#skill-file-text').value,'')
  assert.equal(cm.redo(code),true);assert.equal(el('#skill-file-text').value,'draft')
  code.dispatch({changes:{from:0,to:code.state.doc.length,insert:'print("ok")'}})
  // CodeMirror is active and emits highlighted tokens, rather than a plain textarea.
  await wait(()=>all('.skill-text-pane:not([hidden]) .cm-line span').some(n=>n.textContent==='"ok"'))
  await click('.skill-tree-folder[data-path="rules/nested"]')
  await pathDialog('#skill-path-rename','renamed');await wait(()=>el('[data-path="rules/renamed/check.py"]'))
  await click('.skill-tree-file[data-path="rules/renamed/check.py"]');await wait(()=>el('#skill-file-text')?.value==='print("ok")')
  await pathDialog('#skill-path-move',null,'references');await wait(()=>el('[data-path="references/check.py"]'))
  // Internal drag-and-drop also flushes an in-memory draft before moving it.
  fillStudio('#skill-file-text','print("dragged")')
  const transfer={types:['application/x-qwen-skill-path'],getData:()=> 'references/check.py'}
  const drop=new dom.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:transfer})
  el('.skill-tree-root').dispatchEvent(drop)
  await wait(()=>el('.skill-tree-file[data-path="check.py"]')&&el('#skill-file-text')?.value==='print("dragged")')
  await click('.skill-tree-folder[data-path="rules/renamed"]');await click('#skill-path-remove');await click('.chat-dialog .button-danger');await wait(()=>!el('.chat-dialog')&&!el('[data-path="rules/renamed"]'))
  const imagePath=join(base,'icon.png');await writeFile(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNHEAAAAASUVORK5CYII=','base64'))
  h.folder=imagePath;await click('.skill-tree-root');await click('#skill-file-import');await wait(()=>el('[data-path="icon.png"]'));h.folder=folderA
  await click('.skill-tree-file[data-path="icon.png"]');await wait(()=>el('.skill-asset-preview'));assert.match(el('.skill-asset-preview').src,/^data:image\/png;base64,/)
  await click('.skill-tree-file[data-path="SKILL.md"]');await wait(()=>el('#skill-file-text')?.value.startsWith('---'))
  fillStudio('#skill-file-text',el('#skill-file-text').value.replace('---\n\n','metadata:\n  author: UI fixture\n---\n\n').replace('UI test description updated','Changed raw description'))
  await click('#skill-tab-general');assert.equal(el('#skill-description').value,'Changed raw description')
  // Closing/invoking flushes pending edits without requiring another explicit Save.
  await click('#skill-invoke');await wait(()=>!el('.studio-dialog'));assert.equal(el('#chat-input').value,'/ui-skill ')
  el('#chat-input').value='/';el('#chat-input').dispatchEvent(new dom.window.Event('input',{bubbles:true}));await wait(()=>!el('#slash-menu').hidden)
  assert.ok(all('.slash-item strong').some(n=>n.textContent==='/ui-skill'))
  el('#chat-input').value='/mod';el('#chat-input').dispatchEvent(new dom.window.Event('input',{bubbles:true}));el('#chat-input').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(el('#chat-input').value,'/model ')
  await send('/model');await wait(()=>Boolean(el('.models-dialog')));await closeStudio()
  await send('/skills');await wait(()=>Boolean(el('.skills-dialog')));await closeStudio()
  const startsBeforeHelp=launches.length;await send('/help');await tick();assert.equal(launches.length,startsBeforeHelp);assert.match(el('#messages').textContent,/Команды Desktop/)
  // Restart preserves the selected model, prompt and edited skill files.
  await shutdown();await boot();await idle();await wait(()=>el('#model-profile').selectedOptions[0]?.textContent==='UI fixture')
  assert.equal((await h.invoke('get-studio','user')).value.selectedModelId,selectedProfile)
  assert.equal((await h.invoke('get-studio','project')).value.prompt.text,'PROJECT_UI_PROMPT')
  const savedSkills=(await h.invoke('get-skills','user')).value.entries;assert.ok(savedSkills.some(s=>s.name==='ui-skill'&&s.description==='Changed raw description'))
  // Keep the existing regression fixtures in their original model/prompt mode.
  await h.invoke('select-model',null);let studioData=(await h.invoke('get-studio','project')).value;await h.invoke('save-prompt',{scope:'project',revision:studioData.revision,prompt:null});studioData=(await h.invoke('get-studio','user')).value;await h.invoke('save-prompt',{scope:'user',revision:studioData.revision,prompt:null})
  el('#chat-input').value='';el('#chat-input').dispatchEvent(new dom.window.Event('input',{bubbles:true}))

  const initialDir = (await h.view()).chat.workdirId
  await click('#open-core-tools')
  await wait(() => Boolean(el('.core-tools-dialog [data-tool="write_file"] input')))
  assert.equal(el('[data-tool="write_file"] input').checked, true)
  const writer = el('[data-tool="write_file"] input')
  writer.checked = false; writer.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  el('.core-tools-dialog .settings-footer button:last-child').click()
  await wait(() => el('.core-tools-dialog .settings-message').textContent.includes('Сохранено'))
  assert.ok(JSON.parse(await readFile(settingsPath, 'utf8')).tools.disabled.includes('write_file'))
  el('.core-tools-dialog .settings-search').value = 'ask_user_question'
  el('.core-tools-dialog .settings-search').dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  assert.equal(el('[data-tool="ask_user_question"] input').disabled, true)
  assert.equal(el('[data-tool="ask_user_question"] input').checked, false)
  await click('.core-tools-dialog .settings-footer button:nth-child(2)')
  await click(`[data-close-workdir="${initialDir}"]`)
  await wait(() => (el('#workspace-name').textContent === 'Папка не выбрана'))
  assert.equal(el('#chat-input').disabled, true)
  assert.ok(el('.closed-workdirs'))
  await click(`[data-reopen-workdir="${initialDir}"]`); await idle()
  assert.equal((await h.view()).chat.workdirId, initialDir)
  await click('#open-settings')
  await wait(() => Boolean(el('.settings-dialog [data-setting="tools.approvalMode"] select')))
  await click('.settings-scopes [data-scope="project"]')
  await wait(() => el('.settings-scopes [data-scope="project"]').getAttribute('aria-pressed') === 'true' && !el('.settings-search').disabled)
  selectSetting('tools.approvalMode', 'auto-edit')
  await saveSettings()
  assert.equal(JSON.parse(await readFile(join(folderA, '.qwen/settings.json'), 'utf8')).tools.approvalMode, 'auto-edit')
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).tools.approvalMode, 'default')
  await click('.settings-footer button:nth-child(2)')
  assert.equal(el('#approval-mode').selectedOptions[0].textContent, 'Из настроек · Автоправки')
  const changeMode = async mode => {
    el('#approval-mode').value = mode
    el('#approval-mode').dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await idle(); await tick()
  }
  el('#chat-input').value = 'Draft kept while choosing mode'
  await changeMode('plan')
  assert.equal((await h.view()).mode, 'plan')
  assert.equal(el('#chat-input').value, 'Draft kept while choosing mode')
  await changeMode('default')
  assert.equal((await h.view()).mode, 'default')
  const firstId = (await h.view()).chat.id
  await send('First conversation with tools')
  await wait(() => all('.permission-actions button').length === 3)
  assert.equal(all('.saved-chat').every(button => button.disabled), true)
  all('.permission-actions button')[1].click()
  await idle(); await tick()
  assert.equal(decisions.at(-1), 'allow-session')
  assert.equal(launches[0].options.permissionMode, 'default')
  assert.ok(launches[0].options.excludeTools.includes('write_file'))
  assert.equal(el('#approval-mode').value, 'yolo')
  assert.equal(all('.messages > .message.assistant').length, 1)
  assert.equal(all('.activity .message.assistant').length, 2)
  assert.ok(el('.activity .thinking-panel'))
  assert.ok(el('.activity .tool-entry'))
  assert.ok(el('.activity .permission'))
  assert.equal(el('.activity').open, false)
  assert.equal(el('.thinking-panel').closest('.activity'), el('.activity'))
  assert.equal(all('.messages > .thinking-panel, .messages > .turn-thinking').length, 0)
  assert.equal(el('.thinking-panel').open, true)
  assert.equal(el('.workdir-toggle svg path').getAttribute('d'), 'm9 5 7 7-7 7')
  assert.equal(el('.workdir-toggle').textContent, '')
  assert.equal(el('.messages > .message.assistant .markdown-body strong').textContent, 'Answer:')
  assert.match(el('.tool-title').textContent, /mcp__custom__write_report/)
  assert.match(el('#agent-status').textContent, /Всё разрешено/)
  const firstSession = launches[0].id
  await click('#new-chat'); await idle()
  const secondId = (await h.view()).chat.id
  assert.equal(all('.saved-chat').length, 2)
  assert.equal(all('.message.user').length, 0)
  await send('Independent <img src=x onerror=alert(1)>'); await idle(); await tick()
  assert.equal(launches[1].options.resume, undefined)
  assert.equal(all('.saved-chat img').length, 0)
  h.folder = folderB
  await click('#choose-workdir'); await idle()
  await send('Other project'); await idle(); await tick()
  assert.equal(all('.saved-workdir').length, 2)
  assert.equal(all('.saved-chat').length, 3)
  await click(`[data-chat-id="${firstId}"]`); await idle()
  assert.match(el('.thinking-content').textContent, /Saved thinking text/)
  assert.match(el('.tool-output').textContent, /Saved MCP result/)
  assert.equal(all('.permission-actions button').length, 0, 'Historical permission has active buttons')
  assert.match(el('.permission-result').textContent, /не включает автоодобрение/)
  assert.equal(el('#agent-status').textContent.includes('Всё разрешено'), true)
  assert.equal(decisions.length, 1, 'Restoring the transcript sent a tool approval')
  await click(`[data-chat-id="${secondId}"]`); await idle()
  assert.equal(all('.message.user').length, 1)
  assert.equal(all('.thinking-panel').length, 0)
  // Switching back before restart must preserve A's own approval.
  await click(`[data-chat-id="${firstId}"]`); await idle()
  const decisionsBefore = decisions.length
  await send('Continue with tools'); await idle(); await tick()
  assert.equal(decisions.length, decisionsBefore)
  assert.equal(launches.at(-1).options.resume, firstSession)
  await click(`[data-chat-id="${secondId}"]`); await idle()
  const startsBeforeRestart = launches.length
  await shutdown()
  // Simulate a chat written by the earlier build with no explicit final events.
  const file = join(base, 'app-data/qwen-desktop-history/chats', `${firstId}.json`)
  const legacy = JSON.parse(await readFile(file, 'utf8'))
  for (const turn of legacy.turns) turn.events = turn.events.filter(event => event.type !== 'final')
  await writeFile(file, JSON.stringify(legacy))
  await boot(); await idle()
  assert.equal(el('#agent-status').textContent.includes('Всё разрешено'), false)
  assert.equal(all('.saved-workdir').length, 2)
  assert.equal(all('.saved-chat').length, 3)
  assert.equal(el('.saved-chat[aria-current="true"]').dataset.chatId, secondId)
  assert.equal(el('#workspace-name').textContent, 'Project A')
  assert.ok(el('.message.user').textContent.includes('Independent'))
  assert.equal(launches.length, startsBeforeRestart, 'Booting started the model unexpectedly')
  await click(`[data-chat-id="${firstId}"]`); await idle()
  await send('Continue the first conversation'); await idle(); await tick()
  assert.equal(launches.at(-1).options.resume, firstSession)
  assert.equal(all('.message.user').length, 3)
  assert.equal(all('.messages > .message.assistant').length, 3)
  assert.ok(all('.markdown-body h1').every(node => dom.window.getComputedStyle(node).fontSize === '14px'))
  // Rename preserves unsent input, history and session identity.
  el('#chat-input').value = 'Unsent draft'
  const menuAction = async (id, mode) => {
    const row = el(`[data-chat-id="${id}"]`).closest('.saved-chat-row')
    row.querySelector('.chat-menu-trigger').click()
    row.querySelector(`.chat-${mode}`).click()
    await wait(() => Boolean(el('.chat-dialog')))
  }
  const confirmDialog = async () => {
    const form = el('.chat-dialog form')
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(() => !el('.chat-dialog'))
    await idle()
  }
  await menuAction(firstId, 'rename')
  el('.chat-dialog input').value = '  Renamed <img src=x onerror=alert(1)>  '
  await confirmDialog()
  assert.equal((await h.view()).chat.title, 'Renamed <img src=x onerror=alert(1)>')
  assert.equal(el('#chat-input').value, 'Unsent draft')
  assert.equal(all('.saved-chat-title img').length, 0)
  assert.equal((await h.view()).chat.sessionId, firstSession)
  await menuAction(firstId, 'delete')
  await click('.chat-dialog button[type="button"]')
  assert.equal((await h.view()).chat.id, firstId)
  assert.equal(management.filter(x => x.mode === 'delete').length, 0)
  await menuAction(secondId, 'delete')
  await confirmDialog()
  assert.equal((await h.view()).chat.id, firstId)
  assert.equal(el('#chat-input').value, 'Unsent draft')
  await menuAction(firstId, 'delete')
  const formToDelete = el('.chat-dialog form')
  formToDelete.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  formToDelete.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(() => !el('.chat-dialog')); await idle()
  assert.equal(management.filter(x => x.mode === 'delete').length, 2)
  const freshId = (await h.view()).chat.id
  assert.notEqual(freshId, firstId)
  assert.equal(el('#workspace-name').textContent, 'Project A')
  assert.equal(all('.message.user').length, 0)
  await menuAction(freshId, 'rename')
  el('.chat-dialog input').value = 'Named empty chat'
  await confirmDialog()
  await send('Cancel with tools')
  await wait(() => all('.permission-actions button').length === 3)
  await click('#stop-qwen'); await idle()
  assert.equal(el('.activity').open, true)
  assert.equal(all('.messages > .message.assistant').length, 0)
  assert.ok(el('.activity .message.assistant').textContent.includes('Сначала проверю'))
  assert.equal((await h.view()).chat.title, 'Named empty chat')
  await click('#theme-toggle'); assert.equal(dom.window.document.documentElement.dataset.theme,'light')
  await shutdown(); await boot(); await idle()
  assert.equal(dom.window.document.documentElement.dataset.theme,'light'); assert.equal(el('#theme-select').value,'light')
  assert.equal((await h.view()).chat.title, 'Named empty chat')
  assert.equal(all('.saved-chat').length, 2)
  // Closed folders survive another restart and reopening retains the chat.
  const persisted = await h.view()
  const openDirId = persisted.chat.workdirId, keptChatId = persisted.chat.id
  await click(`[data-close-workdir="${openDirId}"]`)
  await wait(() => el('#ui-language') && dom.window.document.documentElement.dataset.theme && !el('#choose-workdir').disabled)
  await shutdown(); await boot()
  await wait(()=>el(`[data-reopen-workdir="${openDirId}"]`))
  assert.ok(el(`[data-reopen-workdir="${openDirId}"]`))
  await click(`[data-reopen-workdir="${openDirId}"]`); await idle()
  assert.equal((await h.view()).chat.id, keptChatId)
  assert.deepEqual(errors, [])
  console.log('PASS: skill tabs, CodeMirror highlighting, autosave/draft switching, folder-picker moves, resource import/preview, shared SKILL metadata, skills/models/system-prompt UI, file drafts, raw editing, slash palette and local commands, persistent themes, MCP forms/probe/tool toggles/deletion/draft protection, navigation settings/tools buttons, persistent workdir close/reopen without data loss, native tool switches and protected tools, ' + ' settings dialog, scopes, toggles, search, persisted values, excluded MCP/skills editing, five-mode dropdown, selected mode reaches SDK, draft preserved,  chat rename/delete dialogs, cancel/delete double-submit, persistent custom titles, independent approvals through switches, final answer promotion and one collapsed block including thinking, legacy transcript folding, interrupted progress retained, ' + ' real main/store + DOM, multiple folders/chats, independent sessions, live permission, inert historical permission, Markdown/thinking/MCP replay, restart restores selected chat and messages without model calls, next prompt resumes the right session, no injected title HTML, existing 14px typography preserved.')
} finally { await shutdown(); await rm(base, { recursive: true, force: true }) }
