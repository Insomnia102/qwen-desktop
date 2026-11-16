import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HistoryStore } from './load-history-store.mjs'
import { harness } from './main-harness.mjs'

test('A → B → A retains each chat permission independently; a fresh application resets it', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-chat-approvals-'))
  const folder = join(base, 'project'); await mkdir(folder)
  const query = ({ options }) => {
    const id = options.resume ?? randomUUID()
    return { initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
      async *[Symbol.asyncIterator]() {
        await options.canUseTool('run_shell_command', { command: 'fixture only' }, { signal: options.abortController.signal })
        yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'Done', permission_denials: [] }
      } }
  }
  const onEvent = (event, api) => {
    if (event.type === 'permission') assert.equal(api.invoke('approve', event.permissionId, 'allow-session').ok, true)
  }
  let h = await harness({ userData: join(base, 'app'), folder, query, onEvent })
  try {
    const a = (await h.invoke('select-folder')).value.chat.id
    await h.start('a1'); await h.done('a1')
    const b = (await h.invoke('new-chat')).value.chat.id
    assert.equal((await h.view()).allowAll, false)
    await h.start('b1'); await h.done('b1')
    assert.equal((await h.invoke('select-chat', a)).value.allowAll, true)
    await h.start('a2'); await h.done('a2')
    assert.equal(h.events.some(x => x.requestId === 'a2' && x.type === 'permission'), false)
    await h.invoke('select-workdir', (await h.view()).chat.workdirId)
    assert.equal((await h.view()).allowAll, true)
    assert.equal((await h.invoke('select-chat', b)).value.allowAll, true)
    await h.start('b2'); await h.done('b2')
    assert.equal(h.events.some(x => x.requestId === 'b2' && x.type === 'permission'), false)
    await h.close()
    h = await harness({ userData: join(base, 'app'), folder, query, onEvent })
    assert.equal((await h.view()).allowAll, false)
    assert.equal((await h.invoke('select-chat', a)).value.allowAll, false)
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})

test('renaming survives first prompt and restart without changing the session or messages', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-rename-'))
  try {
    let db = new HistoryStore(base)
    const id = db.addWorkdir('/project/a')
    db.renameChat(id, '  My   custom name  ')
    db.beginTurn(id, 'turn', 'Do not use this as title')
    const sid = randomUUID(); db.setSession(id, sid)
    db.record(id, { requestId: 'turn', type: 'text', messageId: 'answer', text: 'Saved answer' })
    db.finishTurn(id, 'turn', 'done'); db.flush()
    db = new HistoryStore(base)
    assert.equal(db.getChat(id).title, 'My custom name')
    assert.equal(db.getChat(id).sessionId, sid)
    assert.equal(db.getChat(id).turns[0].prompt, 'Do not use this as title')
    assert.throws(() => db.renameChat(id, '   '), /Название/)
    assert.throws(() => db.renameChat(id, 'a'.repeat(121)), /Название/)
    db.renameChat(id, '<img src=x onerror=alert(1)>')
    assert.equal(new HistoryStore(base).getChat(id).title, '<img src=x onerror=alert(1)>')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('deleting inactive, selected, and last chats persists; backups do not restore a deleted entry', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-delete-'))
  try {
    let db = new HistoryStore(base)
    const a = db.addWorkdir('/project/a'), dirA = db.getChat(a).workdirId
    const a2 = db.createChat(dirA)
    const b = db.addWorkdir('/project/b')
    db.deleteChat(a)
    assert.equal(db.snapshot().activeChatId, b)
    assert.equal(db.snapshot().chats.some(x => x.id === a), false)
    assert.equal((await readdir(join(base, 'chats'))).some(x => x.startsWith(a)), false)
    db.selectChat(a2)
    const replacement = db.deleteChat(a2)
    assert.notEqual(replacement, a2)
    assert.equal(db.getChat(replacement).workdirId, dirA)
    assert.equal(db.getChat(replacement).status, 'empty')
    assert.equal(db.getChat(b).turns.length, 0)
    await writeFile(join(base, 'index.json'), 'damaged')
    db = new HistoryStore(base)
    assert.equal(db.snapshot().chats.some(x => x.id === a || x.id === a2), false)
    assert.equal(db.snapshot().activeChatId, replacement)
    assert.throws(() => db.deleteChat('../../outside'), /не найден/)
    assert.ok((await readFile(join(base, 'index.json.bak'), 'utf8')).includes(replacement))
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('management IPC keeps the active chat when deleting another and blocks mutation during a request', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-manage-ipc-'))
  const query = ({ options }) => { const id = randomUUID(); return {
    initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
    async *[Symbol.asyncIterator]() {
      await options.canUseTool('run_shell_command', {}, { signal: options.abortController.signal })
      yield { type: 'result', subtype: 'success', is_error: false, session_id: id, result: 'Done', permission_denials: [] }
    }
  } }
  const h = await harness({ userData: join(base, 'app'), folder: base, query })
  try {
    const a = (await h.invoke('select-folder')).value.chat.id
    const b = (await h.invoke('new-chat')).value.chat.id
    assert.equal((await h.invoke('rename-chat', a, 'Renamed inactive')).value.index.chats.find(x => x.id === a).title, 'Renamed inactive')
    assert.equal((await h.invoke('delete-chat', a)).value.chat.id, b)
    await h.start('running')
    await h.wait(items => items.some(x => x.type === 'permission'))
    assert.equal((await h.invoke('delete-chat', b)).ok, false)
    assert.equal((await h.invoke('rename-chat', b, 'Cannot')).ok, false)
    h.invoke('cancel'); await h.done('running')
    const removed = await h.invoke('delete-chat', b)
    assert.equal(removed.ok, true)
    assert.notEqual(removed.value.chat.id, b)
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})

test('failed deletion commit leaves the original chat selected and does not leave an extra empty document', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-delete-failure-'))
  try {
    const db = new HistoryStore(base)
    const id = db.addWorkdir('/project/a')
    const backup = join(base, 'index.json.bak')
    await rm(backup, { force: true }); await mkdir(backup)
    const before = await readdir(join(base, 'chats'))
    assert.throws(() => db.deleteChat(id))
    assert.equal(db.snapshot().activeChatId, id)
    assert.equal(db.getChat(id).id, id)
    assert.deepEqual(await readdir(join(base, 'chats')), before)
    await rm(backup, { recursive: true })
    assert.notEqual(db.deleteChat(id), id)
  } finally { await rm(base, { recursive: true, force: true }) }
})
