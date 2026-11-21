import { importLabFixture } from './lab-ui-fixtures.mjs'
import { streamingFixture } from './skill-stream-fixture.mjs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { harness, root } from './main-harness.mjs'
const require = createRequire(import.meta.url),
  { JSDOM, VirtualConsole } = require('jsdom'),
  base = await mkdtemp(join(tmpdir(), 'qwen-ui-dialogue-')),
  errors = [],
  listeners = new Set(),
  native = [],
  roles = []
let h,
  dom,
  round = 0,
  invalidReview = false
function query(c) {
  let role, data
  try {
    const parsed = JSON.parse(c.prompt)
    role = parsed.labRole
    data = parsed.data
  } catch {}
  let text,
    id = c.options.resume ?? c.options.sessionId ?? randomUUID()
  if (role) {
    roles.push(c)
    if (role === 'planner')
      text = JSON.stringify({
        cases: [
          {
            name: 'Generated interactive test',
            prompt: 'Build the demo service',
            persona: 'Choose api, then full, finish after SUCCESS',
            criteria: ['Ask for required choices before launch', 'Confirm the actual result']
          }
        ]
      })
    else if (role === 'actor') {
      const last = data.conversation.at(-1).text
      text = JSON.stringify(
        last.includes('service?')
          ? { action: 'reply', text: 'api', delaySeconds: 0 }
          : last.includes('profile?')
            ? { action: 'reply', text: 'full', delaySeconds: 0 }
            : { action: 'finish', text: 'Task completed', delaySeconds: 0 }
      )
    } else
      text = JSON.stringify({
        assessments: data.requirements.map((r) => ({
          criterionId: r.id,
          status: 'passed',
          reason: 'Recorded conversation confirms the requirement',
          evidenceIds: [invalidReview ? 'missing' : data.evidence.at(-1).id]
        }))
      })
  } else {
    if (!c.options.resume) round = 0
    round++
    native.push(c)
    text =
      round === 1
        ? 'Which service? api or web'
        : round === 2
          ? 'Which profile? quick or full'
          : 'Build SUCCESS for api/full'
  }
  return {
    initialized: Promise.resolve(),
    getSessionId: () => id,
    close: async () => {},
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'assistant',
        uuid: randomUUID(),
        message: { id: randomUUID(), content: [{ type: 'text', text }] }
      }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: id, result: text }
    }
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20)),
  el = (s) => dom.window.document.querySelector(s),
  all = (s) => [...dom.window.document.querySelectorAll(s)]
async function wait(fn) {
  const end = Date.now() + 6000
  while (!fn()) {
    if (Date.now() > end)
      throw Error('UI dialogue timeout: ' + dom.window.document.body.textContent.slice(-2000))
    await tick()
  }
}
async function click(s) {
  assert.ok(el(s), s)
  el(s).click()
  await tick()
}
function fill(s, value, event = 'input') {
  assert.ok(el(s), s)
  el(s).value = value
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
    query: streamingFixture(query),
    onTestEvent: (e) => {
      for (const cb of listeners) cb(e)
    }
  })
  await h.invoke('select-folder')
  const info = (await h.invoke('get-studio', 'user')).value,
    saved = await h.invoke('save-model', {
      revision: info.revision,
      id: null,
      label: 'Fixture',
      model: 'fixture',
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:7777/v1',
      keySource: 'stored',
      envKey: '',
      apiKey: 'fake'
    })
  assert.equal(saved.ok, true, saved.error)
  await h.invoke('complete-onboarding', saved.value.profiles[0].id, false)
  const source = (
      await build({
        stdin: {
          contents:
            "import {openSkillTests} from './src/renderer/src/skill-tests-panel';globalThis.openLab=()=>openSkillTests(globalThis.api,true,()=>{});",
          resolveDir: root
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022'
      })
    ).outputFiles[0].text,
    vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e)))
  dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  })
  dom.window.structuredClone = structuredClone
  dom.window.localStorage.setItem('qwen-desktop-language', 'ru')
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
    runSkillTestSuite: 'run-skill-test-suite',
    getSkillTestRun: 'get-skill-test-run',
    deleteSkillTestRun: 'delete-skill-test-run',
    clearSkillTestHistory: 'clear-skill-test-history',
    cancelSkillTests: 'cancel-skill-tests',
    approveSkillTest: 'approve-skill-test',
    replySkillTest: 'reply-skill-test',
    planSkillTests: 'plan-skill-tests',
    getSkillTestArtifact: 'get-skill-test-artifact',
    revealSkillTestRun: 'reveal-skill-test-run',
    exportSkillTestRun: 'export-skill-test-run'
  }
  dom.window.api = {
    onSkillTestEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  for (const [name, route] of Object.entries(routes))
    dom.window.api[name] = (...args) => h.invoke(route, ...args)
  dom.window.eval(source)
  await importLabFixture(h, folder, 'demo-build-assistant')
  dom.window.openLab()
  await wait(() => el('[data-suite]'))
  assert.equal(el('#test-example'), null)
  assert.equal(el('#test-dialogue-example'), null)
  await click('[data-suite]')
  await wait(() => el('#test-dialogue-mode'))
  assert.equal(el('#test-dialogue-mode').value, 'manual')
  assert.equal(all('[data-test-case]').length, 5)
  assert.ok(el('#test-criteria').value.includes('параметры'))
  await click('#test-run-one')
  await wait(() => el('#test-dialogue-reply'))
  assert.equal(el('.test-conversation').children.length, 2)
  assert.equal(el('#test-report-delete').disabled, true)
  assert.equal(el('#test-history-clear').disabled, true)
  assert.equal((await h.invoke('clear-skill-test-history')).ok, false)
  const textarea = el('.test-live-reply textarea')
  textarea.focus()
  fill('.test-live-reply textarea', 'draft reply')
  textarea.setSelectionRange(2, 5)
  for (const cb of listeners)
    cb({
      type: 'changed',
      batchId: (await h.invoke('get-skill-tests')).value.activeBatchId,
      active: true
    })
  await tick()
  await tick()
  assert.equal(el('.test-live-reply textarea').value, 'draft reply')
  assert.equal(el('.test-live-reply textarea').selectionStart, 2)
  fill('.test-live-reply textarea', 'api')
  await click('#test-dialogue-reply')
  await wait(
    () => el('.test-live-reply') && el('.test-conversation').textContent.includes('Which profile')
  )
  fill('.test-live-reply textarea', 'full')
  el('.test-live-reply textarea').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  await wait(
    () => el('.test-live-reply') && el('.test-conversation').textContent.includes('Build SUCCESS')
  )
  await click('#test-dialogue-finish')
  await wait(() => el('.test-case-result[data-status="passed"]'))
  assert.ok(el('.test-assessment[data-verdict="passed"]'))
  assert.equal(all('.test-dialogue-message').length, 6)
  assert.ok(el('.test-evidence-link'))
  assert.ok(native[1].options.resume)
  assert.equal((await h.view()).chat.turns.length, 0)
  // Natural-language planning generates editable dialogue scenarios, with no mandatory artifact checks.
  await click('#test-planner')
  fill('#test-plan-goal', 'Проверь последовательный выбор параметров и успешную сборку')
  el('#test-plan-generate')
    .closest('form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(() => el('#test-case-name')?.value === 'Generated interactive test')
  assert.equal(el('#test-dialogue-mode').value, 'ai')
  assert.equal(all('.test-check').length, 0)
  assert.ok(el('#test-persona').value.includes('api'))
  await click('#test-run-all')
  await wait(() => el('.test-case-result[data-status="passed"]'))
  assert.equal(
    all('.test-dialogue-message').filter(
      (e) => e.querySelector('small').textContent === 'ИИ-пользователь'
    ).length,
    2
  )
  const suiteId = (await h.invoke('get-skill-tests')).value.suites.find((s) =>
    s.cases.some((c) => c.name === 'Generated interactive test')
  ).id
  await click('[data-suite="' + suiteId + '"]')
  invalidReview = true
  await click('#test-run-one')
  await wait(() => el('.test-case-result[data-status="review"]'))
  assert.ok(el('.test-assessment[data-verdict="uncertain"]'))
  // A pending manual prompt survives panel closure and can be cancelled on reopening.
  await click('[data-suite="' + suiteId + '"]')
  fill('#test-dialogue-mode', 'manual', 'change')
  await click('#test-run-one')
  await wait(() => el('#test-dialogue-reply'))
  await close()
  dom.window.openLab()
  await wait(() => el('#test-dialogue-reply'))
  await click('#test-run-cancel')
  await wait(() => el('.test-case-result[data-status="cancelled"]'))
  assert.equal((await h.invoke('get-skill-tests')).value.inputs.length, 0)
  await close()
  assert.equal(listeners.size, 0)
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.ok(roles.every((c) => c.options.maxToolCalls === 0))
  console.log(
    'PASS: dialogue example, manual turns and finish, draft/caret retention during updates, resumed sessions, evidence review, natural-language planning, AI user, uncertain verdict, close/reconnect/cancel and unchanged chat history.'
  )
} finally {
  dom?.window.close()
  await h?.close()
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
