import { importLabFixture } from './lab-ui-fixtures.mjs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { harness, root } from './main-harness.mjs'
const require = createRequire(import.meta.url),
  { JSDOM, VirtualConsole } = require('jsdom'),
  base = await mkdtemp(join(tmpdir(), 'qwen-ui-lab-')),
  errors = [],
  listeners = new Set(),
  launches = []
let h,
  dom,
  behaviour = 'pass',
  pending = () => {},
  events = 0
const source = (
  await build({
    stdin: {
      contents:
        "import {openSkillTests} from './src/renderer/src/skill-tests-panel';globalThis.openLab=()=>openSkillTests(globalThis.api,true,()=>{});",
      resolveDir: root
    },
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: 'es2022'
  })
).outputFiles[0].text
const query = (config) => {
  launches.push(config)
  return {
    initialized: Promise.resolve(),
    close: async () => {},
    async *[Symbol.asyncIterator]() {
      if (behaviour === 'wait')
        await new Promise((r) => {
          pending = r
          config.options.abortController.signal.addEventListener('abort', r, { once: true })
        })
      if (behaviour === 'permission')
        await config.options.canUseTool(
          'run_shell_command',
          { command: 'echo fixture' },
          { signal: config.options.abortController.signal }
        )
      if (behaviour === 'creator') {
        const name = 'ui-generated',
          dir = join(config.options.cwd, name)
        await mkdir(join(dir, 'evals'), { recursive: true })
        await writeFile(
          join(dir, 'SKILL.md'),
          '---\nname: ' + name + '\ndescription: Generated fixture\n---\nGenerate fixtures.\n'
        )
        const template = JSON.parse(
          await readFile(join(root, 'resources/examples/repo-health-report.suite.json'), 'utf8')
        )
        await writeFile(
          join(dir, 'evals/suite.json'),
          JSON.stringify({ ...template, skillName: name })
        )
      } else
        await writeFile(
          join(config.options.cwd, 'result.txt'),
          behaviour === 'fail' ? 'wrong' : 'correct'
        )
      yield {
        type: 'assistant',
        uuid: randomUUID(),
        message: { id: randomUUID(), content: [{ type: 'text', text: '# Finished fixture' }] }
      }
      yield { type: 'result', subtype: 'success', is_error: false, result: '# Finished fixture' }
    }
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20)),
  el = (s) => dom.window.document.querySelector(s),
  all = (s) => [...dom.window.document.querySelectorAll(s)]
async function wait(fn) {
  const until = Date.now() + 6000
  while (!fn()) {
    if (Date.now() > until)
      throw Error('UI timeout ' + dom.window.document.body.textContent.slice(-2000))
    await tick()
  }
}
async function click(s) {
  assert.ok(el(s), s)
  el(s).click()
  await tick()
}
function fill(s, v, event = 'input') {
  assert.ok(el(s), s)
  el(s).value = v
  el(s).dispatchEvent(new dom.window.Event(event, { bubbles: true }))
}
async function close() {
  await click('.skill-tests-dialog .settings-footer button:last-child')
  await wait(() => !el('.skill-tests-dialog'))
}
try {
  const folder = join(base, 'project')
  await mkdir(folder)
  h = await harness({
    userData: join(base, 'app'),
    folder,
    query,
    onTestEvent: (e) => {
      events++
      for (const callback of listeners) callback(e)
    }
  })
  await h.invoke('select-folder')
  const studio = (await h.invoke('get-studio', 'user')).value,
    saved = await h.invoke('save-model', {
      revision: studio.revision,
      id: null,
      label: 'UI test model',
      model: 'fixture',
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:7777/v1',
      keySource: 'stored',
      envKey: '',
      apiKey: 'fixture-key'
    })
  assert.equal(saved.ok, true, saved.error)
  const model = saved.value.profiles[0].id
  // Complete onboarding sets the default used by the lab, independently of chat selection.
  assert.equal((await h.invoke('complete-onboarding', model, false)).ok, true)
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e)))
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  })
  dom.window.structuredClone = structuredClone
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  const routes = {
    getSkills: 'get-skills',
    getStudio: 'get-studio',
    getSkillTests: 'get-skill-tests',
    saveSkillTestSuite: 'save-skill-test-suite',
    deleteSkillTestSuite: 'delete-skill-test-suite',
    runSkillTestSuite: 'run-skill-test-suite',
    getSkillTestRun: 'get-skill-test-run',
    deleteSkillTestRun: 'delete-skill-test-run',
    clearSkillTestHistory: 'clear-skill-test-history',
    cancelSkillTests: 'cancel-skill-tests',
    approveSkillTest: 'approve-skill-test',
    getSkillTestArtifact: 'get-skill-test-artifact',
    revealSkillTestRun: 'reveal-skill-test-run',
    importSkillTestSuite: 'import-skill-test-suite',
    exportSkillTestSuite: 'export-skill-test-suite',
    exportSkillTestRun: 'export-skill-test-run',
    runSkillCreator: 'run-skill-creator',
    installCreatedSkill: 'install-created-skill'
  }
  dom.window.api = {
    onSkillTestEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  for (const [name, route] of Object.entries(routes))
    dom.window.api[name] = (...args) => h.invoke(route, ...args)
  dom.window.localStorage.setItem('qwen-desktop-language', 'ru')
  dom.window.eval(source)
  await importLabFixture(h, folder, 'repo-health-report')
  dom.window.openLab()
  await wait(() => el('[data-suite]'))
  assert.equal(el('#test-example'), null)
  assert.equal(el('#test-dialogue-example'), null)
  await click('[data-suite]')
  await wait(() => el('#test-suite-name'))
  assert.equal(all('[data-test-case]').length, 4)
  // Import suite is editable without mandatory manual saves; fixtures and checks have form controls.
  const suite = (await h.invoke('get-skill-tests')).value.suites[0]
  const compact = await h.invoke('save-skill-test-suite', {
    ...suite,
    cases: [
      {
        id: 'basic',
        name: 'Basic',
        prompt: 'Create result.txt',
        files: [],
        checks: [{ kind: 'file-equals', path: 'result.txt', value: 'correct' }]
      }
    ]
  })
  assert.equal(compact.ok, true, compact.error)
  await close()
  dom.window.openLab()
  await wait(() => el('[data-suite]'))
  await click('[data-suite]')
  fill('#test-suite-name', 'Renamed suite')
  await click('#test-fixture-add')
  fill('.test-fixture input', 'input.txt')
  fill('.test-fixture textarea', 'Fixture input')
  await click('#test-run-all')
  await wait(() => el('.test-case-result[data-status="passed"]'))
  assert.equal((await h.invoke('get-skill-tests')).value.suites[0].name, 'Renamed suite')
  assert.equal(launches[0].options.model, 'fixture')
  assert.ok(el('.test-check-result[data-passed="true"]'))
  assert.ok(el('.test-answer h1'))
  assert.equal((await h.view()).chat.turns.length, 0)
  const latest = (await h.invoke('get-skill-tests')).value.runs[0]
  const reportPath = join(base, 'run.html')
  h.folder = reportPath
  assert.equal(el('#test-report-export').textContent, 'HTML-отчёт')
  await click('#test-report-export')
  await wait(() => existsSync(reportPath))
  const exported = new JSDOM(await readFile(reportPath, 'utf8'))
  assert.equal(exported.window.document.querySelector('.case h2').textContent, 'Basic')
  assert.ok(exported.window.document.querySelector('.answer h1'))
  exported.window.close()
  const jsonPath = join(base, 'run.json')
  h.folder = jsonPath
  assert.equal((await h.invoke('export-skill-test-run', latest.id, 'json')).ok, true)
  assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).id, latest.id)
  assert.equal((await h.invoke('export-skill-test-run', latest.id, 'unsupported')).ok, false)
  h.folder = folder
  // Directory enumeration differs between Windows and POSIX. Open the exact
  // artifact under test instead of assuming the output is listed first.
  for (const [path, expected] of [
    ['result.txt', 'correct'],
    ['input.txt', 'Fixture input']
  ]) {
    const artifact = all('.test-artifact').find((b) => b.textContent === path)
    assert.ok(artifact, `Artifact button missing: ${path}`)
    artifact.click()
    await wait(() => el('.test-artifact-dialog'))
    assert.equal(el('.test-artifact-dialog h3').textContent, path)
    assert.equal(el('.test-artifact-dialog pre').textContent, expected)
    await click('.test-artifact-dialog button')
  }
  // Finished report survives panel closure; fail is distinct from an SDK error.
  await click('[data-suite]')
  behaviour = 'fail'
  await click('#test-run-one')
  await wait(() => el('.test-case-result[data-status="failed"]'))
  assert.ok(el('.test-check-result[data-passed="false"]'))
  await click('[data-suite]')
  behaviour = 'permission'
  await click('#test-run-all')
  await wait(() => el('.test-permission'))
  assert.ok(el('.test-permission pre').textContent.includes('echo fixture'))
  all('.test-permission button')
    .find((b) => b.textContent.includes('в этом прогоне'))
    .click()
  await wait(() => el('.test-case-result[data-status="passed"]'))
  // Active test can continue behind a closed panel, and reopening reconnects to it.
  await click('[data-suite]')
  behaviour = 'wait'
  await click('#test-run-all')
  await wait(() => el('.test-case-result[data-status="running"]'))
  assert.equal((await h.invoke('start', { requestId: 'blocked', prompt: 'chat' })).ok, false)
  await close()
  assert.ok((await h.invoke('get-skill-tests')).value.activeBatchId)
  dom.window.openLab()
  await wait(() => el('.test-case-result[data-status="running"]'))
  await click('#test-run-cancel')
  pending()
  await wait(() => el('.test-case-result[data-status="cancelled"]'))
  // Creator -> actual generated files -> install -> import generated scenarios.
  behaviour = 'creator'
  await click('#test-creator')
  fill('#creator-name', 'ui-generated')
  fill('#creator-description', 'Generate a useful fixture skill')
  el('#creator-run')
    .closest('form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(() => el('#creator-install') && !el('#creator-install').disabled)
  await click('#creator-install')
  await wait(() =>
    all('.studio-detail button').some((b) => b.textContent === 'Добавить созданные сценарии')
  )
  all('.studio-detail button')
    .find((b) => b.textContent === 'Добавить созданные сценарии')
    .click()
  await wait(() => el('#test-suite-name') && all('[data-test-case]').length === 4)
  assert.equal(
    (await h.invoke('get-skills', 'project')).value.entries.some((s) => s.name === 'ui-generated'),
    true
  )
  // An incomplete new suite can be discarded; it must not trap the dialog open.
  await click('#test-suite-add')
  await wait(() => el('#test-case-prompt'))
  assert.equal(el('#test-suite-permissions').value, 'yolo')
  assert.equal(el('#test-suite-permissions').closest('details'), null)
  await click('#test-suite-discard')
  await close()
  assert.equal(listeners.size, 0)
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.ok(events > 0)
  dom.window.openLab()
  await wait(() => el('[data-test-run]'))
  await click('[data-test-run="' + latest.id + '"]')
  await wait(() => el('#test-report-delete'))
  await click('#test-report-delete')
  await click('.chat-dialog .button-danger')
  await wait(() => !el('.chat-dialog'))
  assert.ok(!(await h.invoke('get-skill-tests')).value.runs.some((r) => r.id === latest.id))
  assert.ok((await h.invoke('get-skill-tests')).value.suites.length >= 2)
  await click('#test-history-clear')
  await click('.chat-dialog .button-danger')
  await wait(() => !el('.chat-dialog'))
  await wait(() => !el('[data-test-run]'))
  assert.equal((await h.invoke('get-skill-tests')).value.runs.length, 0)
  assert.ok(
    (await h.invoke('get-skills', 'project')).value.entries.some((s) => s.name === 'ui-generated')
  )
  await close()
  await h.close()
  h = await harness({ userData: join(base, 'app'), folder, query })
  const restored = (await h.invoke('get-skill-tests')).value
  assert.equal(restored.runs.length, 0)
  assert.ok(restored.suites.some((s) => s.name === 'Renamed suite'))
  assert.equal(restored.activeBatchId, null)
  console.log(
    'PASS: Skills Lab forms, autosave before run, model default, fixtures/checks, reports/artifact preview, failure grading, independent permissions, close/reconnect/cancel, creator installation and generated suites, draft discard and persisted history.'
  )
} finally {
  dom?.window.close()
  await h?.close()
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
