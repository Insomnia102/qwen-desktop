import {t} from '../shared/i18n'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { existsSync,readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { query, type CanUseTool, type PermissionResult } from '@qwen-code/sdk'
import type { PermissionDecision, QwenEvent, Reply, SavedChat, WorkspaceView } from '../shared/qwen'
import { isApprovalMode, type ApprovalMode, type SettingsSaveRequest } from '../shared/settings'
import { Transcript } from './transcript'
import { HistoryStore } from './history-store'
import { SettingsStore } from './settings-store'
import type { CoreToolsSaveRequest } from '../shared/core-tools'
import type { McpMutation, McpProbeRequest } from '../shared/mcp'
import { McpStore } from './mcp-store'
import { probeMcp } from './mcp-client'
import { McpConsent } from './mcp-consent'
import type { McpConfig, McpView } from '../shared/mcp'
import {DesktopStore} from './desktop-store'
import {RuntimeManager} from './runtime-manager'
import {waitFor,closeSession} from './async-lifecycle'
import {checkConnection} from './connection-check'
import {isUiLanguage,type ConnectionState} from '../shared/desktop'
import { StudioStore } from './studio-store'
import { SkillsStore } from './skills-store'
import {SkillTestsService} from './skill-tests-service'
import type {SkillTestSuite} from '../shared/skill-tests'
import type {TestEnvironment} from './skill-test-runner'
import { DESKTOP_COMMANDS, QWEN_COMMANDS, type ModelSaveRequest, type PromptSaveRequest, type SkillSaveRequest, type SkillFile, type SkillPathChange, type SlashCommand } from '../shared/studio'
import type { SettingsScope } from '../shared/settings'

type PendingPermission = { finish: (decision: PermissionDecision) => void }
type Run = {
  chatId: string
  requestId: string
  abort: AbortController
  permissions: Map<string, PendingPermission>
  allowAll: boolean
  mode: ApprovalMode
  settled: Promise<void>
  resolve: () => void
}
type WindowState = {
  id: number
  contents: BrowserWindow['webContents']
  window: BrowserWindow
  chatId: string | null
  selecting: boolean
  approvedChats: Set<string>
  modes: Map<string, ApprovalMode>
  run: Run | null
}
const states = new Map<number, WindowState>()
let store: HistoryStore | undefined
let settingsStore: SettingsStore | undefined
let mcpStore: McpStore | undefined
let studioStore: StudioStore | undefined
let skillsStore: SkillsStore | undefined
let desktopStore:DesktopStore|undefined
let runtimeManager:RuntimeManager|undefined
const runtimeOperations=new Map<number,AbortController>()
let skillTestsService:SkillTestsService|undefined
function skillTests():SkillTestsService{
 if(!skillTestsService)skillTestsService=new SkillTestsService({directory:join(app.getPath('userData'),'skill-tests'),resources:join(app.getAppPath(),'resources').replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'),skills:skills(),launch:query,environment:testEnvironment,changed:(batchId,active)=>{for(const state of states.values())if(!state.window.isDestroyed()&&!state.contents.isDestroyed())state.contents.send('qwen:skill-test-event',{type:'changed',batchId,active})}})
 return skillTestsService
}
async function testEnvironment(suite:SkillTestSuite):Promise<TestEnvironment>{
 const runtime=await runtimes().inspect();if(!runtime.ready)throw new Error('Qwen CLI is unavailable. Open Model connection to install it.')
 const cwd=suite.sourceCwd,info=studio().view(null,cwd),profileId=suite.modelProfileId??info.defaultModelId,chosen=info.profiles.find(p=>p.id===profileId)
 if(suite.modelProfileId&&!chosen)throw new Error('Model profile not found');if(chosen)settings().validateStudioModel(chosen,cwd)
 const profile=studio().runtime('skill-tests',cwd??app.getPath('home'),process.env,profileId)
 if(!chosen&&!settings().connectionConfigured(cwd))throw new Error('Configure a model before running skill tests')
 const config=settings().testRuntimeConfig(cwd),servers:Record<string,McpConfig>=Object.create(null)
 if(suite.useMcp)for(const entry of mcp().loadMcp(cwd?'project':'user',cwd).servers){const project=['Текущая папка','.mcp.json проекта'].includes(entry.source);if(entry.enabled&&(!project||cwd&&consents().has(cwd,entry.name,entry.config))){const value={...entry.config};delete value.scope;servers[entry.name]=value}}
 return {bootstrap:bootstrapPath(),cli:cliPath(),model:profile.model,authType:profile.authType,env:profile.env,systemPrompt:profile.systemPrompt,disabledTools:settings().disabledCoreTools(cwd),...config,mcpServers:servers,modelLabel:chosen?.label??'Native Qwen configuration'}
}
function runtimes():RuntimeManager {
 if(!runtimeManager){const root=dirname(require.resolve('@qwen-code/sdk/package.json'));const version=readFileSync(join(root,'dist','BUNDLED_CLI_VERSION'),'utf8').trim();if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw new Error('Invalid bundled CLI version');runtimeManager=new RuntimeManager({directory:join(app.getPath('userData'),'runtimes'),version})}
 return runtimeManager
}
const connectionChecks=new Map<number,AbortController>()
function desktop():DesktopStore {return desktopStore??=new DesktopStore(join(app.getPath('userData'),'qwen-desktop-preferences.json'),app.getLocale?.()??'en')}
async function connectionState(state:WindowState,refresh=false):Promise<ConnectionState> {
 state.chatId??=history().snapshot().activeChatId
 const cwd=selectedCwd(state),info=studio().view(state.chatId,cwd),nativeConfigurationFound=settings().connectionConfigured(cwd)
 const runtime=refresh&&!runtimeOperations.size?await runtimes().inspect():runtimes().cached()??await runtimes().inspect()
 let runtimeReady=runtime.ready;try{bootstrapPath()}catch{runtimeReady=false}
 const chosen=info.profiles.find(p=>p.id===info.selectedModelId)
 let configured=nativeConfigurationFound
 if(chosen){try{settings().validateStudioModel(chosen,cwd);studio().runtime(state.chatId??'',cwd??app.getPath('home'),process.env,chosen.id);configured=chosen.keySource!=='inherit'||settings().connectionConfigured(cwd,process.env,chosen.model)}catch{configured=false}}
 return {preferences:desktop().read(),runtime,runtimeReady,configurationFound:configured,profiles:info.profiles.map(({id,label,model})=>({id,label,model})),defaultModelId:info.defaultModelId??null,selectedModelId:info.selectedModelId,secureStorage:info.secureStorage,nativeConfigurationFound}
}
function studio(): StudioStore {
  return studioStore ??= new StudioStore(join(app.getPath('userData'),'qwen-desktop-studio.json'),{
    available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),
    encrypt:text=>safeStorage.encryptString(text),decrypt:data=>safeStorage.decryptString(data)
  })
}
function skills(): SkillsStore { return skillsStore ??= new SkillsStore(app.getPath('home')) }
const probes = new Map<number, AbortController>()
const commandCache = new Map<string,SlashCommand[]>()
function mcp(): McpStore { return mcpStore ??= new McpStore(app.getPath('home')) }
function consents(): McpConsent { return new McpConsent(join(app.getPath('userData'), 'qwen-desktop-mcp-consent.json')) }
function mcpView(scope: 'user' | 'project', cwd: string | null): McpView {
  const result = mcp().loadMcp(scope, cwd)
  if (cwd) for (const entry of result.servers) {
    entry.needsApproval = (entry.source === 'Текущая папка' || entry.source === '.mcp.json проекта') && !consents().has(cwd, entry.name, entry.config)
  }
  return result
}
function runtimeMcpServers(cwd: string): Record<string, McpConfig> {
  const result: Record<string, McpConfig> = Object.create(null)
  for (const entry of mcp().loadMcp('project', cwd).servers) {
    if (entry.enabled && ['Текущая папка', '.mcp.json проекта'].includes(entry.source) && consents().has(cwd, entry.name, entry.config)) {
      const config = { ...entry.config }; delete config.scope
      result[entry.name] = config
    }
  }
  return result
}
const ok = <T>(value: T): Reply<T> => ({ ok: true, value })
const fail = (error: string): Reply<never> => ({ ok: false, error })
const errorText = (error: unknown): string => error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : String(error)

// Keep the SDK external in electron-vite. For packaged builds its entire
// directory is unpacked, and the child process needs the real filesystem path.
function cliPath():string {return runtimes().entry()}

function bootstrapPath(): string {
  const path = join(app.getAppPath(), 'resources', 'qwen-bootstrap.cjs')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  if (!existsSync(path)) throw new Error(`Не найден запускной файл: ${path}. Скопируйте resources/qwen-bootstrap.cjs из патча.`)
  return path
}

function send(state: WindowState, event: QwenEvent): void {
  if (state.run && event.requestId === state.run.requestId && event.type !== 'done') {
    history().record(state.run.chatId, event)
  }
  if (!state.window.isDestroyed() && !state.contents.isDestroyed()) {
    state.contents.send('qwen:event', event)
  }
}

function storageError(error: unknown): void {
  console.error('[qwen history]', error)
  const text = `Не удалось сохранить историю: ${errorText(error)}. Проверьте доступ к папке данных приложения.`
  for (const state of states.values()) send(state, { requestId: '', type: 'storage-error', text })
}

function history(): HistoryStore {
  return store ??= new HistoryStore(join(app.getPath('userData'), 'qwen-desktop-history'), storageError)
}

function settings(): SettingsStore {
  return settingsStore ??= new SettingsStore(app.getPath('home'))
}

function selectedCwd(state: WindowState): string | null {
  const index = history().snapshot()
  const chat = index.chats.find(item => item.id === state.chatId)
  return index.workdirs.find(dir => dir.id === chat?.workdirId)?.path ?? null
}

function modeFor(state: WindowState): ApprovalMode {
  if (state.chatId && state.approvedChats.has(state.chatId)) return 'yolo'
  return (state.chatId && state.modes.get(state.chatId)) || settings().approvalMode(selectedCwd(state))
}

function view(state: WindowState): WorkspaceView {
  const db = history()
  let chat: SavedChat | null = null
  const warnings = db.takeWarnings()
  try { if (state.chatId) chat = db.getChat(state.chatId) } catch (error) { warnings.push(errorText(error)) }
  warnings.push(...db.takeWarnings())
  let mode: ApprovalMode = 'auto'
  try { mode = modeFor(state) } catch (error) { warnings.push(errorText(error)) }
  let modelProfileId:string|null=null,modelLabel='Из настроек Qwen'
  try {const info=studio().view(state.chatId,selectedCwd(state));modelProfileId=info.selectedModelId;modelLabel=info.profiles.find(p=>p.id===modelProfileId)?.label??modelLabel}catch(error){warnings.push(errorText(error))}
  return { index: { ...db.snapshot(), activeChatId: state.chatId }, chat, warnings, modelProfileId,modelLabel,skillTestsRunning:Boolean(skillTestsService?.busy),
    allowAll: state.chatId !== null && state.approvedChats.has(state.chatId), mode,
    modeOverride: state.chatId !== null && (state.modes.has(state.chatId) || state.approvedChats.has(state.chatId)) }
}

function cancel(state: WindowState): void {
  runtimeOperations.get(state.id)?.abort(); connectionChecks.get(state.id)?.abort()
  probes.get(state.id)?.abort();skillTestsService?.cancel(state.id)
  if (!state.run) return
  state.run?.abort.abort()
  for (const pending of state.run?.permissions.values() ?? []) pending.finish('deny')
  state.approvedChats.delete(state.run.chatId)
  try { history().finishTurn(state.run.chatId, state.run.requestId, 'stopped');history().flush() } catch (error) { storageError(error) }
}

export function attachQwenWindow(window: BrowserWindow): void {
  // Capture native handles while the window is alive. Their getters may throw
  // during closed/before-quit, even when no model request is running.
  const contents = window.webContents
  const id = contents.id
  const state: WindowState = { id, contents, window, chatId: null, selecting: false, approvedChats: new Set(), modes: new Map(), run: null }
  states.set(id, state)
  contents.on('did-start-loading', () => cancel(state))
  window.on('close', () => { cancel(state); try { store?.flush() } catch (error) { storageError(error) } })
  window.on('closed', () => { cancel(state); states.delete(id) })
}

export function stopQwen(): void {
  for (const controller of runtimeOperations.values()) controller.abort()
  for (const controller of connectionChecks.values()) controller.abort()
  for (const controller of probes.values()) controller.abort()
  skillTestsService?.cancel()
  for (const state of states.values()) cancel(state)
  try { store?.flush() } catch (error) { storageError(error) }
}

function stateFor(event: IpcMainInvokeEvent): WindowState {
  const state = states.get(event.sender.id)
  if (!state || event.senderFrame !== event.sender.mainFrame) throw new Error('Недоступный IPC sender')
  return state
}

function askPermission(state: WindowState, run: Run): CanUseTool {
  return async (tool, input, { signal }): Promise<PermissionResult> => {
    if (signal.aborted || run.abort.signal.aborted) {
      return { behavior: 'deny', message: 'Операция отменена' }
    }
    // Remember the user's decision in this desktop dialogue. Keep the SDK's
    // normal policy checks: tools explicitly excluded/denied are not enabled.
    if (run.allowAll) return { behavior: 'allow', updatedInput: input }
    const permissionId = randomUUID()
    const allowed = await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (decision: PermissionDecision): void => {
        if (settled) return
        settled = true
        const allow = decision !== 'deny' && !signal.aborted && !run.abort.signal.aborted
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        run.abort.signal.removeEventListener('abort', onAbort)
        run.permissions.delete(permissionId)
        send(state, { requestId: run.requestId, type: 'permission-closed', permissionId,
          allowed: allow, decision: allow ? decision : 'deny' })
        resolve(allow)
      }
      const onAbort = (): void => finish('deny')
      // Shorter than the SDK's five-minute callback timeout configured below.
      const timer = setTimeout(() => finish('deny'), 290_000)
      run.permissions.set(permissionId, { finish })
      signal.addEventListener('abort', onAbort, { once: true })
      run.abort.signal.addEventListener('abort', onAbort, { once: true })
      send(state, { requestId: run.requestId, type: 'permission', permissionId, tool,
        details: JSON.stringify(input, null, 2) })
    })
    return allowed && !signal.aborted && !run.abort.signal.aborted
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Операция не подтверждена или отменена' }
  }
}

async function runPrompt(state: WindowState, run: Run, prompt: string, cwd: string): Promise<void> {
  let session: ReturnType<typeof query> | undefined
  let gotResult = false
  let initialized = false
  let successful = false
  let failed = false
  let resume:string|undefined
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) {
      throw new Error('SDK требует Node.js >= 22 внутри Electron. Обновите Electron.')
    }
    if (!(await stat(cwd)).isDirectory()) throw new Error('Рабочая папка недоступна')
    if (run.abort.signal.aborted) return
    resume = history().getChat(run.chatId).sessionId ?? undefined
    const chosen=studio().view(run.chatId,cwd)
    const selectedProfile=chosen.profiles.find(p=>p.id===chosen.selectedModelId)
    if(selectedProfile)settings().validateStudioModel(selectedProfile,cwd)
    const profile = studio().runtime(run.chatId,cwd)
    console.info('[qwen launch]', { cwd, chatId: run.chatId, promptLength: prompt.length, resume: resume ?? null })
    send(state, { requestId: run.requestId, type: 'approval-mode', allowAll: run.allowAll, mode: run.mode })
    session = query({
      prompt, // The complete string, with quotes and newlines preserved.
      options: {
        ...(profile.model?{model:profile.model,authType:profile.authType}:{}),
        cwd,
        // Explicitly configured project connections enter the SDK overlay only
        // after a Desktop grant for this exact configuration fingerprint.
        mcpServers: runtimeMcpServers(cwd),
        pathToQwenExecutable: bootstrapPath(),
        // SDK uses process.execPath. In Electron, run the child as Node.
        env: {
          ELECTRON_RUN_AS_NODE: '1', FORK_MODE: '0', NO_COLOR: '1', FORCE_COLOR: '0',
          QWEN_CODE_NO_RELAUNCH: 'true',
          QWEN_DESKTOP_CLI_ENTRY: cliPath(),
          ...profile.env
        },
        permissionMode: run.mode,
        canUseTool: askPermission(state, run),
        // This desktop bridge has text follow-ups and permission cards, but
        // does not implement the CLI's interactive questionnaire protocol.
        excludeTools: [...new Set(['ask_user_question', ...settings().disabledCoreTools(cwd)])],
        systemPrompt: profile.systemPrompt,
        includePartialMessages: true,
        abortController: run.abort,
        resume,
        timeout: { canUseTool: 300_000 },
        // Diagnostic output goes to main-process logs, never to the chat.
        stderr: text => console.error('[qwen stderr]', text),
        // Debug transport logs may include the serialized MCP configuration.
        logLevel: 'warn'
      }
    })
    // A system/init event alone is not the control handshake acknowledgment.
    // Never display unsolicited output or remember its session before this.
    await waitFor(session.initialized,run.abort.signal,45_000,'Qwen CLI did not complete initialization within 45 seconds. Open Model connection, check the runtime and try again.')
    if (run.abort.signal.aborted) return
    initialized = true
    // Persist only after the control handshake has acknowledged the session.
    // The CLI owns its model/tool context; the desktop owns its presentation.
    history().setSession(run.chatId, session.getSessionId())
    console.info('[qwen ready]', { sessionId: session.getSessionId(), cwd })
    const transcript = new Transcript(run.requestId, event => send(state, event))
    for await (const message of session) {
      if (run.abort.signal.aborted) break
      if (message.type === 'system') {
        console.info('[qwen session]', message.subtype, message.cwd, message.tools)
        if(message.slash_commands){const knownSkills=new Set(skills().effective(cwd).map(s=>s.name));commandCache.set(cwd,message.slash_commands.map(raw=>{const name=raw.replace(/^\//,'');return{name,description:'Команда Qwen CLI',kind:knownSkills.has(name)?'skill':'qwen'}}))}
      }
      if (message.type === 'result') {
        gotResult = true
        if (!message.is_error && message.session_id) {
          history().setSession(run.chatId, message.session_id)
          successful = true
        }
      }
      transcript.accept(message)
    }
    if (!gotResult && !run.abort.signal.aborted) {
      throw new Error('Qwen завершился без результата. Проверьте авторизацию и логи main-процесса.')
    }
  } catch (error) {
    failed=!run.abort.signal.aborted
    if (failed) {
      const detail=t(errorText(error),desktop().read().language)
      send(state, { requestId: run.requestId, type: 'error', text: initialized ? detail :
        `Не удалось завершить инициализацию SDK: ${detail}. Проверьте resources/qwen-bootstrap.cjs и лог [qwen-bootstrap].` + (resume ? ' '+t('This chat has a saved Qwen session. If you deleted Qwen data, create a new chat. Your visible history is preserved.',desktop().read().language) : '') })
    }
  } finally {
    for (const pending of [...run.permissions.values()]) pending.finish('deny')
    const cancelled=run.abort.signal.aborted
    // Kill the SDK child before bounded cleanup; a missing handshake must never lock the chat.
    if (!successful) run.abort.abort()
    await closeSession(session)
    const status = cancelled ? 'stopped' : successful ? 'done' : 'error'
    try{history().finishTurn(run.chatId, run.requestId, status)}catch(error){storageError(error)}
    if (successful && !run.abort.signal.aborted && run.allowAll) state.approvedChats.add(run.chatId)
    else state.approvedChats.delete(run.chatId)
    try { history().flush() } catch (error) { storageError(error) }
    if (state.run === run) state.run = null
    send(state, { requestId: run.requestId, type: 'done', cancelled,
      allowAll: state.approvedChats.has(run.chatId), mode: state.approvedChats.has(run.chatId) ? 'yolo' : run.mode })
    run.resolve()
  }
}

export function registerQwenIPC(): void {
  const scopeOf=(value:unknown):SettingsScope=>{if(value!=='user'&&value!=='project')throw new Error('Неизвестная область');return value}
  const textOf=(value:unknown):string=>{if(typeof value!=='string'||value.length>1000)throw new Error('Некорректный идентификатор');return value}
  const idle=(state:WindowState):void=>{if(state.selecting||runtimeOperations.size||connectionChecks.size||probes.size||skillTestsService?.busy||[...states.values()].some(s=>s.run))throw new Error('Дождитесь завершения текущей операции')}
  const handle=(name:string,fn:(state:WindowState,...args:unknown[])=>unknown,mutating=false):void=>{
    ipcMain.handle(`qwen:${name}`,async(event,...args:unknown[])=>{try{const state=stateFor(event);if(mutating)idle(state);return ok(await fn(state,...args))}catch(error){return fail(errorText(error))}})
  }
  handle('plan-skill-tests',(state,request)=>skillTests().plan(state.id,request,selectedCwd(state)),true)
  handle('reply-skill-test',(state,id,text)=>{if(text!==null&&(typeof text!=='string'||text.length>8000))throw Error('Invalid dialogue reply');skillTests().runner.reply(state.id,textOf(id),text as string|null)})
  handle('get-skill-tests',state=>skillTests().view(state.id))
  handle('save-skill-test-suite',(state,input)=>skillTests().save(input,selectedCwd(state)),true)
  handle('delete-skill-test-suite',(_state,id,revision)=>skillTests().store.remove(textOf(id),textOf(revision)),true)
  handle('run-skill-test-suite',async(state,id,cases)=>{state.selecting=true;try{return await skillTests().run(state.id,textOf(id),cases)}finally{state.selecting=false}},true)
  handle('delete-skill-test-run',(_state,id)=>skillTests().removeRun(textOf(id)))
  handle('clear-skill-test-history',()=>skillTests().clearHistory())
  handle('get-skill-test-run',(_state,id)=>skillTests().store.run(textOf(id)))
  handle('cancel-skill-tests',state=>skillTests().cancel(state.id))
  handle('approve-skill-test',(state,id,decision)=>{if(decision!=='allow-once'&&decision!=='allow-run'&&decision!=='deny')throw new Error('Invalid test permission');skillTests().runner.approve(state.id,textOf(id),decision)})
  handle('get-skill-test-artifact',(_state,id,caseId,path)=>skillTests().runner.artifact(textOf(id),textOf(caseId),textOf(path)))
  handle('reveal-skill-test-run',async(_state,id,caseId)=>{const message=await shell.openPath(skillTests().runner.workspace(textOf(id),textOf(caseId)));if(message)throw new Error(message)})
  handle('import-skill-test-suite',async state=>{state.selecting=true;try{const file=await dialog.showOpenDialog(state.window,{properties:['openFile'],filters:[{name:'JSON',extensions:['json']}],title:'Import test scenarios'});return file.canceled||!file.filePaths[0]?null:skillTests().import(file.filePaths[0],selectedCwd(state))}finally{state.selecting=false}},true)
  const exportTests=async(state:WindowState,id:unknown,report:boolean,format:unknown='html'):Promise<void>=>{
    if(format!=='html'&&format!=='json')throw Error('Unknown report format')
    const key=textOf(id),html=report&&format==='html',text=report?(html?skillTests().reportHTML(key,desktop().read().language):skillTests().reportJSON(key)):skillTests().suiteJSON(key)
    state.selecting=true
    try{const file=await dialog.showSaveDialog(state.window,{defaultPath:report?(html?'skill-test-report.html':'skill-test-report.json'):'skill-test-suite.json',filters:[{name:html?'HTML':'JSON',extensions:[html?'html':'json']}]});if(!file.canceled&&file.filePath)skillTests().exportFile(file.filePath,text)}finally{state.selecting=false}
  }
  handle('export-skill-test-suite',(state,id)=>exportTests(state,id,false))
  handle('export-skill-test-run',(state,id,format)=>exportTests(state,id,true,format))
  handle('run-skill-creator',async(state,request)=>{state.selecting=true;try{return await skillTests().creator(state.id,request,selectedCwd(state))}finally{state.selecting=false}},true)
  handle('install-created-skill',(_state,id)=>skillTests().installCreated(textOf(id)),true)
  handle('get-connection-state',state=>connectionState(state,true))
  handle('prepare-runtime',async state=>{
    const abort=new AbortController(),id=state.id;runtimeOperations.set(id,abort)
    try{await runtimes().prepare(abort.signal,phase=>send(state,{requestId:'',type:'runtime-progress',phase}));return await connectionState(state)}finally{if(runtimeOperations.get(id)===abort)runtimeOperations.delete(id)}
  },true)
  handle('cancel-runtime',state=>{runtimeOperations.get(state.id)?.abort()})
  handle('set-ui-language',(_state,language)=>{if(!isUiLanguage(language))throw new Error('Неизвестный язык интерфейса');return desktop().language(language)},true)
  handle('complete-onboarding',(state,id,skip)=>{
    if(typeof skip!=='boolean'||id!==null&&typeof id!=='string')throw new Error('Некорректный запрос')
    if(!skip){studio().setDefault(id as string|null,history().snapshot().chats.map(c=>c.id));if(state.chatId)studio().select(state.chatId,id as string|null)}
    desktop().complete();return connectionState(state)
  },true)
  handle('test-connection',async(state,id)=>{
    if(id!==null&&typeof id!=='string')throw new Error('Некорректный идентификатор')
    const cwd=selectedCwd(state),info=studio().view(state.chatId,cwd),profile=info.profiles.find(p=>p.id===id)
    if(id!==null&&!profile)throw new Error('Модель не найдена')
    if(profile)settings().validateStudioModel(profile,cwd)
    const runtime=studio().runtime(state.chatId??'',cwd??app.getPath('home'),process.env,id as string|null)
    const abort=new AbortController(),windowId=state.id;connectionChecks.set(windowId,abort)
    try{return await checkConnection({directory:join(app.getPath('userData'),'connection-checks'),cwd:cwd??undefined,bootstrap:bootstrapPath(),cli:cliPath(),model:runtime.model,authType:runtime.authType,env:runtime.env},abort,query)}finally{if(connectionChecks.get(windowId)===abort)connectionChecks.delete(windowId)}
  },true)
  handle('cancel-connection-test',state=>{connectionChecks.get(state.id)?.abort();return undefined})
  handle('get-studio',(state,scope)=>studio().view(state.chatId,selectedCwd(state),scopeOf(scope)))
  handle('save-model',(state,request)=>{settings().validateStudioModel(request as ModelSaveRequest,selectedCwd(state));studio().saveModel(request as ModelSaveRequest);return studio().view(state.chatId,selectedCwd(state))},true)
  handle('delete-model',(state,id,revision)=>{studio().removeModel(textOf(id),textOf(revision));return studio().view(state.chatId,selectedCwd(state))},true)
  handle('select-model',(state,id)=>{if(!state.chatId)throw new Error('Сначала выберите диалог');studio().select(state.chatId,id===null?null:textOf(id));return view(state)},true)
  handle('save-prompt',(state,request)=>{studio().savePrompt(request as PromptSaveRequest,selectedCwd(state));return studio().view(state.chatId,selectedCwd(state),(request as PromptSaveRequest).scope)},true)
  handle('get-skills',(state,scope)=>{if(scope==='user'&&existsSync(join(app.getAppPath(),'resources/skills/skill-creator/SKILL.md')))skillTests().builtin();return skills().list(scopeOf(scope),selectedCwd(state))})
  handle('get-skill',(state,scope,id)=>skills().get(scopeOf(scope),textOf(id),selectedCwd(state)))
  handle('save-skill',(state,request)=>skills().save(request as SkillSaveRequest,selectedCwd(state)),true)
  handle('save-raw-skill',(state,scope,id,revision,raw)=>{if(typeof raw!=='string')throw new Error('Ожидается текст');return skills().saveRaw(scopeOf(scope),textOf(id),textOf(revision),raw,selectedCwd(state))},true)
  handle('toggle-skill',(state,scope,id,enabled,revision)=>{const s=scopeOf(scope);if(typeof enabled!=='boolean')throw new Error('Ожидается переключатель');skills().toggle(s,textOf(id),enabled,textOf(revision),selectedCwd(state));return skills().list(s,selectedCwd(state))},true)
  handle('delete-skill',(state,scope,id,revision)=>{const s=scopeOf(scope);skills().remove(s,textOf(id),textOf(revision),selectedCwd(state));return skills().list(s,selectedCwd(state))},true)
  handle('get-skill-directory',(state,scope,id,path,offset)=>skills().directory(scopeOf(scope),textOf(id),textOf(path),typeof offset==='number'?offset:0,selectedCwd(state)))
  handle('get-skill-file',(state,scope,id,path)=>skills().getFile(scopeOf(scope),textOf(id),textOf(path),selectedCwd(state)))
  handle('save-skill-file',(state,scope,id,file)=>skills().saveFile(scopeOf(scope),textOf(id),file as SkillFile,selectedCwd(state)),true)
  handle('inspect-skill-file',(state,scope,id,path)=>skills().inspectFile(scopeOf(scope),textOf(id),textOf(path),selectedCwd(state)))
  handle('change-skill-path',(state,scope,id,request)=>skills().changePath(scopeOf(scope),textOf(id),request as SkillPathChange,selectedCwd(state)),true)
  handle('import-skill-file',async(state,scope,id,directory,revision)=>{
    const s=scopeOf(scope),skillId=textOf(id),dir=textOf(directory),rev=textOf(revision),cwd=selectedCwd(state);state.selecting=true
    try{const result=await dialog.showOpenDialog(state.window,{properties:['openFile'],title:t('Добавить файл в пакет skill',desktop().read().language)});if(result.canceled||!result.filePaths[0])return null;return skills().importFile(s,skillId,result.filePaths[0],dir,rev,cwd)}finally{state.selecting=false}
  },true)
  handle('import-skill',async(state,scope)=>{
    const s=scopeOf(scope),cwd=selectedCwd(state);state.selecting=true
    try{const result=await dialog.showOpenDialog(state.window,{properties:['openDirectory'],title:t('Выберите папку со SKILL.md',desktop().read().language)});if(result.canceled||!result.filePaths[0])return null;return skills().importDirectory(s,result.filePaths[0],cwd)}finally{state.selecting=false}
  },true)
  handle('get-commands',state=>{
    const cwd=selectedCwd(state),disabled=new Set([...settings().slashDisabled(cwd),...(process.env.QWEN_DISABLED_SLASH_COMMANDS??'').split(',')].map(s=>s.trim().replace(/^\//,'').toLowerCase()))
    const result=new Map<string,SlashCommand>()
    for(const command of [...QWEN_COMMANDS,...(cwd?(commandCache.get(cwd)??[]).filter(c=>c.kind!=='skill'):[]),...skills().effective(cwd).filter(s=>s.enabled&&s.userInvocable).map(s=>({name:s.name,description:s.description,kind:'skill' as const})),...DESKTOP_COMMANDS]){
      if(!disabled.has(command.name.toLowerCase()))result.set(command.name,command)
    }
    return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name))
  })
  ipcMain.handle('qwen:load', async event => {
    try {
      const state = stateFor(event)
      if (state.run) await state.run.settled
      state.chatId ??= history().snapshot().activeChatId
      const result = view(state)
      history().flush()
      return ok(result)
    } catch (error) { return fail(errorText(error)) }
  })
  ipcMain.handle('qwen:select-folder', async event => {
    const state = stateFor(event)
    if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Дождитесь завершения текущей операции')
    state.selecting = true
    try {
      const result = await dialog.showOpenDialog(state.window, {
        properties: ['openDirectory'], title: t('Выберите рабочую папку',desktop().read().language)
      })
      if (result.canceled || !result.filePaths[0]) return ok(null)
      const cwd = await realpath(result.filePaths[0])
      if (!(await stat(cwd)).isDirectory()) return fail('Выбранный путь не является папкой')
      state.chatId = history().addWorkdir(cwd)
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
    finally { state.selecting = false }
  })

  for (const kind of ['chat', 'workdir'] as const) ipcMain.handle(`qwen:select-${kind}`, (event, id: unknown) => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Дождитесь завершения текущей операции')
      if (typeof id !== 'string') return fail('Некорректный идентификатор')
      if (kind === 'chat') { history().selectChat(id); state.chatId = id }
      else state.chatId = history().selectWorkdir(id)
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:close-workdir', (event, id: unknown) => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Дождитесь завершения текущей операции')
      if (typeof id !== 'string') return fail('Некорректный ID папки')
      const index = history().snapshot()
      const chatIds = new Set(index.chats.filter(chat => chat.workdirId === id).map(chat => chat.id))
      if ([...states.values()].some(other => other.run && chatIds.has(other.run.chatId))) return fail('В этой папке выполняется запрос')
      const fallback = history().closeWorkdir(id)
      for (const other of states.values()) if (other.chatId && chatIds.has(other.chatId)) other.chatId = fallback
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:start', (event, payload: unknown) => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Сначала завершите текущую операцию')
      if (!state.chatId) return fail('Сначала выберите рабочую папку и диалог')
      if (!payload || typeof payload !== 'object') return fail('Некорректный запрос')
      const { requestId, prompt } = payload as Record<string, unknown>
      if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId) ||
          typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200_000) {
        return fail('Некорректный текст запроса или идентификатор')
      }
      if ([...states.values()].some(other => other.run?.chatId === state.chatId)) return fail('Этот диалог уже выполняется в другом окне')
      const chat = history().getChat(state.chatId)
      const cwd = history().snapshot().workdirs.find(dir => dir.id === chat.workdirId)?.path
      if (!cwd) return fail('Рабочая папка диалога не найдена')
      const mode = modeFor(state)
      try { history().beginTurn(chat.id, requestId, prompt) } catch (error) {
        history().finishTurn(chat.id, requestId, 'error')
        throw error
      }
      let resolve!: () => void
      const settled = new Promise<void>(done => { resolve = done })
      const run: Run = { chatId: chat.id, requestId, abort: new AbortController(), permissions: new Map(),
        allowAll: state.approvedChats.has(chat.id), mode, settled, resolve }
      state.run = run // Acquire the lock before any asynchronous work.
      void runPrompt(state, run, prompt, cwd)
      return ok(undefined)
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:cancel', event => { cancel(stateFor(event)); return ok(undefined) })
  ipcMain.handle('qwen:new-chat', event => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Сначала завершите текущую операцию')
      if (!state.chatId) return fail('Сначала выберите рабочую папку')
      const current = history().snapshot().chats.find(chat => chat.id === state.chatId)
      if (!current) return fail('Диалог не найден')
      state.chatId = history().createChat(current.workdirId)
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
  })
  for (const kind of ['rename', 'delete'] as const) ipcMain.handle(`qwen:${kind}-chat`, (event, id: unknown, title: unknown) => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Дождитесь завершения текущей операции')
      if (typeof id !== 'string') return fail('Некорректный ID диалога')
      if ([...states.values()].some(other => other.run?.chatId === id)) return fail('В диалоге выполняется запрос')
      if (kind === 'rename') {
        if (typeof title !== 'string') return fail('Некорректное название')
        history().renameChat(id, title)
      } else {
        const nextId = history().deleteChat(id)
        for (const other of states.values()) {
          other.approvedChats.delete(id)
          other.modes.delete(id)
          if (other.chatId === id) other.chatId = nextId
        }
      }
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:set-mode', (event, mode: unknown) => {
    try {
      const state = stateFor(event)
      if (state.run || state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy) return fail('Режим можно менять между запросами')
      if (!state.chatId) return fail('Сначала выберите диалог')
      if (mode !== null && !isApprovalMode(mode)) return fail('Неизвестный режим разрешений')
      state.approvedChats.delete(state.chatId)
      if (mode === null) state.modes.delete(state.chatId); else state.modes.set(state.chatId, mode)
      return ok(view(state))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:get-settings', (event, scope: unknown) => {
    try {
      const state = stateFor(event)
      if (scope !== 'user' && scope !== 'project') return fail('Неизвестная область настроек')
      return ok(settings().load(scope, selectedCwd(state)))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:save-settings', (event, request: unknown) => {
    try {
      const state = stateFor(event)
      if (state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy || [...states.values()].some(other => other.run)) return fail('Дождитесь завершения запроса перед сохранением настроек')
      const saved = settings().save(request as SettingsSaveRequest, selectedCwd(state))
      return ok({ settings: saved, workspace: view(state) })
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:get-core-tools', (event, scope: unknown) => {
    try {
      const state = stateFor(event)
      if (scope !== 'user' && scope !== 'project') return fail('Неизвестная область настроек')
      return ok(settings().loadCoreTools(scope, selectedCwd(state)))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:save-core-tools', (event, request: unknown) => {
    try {
      const state = stateFor(event)
      if (state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy || [...states.values()].some(other => other.run)) return fail('Дождитесь завершения запроса')
      return ok(settings().saveCoreTools(request as CoreToolsSaveRequest, selectedCwd(state)))
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:set-theme', (event, theme: unknown) => {
    try {
      const state = stateFor(event)
      if (theme !== 'dark' && theme !== 'light' && theme !== 'system') return fail('Неизвестная тема')
      nativeTheme.themeSource = theme
      state.window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c20' : '#fbfafc')
      return ok(undefined)
    } catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:get-mcp', (event, scope: unknown) => {
    try {
      const state = stateFor(event)
      if (scope !== 'user' && scope !== 'project') return fail('Неизвестная область настроек')
      return ok(mcpView(scope, selectedCwd(state)))
    } catch (error) { return fail(errorText(error)) }
  })
  ipcMain.handle('qwen:mutate-mcp', (event, request: unknown) => {
    try {
      const state = stateFor(event)
      if (state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy || [...states.values()].some(x => x.run)) return fail('Дождитесь завершения запроса или проверки MCP')
      const mutation = request as McpMutation, cwd = selectedCwd(state)
      const saved = mcp().mutateMcp(mutation, cwd)
      if (cwd && ((mutation.action === 'save' && mutation.scope === 'project') || mutation.action === 'approve' || (mutation.action === 'toggle' && mutation.enabled))) {
        const entry = saved.servers.find(x => x.name === mutation.name)
        if (entry && ['Текущая папка', '.mcp.json проекта'].includes(entry.source)) consents().grant(cwd, entry.name, entry.config)
      }
      return ok(mcpView(mutation.scope, cwd))
    } catch (error) { return fail(errorText(error)) }
  })
  ipcMain.handle('qwen:probe-mcp', async (event, request: McpProbeRequest) => {
    let controller: AbortController | undefined
    try {
      const state = stateFor(event)
      if (state.selecting || runtimeOperations.size || connectionChecks.size || probes.size || skillTestsService?.busy || [...states.values()].some(x => x.run)) return fail('Дождитесь завершения запроса или проверки MCP')
      if (!request || !['user', 'project'].includes(request.scope) || typeof request.name !== 'string' || typeof request.contextRevision !== 'string') return fail('Некорректный запрос MCP')
      const cwd = selectedCwd(state)
      const config = mcp().probeConfig(request.scope, request.name, request.contextRevision, cwd)
      controller = new AbortController(); probes.set(event.sender.id, controller)
      return ok(await probeMcp(request.name, config, cwd, controller.signal))
    } catch (error) { return fail(errorText(error)) }
    finally { if (controller && probes.get(event.sender.id) === controller) probes.delete(event.sender.id) }
  })
  ipcMain.handle('qwen:cancel-mcp-probe', event => {
    try { stateFor(event); probes.get(event.sender.id)?.abort(); return ok(undefined) }
    catch (error) { return fail(errorText(error)) }
  })

  ipcMain.handle('qwen:approve', (event, permissionId: unknown, decision: unknown) => {
    const state = stateFor(event)
    if (typeof permissionId !== 'string' ||
        (decision !== 'allow-once' && decision !== 'allow-session' && decision !== 'deny')) {
      return fail('Некорректное подтверждение')
    }
    const run = state.run
    if (!run || run.abort.signal.aborted) return fail('Запрос уже завершён или отменён')
    const pending = run.permissions.get(permissionId)
    if (!pending) return fail('Запрос подтверждения уже закрыт')
    if (decision === 'allow-session') {
      run.allowAll = true
      send(state, { requestId: run.requestId, type: 'approval-mode', allowAll: true, mode: 'yolo' })
      // Resolve every outstanding card, including parallel tool requests.
      for (const item of [...run.permissions.values()]) item.finish('allow-session')
    } else pending.finish(decision)
    return ok(undefined)
  })
}
