import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HistoryStore } from './load-history-store.mjs'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-history-store-'))
  return { dir, close: () => rmSync(dir, { recursive: true, force: true }) }
}
const text = (requestId, messageId, value) => ({ requestId, type: 'text', messageId, text: value })

test('multiple workdirs and chats survive a fresh store; Markdown, thinking, tools and sessions stay isolated', () => {
  const f = fixture()
  try {
    let db = new HistoryStore(f.dir)
    const first = db.addWorkdir('/projects/one')
    const firstDir = db.snapshot().workdirs[0].id
    db.beginTurn(first, 'turn-1', 'Build **one**\n<raw>')
    db.record(first, { requestId: 'turn-1', type: 'thinking', messageId: 'thought', text: 'Investigating', state: 'done' })
    db.record(first, { requestId: 'turn-1', type: 'tool', toolId: 'tool', name: 'mcp__custom__hello', state: 'done', input: { a: 1 }, output: 'Result' })
    db.record(first, text('turn-1', 'answer', '# Saved\n\n```js\n42\n```'))
    const sessionId = randomUUID()
    db.setSession(first, sessionId)
    db.finishTurn(first, 'turn-1', 'done'); db.flush()
    const second = db.createChat(firstDir)
    const other = db.addWorkdir('/projects/two')
    db.beginTurn(other, 'turn-2', 'Other project')
    db.record(other, text('turn-2', 'answer', 'Other answer'))
    db.finishTurn(other, 'turn-2', 'done')
    db.selectChat(second)
    db.flush()
    db = new HistoryStore(f.dir)
    assert.equal(db.snapshot().workdirs.length, 2)
    assert.equal(db.snapshot().chats.length, 3)
    assert.equal(db.snapshot().activeChatId, second)
    assert.equal(db.getChat(first).sessionId, sessionId)
    assert.equal(db.getChat(first).turns[0].events.find(x => x.type === 'text').text, '# Saved\n\n```js\n42\n```')
    assert.equal(db.getChat(first).turns[0].events.find(x => x.type === 'thinking').text, 'Investigating')
    assert.equal(db.getChat(first).turns[0].events.find(x => x.type === 'tool').output, 'Result')
    assert.equal(db.getChat(second).turns.length, 0)
    assert.equal(db.getChat(other).turns[0].prompt, 'Other project')
    assert.equal(db.selectWorkdir(firstDir), second)
    assert.equal(db.addWorkdir('/projects/one'), second)
    assert.equal(db.snapshot().workdirs.length, 2)
    db.flush()
  } finally { f.close() }
})

test('stream snapshots are compacted; autosave preserves partial text and recovers an interrupted turn', async () => {
  const f = fixture()
  try {
    const db = new HistoryStore(f.dir)
    const chat = db.addWorkdir('/projects/stream')
    db.beginTurn(chat, 'stream', 'Long request')
    for (let i = 0; i < 500; i++) db.record(chat, text('stream', 'answer', `Snapshot ${i}`))
    db.record(chat, { requestId: 'stream', type: 'permission', permissionId: 'pending', tool: 'run_shell_command', details: '{}' })
    await new Promise(resolve => setTimeout(resolve, 350))
    const saved = JSON.parse(readFileSync(join(f.dir, 'chats', `${chat}.json`), 'utf8'))
    assert.equal(saved.turns[0].events.filter(x => x.type === 'text').length, 1)
    assert.equal(saved.turns[0].events[0].text, 'Snapshot 499')
    const reopened = new HistoryStore(f.dir)
    assert.equal(reopened.snapshot().chats[0].status, 'interrupted')
    const turn = reopened.getChat(chat).turns[0]
    assert.equal(turn.status, 'interrupted')
    assert.ok(turn.events.some(x => x.type === 'warning' && x.text.includes('прерван')))
    assert.ok(turn.events.some(x => x.type === 'done' && x.cancelled))
    reopened.flush()
    assert.equal(new HistoryStore(f.dir).getChat(chat).turns[0].status, 'interrupted')
  } finally { f.close() }
})

test('damaged catalogue or chat recovers backup and preserves damaged original', () => {
  const f = fixture()
  try {
    let db = new HistoryStore(f.dir)
    const id = db.addWorkdir('/projects/backup')
    db.beginTurn(id, 'backup', 'Keep this')
    db.record(id, text('backup', 'answer', 'Saved answer'))
    db.finishTurn(id, 'backup', 'done'); db.flush()
    db.selectChat(id) // ensure an up-to-date catalogue backup
    const indexPath = join(f.dir, 'index.json')
    writeFileSync(indexPath, '{damaged')
    db = new HistoryStore(f.dir)
    assert.equal(db.snapshot().chats.length, 1)
    assert.ok(db.takeWarnings().length)
    assert.ok(readdirSync(f.dir).some(name => name.startsWith('index.json.corrupt-')))
    const chatPath = join(f.dir, 'chats', `${id}.json`)
    const good = readFileSync(chatPath, 'utf8')
    writeFileSync(`${chatPath}.bak`, good)
    writeFileSync(chatPath, '{also damaged')
    assert.equal(db.getChat(id).turns[0].prompt, 'Keep this')
    assert.ok(readdirSync(join(f.dir, 'chats')).some(name => name.includes('.corrupt-')))
    db.flush()
  } finally { f.close() }
})

test('unrecoverable and unknown data are not silently replaced; invalid IDs cannot address arbitrary files', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.dir, 'index.json'), 'ORIGINAL DAMAGED BYTES')
    assert.throws(() => new HistoryStore(f.dir), /Файлы сохранены без изменений/)
    assert.equal(readFileSync(join(f.dir, 'index.json'), 'utf8'), 'ORIGINAL DAMAGED BYTES')
    rmSync(join(f.dir, 'index.json'))
    const db = new HistoryStore(f.dir)
    db.addWorkdir('/projects/safe')
    assert.throws(() => db.selectChat('../../elsewhere'), /не найден/)
  } finally { f.close() }
})

test('disk failure is reported and dirty state can be saved after repair', () => {
  const f = fixture()
  try {
    const db = new HistoryStore(f.dir)
    const id = db.addWorkdir('/projects/disk')
    db.beginTurn(id, 'disk', 'Keep pending changes')
    db.record(id, text('disk', 'answer', 'Pending answer'))
    const directory = join(f.dir, 'chats')
    rmSync(directory, { recursive: true })
    writeFileSync(directory, 'Blocking file')
    assert.throws(() => db.flush())
    rmSync(directory); mkdirSync(directory)
    db.flush()
    assert.equal(new HistoryStore(f.dir).getChat(id).turns[0].events[0].text, 'Pending answer')
  } finally { f.close() }
})
