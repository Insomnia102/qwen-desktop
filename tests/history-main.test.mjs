import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { harness } from './main-harness.mjs'

test('fresh main process restores workdirs, separate chats, active selection, transcript and resume; approvals remain temporary', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-main-history-'))
  const folderA = join(base, 'project-a'), folderB = join(base, 'project-b'), userData = join(base, 'app-data')
  await mkdir(folderA); await mkdir(folderB)
  const launches = []
  let ask = true
  let broken = false
  const query = ({ prompt, options }) => {
    const id = options.resume ?? randomUUID()
    launches.push({ prompt, options, id })
    return { initialized: broken ? Promise.reject(new Error('Fixture handshake failed')) : Promise.resolve(),
      getSessionId: () => id, close: async () => {},
      async *[Symbol.asyncIterator]() {
        if (ask) await options.canUseTool('mcp__fixture__operation', { value: 42 }, { signal: options.abortController.signal })
        yield { type: 'assistant', uuid: randomUUID(), message: { id: 'answer',
          content: [{ type: 'thinking', thinking: 'Fixture thinking' }, { type: 'text', text: `# Answer\n${prompt}` }] } }
        yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: `# Answer\n${prompt}`, permission_denials: [] }
      }
    }
  }
  const onEvent = (event, api) => { if (event.type === 'permission') api.invoke('approve', event.permissionId, 'allow-session') }
  let h = await harness({ userData, folder: folderA, query, onEvent })
  try {
    assert.equal((await h.view()).chat, null)
    const added = await h.invoke('select-folder')
    const chatA = added.value.chat.id
    await h.start('a1', 'First conversation'); await h.done('a1')
    assert.equal((await h.view()).allowAll, true)
    const newChat = await h.invoke('new-chat')
    const chatA2 = newChat.value.chat.id
    assert.notEqual(chatA2, chatA)
    await h.start('a2', 'Independent conversation'); await h.done('a2')
    assert.equal(launches[1].options.resume, undefined)
    h.folder = folderB
    const addedB = await h.invoke('select-folder')
    const chatB = addedB.value.chat.id
    await h.start('b1', 'Other project'); await h.done('b1')
    await h.close()

    h = await harness({ userData, folder: folderA, query, onEvent })
    const restored = await h.view()
    assert.equal(restored.index.workdirs.length, 2)
    assert.equal(restored.index.chats.length, 3)
    assert.equal(restored.chat.id, chatB)
    assert.equal(restored.allowAll, false)
    const selected = await h.invoke('select-chat', chatA)
    assert.equal(selected.value.chat.turns[0].prompt, 'First conversation')
    assert.equal(selected.value.chat.turns[0].events.find(x => x.type === 'thinking').text, 'Fixture thinking')
    assert.equal(selected.value.allowAll, false)
    await h.start('a3', 'Continue first conversation'); await h.done('a3')
    assert.equal(launches[3].options.resume, launches[0].id)
    assert.equal(launches[3].options.cwd, await realpath(folderA))
    assert.equal(h.events.filter(x => x.requestId === 'a3' && x.type === 'permission').length, 1)
    assert.equal((await h.view()).chat.turns.length, 2)
    assert.equal((await h.invoke('select-chat', chatA2)).value.chat.turns.length, 1)

    ask = false; broken = true
    await h.start('failure', 'Keep this failed request'); await h.done('failure')
    const failed = await h.view()
    assert.equal(failed.chat.turns.length, 2)
    assert.equal(failed.chat.turns[1].status, 'error')
    assert.equal(failed.chat.sessionId, launches[1].id)
    assert.equal(failed.allowAll, false)
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})

test('closing a window saves partial text, closes pending permission, and never approves historical requests', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-main-stop-'))
  let currentSession
  const query = ({ options }) => { const id = currentSession = randomUUID(); return { initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
    async *[Symbol.asyncIterator]() {
      yield { type: 'assistant', uuid: randomUUID(), message: { id: 'partial', content: [{ type: 'text', text: 'Partial saved answer' }] } }
      const answer = await options.canUseTool('run_shell_command', { command: 'fixture only' }, { signal: options.abortController.signal })
      assert.equal(answer.behavior, 'deny')
    }
  } }
  let h = await harness({ userData: join(base, 'app'), folder: base, query })
  try {
    await h.invoke('select-folder')
    await h.start('pending')
    await h.wait(items => items.some(x => x.type === 'permission'))
    assert.equal((await h.invoke('new-chat')).ok, false)
    await h.close()
    h = await harness({ userData: join(base, 'app'), folder: base, query })
    const restored = await h.view()
    assert.equal(restored.chat.sessionId, currentSession)
    assert.equal(restored.chat.turns[0].status, 'stopped')
    assert.equal(restored.chat.turns[0].events.find(x => x.type === 'text').text, 'Partial saved answer')
    assert.equal(restored.chat.turns[0].events.find(x => x.type === 'permission-closed').allowed, false)
    const old = restored.chat.turns[0].events.find(x => x.type === 'permission')
    assert.equal((await h.invoke('approve', old.permissionId, 'allow-session')).ok, false)
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})
