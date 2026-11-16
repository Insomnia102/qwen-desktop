import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { SettingsStore } from './settings-store'
import type { SettingsScope } from '../shared/settings'
import type { McpConfig, McpEntry, McpMutation, McpView } from '../shared/mcp'

const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const nameValid = (name: unknown): name is string => typeof name === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name)
const list = (v: unknown): string[] => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error('В списках MCP ожидаются строки')
  return v as string[]
}
export function globMatches(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`).test(name)
}
export function validateMcpConfig(value: unknown): asserts value is McpConfig {
  if (!record(value) || JSON.stringify(value).length > 150_000) throw new Error('Некорректная конфигурация MCP')
  const transports = ['command', 'url', 'httpUrl'].filter(key => typeof value[key] === 'string' && (value[key] as string).trim())
  if (transports.length !== 1) throw new Error('Укажите один способ подключения: команду, HTTP или SSE')
  for (const key of ['command', 'cwd', 'description']) if (value[key] !== undefined && (typeof value[key] !== 'string' || /\0/.test(value[key] as string))) throw new Error(`Некорректное поле ${key}`)
  for (const key of ['httpUrl', 'url']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'string') throw new Error('Адрес сервера должен быть строкой')
    // Placeholders are resolved only in the main process at connection time.
    if (!(value[key] as string).includes('$')) {
      let url: URL
      try { url = new URL(value[key] as string) } catch { throw new Error('Укажите полный адрес MCP-сервера') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Нужен HTTP(S)-адрес без пароля в URL; используйте заголовки')
    }
  }
  for (const key of ['args', 'includeTools', 'excludeTools']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || (value[key] as unknown[]).some(x => typeof x !== 'string' || x.includes('\0')))) throw new Error(`В ${key} ожидается список строк`)
  }
  for (const key of ['env', 'headers']) if (value[key] !== undefined) {
    if (!record(value[key]) || Object.entries(value[key]).some(([k, v]) => !k || /[\0\r\n]/.test(k) || typeof v !== 'string' || /\0/.test(v))) throw new Error(`В ${key} нужны пары имя/значение`)
  }
  if (value.trust !== undefined && typeof value.trust !== 'boolean') throw new Error('trust должен быть переключателем')
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isInteger(value.timeout) || value.timeout < 1000 || value.timeout > 3_600_000)) throw new Error('Тайм-аут: от 1 до 3600 секунд')
}

export class McpStore extends SettingsStore {
  loadMcp(scope: SettingsScope, cwd: string | null): McpView {
    const layers = this.layers(cwd)
    const selected = layers.find(x => x.scope === scope)
    if (!selected) throw new Error('Сначала выберите рабочую папку')
    const projectFile = cwd ? this.read(join(cwd, '.mcp.json')) : null
    const sources = [...layers.slice(0, 2), ...(projectFile ? [{ name: '.mcp.json проекта', document: projectFile, scope: undefined }] : []), ...layers.slice(2)]
    const effective = new Map<string, { config: McpConfig; source: string; local: boolean }>()
    for (const layer of sources) {
      const servers = layer.document.data.mcpServers
      if (servers === undefined) continue
      if (!record(servers)) throw new Error(`Неверный раздел mcpServers: ${layer.name}`)
      for (const [name, config] of Object.entries(servers)) {
        if (!record(config)) continue
        const normalized = { ...config } as McpConfig
        if (layer.document === projectFile && normalized.type === 'http' && typeof normalized.url === 'string' && !normalized.httpUrl) {
          normalized.httpUrl = normalized.url; delete normalized.url; delete normalized.type
        }
        effective.set(name, { config: normalized, source: layer.name, local: layer === selected })
      }
    }
    const exclusions = layers.flatMap(layer => {
      const mcp = layer.document.data.mcp
      return (record(mcp) ? list(mcp.excluded) : []).map(rule => ({ rule, local: layer === selected, source: layer.name }))
    })
    // Native mcp.allowed and mcp.excluded use concatenation between settings scopes.
    let hasAllowlist = false
    const allowed: string[] = []
    for (const layer of layers) if (record(layer.document.data.mcp) && layer.document.data.mcp.allowed !== undefined) {
      hasAllowlist = true; allowed.push(...list(layer.document.data.mcp.allowed))
    }
    const localServers = selected.document.data.mcpServers
    const names = new Set([...effective.keys(), ...(record(localServers) ? Object.keys(localServers).filter(name => record(localServers[name])) : [])])
    const servers: McpEntry[] = [...names].sort().map(name => {
      const entry = effective.get(name)!
      const own = record(localServers) && Object.hasOwn(localServers, name) ? localServers[name] : undefined
      const shadowed = own !== undefined && !entry.local
      const hits = exclusions.filter(x => globMatches(x.rule, name))
      const policy = hits.find(x => !x.local || x.rule !== name)
      const notAllowed = hasAllowlist && !allowed.some(rule => globMatches(rule, name))
      return { name, config: (record(own) ? own : entry.config) as McpConfig, source: shadowed ? `Перекрыто: ${entry.source}` : entry.source,
        editable: record(own), enabled: hits.length === 0 && !notAllowed, toggleLocked: Boolean(policy) || notAllowed,
        reason: policy ? `Запрет ${policy.rule} (${policy.source}).` : notAllowed ? 'Сервер отсутствует в mcp.allowed.' : shadowed ? 'В этой папке используется одноимённая конфигурация другого уровня.' : '' }
    })
    return { scope, path: this.path(scope, cwd), revision: selected.document.revision,
      contextRevision: createHash('sha256').update(sources.map(x => x.document.revision).join(':')).digest('hex'), servers }
  }

  mutateMcp(request: McpMutation, cwd: string | null): McpView {
    if (!request || !['user', 'project'].includes(request.scope) || !nameValid(request.name) || typeof request.revision !== 'string') throw new Error('Некорректный запрос MCP')
    const view = this.loadMcp(request.scope, cwd)
    const doc = this.read(this.path(request.scope, cwd))
    if (view.revision !== request.revision) throw new Error('Настройки изменились. Обновите список перед сохранением.')
    const entries = record(doc.data.mcpServers) ? Object.entries(doc.data.mcpServers) : []
    const owns = entries.some(([name]) => name === request.name)
    const changes: Record<string, unknown> = {}
    if (request.action === 'save') {
      validateMcpConfig(request.config)
      if (request.create ? view.servers.some(x => x.name === request.name) : !owns) throw new Error(request.create ? 'Такое имя уже существует' : 'Изменять можно серверы выбранной области')
      // Preserve all unedited/unknown properties of other server entries.
      changes.mcpServers = Object.fromEntries([...entries.filter(([name]) => name !== request.name), [request.name, request.config]])
    } else if (request.action === 'remove') {
      if (!owns) throw new Error('Удалять можно серверы выбранной области')
      changes.mcpServers = Object.fromEntries(entries.filter(([name]) => name !== request.name))
      // Retain an explicit disable so removing a shadowing entry cannot silently enable an inherited server.
    } else if (request.action === 'toggle') {
      const entry = view.servers.find(x => x.name === request.name)
      if (!entry || entry.toggleLocked || typeof request.enabled !== 'boolean') throw new Error('Сервер ограничен другой настройкой')
      const mcp = record(doc.data.mcp) ? doc.data.mcp : {}
      const disabled = list(mcp.excluded).filter(x => x !== request.name)
      if (!request.enabled) disabled.push(request.name)
      changes['mcp.excluded'] = disabled
    } else if (request.action === 'approve') {
      const entry = view.servers.find(x => x.name === request.name)
      if (!entry || !entry.enabled || entry.source.startsWith('Перекрыто:')) throw new Error('Выберите действующее включённое подключение')
      validateMcpConfig(entry.config)
    } else throw new Error('Неизвестное действие MCP')
    this.patch(doc, changes)
    return this.loadMcp(request.scope, cwd)
  }

  probeConfig(scope: SettingsScope, name: string, contextRevision: string, cwd: string | null): McpConfig {
    const view = this.loadMcp(scope, cwd)
    if (view.contextRevision !== contextRevision) throw new Error('Настройки изменились. Обновите список перед проверкой.')
    const entry = view.servers.find(x => x.name === name)
    if (!entry || !entry.enabled) throw new Error('Сначала включите MCP-сервер')
    if (entry.source.startsWith('Перекрыто:')) throw new Error('Переключитесь в область текущей папки для проверки действующего сервера')
    validateMcpConfig(entry.config)
    return structuredClone(entry.config)
  }
}
