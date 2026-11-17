// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTypeScript } from './load-typescript.mjs'
const { SkillDrafts, skillMetadata, updateSkillMetadata } = loadTypeScript(
  'src/renderer/src/skill-drafts.ts'
)
const raw =
  '---\n# Keep this comment\nname: demo\ndescription: Demo\nmetadata:\n  owner: Example\nallowed-tools: [read_file]\n---\n\nInstructions'
const ok = (value) => ({ ok: true, value })
function fixture() {
  let version = 1,
    doc = {
      entry: { id: 'demo', name: 'demo', description: 'Demo', revision: '1', editable: true },
      raw,
      body: 'Instructions',
      files: [
        { path: 'SKILL.md', kind: 'file' },
        { path: 'script.py', kind: 'file' }
      ],
      treeRevision: 'tree-1'
    }
  const files = new Map([
      [
        'script.py',
        { path: 'script.py', text: 'old', revision: 'f1', encoding: 'utf8', lineEnding: 'LF' }
      ]
    ]),
    calls = []
  const api = {
    getSkill: async () => ok(structuredClone(doc)),
    getSkillFile: async (s, id, path) => ok(structuredClone(files.get(path))),
    saveRawSkill: async (s, id, revision, text) => {
      calls.push(['raw', text, revision])
      if (revision !== doc.entry.revision) return { ok: false, error: 'External conflict' }
      doc = {
        ...doc,
        raw: text,
        entry: { ...doc.entry, revision: String(++version) },
        treeRevision: `tree-${version}`
      }
      return ok(structuredClone(doc))
    },
    saveSkillFile: async (s, id, file) => {
      calls.push(['file', file.text, file.revision])
      if (files.get(file.path).revision !== file.revision)
        return { ok: false, error: 'External conflict' }
      const saved = { ...file, revision: 'f' + ++version }
      files.set(file.path, saved)
      doc.treeRevision = `tree-${version}`
      return ok(structuredClone(saved))
    },
    changeSkillPath: async (s, id, change) => {
      calls.push(['change', change])
      assert.equal(change.revision, doc.treeRevision)
      return ok(structuredClone(doc))
    }
  }
  return {
    api,
    calls,
    get document() {
      return structuredClone(doc)
    },
    external() {
      doc.entry.revision = 'external'
    },
    files
  }
}
test('general settings preserve custom YAML fields and comments, sharing the raw draft', () => {
  const fields = skillMetadata(raw)
  assert.equal(fields.body, 'Instructions')
  fields.description = 'Changed'
  fields.modelInvocable = false
  const changed = updateSkillMetadata(raw, fields)
  assert.match(changed, /# Keep this comment/)
  assert.match(changed, /owner: Example/)
  assert.match(changed, /allowed-tools: \[ read_file \]/)
  assert.equal(skillMetadata(changed).modelInvocable, false)
  assert.throws(() => skillMetadata('---\nname: a\nname: b\n---\ntext'))
})
test('all file drafts survive switching and structural changes flush with the latest tree revision', async () => {
  const f = fixture(),
    drafts = new SkillDrafts(f.api, 'user', f.document, 60000)
  try {
    await drafts.file('script.py')
    drafts.edit('script.py', 'new script')
    drafts.edit('SKILL.md', raw + ' changed')
    assert.equal((await drafts.file('script.py')).text, 'new script')
    await drafts.change({ action: 'rename', path: 'script.py', target: 'moved.py' })
    assert.equal(drafts.dirty, false)
    assert.deepEqual(
      f.calls.map((c) => c[0]),
      ['raw', 'file', 'change']
    )
    assert.equal(f.files.get('script.py').text, 'new script')
  } finally {
    drafts.dispose()
  }
})
test('typing while a save is pending is retained and the next save uses the new revision', async () => {
  const f = fixture()
  let release
  const original = f.api.saveRawSkill
  let first = true
  f.api.saveRawSkill = async (...args) => {
    if (first) {
      first = false
      await new Promise((resolve) => {
        release = resolve
      })
    }
    return original(...args)
  }
  const drafts = new SkillDrafts(f.api, 'user', f.document, 60000)
  try {
    drafts.edit('SKILL.md', raw + ' first')
    const saving = drafts.flush()
    await new Promise((resolve) => setImmediate(resolve))
    drafts.edit('SKILL.md', raw + ' second')
    release()
    await saving
    assert.equal(drafts.raw, raw + ' second')
    assert.equal(drafts.dirty, true)
    await drafts.flush()
    assert.equal(drafts.dirty, false)
    assert.equal(f.document.raw, raw + ' second')
    assert.deepEqual(
      f.calls.map((c) => c[2]),
      ['1', '2']
    )
  } finally {
    drafts.dispose()
  }
})
test('revision conflicts retain unsaved text and block moving without overwriting the external file', async () => {
  const f = fixture(),
    drafts = new SkillDrafts(f.api, 'user', f.document, 60000)
  try {
    drafts.edit('SKILL.md', raw + ' local')
    f.external()
    await assert.rejects(
      drafts.change({ action: 'remove', path: 'script.py' }),
      /External conflict/
    )
    assert.equal(drafts.raw, raw + ' local')
    assert.equal(drafts.dirty, true)
    assert.equal(f.document.raw, raw)
    assert.equal(drafts.drafts.get('SKILL.md').base.revision, '1')
    assert.ok(!f.calls.some((c) => c[0] === 'change'))
  } finally {
    drafts.dispose()
  }
})
test('autosave debounces edits and keeps errors instead of silently discarding drafts', async () => {
  const f = fixture(),
    drafts = new SkillDrafts(f.api, 'user', f.document, 10)
  try {
    drafts.edit('SKILL.md', raw + ' a')
    drafts.edit('SKILL.md', raw + ' b')
    await new Promise((resolve) => setTimeout(resolve, 45))
    assert.equal(f.calls.length, 1)
    assert.equal(f.document.raw, raw + ' b')
    assert.equal(drafts.dirty, false)
  } finally {
    drafts.dispose()
  }
})
test('discarding one conflicted file reloads its latest disk revision while preserving another draft', async () => {
  const f = fixture(),
    drafts = new SkillDrafts(f.api, 'user', f.document, 60000)
  try {
    await drafts.file('script.py')
    drafts.edit('script.py', 'keep my script draft')
    drafts.edit('SKILL.md', raw + ' unsaved')
    f.external()
    await assert.rejects(drafts.flush(), /External conflict/)
    drafts.edit('script.py', 'keep my next script draft')
    await drafts.revert('SKILL.md')
    assert.equal(drafts.raw, raw)
    assert.equal(drafts.drafts.get('SKILL.md').base.revision, 'external')
    assert.equal((await drafts.file('script.py')).text, 'keep my next script draft')
    await drafts.flush()
    assert.equal(f.files.get('script.py').text, 'keep my next script draft')
  } finally {
    drafts.dispose()
  }
})
