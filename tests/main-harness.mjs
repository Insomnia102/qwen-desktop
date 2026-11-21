import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { HistoryStore } from './load-history-store.mjs'
import { loadTypeScript } from './load-typescript.mjs'
const require = createRequire(import.meta.url)
export const root = dirname(dirname(fileURLToPath(import.meta.url)))
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

export async function harness({ userData, folder, query, onEvent = () => {}, onTestEvent = () => {}, onDialog = () => {}, runtime, startupMs=45000 }) {
  const handlers = new Map(), events = [], windowEvents = new Map(), contentEvents = new Map()
  let destroyed=false
  const sender = { get id(){if(destroyed)throw new Error('Object has been destroyed');return 1}, mainFrame: {}, on: (name, callback) => contentEvents.set(name, callback), isDestroyed: () => destroyed,
    send(_channel, event) {if(_channel==='qwen:skill-test-event'){api.testEvents.push(event);onTestEvent(event);return} if(destroyed)throw new Error('Object has been destroyed');events.push(event); onEvent(event, api) } }
  const window = { setBackgroundColor() {}, get webContents(){if(destroyed)throw new Error('Object has been destroyed');return sender}, on: (name, callback) => windowEvents.set(name, callback), isDestroyed: () => destroyed }
  const electron = { safeStorage: {isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:text=>Buffer.from('TEST:'+text),decryptString:data=>data.toString().slice(5)}, nativeTheme: { themeSource: 'system', shouldUseDarkColors: true }, app: { getLocale:()=> 'ru', getAppPath: () => root, getPath: name => name === 'home' ? join(userData, 'home') : userData },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    shell:{openPath:async()=>''},dialog: { showSaveDialog:async()=>({canceled:false,filePath:api.folder}),showOpenDialog: async (...args) => {onDialog(args.at(-1));return { canceled: false, filePaths: [api.folder] }} } }
  const transcript = { exports: {} }
  vm.runInNewContext(compile(await readFile(join(root, 'src/main/transcript.ts'), 'utf8')),
    { exports: transcript.exports, module: transcript })
  const service = { exports: {} }
  const RuntimeManager=class{
 constructor(){this.status={ready:true,source:'managed',cliVersion:'0.27.2',detectedCliVersion:'0.27.2',requiredVersion:'0.27.2',nodeVersion:process.version,npmVersion:'fixture',issue:null};Object.assign(this,runtime)}
 async inspect(){return this.cached()}
 cached(){return {...this.status}}
 entry(){if(!this.status.ready)throw new Error('Qwen CLI is unavailable. Open Model connection to install it.');return join(dirname(require.resolve('@qwen-code/sdk/package.json')),'dist/cli/cli.js')}
 async prepare(signal,progress){progress('installing');this.status.ready=true;this.status.issue=null;return this.cached()}
 }
  const customRequire = name => name==='./skill-tests-service'?loadTypeScript('src/main/skill-tests-service.ts'):  name==='./runtime-manager'?{RuntimeManager}:name==='./async-lifecycle'?{...loadTypeScript('src/main/async-lifecycle.ts'),waitFor:(work,signal,ms,message)=>loadTypeScript('src/main/async-lifecycle.ts').waitFor(work,signal,ms===45000?startupMs:ms,message)}: name === 'electron' ? electron : name === '@qwen-code/sdk' ? { query } :
    name === './desktop-store' ? loadTypeScript('src/main/desktop-store.ts') : name === './connection-check' ? loadTypeScript('src/main/connection-check.ts') : name === '../shared/i18n' ? loadTypeScript('src/shared/i18n.ts') : name === '../shared/desktop' ? loadTypeScript('src/shared/desktop.ts') : name === './studio-store' ? loadTypeScript('src/main/studio-store.ts') : name === './skills-store' ? loadTypeScript('src/main/skills-store.ts') : name === '../shared/studio' ? loadTypeScript('src/shared/studio.ts') : name === './mcp-consent' ? loadTypeScript('src/main/mcp-consent.ts') : name === './mcp-store' ? loadTypeScript('src/main/mcp-store.ts') : name === './mcp-client' ? loadTypeScript('src/main/mcp-client.ts') : name === './history-store' ? { HistoryStore } : name === './settings-store' ? loadTypeScript('src/main/settings-store.ts') :
    name === '../shared/settings' ? loadTypeScript('src/shared/settings.ts') : name === './transcript' ? transcript.exports : require(name)
  customRequire.resolve = require.resolve
  vm.runInNewContext(compile(await readFile(join(root, 'src/main/qwen.ts'), 'utf8')), {
    exports: service.exports, module: service, require: customRequire,
    console: { info() {}, error() {} }, process, AbortController, setTimeout, clearTimeout
  })
  service.exports.registerQwenIPC(); service.exports.attachQwenWindow(window)
  const event = { sender, senderFrame: sender.mainFrame }
  const api = { folder, events,testEvents:[],
    emitWindow: name => windowEvents.get(name)?.(),
    destroyNative: () => { destroyed=true },
    stop: () => service.exports.stopQwen(),

    invoke: (name, ...args) => handlers.get(`qwen:${name}`)(event, ...args),
    async view() { const result = await api.invoke('load'); assert.equal(result.ok, true, result.error); return result.value },
    async start(id, prompt = 'Fixture prompt') {
      const result = await api.invoke('start', { requestId: id, prompt }); assert.equal(result.ok, true, result.error)
    },
    async wait(predicate, timeout = 3000) {
      const deadline = Date.now() + timeout
      while (!predicate(events)) {
        if (Date.now() > deadline) throw new Error(`Expected event missing: ${JSON.stringify(events)}`)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    },
    async done(id, timeout) { await api.wait(items => items.some(x => x.type === 'done' && x.requestId === id), timeout) },
    async close() { if(!destroyed)windowEvents.get('close')?.();service.exports.stopQwen();await api.invoke('load');destroyed=true;windowEvents.get('closed')?.();service.exports.stopQwen() }
  }
  return api
}
