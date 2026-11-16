import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'jsonc-parser'
import { loadTypeScript } from './load-typescript.mjs'
const { SettingsStore } = loadTypeScript('src/main/settings-store.ts')
const { SETTINGS_FIELDS } = loadTypeScript('src/shared/settings.ts')

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'qwen-settings-'))
  const home = join(base, 'home'), project = join(base, 'project'), system = join(base, 'system')
  await mkdir(join(home, '.qwen'), { recursive: true }); await mkdir(join(project, '.qwen'), { recursive: true }); await mkdir(system)
  const userPath = join(home, '.qwen/settings.json'), projectPath = join(project, '.qwen/settings.json')
  const env = { QWEN_CODE_SYSTEM_SETTINGS_PATH: join(system, 'settings.json'), QWEN_CODE_SYSTEM_DEFAULTS_PATH: join(system, 'defaults.json') }
  return { base, home, project, userPath, projectPath, env, store: new SettingsStore(home, env), close: () => rm(base, { recursive: true, force: true }) }
}

test('GUI settings patch preserves JSONC comments, BOM, auth, providers, MCP, skills and unrelated fields', async () => {
  const f = await fixture()
  try {
    const original = '\uFEFF{\r\n  // retain my comment\r\n  "tools": { "approvalMode": "auto-edit", "exclude": ["old_tool"] },\r\n  "mcpServers": { "private": { "command": "my-server", "env": {"API_KEY":"SECRET"} } },\r\n  "skills": {"custom": true},\r\n  "modelProviders": {"openai":[{"id":"my-model","apiKey":"PROVIDER_SECRET"}]},\r\n  "security": {"auth":{"apiKey":"AUTH_SECRET"}},\r\n  "unknown": {"keep": [1,2,3]},\r\n}\r\n'
    await writeFile(f.userPath, original)
    const view = f.store.load('user', f.project)
    assert.equal(view.fields['tools.approvalMode'].local, 'auto-edit')
    assert.equal(JSON.stringify(view).includes('SECRET'), false)
    f.store.save({ scope: 'user', revision: view.revision, changes: { 'tools.approvalMode': 'default', 'privacy.usageStatisticsEnabled': false } }, f.project)
    const result = await readFile(f.userPath, 'utf8')
    assert.equal(result[0], '\uFEFF')
    assert.ok(result.includes('// retain my comment'))
    assert.equal(await readFile(`${f.userPath}.desktop.bak`, 'utf8'), original)
    const before = parse(original.slice(1), [], { allowTrailingComma: true }), after = parse(result.slice(1), [], { allowTrailingComma: true })
    assert.equal(after.tools.approvalMode, 'default')
    assert.equal(after.privacy.usageStatisticsEnabled, false)
    for (const key of ['mcpServers', 'skills', 'modelProviders', 'security', 'unknown']) assert.deepEqual(after[key], before[key])
    assert.deepEqual(after.tools.exclude, before.tools.exclude)
    assert.equal(SETTINGS_FIELDS.some(field => /skill|^mcp\./i.test(field.key)), false)
  } finally { await f.close() }
})

test('user/project inheritance, resetting a field and system priority behave correctly', async () => {
  const f = await fixture()
  try {
    await writeFile(f.userPath, '{"tools":{"approvalMode":"default"},"context":{"fileFiltering":{"respectGitIgnore":true}}}')
    await writeFile(f.projectPath, '{"tools":{"approvalMode":"yolo"},"context":{"fileFiltering":{"respectGitIgnore":false}},"mcpServers":{"keep":{}}}')
    assert.equal(f.store.approvalMode(f.project), 'yolo')
    const view = f.store.load('project', f.project)
    assert.equal(view.fields['context.fileFiltering.respectGitIgnore'].inherited, true)
    f.store.save({ scope: 'project', revision: view.revision, changes: { 'tools.approvalMode': null } }, f.project)
    assert.equal(f.store.approvalMode(f.project), 'default')
    assert.deepEqual(parse(await readFile(f.projectPath, 'utf8')).mcpServers, { keep: {} })
    await writeFile(f.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, '{"tools":{"approvalMode":"plan"}}')
    const locked = f.store.load('user', f.project)
    assert.equal(locked.fields['tools.approvalMode'].locked, true)
    assert.equal(f.store.approvalMode(f.project), 'plan')
    assert.throws(() => f.store.save({ scope: 'user', revision: locked.revision, changes: { 'tools.approvalMode': 'yolo' } }, f.project), /другом уровне/)
  } finally { await f.close() }
})

test('external changes, bad JSON, invalid values and arbitrary paths cannot be overwritten', async () => {
  const f = await fixture()
  try {
    await writeFile(f.userPath, '{}')
    const original = f.store.load('user', null)
    await writeFile(f.userPath, '{"external":true}')
    assert.throws(() => f.store.save({ scope: 'user', revision: original.revision, changes: { 'tools.approvalMode': 'yolo' } }, null), /изменились вне/)
    let view = f.store.load('user', null)
    for (const changes of [{ 'tools.approvalMode': 'made-up-mode' }, { '__proto__.polluted': true }, { 'privacy.usageStatisticsEnabled': 'false' }, { 'model.maxSubagentDepth': 999 }]) {
      assert.throws(() => f.store.save({ scope: 'user', revision: view.revision, changes }, null))
    }
    assert.equal(await readFile(f.userPath, 'utf8'), '{"external":true}')
    assert.throws(() => f.store.load('project', null), /выберите рабочую папку/)
    await writeFile(f.userPath, '{BROKEN')
    assert.throws(() => f.store.load('user', null), /Неверный JSON/)
    assert.equal(await readFile(f.userPath, 'utf8'), '{BROKEN')
  } finally { await f.close() }
})

test('a missing user file is created and QWEN_HOME points to the configured directory', async () => {
  const f = await fixture()
  try {
    const configured = join(f.base, 'custom-qwen')
    const store = new SettingsStore(f.home, { ...f.env, QWEN_HOME: configured })
    const view = store.load('user', null)
    assert.equal(view.path, join(configured, 'settings.json'))
    store.save({ scope: 'user', revision: view.revision, changes: { 'tools.approvalMode': 'auto-edit' } }, null)
    assert.equal(parse(await readFile(join(configured, 'settings.json'), 'utf8')).tools.approvalMode, 'auto-edit')
  } finally { await f.close() }
})

test('linked settings update their target; a dangling link is left intact', async t => {
  const f = await fixture()
  try {
    const target = join(f.base, 'linked-settings.json')
    await writeFile(target, '{}')
    try { await symlink(target, f.userPath) } catch (error) {
      if (error.code === 'EPERM') { t.skip('Creating symlinks is not permitted for this account'); return }
      throw error
    }
    const view = f.store.load('user', null)
    f.store.save({ scope: 'user', revision: view.revision, changes: { 'tools.approvalMode': 'default' } }, null)
    assert.equal((await lstat(f.userPath)).isSymbolicLink(), true)
    assert.equal(parse(await readFile(target, 'utf8')).tools.approvalMode, 'default')
    await rm(target)
    assert.throws(() => f.store.load('user', null))
    assert.equal((await lstat(f.userPath)).isSymbolicLink(), true)
  } finally { await f.close() }
})
