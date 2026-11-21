// Import authored fixtures through the same public APIs available to users.
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { root } from './main-harness.mjs'
export async function importLabFixture(h, folder, name) {
  h.folder = join(root, 'resources/examples', name)
  try {
    const imported = await h.invoke('import-skill', 'project')
    assert.equal(imported.ok, true, imported.error)
    const template = JSON.parse(
      await readFile(join(root, 'resources/examples', name + '.suite.json'), 'utf8')
    )
    const saved = await h.invoke('save-skill-test-suite', {
      ...template,
      id: null,
      revision: null,
      scope: 'project',
      skillId: imported.value.entry.id,
      modelProfileId: null
    })
    assert.equal(saved.ok, true, saved.error)
    return saved.value
  } finally {
    h.folder = folder
  }
}

// This setup is test-only; factory examples have no production IPC or service entry point.
export function seedServiceFixture(service, name, cwd) {
  const { skills, resources } = service.options,
    scope = cwd ? 'project' : 'user'
  let entry = skills.list(scope, cwd).entries.find((e) => e.name === name)
  if (!entry) entry = skills.importDirectory(scope, join(resources, 'examples', name), cwd).entry
  const template = JSON.parse(
    readFileSync(join(resources, 'examples', name + '.suite.json'), 'utf8')
  )
  return service.save(
    { ...template, id: null, revision: null, scope, skillId: entry.id, modelProfileId: null },
    cwd
  )
}
