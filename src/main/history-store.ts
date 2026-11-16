import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatSummary, QwenEvent, SavedChat, TurnStatus, WorkspaceIndex } from '../shared/qwen'

const idPattern = /^[a-f0-9-]{36}$/i
const clone = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const validStatus = (value: unknown): boolean => ['empty', 'running', 'done', 'stopped', 'error', 'interrupted'].includes(String(value))

function validIndex(value: unknown): value is WorkspaceIndex {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.workdirs) || !Array.isArray(value.chats)) return false
  const dirs = new Set<string>(), chats = new Set<string>()
  for (const dir of value.workdirs) {
    if (!object(dir) || !validId(dir.id) || dirs.has(dir.id) || typeof dir.path !== 'string' ||
        typeof dir.name !== 'string' || !(dir.lastChatId === null || validId(dir.lastChatId)) ||
        (dir.closed !== undefined && typeof dir.closed !== 'boolean')) return false
    dirs.add(dir.id)
  }
  for (const chat of value.chats) {
    if (!object(chat) || !validId(chat.id) || chats.has(chat.id) || !dirs.has(String(chat.workdirId)) ||
        typeof chat.title !== 'string' || (chat.customTitle !== undefined && typeof chat.customTitle !== 'boolean') || typeof chat.createdAt !== 'string' ||
        typeof chat.updatedAt !== 'string' || !validStatus(chat.status)) return false
    chats.add(chat.id)
  }
  return value.activeChatId === null || (typeof value.activeChatId === 'string' && chats.has(value.activeChatId))
}

function validEvent(value: unknown): value is QwenEvent {
  if (!object(value) || typeof value.requestId !== 'string') return false
  switch (value.type) {
    case 'text': case 'final': return typeof value.messageId === 'string' && typeof value.text === 'string'
    case 'thinking': return typeof value.messageId === 'string' && typeof value.text === 'string' && ['streaming', 'done'].includes(String(value.state))
    case 'tool': return typeof value.toolId === 'string' && typeof value.name === 'string' &&
      ['running', 'done', 'error'].includes(String(value.state)) && (value.output === undefined || typeof value.output === 'string')
    case 'permission': return typeof value.permissionId === 'string' && typeof value.tool === 'string' && typeof value.details === 'string'
    case 'permission-closed': return typeof value.permissionId === 'string' && typeof value.allowed === 'boolean' &&
      (value.decision === undefined || ['allow-once', 'allow-session', 'deny'].includes(String(value.decision)))
    case 'approval-mode': return typeof value.allowAll === 'boolean'
    case 'done': return typeof value.cancelled === 'boolean'
    case 'warning': case 'error': case 'storage-error': return typeof value.text === 'string'
    default: return false
  }
}

function validChat(value: unknown): value is SavedChat {
  return object(value) && validId(value.id) && validId(value.workdirId) && typeof value.title === 'string' &&
    (value.customTitle === undefined || typeof value.customTitle === 'boolean') &&
    typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && validStatus(value.status) &&
    (value.sessionId === null || validId(value.sessionId)) && Array.isArray(value.turns) && value.turns.every(turn =>
      object(turn) && typeof turn.requestId === 'string' && typeof turn.prompt === 'string' &&
      typeof turn.startedAt === 'string' && ['running', 'done', 'stopped', 'error', 'interrupted'].includes(String(turn.status)) &&
      (turn.finishedAt === undefined || typeof turn.finishedAt === 'string') && Array.isArray(turn.events) &&
      turn.events.every(event => validEvent(event) && event.requestId === turn.requestId))
}

// One small catalogue + one JSON document per chat. No browser storage or HTML.
// Mutations live in main; streams are compacted into their latest snapshots.
export class HistoryStore {
  private index: WorkspaceIndex
  private chats = new Map<string, SavedChat>()
  private eventSlots = new Map<string, Map<string, number>>()
  private dirty = new Set<string>()
  private indexDirty = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private warnings: string[] = []

  constructor(readonly directory: string, private onError: (error: Error) => void = () => {}) {
    mkdirSync(join(directory, 'chats'), { recursive: true })
    const path = join(directory, 'index.json')
    this.index = existsSync(path) || existsSync(`${path}.bak`)
      ? this.read(path, validIndex) : { version: 1, workdirs: [], chats: [], activeChatId: null }
    for (const chat of this.index.chats) if (chat.status === 'running') {
      chat.status = 'interrupted'
      this.indexDirty = true
    }
    const active = this.index.chats.find(chat => chat.id === this.index.activeChatId)
    if (active && this.index.workdirs.find(dir => dir.id === active.workdirId)?.closed) {
      this.index.activeChatId = this.fallbackChat()
      this.indexDirty = true
    }
  }

  private read<T>(path: string, validate: (value: unknown) => value is T): T {
    const parse = (file: string): T => {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!validate(value)) throw new Error('Неверный формат данных')
      return value
    }
    try { return parse(path) } catch (primaryError) {
      let recovered: T
      try { recovered = parse(`${path}.bak`) } catch {
        throw new Error(`Не удалось прочитать историю ${path}. Файлы сохранены без изменений. ${String(primaryError)}`)
      }
      // Preserve the damaged bytes before restoring the known-good backup.
      if (existsSync(path)) renameSync(path, `${path}.corrupt-${randomUUID()}`)
      copyFileSync(`${path}.bak`, path)
      this.warnings.push(`Восстановлена резервная копия истории: ${basename(path)}. Повреждённый файл сохранён отдельно.`)
      return recovered
    }
  }

  private write(path: string, value: unknown): void {
    const temp = `${path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temp, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify(value))
      fsyncSync(fd)
      closeSync(fd); fd = undefined
      if (existsSync(path)) copyFileSync(path, `${path}.bak`)
      renameSync(temp, path)
    } finally {
      if (fd !== undefined) closeSync(fd)
      if (existsSync(temp)) unlinkSync(temp)
    }
  }

  private chatPath(id: string): string {
    if (!validId(id)) throw new Error('Некорректный ID диалога')
    return join(this.directory, 'chats', `${id}.json`)
  }

  private schedule(): void {
    // Fixed delay from the first change; a continuous stream cannot starve saving.
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      try { this.flush() } catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))) }
    }, 250)
    this.timer.unref?.()
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    // Commit documents before publishing their catalogue references.
    for (const id of this.dirty) {
      this.write(this.chatPath(id), this.chats.get(id))
      this.dirty.delete(id)
    }
    if (this.indexDirty) {
      this.write(join(this.directory, 'index.json'), this.index)
      this.indexDirty = false
    }
  }

  snapshot(): WorkspaceIndex { return clone(this.index) }
  takeWarnings(): string[] { return this.warnings.splice(0) }

  private summary(id: string): ChatSummary {
    const summary = this.index.chats.find(chat => chat.id === id)
    if (!summary) throw new Error('Диалог не найден')
    return summary
  }

  getChat(id: string): SavedChat {
    const summary = this.summary(id)
    let chat = this.chats.get(id)
    if (!chat) {
      chat = this.read(this.chatPath(id), validChat)
      if (chat.id !== id || chat.workdirId !== summary.workdirId) throw new Error('История не соответствует выбранному диалогу')
      this.chats.set(id, chat)
      for (const turn of chat.turns) if (turn.status === 'running') {
        turn.events.push({ requestId: turn.requestId, type: 'warning',
          text: 'Предыдущий запрос прерван при закрытии приложения. Ниже сохранён полученный к этому моменту ответ.' })
        this.finishTurn(id, turn.requestId, 'interrupted')
      }
      // The document is authoritative if the process stopped between the two commits.
      Object.assign(summary, this.metadata(chat))
      this.indexDirty = true
    }
    return clone(chat)
  }

  private mutableChat(id: string): SavedChat {
    this.getChat(id)
    return this.chats.get(id)!
  }

  private metadata(chat: SavedChat): ChatSummary {
    const { id, workdirId, title, createdAt, updatedAt, status } = chat
    return { id, workdirId, title, customTitle: chat.customTitle ?? false, createdAt, updatedAt, status }
  }

  private changed(chat: SavedChat, metadata = false): void {
    this.dirty.add(chat.id)
    if (metadata) { Object.assign(this.summary(chat.id), this.metadata(chat)); this.indexDirty = true }
    this.schedule()
  }

  addWorkdir(path: string): string {
    const key = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
    let dir = this.index.workdirs.find(item => key(item.path) === key(path))
    if (!dir) {
      dir = { id: randomUUID(), path, name: basename(path) || path, lastChatId: null }
      this.index.workdirs.push(dir)
      this.indexDirty = true
    }
    const id = dir.lastChatId ?? this.createChat(dir.id)
    this.selectChat(id)
    this.flush()
    return id
  }

  createChat(workdirId: string): string {
    const dir = this.index.workdirs.find(item => item.id === workdirId)
    if (!dir) throw new Error('Рабочая папка не найдена')
    const now = new Date().toISOString()
    const chat: SavedChat = { id: randomUUID(), workdirId, title: 'Новый диалог', createdAt: now,
      updatedAt: now, status: 'empty', sessionId: null, turns: [] }
    this.chats.set(chat.id, chat)
    this.index.chats.push(this.metadata(chat))
    this.dirty.add(chat.id)
    this.selectChat(chat.id)
    this.flush()
    return chat.id
  }

  selectChat(id: string): void {
    const chat = this.getChat(id)
    const dir = this.index.workdirs.find(item => item.id === chat.workdirId)!
    dir.closed = false
    dir.lastChatId = id
    this.index.activeChatId = id
    this.indexDirty = true
    this.flush()
  }

  selectWorkdir(id: string): string {
    const dir = this.index.workdirs.find(item => item.id === id)
    if (!dir) throw new Error('Рабочая папка не найдена')
    const chatId = dir.lastChatId ?? this.createChat(id)
    this.selectChat(chatId)
    return chatId
  }

  private fallbackChat(): string | null {
    const open = new Set(this.index.workdirs.filter(dir => !dir.closed).map(dir => dir.id))
    return this.index.chats.filter(chat => open.has(chat.workdirId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null
  }

  closeWorkdir(id: string): string | null {
    const dir = this.index.workdirs.find(item => item.id === id)
    if (!dir) throw new Error('Рабочая папка не найдена')
    if (this.index.chats.some(chat => chat.workdirId === id && chat.status === 'running')) {
      throw new Error('Сначала завершите запросы в этой папке')
    }
    const old = clone(this.index)
    dir.closed = true
    if (this.index.chats.find(chat => chat.id === this.index.activeChatId)?.workdirId === id) {
      this.index.activeChatId = this.fallbackChat()
    }
    this.indexDirty = true
    try { this.flush() } catch (error) { this.index = old; this.indexDirty = true; throw error }
    return this.index.activeChatId
  }

  renameChat(id: string, rawTitle: string): void {
    const title = rawTitle.trim().replace(/\s+/g, ' ')
    if (!title || title.length > 120) throw new Error('Название должно содержать от 1 до 120 символов')
    const chat = this.mutableChat(id)
    if (chat.status === 'running') throw new Error('Дождитесь завершения запроса')
    chat.title = title
    chat.customTitle = true
    this.changed(chat, true)
    this.flush()
  }

  deleteChat(id: string): string | null {
    const removed = this.summary(id)
    if (removed.status === 'running') throw new Error('Дождитесь завершения запроса')
    this.flush()
    const next = clone(this.index)
    next.chats = next.chats.filter(chat => chat.id !== id)
    const dir = next.workdirs.find(item => item.id === removed.workdirId)!
    let replacement = next.chats.filter(chat => chat.workdirId === dir.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id
    let empty: SavedChat | undefined
    if (!replacement) {
      const now = new Date().toISOString()
      empty = { id: randomUUID(), workdirId: dir.id, title: 'Новый диалог', createdAt: now,
        updatedAt: now, status: 'empty', sessionId: null, turns: [] }
      replacement = empty.id
      this.write(this.chatPath(empty.id), empty)
      next.chats.push(this.metadata(empty))
    }
    if (dir.lastChatId === id) dir.lastChatId = replacement
    if (next.activeChatId === id) next.activeChatId = replacement
    // Publish removal before deleting document bytes. A failed catalogue
    // commit leaves the original chat and current selection available.
    const path = join(this.directory, 'index.json')
    try { this.write(path, next) } catch (error) {
      if (empty) { try { unlinkSync(this.chatPath(empty.id)) } catch { /* Unreferenced new file; original chat is intact. */ } }
      throw error
    }
    this.index = next
    this.indexDirty = false
    if (empty) this.chats.set(empty.id, empty)
    this.chats.delete(id); this.dirty.delete(id)
    for (const key of this.eventSlots.keys()) if (key.startsWith(`${id}:`)) this.eventSlots.delete(key)
    try { copyFileSync(path, `${path}.bak`) } catch (error) {
      this.warnings.push(`Чат удалён. Не удалось обновить резервную копию каталога: ${String(error)}`)
    }
    for (const file of [this.chatPath(id), `${this.chatPath(id)}.bak`]) {
      try { if (existsSync(file)) unlinkSync(file) } catch (error) {
        this.warnings.push(`Чат удалён из списка, но не удалось удалить файл ${file}: ${String(error)}`)
      }
    }
    return next.activeChatId
  }

  beginTurn(chatId: string, requestId: string, prompt: string): void {
    const chat = this.mutableChat(chatId)
    if (chat.turns.some(turn => turn.requestId === requestId)) throw new Error('Этот запрос уже сохранён')
    if (chat.turns.some(turn => turn.status === 'running')) throw new Error('В диалоге уже выполняется запрос')
    const now = new Date().toISOString()
    if (!chat.turns.length && !chat.customTitle) chat.title = prompt.trim().replace(/\s+/g, ' ').slice(0, 70)
    chat.turns.push({ requestId, prompt, startedAt: now, status: 'running', events: [] })
    chat.updatedAt = now; chat.status = 'running'
    this.eventSlots.set(`${chatId}:${requestId}`, new Map())
    this.changed(chat, true)
    this.flush() // Do not start a paid request before the user's prompt is saved.
  }

  record(chatId: string, event: QwenEvent): void {
    const chat = this.chats.get(chatId)
    const turn = chat?.turns.find(item => item.requestId === event.requestId)
    if (!chat || !turn || turn.status !== 'running') return
    const key = event.type === 'text' || event.type === 'thinking' ? `${event.type}:${event.messageId}` :
      event.type === 'tool' ? `tool:${event.toolId}` : undefined
    const slots = this.eventSlots.get(`${chatId}:${event.requestId}`)!
    const index = key ? slots.get(key) : undefined
    if (index !== undefined) turn.events[index] = clone(event)
    else { if (key) slots.set(key, turn.events.length); turn.events.push(clone(event)) }
    this.changed(chat)
  }

  setSession(chatId: string, sessionId: string): void {
    if (!validId(sessionId)) throw new Error('SDK вернул некорректный ID сессии')
    const chat = this.mutableChat(chatId)
    chat.sessionId = sessionId
    this.changed(chat)
    this.flush()
  }

  finishTurn(chatId: string, requestId: string, status: Exclude<TurnStatus, 'running'>): void {
    const chat = this.chats.get(chatId)
    const turn = chat?.turns.find(item => item.requestId === requestId)
    if (!chat || !turn || turn.status !== 'running') return
    turn.status = status; turn.finishedAt = new Date().toISOString()
    // Historical permission cards are inert. Never replay approval-mode as authority.
    turn.events.push({ requestId, type: 'done', cancelled: status === 'stopped' || status === 'interrupted' })
    chat.status = status; chat.updatedAt = turn.finishedAt
    this.eventSlots.delete(`${chatId}:${requestId}`)
    this.changed(chat, true)
  }
}
