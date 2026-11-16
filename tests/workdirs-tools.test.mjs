import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { parse } from 'jsonc-parser'
import { loadTypeScript } from './load-typescript.mjs'
import { harness } from './main-harness.mjs'
const { HistoryStore } = loadTypeScript('src/main/history-store.ts')
const { SettingsStore } = loadTypeScript('src/main/settings-store.ts')

test('closing workdirs persists, retains every chat/file/session and reopens the same identities', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-close-dirs-'))
  try {
    let db = new HistoryStore(base)
    const a = db.addWorkdir('/projects/a'), dirA = db.getChat(a).workdirId
    db.beginTurn(a, 'first', 'Remember this')
    const sid = randomUUID(); db.setSession(a, sid)
    db.record(a, { requestId: 'first', type: 'text', messageId: 'answer', text: 'Saved' })
    db.finishTurn(a, 'first', 'done'); db.flush()
    const b = db.addWorkdir('/projects/b'), dirB = db.getChat(b).workdirId
    const before = await readdir(join(base, 'chats'))
    db.closeWorkdir(dirA)
    assert.equal(db.snapshot().activeChatId, b)
    assert.equal(db.snapshot().workdirs.find(x => x.id === dirA).closed, true)
    assert.deepEqual(await readdir(join(base, 'chats')), before)
    assert.equal(db.getChat(a).sessionId, sid)
    db.closeWorkdir(dirB)
    assert.equal(db.snapshot().activeChatId, null)
    db = new HistoryStore(base)
    assert.equal(db.snapshot().activeChatId, null)
    assert.equal(db.snapshot().workdirs.every(x => x.closed), true)
    assert.equal(db.selectWorkdir(dirA), a)
    assert.equal(db.getChat(a).turns[0].events.find(x => x.type === 'text').text, 'Saved')
    assert.equal(db.snapshot().workdirs.find(x => x.id === dirA).closed, false)
    assert.equal(db.addWorkdir('/projects/b'), b)
    assert.equal(db.snapshot().workdirs.length, 2)
    db.beginTurn(b, 'running', 'Work')
    assert.throws(() => db.closeWorkdir(dirB), /завершите запросы/)
    db.finishTurn(b, 'running', 'stopped'); db.flush()
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('native tools policy preserves unrelated MCP/skills/rules, unions scopes and enforces fixed exclusions', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-core-policy-'))
  try {
    const home = join(base, 'home'), project = join(base, 'project')
    await mkdir(join(home, '.qwen'), { recursive: true }); await mkdir(join(project, '.qwen'), { recursive: true })
    const user = join(home, '.qwen/settings.json'), file = join(project, '.qwen/settings.json')
    await writeFile(user, '{ // keep\n"tools":{"disabled":["mcp__server__private_tool"]},"mcpServers":{"keep":{}},"memory":{"enableAutoSkill":true},"permissions":{"deny":["Bash(rm *)"]}}')
    const store = new SettingsStore(home, { QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json') })
    let view = store.loadCoreTools('user', project)
    assert.equal(view.tools.write_file.enabled, true)
    assert.equal(view.tools.ask_user_question.locked, true)
    assert.equal(view.tools.run_shell_command.locked, false)
    store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { write_file: false, list_directory: true } }, project)
    const saved = parse(await readFile(user, 'utf8'))
    assert.ok(saved.tools.disabled.includes('write_file'))
    assert.ok(saved.tools.disabled.includes('mcp__server__private_tool'))
    assert.equal(saved.tools.listDirectory.enabled, true)
    assert.deepEqual(saved.mcpServers, { keep: {} })
    assert.equal(saved.memory.enableAutoSkill, true)
    assert.deepEqual(saved.permissions.deny, ['Bash(rm *)'])
    assert.ok((await readFile(user, 'utf8')).includes('// keep'))
    view = store.loadCoreTools('project', project)
    assert.equal(view.tools.write_file.locked, true)
    assert.throws(() => store.saveCoreTools({ scope: 'project', revision: view.revision, changes: { write_file: true } }, project), /ограничен/)
    view = store.loadCoreTools('user', project)
    assert.throws(() => store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { ask_user_question: true } }, project), /ограничен/)
    assert.throws(() => store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { mcp__arbitrary: false } }, project), /Неизвестный/)
    store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { write_file: true } }, project)
    assert.equal(store.loadCoreTools('project', project).tools.write_file.enabled, true)
    view = store.loadCoreTools('project', project)
    store.saveCoreTools({ scope: 'project', revision: view.revision, changes: { run_shell_command: false } }, project)
    assert.ok(store.disabledCoreTools(project).includes('run_shell_command'))
    const projectDoc = parse(await readFile(file, 'utf8'))
    assert.deepEqual(projectDoc.tools.disabled, ['run_shell_command'])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('tool policies honor whole-tool deny rules, conflict checks and feature switches', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-core-lock-'))
  try {
    await mkdir(join(base, '.qwen'))
    const file = join(base, '.qwen/settings.json')
    await writeFile(file, '{"permissions":{"deny":["Bash"]},"tools":{"toolSearch":{"enabled":false}}}')
    const store = new SettingsStore(base, { QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json') })
    const view = store.loadCoreTools('user', null)
    assert.equal(view.tools.run_shell_command.locked, true)
    assert.equal(view.tools.tool_call.enabled, false)
    store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { tool_call: true } }, null)
    assert.equal(store.loadCoreTools('user', null).tools.tool_search.enabled, true)
    assert.throws(() => store.saveCoreTools({ scope: 'user', revision: view.revision, changes: { write_file: false } }, null), /изменился/)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('IPC closes the selected folder and forwards disabled native tools even in YOLO', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-close-ipc-')), options = []
  const query = config => { const id = randomUUID(); options.push(config.options); return {
    initialized: Promise.resolve(), getSessionId: () => id, close: async () => {},
    async *[Symbol.asyncIterator]() { yield { type: 'result', subtype: 'success', is_error: false, session_id: id, result: 'Done', permission_denials: [] } }
  } }
  const h = await harness({ userData: join(base, 'app'), folder: base, query })
  try {
    const first = (await h.invoke('select-folder')).value
    const view = (await h.invoke('get-core-tools', 'project')).value
    assert.equal((await h.invoke('save-core-tools', { scope: 'project', revision: view.revision, changes: { write_file: false } })).ok, true)
    await h.invoke('set-mode', 'yolo')
    await h.start('off'); await h.done('off')
    assert.equal(options[0].permissionMode, 'yolo')
    assert.ok(options[0].excludeTools.includes('write_file'))
    const closed = await h.invoke('close-workdir', first.chat.workdirId)
    assert.equal(closed.value.chat, null)
    assert.equal((await h.invoke('start', { requestId: 'closed', prompt: 'Not running' })).ok, false)
    const restored = await h.invoke('select-workdir', first.chat.workdirId)
    assert.equal(restored.value.chat.id, first.chat.id)
    assert.equal(restored.value.chat.turns.length, 1)
  } finally { await h.close(); await rm(base, { recursive: true, force: true }) }
})
