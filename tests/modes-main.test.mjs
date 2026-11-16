import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { harness } from './main-harness.mjs'

test('all five dropdown modes reach the SDK, stay attached to their chat, and explicit Ask clears allow-all', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-modes-'))
  const options = []
  const query = config => { const id = config.options.resume ?? randomUUID(); options.push(config.options); return {
    initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
    async *[Symbol.asyncIterator]() {
      if (config.prompt === 'ask') await config.options.canUseTool('write_file', {}, { signal: config.options.abortController.signal })
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'Done', permission_denials: [] }
    }
  } }
  const h = await harness({ userData: join(base, 'app'), folder: base, query,
    onEvent: (event, api) => { if (event.type === 'permission') api.invoke('approve', event.permissionId, 'allow-session') } })
  try {
    const chatA = (await h.invoke('select-folder')).value.chat.id
    for (const [index, mode] of ['plan', 'default', 'auto-edit', 'auto', 'yolo'].entries()) {
      assert.equal((await h.invoke('set-mode', mode)).value.mode, mode)
      await h.start(`mode-${index}`); await h.done(`mode-${index}`)
      assert.equal(options.at(-1).permissionMode, mode)
    }
    const chatB = (await h.invoke('new-chat')).value.chat.id
    assert.equal((await h.view()).mode, 'auto')
    assert.equal((await h.invoke('select-chat', chatA)).value.mode, 'yolo')
    await h.invoke('set-mode', 'default')
    await h.start('allow-all', 'ask'); await h.done('allow-all')
    assert.equal((await h.view()).mode, 'yolo')
    await h.invoke('set-mode', 'default')
    assert.equal((await h.view()).allowAll, false)
    await h.start('ask-again', 'ask'); await h.done('ask-again')
    assert.ok(h.events.some(event => event.requestId === 'ask-again' && event.type === 'permission'))
    await h.invoke('select-chat', chatB)
    const settings = (await h.invoke('get-settings', 'project')).value
    const saved = await h.invoke('save-settings', { scope: 'project', revision: settings.revision, changes: { 'tools.approvalMode': 'auto-edit' } })
    assert.equal(saved.ok, true, saved.error)
    assert.equal(saved.value.workspace.mode, 'auto-edit')
    assert.equal(saved.value.workspace.modeOverride, false)
    await h.start('configured'); await h.done('configured')
    assert.equal(options.at(-1).permissionMode, 'auto-edit')
    assert.equal((await h.invoke('set-mode', 'unknown')).ok, false)
    await h.invoke('select-chat', chatA)
    assert.equal((await h.view()).mode, 'yolo')
    assert.equal((await h.invoke('set-mode', null)).value.mode, 'auto-edit')
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})
