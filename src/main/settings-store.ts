import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import { SETTINGS_FIELDS, isApprovalMode, type ApprovalMode, type SettingDefinition, type SettingValue, type SettingsSaveRequest, type SettingsScope, type SettingsView } from '../shared/settings'
import { CORE_TOOLS, type CoreToolDefinition, type CoreToolsSaveRequest, type CoreToolsView } from '../shared/core-tools'

type Document = { path: string; text: string; data: Record<string, unknown>; revision: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function get(data: Record<string, unknown>, key: string): unknown {
  let value: unknown = data
  for (const part of key.split('.')) {
    if (!object(value) || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}
const scalar = (value: unknown): SettingValue | null => ['boolean', 'string', 'number'].includes(typeof value) ? value as SettingValue : null

export class SettingsStore {
  private userPath: string
  private systemPath: string
  private defaultsPath: string
  constructor(home = homedir(), env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
    const expand = (path: string): string => resolve(path.replace(/^~(?=$|[\\/])/, home))
    this.userPath = join(env.QWEN_HOME ? expand(env.QWEN_HOME) : join(home, '.qwen'), 'settings.json')
    this.systemPath = env.QWEN_CODE_SYSTEM_SETTINGS_PATH ? expand(env.QWEN_CODE_SYSTEM_SETTINGS_PATH) :
      platform === 'win32' ? 'C:\\ProgramData\\qwen-code\\settings.json' : platform === 'darwin'
        ? '/Library/Application Support/QwenCode/settings.json' : '/etc/qwen-code/settings.json'
    this.defaultsPath = env.QWEN_CODE_SYSTEM_DEFAULTS_PATH ? expand(env.QWEN_CODE_SYSTEM_DEFAULTS_PATH) : join(dirname(this.systemPath), 'system-defaults.json')
  }

  protected path(scope: SettingsScope, cwd: string | null): string {
    if (scope === 'user') return this.userPath
    if (scope !== 'project' || !cwd) throw new Error('Для настроек проекта сначала выберите рабочую папку')
    return join(cwd, '.qwen', 'settings.json')
  }

  private decode(text: string, path: string): Record<string, unknown> {
    const errors: ParseError[] = []
    const data: unknown = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
    if (errors.length || !object(data)) throw new Error(`Неверный JSON в ${path}. Файл оставлен без изменений.`)
    return data
  }

  protected read(path: string): Document {
    let actual = path, text = ''
    try {
      actual = realpathSync(path)
      if (!statSync(actual).isFile()) throw new Error(`Настройки должны быть обычным файлом: ${path}`)
      text = readFileSync(actual, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Do not replace a dangling link with a new regular file.
      try { lstatSync(path); throw error } catch (linkError) {
        if (linkError === error || (linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError
      }
      actual = path
    }
    return { path: actual, text, data: text ? this.decode(text, path) : {},
      revision: createHash('sha256').update(`${actual}\0${text}`).digest('hex') }
  }

  protected layers(cwd: string | null): { name: string; document: Document; scope?: SettingsScope }[] {
    return [
      { name: 'Системное значение по умолчанию', document: this.read(this.defaultsPath) },
      { name: 'Все проекты', document: this.read(this.userPath), scope: 'user' as const },
      ...(cwd ? [{ name: 'Текущая папка', document: this.read(this.path('project', cwd)), scope: 'project' as const }] : []),
      { name: 'Системная настройка', document: this.read(this.systemPath) }
    ]
  }

  load(scope: SettingsScope, cwd: string | null): SettingsView {
    const path = this.path(scope, cwd)
    const layers = this.layers(cwd)
    const selected = layers.find(layer => layer.scope === scope)!
    const fields: SettingsView['fields'] = {}
    for (const definition of SETTINGS_FIELDS) {
      let effective: unknown = definition.default, inherited: unknown = definition.default
      let source = 'Qwen Code', locked = false
      for (const layer of layers) {
        if (definition.userOnly && layer.scope === 'project') continue
        const value = get(layer.document.data, definition.key)
        if (value === undefined) continue
        effective = value; source = layer.name
        if (layer.scope !== scope) inherited = value
        if (!layer.scope && layer.name === 'Системная настройка') locked = true
      }
      fields[definition.key] = { local: scalar(get(selected.document.data, definition.key)), inherited: scalar(inherited),
        effective: scalar(effective), source, locked: locked || (scope === 'project' && Boolean(definition.userOnly)) }
    }
    return { scope, path, revision: selected.document.revision, fields }
  }

  connectionConfigured(cwd:string|null,env:NodeJS.ProcessEnv=process.env,modelOverride?:string):boolean {
    let auth:unknown,model:unknown,key:unknown
    const providers:Record<string,unknown>={}
    for(const layer of this.layers(cwd)){
      auth=get(layer.document.data,'security.auth.selectedType')??auth;model=get(layer.document.data,'model.name')??model;key=get(layer.document.data,'security.auth.apiKey')??key
      const value=get(layer.document.data,'modelProviders');if(object(value))Object.assign(providers,value)
    }
    if(auth==='qwen-oauth')return existsSync(join(dirname(this.userPath),'oauth_creds.json'))
    model=modelOverride??model??env.OPENAI_MODEL??env.ANTHROPIC_MODEL??env.GEMINI_MODEL
    const route=Object.values(providers).flatMap(p=>Array.isArray(p)?p:[]).find(p=>object(p)&&p.id===model)
    const routeKey=object(route)&&(route.apiKey||typeof route.envKey==='string'&&env[route.envKey])
    const hasKey=Boolean(key||routeKey||env.OPENAI_API_KEY||env.ANTHROPIC_API_KEY||env.GEMINI_API_KEY)
    return hasKey&&Boolean(model||auth)
  }
  approvalMode(cwd: string | null): ApprovalMode {
    let value: unknown = 'auto'
    for (const layer of this.layers(cwd)) value = get(layer.document.data, 'tools.approvalMode') ?? value
    if (!isApprovalMode(value)) throw new Error('В settings.json указан неизвестный tools.approvalMode')
    return value
  }

  private validate(definition: SettingDefinition, value: unknown): void {
    if (value === null) return
    if (definition.key === 'model.maxWallTimeSeconds' && typeof value === 'number' && value !== -1 && value < 1) {
      throw new Error('Лимит времени должен быть положительным или без ограничения')
    }
    if (definition.type === 'boolean') {
      if (typeof value === 'boolean') return
    } else if (definition.choices?.some(choice => typeof choice === typeof value && choice === value)) return
    else if (typeof value === 'number' && Number.isFinite(value) && definition.choices?.some(choice => typeof choice === 'number')) {
      if ((definition.min === undefined || value >= definition.min) && (definition.max === undefined || value <= definition.max) &&
          (!definition.integer || Number.isInteger(value))) return
    }
    throw new Error(`Некорректное значение параметра «${definition.label}»`)
  }

  private strings(data: Record<string, unknown>, key: string): string[] {
    const value = get(data, key)
    if (value === undefined) return []
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Ожидается список строк в ${key}`)
    return value as string[]
  }

  private toolMatches(rule: string, tool: CoreToolDefinition, pattern = false): boolean {
    const aliases = [tool.name, ...tool.aliases, ...(tool.name === 'run_shell_command' ? ['Bash', 'ShellTool'] :
      tool.name === 'read_file' ? ['Read', 'ReadFileTool'] : tool.name === 'write_file' ? ['Write', 'WriteFileTool'] : [])]
    if (!pattern) return [tool.name, ...tool.aliases].includes(rule.trim())
    // Invocation-specific rules remain runtime policy; they do not disable a whole tool.
    if (rule.includes('(')) return false
    const regex = new RegExp(`^${rule.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
    return aliases.some(alias => regex.test(alias))
  }

  loadCoreTools(scope: SettingsScope, cwd: string | null): CoreToolsView {
    const path = this.path(scope, cwd)
    const layers = this.layers(cwd)
    const selected = layers.find(layer => layer.scope === scope)!
    const tools: CoreToolsView['tools'] = {}
    const featureKeys: Record<string, string> = { list_directory: 'tools.listDirectory.enabled', todo_write: 'tools.todoWrite.enabled',
      lsp: 'tools.lspEnabled', web_search: 'tools.webSearch.enabled', tool_search: 'tools.toolSearch.enabled', tool_call: 'tools.toolSearch.enabled', workflow: 'tools.workflowsEnabled' }
    for (const tool of CORE_TOOLS) {
      let localDisabled = false, locked = Boolean(tool.fixedOff), reason = tool.fixedOff ? 'Интерактивный выбор пока не поддерживается Desktop.' : ''
      let disabled = Boolean(tool.fixedOff)
      for (const layer of layers) {
        const hit = this.strings(layer.document.data, 'tools.disabled').find(rule => this.toolMatches(rule, tool))
        if (hit) {
          disabled = true
          if (layer.scope === scope) localDisabled = true
          else { locked = true; reason = `Отключено в области «${layer.name}».` }
        }
        for (const key of ['permissions.deny', 'tools.exclude']) {
          const denied = this.strings(layer.document.data, key).find(rule => this.toolMatches(rule, tool, true))
          if (denied) { disabled = true; locked = true; reason = `Ограничено правилом ${key}: ${denied} (${layer.name}).` }
        }
      }
      const feature = featureKeys[tool.name]
      if (feature) {
        let enabled: unknown = ['list_directory', 'todo_write', 'lsp', 'workflow'].includes(tool.name) ? false : undefined
        let source = 'Qwen Code'
        for (const layer of layers) {
          const value = get(layer.document.data, feature)
          if (value !== undefined) { enabled = value; source = layer.name }
        }
        if (enabled === false && !disabled) { disabled = true; reason = `Функция ${feature} выключена (${source}).` }
        const system = layers[layers.length - 1]
        if (get(system.document.data, feature) === false) { locked = true; reason = `Функция выключена системной настройкой ${feature}.` }
      }
      tools[tool.name] = { enabled: !disabled, localDisabled, locked, reason }
    }
    return { scope, path, revision: selected.document.revision, tools }
  }

  disabledCoreTools(cwd: string | null): string[] {
    const layers = this.layers(cwd)
    // Registration defaults and feature flags remain the CLI's responsibility.
    // Forward explicit exclusions, including all UI-generated disabled entries.
    return CORE_TOOLS.filter(tool => tool.fixedOff || layers.some(layer =>
      this.strings(layer.document.data, 'tools.disabled').some(rule => this.toolMatches(rule, tool)) ||
      ['permissions.deny', 'tools.exclude'].some(key => this.strings(layer.document.data, key).some(rule => this.toolMatches(rule, tool, true)))
    )).map(tool => tool.name)
  }

  saveCoreTools(request: CoreToolsSaveRequest, cwd: string | null): CoreToolsView {
    if (!request || (request.scope !== 'user' && request.scope !== 'project') || typeof request.revision !== 'string' ||
        !object(request.changes) || Object.keys(request.changes).length > CORE_TOOLS.length) throw new Error('Некорректный запрос инструментов')
    const view = this.loadCoreTools(request.scope, cwd)
    const doc = this.read(this.path(request.scope, cwd))
    if (request.revision !== doc.revision) throw new Error('Файл настроек изменился. Перезагрузите список инструментов.')
    let disabled = [...this.strings(doc.data, 'tools.disabled')]
    const changes: Record<string, unknown> = {}
    const flags: Record<string, string> = { list_directory: 'tools.listDirectory.enabled', todo_write: 'tools.todoWrite.enabled',
      lsp: 'tools.lspEnabled', web_search: 'tools.webSearch.enabled', tool_search: 'tools.toolSearch.enabled', tool_call: 'tools.toolSearch.enabled', workflow: 'tools.workflowsEnabled' }
    for (const [name, enabled] of Object.entries(request.changes)) {
      const tool = CORE_TOOLS.find(item => item.name === name)
      if (!tool || typeof enabled !== 'boolean') throw new Error('Неизвестный инструмент или неверное значение')
      if (view.tools[name].locked) throw new Error(`Инструмент ${name} ограничен другой настройкой`)
      disabled = disabled.filter(rule => !this.toolMatches(rule, tool))
      if (!enabled) disabled.push(name)
      else if (flags[name]) changes[flags[name]] = true
    }
    changes['tools.disabled'] = [...new Set(disabled)]
    this.patch(doc, changes)
    return this.loadCoreTools(request.scope, cwd)
  }

  protected patch(doc: Document, changes: Record<string, unknown>): void {
    const bom = doc.text.startsWith('\uFEFF') ? '\uFEFF' : ''
    let text = doc.text.replace(/^\uFEFF/, '') || '{}\n'
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.split('.')
      for (let i = 1; i < parts.length; i++) {
        const parent = get(doc.data, parts.slice(0, i).join('.'))
        if (parent !== undefined && !object(parent)) throw new Error(`Неверная структура раздела ${parts.slice(0, i).join('.')}`)
      }
      text = applyEdits(text, modify(text, parts, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' }
      }))
    }
    text = bom + text
    this.decode(text, doc.path)
    if (text === doc.text) return
    mkdirSync(dirname(doc.path), { recursive: true })
    const temp = `${doc.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temp, 'wx', existsSync(doc.path) ? statSync(doc.path).mode & 0o777 : 0o600)
      writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined
      if (existsSync(doc.path)) copyFileSync(doc.path, `${doc.path}.desktop.bak`)
      renameSync(temp, doc.path)
    } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temp)) unlinkSync(temp) }
  }

  skillPolicy(name: string, scope: SettingsScope, cwd: string | null, source: SettingsScope): {enabled:boolean;locked:boolean;reason:string} {
    const layers=this.layers(cwd)
    let disabled=false,locked=false,reason='',defaultDisabled=false,optedIn=false
    for(const layer of layers){
      if(this.strings(layer.document.data,'skills.excludedSources').includes(source)){disabled=true;locked=true;reason=`Источник ${source} отключён (${layer.name}).`}
      if(this.strings(layer.document.data,'skills.disabled').includes(name)){disabled=true;if(layer.scope!==scope){locked=true;reason=`Отключено в области «${layer.name}».`}}
      defaultDisabled ||= this.strings(layer.document.data,'skills.defaultDisabled').includes(name)
      optedIn ||= this.strings(layer.document.data,'skills.enabled').includes(name)
    }
    return {enabled:!disabled&&(!defaultDisabled||optedIn),locked,reason}
  }
  toggleSkill(name:string,enabled:boolean,scope:SettingsScope,cwd:string|null,source:SettingsScope):void {
    if(!name||typeof enabled!=='boolean'||this.skillPolicy(name,scope,cwd,source).locked)throw new Error('Skill ограничен другой областью настроек')
    const doc=this.read(this.path(scope,cwd))
    const disabled=this.strings(doc.data,'skills.disabled').filter(x=>x!==name)
    const active=this.strings(doc.data,'skills.enabled').filter(x=>x!==name)
    if(enabled)active.push(name);else disabled.push(name)
    this.patch(doc,{'skills.disabled':disabled,'skills.enabled':active})
  }
  slashDisabled(cwd:string|null):string[]{return [...new Set(this.layers(cwd).flatMap(layer=>this.strings(layer.document.data,'slashCommands.disabled')))]}
  validateStudioModel(profile:{model:string;provider:string;baseUrl:string;keySource:string},cwd:string|null):void {
    const providers:Record<string,unknown>={},protocols:Record<string,unknown>={}
    for(const layer of this.layers(cwd)){
      const p=get(layer.document.data,'modelProviders'),mapping=get(layer.document.data,'providerProtocol')
      if(object(p))Object.assign(providers,p);if(object(mapping))Object.assign(protocols,mapping)
    }
    const duplicate=Object.entries(providers).some(([provider,models])=>{
      const protocol=String(protocols[provider]??provider).replace('openai-responses','openai')
      return protocol===profile.provider&&Array.isArray(models)&&models.some(model=>object(model)&&model.id===profile.model)
    })
    // SDK 0.1.32 gives registered modelProviders entries ownership of their
    // endpoint/credential route, even when the process env requests another.
    // Prevent sending a selected Desktop profile to that different route.
    if(duplicate&&(profile.baseUrl||profile.keySource!=='inherit'))throw new Error('Этот ID уже настроен в modelProviders Qwen. Для его выбора оставьте Base URL пустым и выберите «Ключ из настроек Qwen». Свой адрес и ключ задавайте для модели, не зарегистрированной в каталоге CLI.')
  }

  save(request: SettingsSaveRequest, cwd: string | null): SettingsView {
    if (!request || (request.scope !== 'user' && request.scope !== 'project') || typeof request.revision !== 'string' ||
        !object(request.changes) || Object.keys(request.changes).length > SETTINGS_FIELDS.length) throw new Error('Некорректный запрос настроек')
    const view = this.load(request.scope, cwd)
    const doc = this.read(this.path(request.scope, cwd))
    if (doc.revision !== request.revision) throw new Error('Настройки изменились вне приложения. Нажмите «Перезагрузить» перед сохранением.')
    const changes: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(request.changes)) {
      const definition = SETTINGS_FIELDS.find(field => field.key === key)
      if (!definition) throw new Error('Неизвестный параметр настроек')
      if (view.fields[key].locked) throw new Error(`Параметр «${definition.label}» задан на другом уровне`)
      this.validate(definition, value)
      changes[key] = value === null ? undefined : value
    }
    this.patch(doc, changes)
    return this.load(request.scope, cwd)
  }
}
