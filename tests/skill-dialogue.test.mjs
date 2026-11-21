import { seedServiceFixture } from './lab-ui-fixtures.mjs'
import { streamingFixture } from './skill-stream-fixture.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadTypeScript } from './load-typescript.mjs'
import { root } from './main-harness.mjs'
const { SkillTestsService } = loadTypeScript('src/main/skill-tests-service.ts'),
  { SkillsStore } = loadTypeScript('src/main/skills-store.ts'),
  { casesDefinition } = loadTypeScript('src/main/skill-tests-store.ts'),
  { assessResponse, actorDecision, plannedCases } = loadTypeScript('src/main/skill-test-roles.ts')
const env = {
  bootstrap: 'fixture',
  cli: 'fixture-cli',
  model: 'fixture',
  authType: 'openai',
  modelLabel: 'Fixture model',
  env: { OPENAI_API_KEY: 'SECRET_DIALOGUE_KEY' },
  settings: {},
  systemPrompt: 'Agent prompt',
  disabledTools: [],
  mcpServers: {}
}
const pause = () => new Promise((r) => setTimeout(r, 10))
async function wait(fn) {
  const end = Date.now() + 5000
  while (!fn()) {
    if (Date.now() > end) throw Error('Dialogue wait timed out')
    await pause()
  }
}
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'qwen-dialogue-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
function session(config, text, tool = false) {
  const id = config.options.resume ?? config.options.sessionId ?? randomUUID()
  config.fixtureSessionId = id
  return {
    initialized: Promise.resolve(),
    getSessionId: () => id,
    close: async () => {},
    async *[Symbol.asyncIterator]() {
      if (tool) {
        yield {
          type: 'assistant',
          uuid: randomUUID(),
          message: {
            id: randomUUID(),
            content: [
              {
                type: 'tool_use',
                id: randomUUID(),
                name: 'run_shell_command',
                input: { command: 'ci status' }
              }
            ]
          }
        }
      }
      yield {
        type: 'assistant',
        uuid: randomUUID(),
        message: { id: randomUUID(), content: [{ type: 'text', text }] }
      }
      yield { type: 'result', is_error: false, subtype: 'success', session_id: id, result: text }
    }
  }
}
function kind(c) {
  try {
    return JSON.parse(c.prompt).labRole
  } catch {
    return 'agent'
  }
}
function reviewer(config, status = 'passed', invalid = false) {
  const data = JSON.parse(config.prompt).data
  return JSON.stringify({
    assessments: data.requirements.map((r) => ({
      criterionId: r.id,
      status,
      reason: 'Based on the conversation',
      evidenceIds: [invalid ? 'invented-id' : data.evidence.at(-1).id]
    }))
  })
}
function service(dir, launch, changed = () => {}) {
  return new SkillTestsService({
    directory: join(dir, 'lab'),
    resources: join(root, 'resources'),
    skills: new SkillsStore(dir, {
      QWEN_HOME: join(dir, 'qwen'),
      QWEN_CODE_SYSTEM_SETTINGS_PATH: join(dir, 'system.json')
    }),
    environment: async () => env,
    launch: streamingFixture(launch),
    changed
  })
}
async function suiteFor(s, mode = 'ai') {
  const installed = seedServiceFixture(s, 'demo-build-assistant', null)
  return s.save(
    {
      ...installed,
      cases: [
        {
          ...installed.cases[1],
          id: 'dialogue',
          dialogue: {
            ...installed.cases[1].dialogue,
            mode,
            criteria: ['Hidden criterion: all choices collected before launch'],
            maxMessages: 6
          }
        }
      ]
    },
    null
  )
}
test('dialogue schema accepts natural-language requirements without file checks and validates bounded waits', () => {
  const base = {
    id: 'x',
    name: 'Dialogue',
    prompt: 'Build',
    files: [],
    checks: [],
    dialogue: {
      mode: 'manual',
      persona: 'Developer',
      criteria: ['Explain the result'],
      maxMessages: 12,
      replyTimeoutSeconds: 1800
    }
  }
  assert.equal(casesDefinition([base])[0].checks.length, 0)
  for (const dialogue of [
    { ...base.dialogue, criteria: [] },
    { ...base.dialogue, maxMessages: 41 },
    { ...base.dialogue, mode: 'yolo' },
    { ...base.dialogue, replyTimeoutSeconds: 0 }
  ])
    assert.throws(() => casesDefinition([{ ...base, dialogue }]))
  assert.throws(() => casesDefinition([{ ...base, dialogue: undefined }]))
  const cases = plannedCases(
    JSON.stringify({
      cases: [
        {
          name: 'Generated',
          prompt: 'Build',
          persona: 'Choose from offered options',
          criteria: ['Collect parameters']
        }
      ]
    }),
    'ai'
  )
  assert.equal(cases[0].dialogue.mode, 'ai')
  assert.equal(cases[0].files.length, 0)
  assert.throws(() => actorDecision('{"action":"reply","text":"ok","delaySeconds":31}'))
})
test('reviewer cannot pass omitted requirements or cite nonexistent evidence', () => {
  const scenario = { dialogue: { criteria: ['First', 'Second'] } },
    result = { evidence: [{ id: 'e1', kind: 'message', text: 'Agent asked a question' }] }
  const graded = assessResponse(
    JSON.stringify({
      assessments: [
        { criterionId: 'r1', status: 'passed', reason: 'Invented', evidenceIds: ['not-real'] }
      ]
    }),
    scenario,
    result
  )
  assert.ok(graded.every((r) => r.status === 'uncertain'))
})
test('manual mode resumes the same session, persists the conversation, scopes answers and supports explicit finish', () =>
  fixture(async (dir) => {
    const launches = []
    const s = service(dir, (c) => {
      launches.push(c)
      return session(
        c,
        kind(c) === 'reviewer'
          ? reviewer(c)
          : launches.filter((x) => kind(x) === 'agent').length === 1
            ? 'Which service: api or web?'
            : 'Build SUCCESS'
      )
    })
    const suite = await suiteFor(s, 'manual'),
      batch = await s.run(1, suite.id)
    await wait(() => s.runner.inputs(1).length)
    assert.equal(s.runner.inputs(2).length, 0)
    const first = s.runner.inputs(1)[0]
    assert.throws(() => s.runner.reply(2, first.id, 'api'))
    s.runner.reply(1, first.id, 'api')
    assert.throws(() => s.runner.reply(1, first.id, 'again'))
    await wait(() => s.runner.inputs(1).length)
    s.runner.reply(1, s.runner.inputs(1)[0].id, null)
    await wait(() => !s.busy)
    const report = s.store.run(batch.id),
      native = launches.filter((x) => kind(x) === 'agent')
    assert.equal(report.cases[0].status, 'passed', JSON.stringify(report))
    assert.equal(native.length, 2)
    assert.equal(native[1].options.resume, native[0].fixtureSessionId)
    assert.ok(native[1].options.resume)
    assert.equal(native[0].options.cwd, native[1].options.cwd)
    assert.deepEqual(
      Array.from(report.cases[0].dialogue, (m) => m.role),
      ['user', 'assistant', 'user', 'assistant']
    )
    assert.equal(report.cases[0].dialogue[2].text, 'api')
    assert.equal(report.cases[0].phase, undefined)
    assert.equal(s.view(1).inputs.length, 0)
    const judge = launches.find((c) => kind(c) === 'reviewer')
    assert.equal(judge.options.maxToolCalls, 0)
    assert.equal(JSON.stringify(judge.options.mcpServers), '{}')
    assert.ok(!native[0].prompt.includes('Hidden criterion'))
  }))
test('AI test user answers adaptively, keeps rubrics out of the agent, and uses tool-free role sessions', () =>
  fixture(async (dir) => {
    const launches = []
    let round = 0
    const s = service(dir, (c) => {
      launches.push(c)
      if (kind(c) === 'actor') {
        const d = JSON.parse(c.prompt).data
        assert.equal(d.criteria, undefined)
        return session(
          c,
          JSON.stringify(
            d.conversation.at(-1).text.includes('Which service')
              ? { action: 'reply', text: 'api', delaySeconds: 0 }
              : { action: 'finish', text: 'Task reached terminal status', delaySeconds: 0 }
          )
        )
      }
      if (kind(c) === 'reviewer') return session(c, reviewer(c))
      return session(c, ++round === 1 ? 'Which service: api or web?' : 'Build SUCCESS')
    })
    const suite = await suiteFor(s),
      batch = await s.run(1, suite.id)
    await wait(() => !s.busy)
    const report = s.store.run(batch.id)
    assert.equal(report.cases[0].status, 'passed', JSON.stringify(report))
    assert.equal(report.cases[0].dialogue[2].source, 'actor')
    assert.ok(report.cases[0].assessments[0].evidenceIds.length)
    assert.ok(
      launches
        .filter((c) => kind(c) !== 'agent')
        .every((c) => c.options.maxToolCalls === 0 && c.options.coreTools.length === 0)
    )
    assert.ok(
      launches
        .filter((c) => kind(c) === 'agent')
        .every((c) => !c.prompt.includes('Hidden criterion'))
    )
  }))
test('unsupported evaluation becomes review; reaching message budget cannot silently pass', () =>
  fixture(async (dir) => {
    const s = service(dir, (c) =>
      session(
        c,
        kind(c) === 'reviewer'
          ? reviewer(c, 'passed', true)
          : kind(c) === 'actor'
            ? JSON.stringify({ action: 'reply', text: 'Continue', delaySeconds: 0 })
            : 'Still waiting for a decision'
      )
    )
    let suite = await suiteFor(s)
    suite = s.save(
      {
        ...suite,
        cases: suite.cases.map((c) => ({ ...c, dialogue: { ...c.dialogue, maxMessages: 1 } }))
      },
      null
    )
    const batch = await s.run(1, suite.id)
    await wait(() => !s.busy)
    const result = s.store.run(batch.id).cases[0]
    assert.equal(result.status, 'review')
    assert.equal(result.assessments[0].status, 'uncertain')
    assert.match(result.stopReason, /limit/)
  }))
test('cancellation unblocks manual replies and permits the next run', () =>
  fixture(async (dir) => {
    const s = service(dir, (c) => session(c, 'Which service?')),
      suite = await suiteFor(s, 'manual'),
      batch = await s.run(1, suite.id)
    await wait(() => s.runner.inputs(1).length)
    const id = s.runner.inputs(1)[0].id
    s.cancel(2)
    assert.equal(s.runner.running, true)
    s.cancel(1)
    await wait(() => !s.busy)
    assert.equal(s.store.run(batch.id).cases[0].status, 'cancelled')
    assert.throws(() => s.runner.reply(1, id, 'api'))
    assert.equal(s.runner.inputs(1).length, 0)
  }))
test('planning creates editable scenarios and never installs a global testing skill', () =>
  fixture(async (dir) => {
    const launches = []
    const s = service(dir, (c) => {
      launches.push(c)
      return session(
        c,
        JSON.stringify({
          cases: [
            {
              name: 'Check manual build',
              prompt: 'Build a service',
              persona: 'Choose api/full',
              criteria: ['Collect parameters before launch']
            }
          ]
        })
      )
    })
    const installed = seedServiceFixture(s, 'demo-build-assistant', null),
      draft = await s.plan(
        1,
        {
          scope: installed.scope,
          skillId: installed.skillId,
          modelProfileId: null,
          mode: 'ai',
          goal: 'Test the manual build workflow',
          language: 'en'
        },
        null
      )
    assert.equal(draft.id, null)
    assert.equal(draft.permissionMode, 'yolo')
    assert.equal(draft.cases[0].dialogue.mode, 'ai')
    assert.equal(s.store.list().length, 1)
    assert.equal(launches[0].options.maxToolCalls, 0)
    const dirs = await readdir(join(dir, 'qwen/skills'))
    assert.deepEqual(dirs, ['demo-build-assistant'])
    assert.equal(s.view(1).planning, false)
  }))
test('demo scripts enforce dependent parameters, report terminal status and explain actual failure without a network', () =>
  fixture(async (dir) => {
    const script = join(root, 'resources/examples/demo-build-assistant/scripts/ci.mjs'),
      run = (...args) =>
        spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' })
    assert.equal(JSON.parse(run('catalog').stdout).defaults.service, 'api')
    assert.equal(run('start', '--service', 'api').status, 1)
    assert.equal(run('start', '--service', 'web', '--profile', 'full').status, 1)
    await writeFile(join(dir, 'demo-control.json'), '{"outcome":"failure","delayMs":0}')
    const started = JSON.parse(run('start', '--service', 'api', '--profile', 'full').stdout)
    assert.equal(started.status, 'RUNNING')
    assert.equal(JSON.parse(run('status', '--id', started.id).stdout).status, 'FAILURE')
    assert.match(JSON.parse(run('log', '--id', started.id).stdout).log, /DEMO_ENDPOINT/)
    assert.equal((await readdir(join(dir, '.demo-ci/jobs'))).length, 1)
  }))

test('AI user can request human help without acquiring tool approval authority; a negative review fails the case', () =>
  fixture(async (dir) => {
    let asks = 0
    const s = service(dir, (c) => {
      if (kind(c) === 'actor')
        return session(
          c,
          JSON.stringify(
            ++asks === 1
              ? { action: 'needs-human', text: 'Which service should I choose?', delaySeconds: 0 }
              : { action: 'finish', text: 'Finished', delaySeconds: 0 }
          )
        )
      if (kind(c) === 'reviewer') return session(c, reviewer(c, 'failed'))
      return session(c, c.options.resume ? 'Task complete' : 'Which service?')
    })
    const suite = await suiteFor(s),
      batch = await s.run(1, suite.id)
    await wait(() => s.runner.inputs(1).length)
    assert.match(s.runner.inputs(1)[0].reason, /Which service/)
    s.runner.reply(1, s.runner.inputs(1)[0].id, 'api')
    await wait(() => !s.busy)
    const report = s.store.run(batch.id)
    assert.equal(report.cases[0].status, 'failed')
    assert.equal(report.cases[0].dialogue[2].source, 'human')
  }))
test('planning is cancellable and releases its operation lock and temporary credential directory', () =>
  fixture(async (dir) => {
    const s = service(dir, () => ({
        initialized: new Promise(() => {}),
        close: async () => {},
        async *[Symbol.asyncIterator]() {}
      })),
      example = seedServiceFixture(s, 'demo-build-assistant', null)
    const pending = s
      .plan(
        1,
        {
          scope: example.scope,
          skillId: example.skillId,
          modelProfileId: null,
          goal: 'Generate scenarios',
          mode: 'ai',
          language: 'en'
        },
        null
      )
      .then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: e })
      )
    await wait(() => s.busy)
    s.cancel(1)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(s.busy, false)
    assert.ok(!(await readdir(join(dir, 'lab'))).some((n) => n.startsWith('lab-role-')))
  }))

test('long dialogue context is bounded and retains stable references to initial choices and recent results', () => {
  const { boundedRoleContext } = loadTypeScript('src/main/skill-test-roles.ts')
  const result = {
    dialogue: Array.from({ length: 80 }, (_, i) => ({
      id: 'm' + i,
      text: 'Message ' + i + ' ' + 'x'.repeat(8000)
    })),
    evidence: Array.from({ length: 200 }, (_, i) => ({
      id: 'e' + i,
      text: 'Result ' + i + ' ' + 'y'.repeat(2000)
    }))
  }
  const context = boundedRoleContext(result)
  assert.ok(JSON.stringify(context).length < 50000)
  assert.equal(context.truncated, true)
  assert.equal(context.conversation[0].id, 'm0')
  assert.equal(context.conversation.at(-1).id, 'm79')
  assert.equal(context.evidence[0].id, 'e0')
  assert.equal(context.evidence.at(-1).id, 'e199')
})

test('fragmented SDK envelopes count as one reported model turn, and a fresh run uses a fresh session and workspace', () =>
  fixture(async (dir) => {
    const ids = [],
      directories = []
    const s = service(dir, (c) => {
      if (kind(c) === 'reviewer') return session(c, reviewer(c))
      if (kind(c) === 'actor')
        return session(
          c,
          JSON.stringify({
            action: c.prompt.includes('Build complete') ? 'finish' : 'reply',
            text: c.prompt.includes('Build complete') ? 'Done' : 'api',
            delaySeconds: 0
          })
        )
      if (!c.options.resume) {
        ids.push(c.options.sessionId)
        directories.push(c.options.cwd)
      }
      const id = c.options.sessionId,
        text = c.options.resume ? 'Build complete' : 'Which service?'
      return {
        initialized: Promise.resolve(),
        close: async () => {},
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < 45; i++)
            yield {
              type: 'assistant',
              uuid: randomUUID(),
              message: { id: 'fragment-' + i, content: [{ type: 'thinking', thinking: 'Working' }] }
            }
          yield {
            type: 'assistant',
            uuid: randomUUID(),
            message: { id: randomUUID(), content: [{ type: 'text', text }] }
          }
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            session_id: id,
            result: text,
            num_turns: 1
          }
        }
      }
    })
    let suite = await suiteFor(s)
    suite = s.save({ ...suite, maxTurns: 2 }, null)
    for (let i = 0; i < 2; i++) {
      const batch = await s.run(1, suite.id)
      await wait(() => !s.busy)
      const report = s.store.run(batch.id)
      assert.equal(report.cases[0].status, 'passed', JSON.stringify(report))
      assert.equal(report.cases[0].budget.modelTurns, 2)
      assert.equal(report.cases[0].dialogue.length, 4)
    }
    assert.notEqual(ids[0], ids[1])
    assert.notEqual(directories[0], directories[1])
  }))
test('a real exhausted model budget preserves the final exchange and requests review instead of reporting a transport error', () =>
  fixture(async (dir) => {
    const s = service(dir, (c) =>
      kind(c) === 'reviewer'
        ? session(c, reviewer(c))
        : kind(c) === 'actor'
          ? session(c, JSON.stringify({ action: 'reply', text: 'api', delaySeconds: 0 }))
          : session(c, 'Which service?')
    )
    let suite = await suiteFor(s)
    suite = s.save({ ...suite, maxTurns: 1 }, null)
    const batch = await s.run(1, suite.id)
    await wait(() => !s.busy)
    const result = s.store.run(batch.id).cases[0]
    assert.equal(result.status, 'review')
    assert.equal(result.error, undefined)
    assert.equal(result.budget.modelTurns, 2)
    assert.equal(result.dialogue.length, 4)
    assert.match(result.stopReason, /лимит шагов/)
  }))
test('history deletion removes report, backup and workspace while retaining suites and source files', () =>
  fixture(async (dir) => {
    const { mkdir, stat, unlink } = await import('node:fs/promises')
    const s = service(dir, () => {}),
      suite = seedServiceFixture(s, 'demo-build-assistant', null),
      source = join(dir, 'protected.txt')
    await writeFile(source, 'Keep me')
    const ids = [randomUUID(), randomUUID()]
    for (const id of ids) {
      const report = {
        id,
        status: 'done',
        createdAt: new Date().toISOString(),
        name: 'History',
        sourceCwd: dir,
        cases: []
      }
      s.store.saveRun(report)
      s.store.saveRun(report)
      const path = join(s.store.directory, 'workspaces', id)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'result.txt'), 'output')
    }
    s.removeRun(ids[0])
    assert.throws(() => s.store.run(ids[0]))
    await assert.rejects(stat(join(s.store.directory, ids[0] + '.json.bak')))
    await assert.rejects(stat(join(s.store.directory, 'workspaces', ids[0])))
    assert.equal(s.store.get(suite.id).id, suite.id)
    await unlink(join(s.store.directory, ids[1] + '.json'))
    s.clearHistory()
    await assert.rejects(stat(join(s.store.directory, ids[1] + '.json.bak')))
    await assert.rejects(stat(join(s.store.directory, 'workspaces', ids[1])))
    assert.equal(s.store.runs().length, 0)
    assert.equal(await readFile(source, 'utf8'), 'Keep me')
  }))
