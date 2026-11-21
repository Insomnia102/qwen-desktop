import { seedServiceFixture } from './lab-ui-fixtures.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadTypeScript } from './load-typescript.mjs'
import { root } from './main-harness.mjs'
const { SkillTestsStore, suiteDefinition, casesDefinition, testPath } = loadTypeScript(
  'src/main/skill-tests-store.ts'
)
const { SkillTestRunner, evaluateScenario } = loadTypeScript('src/main/skill-test-runner.ts')
const { SkillTestsService } = loadTypeScript('src/main/skill-tests-service.ts')
const { SkillsStore } = loadTypeScript('src/main/skills-store.ts')
const template = JSON.parse(
  await readFile(join(root, 'resources/examples/repo-health-report.suite.json'), 'utf8')
)
const delay = () => new Promise((r) => setTimeout(r, 10))
async function wait(fn) {
  const until = Date.now() + 5000
  while (!fn()) {
    if (Date.now() > until) throw Error('Tester did not settle')
    await delay()
  }
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'qwen-tester-'))
  try {
    await fn(base)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
const environment = {
  bootstrap: 'fake-bootstrap',
  cli: 'fake-cli',
  modelLabel: 'Fixture model',
  env: { OPENAI_API_KEY: 'secret-api-key-123' },
  settings: {},
  systemPrompt: 'Fixture prompt',
  disabledTools: [],
  mcpServers: {}
}
function input(skillId = 'fixture') {
  return { ...template, id: null, revision: null, skillId, scope: 'project', modelProfileId: null }
}
async function skill(base) {
  const store = new SkillsStore(base, {
    QWEN_HOME: join(base, 'qwen'),
    QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json')
  })
  return store.importDirectory('user', join(root, 'resources/examples/repo-health-report'), null)
}
function fakeQuery(run) {
  return (config) => ({
    initialized: Promise.resolve(),
    close: async () => {},
    async *[Symbol.asyncIterator]() {
      await run(config)
      yield {
        type: 'assistant',
        uuid: randomUUID(),
        message: { id: randomUUID(), content: [{ type: 'text', text: 'Done secret-api-key-123' }] }
      }
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done secret-api-key-123'
      }
    }
  })
}
test('test suite validates paths, limits, checks and optimistic revisions; reports recover after restart', () =>
  fixture(async (base) => {
    for (const path of ['../escape', '/tmp/x', 'C:/x', 'a\\b', 'a/NUL.txt', '.', 'a//x'])
      assert.throws(() => testPath(path))
    assert.equal(testPath('вход/данные.json'), 'вход/данные.json')
    assert.throws(() =>
      casesDefinition([{ ...template.cases[0], files: [{ path: '.mcp.json', text: '{}' }] }])
    )
    const checked = suiteDefinition(input())
    assert.equal(checked.cases.length, 4)
    for (const changes of [
      { timeoutSeconds: 0 },
      { maxTurns: 999 },
      { permissionMode: 'whatever' },
      { cases: [] },
      { cases: [{ ...checked.cases[0], checks: [] }] },
      { cases: [{ ...checked.cases[0], files: [{ path: '.qwen/settings.json', text: 'x' }] }] }
    ])
      assert.throws(() => suiteDefinition({ ...input(), ...changes }))
    assert.throws(() =>
      casesDefinition([
        {
          ...checked.cases[0],
          checks: [{ kind: 'json-equals', path: 'x.json', pointer: 'not-pointer', value: 1 }]
        }
      ])
    )
    const store = new SkillTestsStore(base),
      saved = store.save(checked, 'fixture', null)
    assert.equal(store.get(saved.id).revision, saved.revision)
    const next = store.save({ ...saved, name: 'Changed' }, 'fixture', null)
    assert.notEqual(next.revision, saved.revision)
    assert.throws(() => store.remove(saved.id, saved.revision), /changed/)
    const batch = {
      id: randomUUID(),
      status: 'running',
      createdAt: new Date().toISOString(),
      cases: [
        { id: 'a', status: 'running' },
        { id: 'b', status: 'queued' }
      ]
    }
    store.saveRun(batch)
    new SkillTestRunner(
      new SkillTestsStore(base),
      () => {},
      () => {}
    )
    assert.equal(store.run(batch.id).status, 'interrupted')
    assert.ok(store.run(batch.id).cases.every((c) => c.status === 'interrupted'))
  }))
test('objective grading checks nested JSON semantically, exact text, missing artifacts, tools and invalid generated packages', () =>
  fixture(async (base) => {
    await writeFile(
      join(base, 'report.json'),
      JSON.stringify({ summary: { a: 1, b: [true, 'x'] } })
    )
    await writeFile(join(base, 'text.txt'), 'Hello\n')
    const scenario = {
      checks: [
        {
          kind: 'json-equals',
          path: 'report.json',
          pointer: '/summary',
          value: { b: [true, 'x'], a: 1 }
        },
        { kind: 'file-equals', path: 'text.txt', value: 'Hello\n' },
        { kind: 'file-absent', path: 'missing.txt' },
        { kind: 'answer-contains', value: 'Ready' },
        { kind: 'tool-used', value: 'write_file' },
        { kind: 'skill-used', value: true },
        { kind: 'skill-valid', path: 'text.txt' },
        { kind: 'test-suite-valid', path: 'report.json' }
      ]
    }
    const results = evaluateScenario(scenario, base, 'Ready', new Set(['write_file']), true)
    assert.ok(results.slice(0, 6).every((x) => x.passed))
    assert.ok(results.slice(6).every((x) => !x.passed))
    if (process.platform !== 'win32') {
      await symlink(join(base, 'text.txt'), join(base, 'linked'))
      assert.equal(
        evaluateScenario(
          { checks: [{ kind: 'file-exists', path: 'linked' }] },
          base,
          '',
          new Set(),
          false
        )[0].passed,
        false
      )
    }
  }))
test('bundled comprehensive skill executes all four fixture scenarios without dependencies', () =>
  fixture(async (base) => {
    for (const scenario of template.cases) {
      const workspace = join(base, scenario.id)
      await mkdir(workspace, { recursive: true })
      for (const f of scenario.files) {
        await mkdir(dirname(join(workspace, f.path)), { recursive: true })
        await writeFile(join(workspace, f.path), f.text)
      }
      const source = scenario.id === 'unicode-paths' ? 'вход/мой проект' : 'repo'
      const output = spawnSync(
        process.execPath,
        [join(root, 'resources/examples/repo-health-report/scripts/audit.mjs'), source, 'output'],
        { cwd: workspace, encoding: 'utf8' }
      )
      assert.equal(output.status, 0, output.stderr)
      const results = evaluateScenario(scenario, workspace, '', new Set(), true)
      assert.ok(
        results.every((r) => r.passed),
        JSON.stringify({ scenario: scenario.id, results })
      )
    }
  }))
test('runner uses fresh sessions and workspaces, records actual failures, redacts secrets and removes temporary auth', () =>
  fixture(async (base) => {
    const doc = await skill(base),
      store = new SkillTestsStore(join(base, 'tests')),
      launches = []
    const runner = new SkillTestRunner(
      store,
      fakeQuery(async (c) => {
        launches.push(c)
        await writeFile(
          join(c.options.cwd, 'result.txt'),
          launches.length === 1 ? 'correct' : 'wrong'
        )
      }),
      () => {}
    )
    const suite = {
      ...suiteDefinition(input(doc.entry.id)),
      id: randomUUID(),
      revision: 'test',
      skillName: doc.entry.name,
      sourceCwd: base,
      cases: [1, 2].map((n) => ({
        id: 'case' + n,
        name: 'Case ' + n,
        prompt: 'Write a result',
        files: [],
        checks: [{ kind: 'file-equals', path: 'result.txt', value: 'correct' }]
      }))
    }
    const batch = runner.start(1, suite, doc, environment)
    assert.throws(() => runner.start(1, suite, doc, environment), /already active/)
    await wait(() => !runner.running)
    const report = store.run(batch.id)
    assert.equal(report.status, 'done')
    assert.equal(report.cases[0].status, 'passed')
    assert.equal(report.cases[1].status, 'failed')
    assert.equal(launches.length, 2)
    assert.notEqual(launches[0].options.cwd, launches[1].options.cwd)
    assert.equal(launches[0].options.resume, undefined)
    assert.equal(launches[0].options.permissionMode, 'auto-edit')
    assert.deepEqual(launches[0].options.mcpServers, {})
    assert.ok(!JSON.stringify(report).includes('secret-api-key-123'))
    assert.match(report.cases[0].answer, /redacted/)
    await assert.rejects(stat(launches[0].options.env.QWEN_HOME))
    assert.equal(runner.artifact(batch.id, 'case1', 'result.txt').text, 'correct')
    assert.throws(() => runner.artifact(batch.id, 'case1', '../home/settings.json'))
  }))
test('permissions are scoped to a test run and owner; cancellation releases pending prompts and stops queue', () =>
  fixture(async (base) => {
    const doc = await skill(base),
      store = new SkillTestsStore(join(base, 'tests')),
      decisions = []
    const launch = fakeQuery(async (c) => {
      decisions.push(
        await c.options.canUseTool(
          'run_shell_command',
          { command: 'echo secret-api-key-123' },
          { signal: c.options.abortController.signal }
        )
      )
      decisions.push(
        await c.options.canUseTool(
          'run_shell_command',
          { command: 'echo again' },
          { signal: c.options.abortController.signal }
        )
      )
      await writeFile(join(c.options.cwd, 'done.txt'), 'done')
    })
    const runner = new SkillTestRunner(store, launch, () => {}),
      suite = {
        ...suiteDefinition(input(doc.entry.id)),
        id: randomUUID(),
        revision: 'test',
        skillName: doc.entry.name,
        sourceCwd: base,
        cases: [
          {
            id: 'case',
            name: 'Case',
            prompt: 'task',
            files: [],
            checks: [{ kind: 'file-exists', path: 'done.txt' }]
          }
        ]
      }
    let batch = runner.start(7, suite, doc, environment)
    await wait(() => runner.permissions(7).length)
    assert.equal(runner.permissions(8).length, 0)
    const permission = runner.permissions(7)[0]
    assert.ok(!permission.details.includes('secret-api-key-123'))
    assert.throws(() => runner.approve(8, permission.id, 'allow-run'))
    runner.approve(7, permission.id, 'allow-run')
    await wait(() => !runner.running)
    assert.ok(decisions.every((d) => d.behavior === 'allow'))
    assert.equal(store.run(batch.id).cases[0].status, 'passed')
    batch = runner.start(7, suite, doc, environment)
    await wait(() => runner.permissions(7).length)
    runner.cancel(8)
    assert.equal(runner.running, true)
    runner.cancel(7)
    await wait(() => !runner.running)
    assert.equal(store.run(batch.id).status, 'cancelled')
    assert.equal(store.run(batch.id).cases[0].status, 'cancelled')
    assert.throws(() => runner.approve(7, permission.id, 'allow-run'))
  }))
test('example installation and bundled creator preserve user edits; generated skill installation waits for validated output', () =>
  fixture(async (base) => {
    const skills = new SkillsStore(base, {
      QWEN_HOME: join(base, 'qwen'),
      QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json')
    })
    let broken = true
    const service = new SkillTestsService({
      directory: join(base, 'tests'),
      resources: join(root, 'resources'),
      skills,
      environment: async () => environment,
      changed: () => {},
      launch: fakeQuery(async (c) => {
        await mkdir(join(c.options.cwd, 'generated/evals'), { recursive: true })
        await writeFile(
          join(c.options.cwd, 'generated/SKILL.md'),
          broken
            ? 'Invalid skill'
            : '---\nname: generated\ndescription: Generated fixture\n---\nFollow fixture instructions\n'
        )
        await writeFile(
          join(c.options.cwd, 'generated/evals/suite.json'),
          JSON.stringify({ ...template, skillName: 'generated' })
        )
      })
    })
    const example = seedServiceFixture(service, 'repo-health-report', null)
    assert.equal(example.cases.length, 4)
    const creator = service.builtin()
    assert.equal(creator.entry.name, 'skill-creator')
    assert.ok(creator.files.some((f) => f.path === 'scripts/aggregate_benchmark.py'))
    assert.match(
      await readFile(join(dirname(creator.entry.path), 'LICENSE.txt'), 'utf8'),
      /Apache License/
    )
    const edited = skills.saveRaw(
      'user',
      creator.entry.id,
      creator.entry.revision,
      creator.raw + '\nUser edit\n',
      null
    )
    assert.equal(service.builtin().raw, edited.raw)
    let batch = await service.creator(
      1,
      {
        name: 'generated',
        description: 'A fixture skill',
        scope: 'user',
        modelProfileId: null,
        timeoutSeconds: 30
      },
      null
    )
    await wait(() => !service.runner.running)
    assert.equal(service.store.run(batch.id).cases[0].status, 'failed')
    assert.throws(() => service.installCreated(batch.id))
    broken = false
    batch = await service.creator(
      1,
      {
        name: 'generated',
        description: 'A fixture skill',
        scope: 'user',
        modelProfileId: null,
        timeoutSeconds: 30
      },
      null
    )
    await wait(() => !service.runner.running)
    assert.equal(service.store.run(batch.id).cases[0].status, 'passed')
    assert.equal(service.installCreated(batch.id).entry.name, 'generated')
    assert.throws(() => service.installCreated(batch.id), /существ/)
    const publicSuite = JSON.parse(service.suiteJSON(example.id))
    assert.equal(publicSuite.sourceCwd, undefined)
    assert.equal(publicSuite.skillId, undefined)
    assert.equal(publicSuite.version, 1)
  }))

test('bundled Anthropic creator retains every pinned upstream resource and its license', async () => {
  const { createHash } = await import('node:crypto')
  const provenance = JSON.parse(
    await readFile(join(root, 'resources/skills/skill-creator/PROVENANCE.json'), 'utf8')
  )
  assert.equal(provenance.commit, 'e4bb5d960d87126ff3b3a8af1a104b7db67560ba')
  assert.equal(provenance.license, 'Apache-2.0')
  assert.ok(Object.keys(provenance.upstreamFiles).length >= 15)
  for (const [path, expected] of Object.entries(provenance.upstreamFiles)) {
    const bytes = await readFile(join(root, 'resources/skills/skill-creator', path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path)
  }
})

test('YOLO suite runs multiple cases without shell or MCP approval prompts and does not grant a later Ask run', () =>
  fixture(async (base) => {
    const doc = await skill(base),
      store = new SkillTestsStore(join(base, 'tests')),
      decisions = []
    const runner = new SkillTestRunner(
      store,
      fakeQuery(async (c) => {
        for (const name of ['run_shell_command', 'mcp__fixture__build'])
          decisions.push(
            await c.options.canUseTool(
              name,
              { command: 'fixture' },
              { signal: c.options.abortController.signal }
            )
          )
      }),
      () => {}
    )
    const suite = {
      ...suiteDefinition(input(doc.entry.id)),
      id: randomUUID(),
      revision: 'test',
      skillName: doc.entry.name,
      sourceCwd: base,
      permissionMode: 'yolo',
      cases: [1, 2].map((n) => ({
        id: 'case' + n,
        name: 'Case ' + n,
        prompt: 'task',
        files: [],
        checks: [{ kind: 'answer-contains', value: 'Done' }]
      }))
    }
    const batch = runner.start(1, suite, doc, environment)
    await wait(() => !runner.running)
    assert.equal(decisions.length, 4)
    assert.ok(decisions.every((d) => d.behavior === 'allow'))
    assert.equal(runner.permissions(1).length, 0)
    assert.ok(store.run(batch.id).cases.every((c) => c.status === 'passed'))
    runner.start(
      1,
      { ...suite, permissionMode: 'default', cases: suite.cases.slice(0, 1) },
      doc,
      environment
    )
    await wait(() => runner.permissions(1).length === 1)
    runner.cancel(1)
    await wait(() => !runner.running)
  }))
