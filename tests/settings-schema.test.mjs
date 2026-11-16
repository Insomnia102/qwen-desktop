import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { loadTypeScript } from './load-typescript.mjs'
const require = createRequire(import.meta.url)
const { SETTINGS_FIELDS, APPROVAL_MODES } = loadTypeScript('src/shared/settings.ts')
const { SETTINGS_HELP } = loadTypeScript('src/shared/settings-help.ts')
const { CORE_TOOLS } = loadTypeScript('src/shared/core-tools.ts')

test('all GUI fields and modes exist in the installed SDK bundled CLI schema', async () => {
  const dir = join(dirname(require.resolve('@qwen-code/sdk/package.json')), 'dist/cli/chunks')
  let schema
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue
    const path = join(dir, name)
    const source = await readFile(path, 'utf8')
    if (source.includes('function getSettingsSchema()')) {
      schema = (await import(pathToFileURL(path).href)).getSettingsSchema()
      break
    }
  }
  assert.ok(schema, 'Bundled CLI schema was not found')
  const get = key => key.split('.').reduce((value, part, index) => index ? value.properties?.[part] : value[part], schema)
  for (const field of SETTINGS_FIELDS) {
    assert.ok(SETTINGS_HELP[field.key]?.length > 40, `Missing help for ${field.key}`)
    const actual = get(field.key)
    assert.ok(actual, `Missing setting: ${field.key}`)
    if (field.type === 'boolean') assert.equal(actual.type, 'boolean', field.key)
    else if (actual.type === 'enum') {
      const values = actual.options.map(option => option.value)
      for (const value of field.choices) assert.ok(values.includes(value), `${field.key}: ${value}`)
    } else assert.ok(['integer', 'number'].includes(actual.type), `${field.key}: ${actual.type}`)
    if (field.default !== undefined) assert.equal(actual.default, field.default, field.key)
  }
  assert.deepEqual([...APPROVAL_MODES], get('tools.approvalMode').options.map(option => option.value))
})

test('native tool catalogue matches the bundled CLI ToolNames', async () => {
  const dir = join(dirname(require.resolve('@qwen-code/sdk/package.json')), 'dist/cli/chunks')
  let actual
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue
    const path = join(dir, name), source = await readFile(path, 'utf8')
    if (source.includes('var ToolNames={')) { actual = (await import(pathToFileURL(path).href)).ToolNames; break }
  }
  assert.ok(actual)
  assert.deepEqual([...CORE_TOOLS].map(tool => tool.name).sort(), Object.values(actual).sort())
})
