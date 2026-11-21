// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { query } from '@qwen-code/sdk'
import type {
  SkillTestsView,
  SkillTestSuite,
  SkillTestBatch,
  CreatorRequest,
  PlanSkillTestsRequest,
  SkillTestSuiteInput
} from '../shared/skill-tests'
import type { SkillDocument } from '../shared/studio'
import type { UiLanguage } from '../shared/desktop'
import { skillTestReportHTML } from './skill-test-report'
import { SkillTestsStore, suiteDefinition, record } from './skill-tests-store'
import { SkillTestRunner, type TestEnvironment } from './skill-test-runner'
import { SkillPackage } from './skill-package'
import { SkillTestRoles, plannedCases } from './skill-test-roles'
import { SkillsStore } from './skills-store'
interface Options {
  directory: string
  resources: string
  skills: SkillsStore
  launch: typeof query
  environment: (suite: SkillTestSuite) => Promise<TestEnvironment>
  changed: (batch: string, active: boolean) => void
}
export class SkillTestsService {
  readonly store: SkillTestsStore
  readonly runner: SkillTestRunner
  private operation: { owner: number; abort: AbortController; kind: 'plan' | 'launch' } | undefined
  get busy(): boolean {
    return Boolean(this.operation) || this.runner.running
  }
  cancel(owner?: number): void {
    if (this.operation && (owner === undefined || owner === this.operation.owner))
      this.operation.abort.abort()
    this.runner.cancel(owner)
  }
  private async prepare<T>(
    owner: number,
    kind: 'plan' | 'launch',
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.busy) throw Error('A Lab operation is already active')
    const operation = { owner, kind, abort: new AbortController() }
    this.operation = operation
    this.options.changed('preparing', true)
    try {
      return await fn(operation.abort.signal)
    } finally {
      if (this.operation === operation) this.operation = undefined
      this.options.changed(this.runner.activeId ?? 'preparing', this.runner.running)
    }
  }
  constructor(private options: Options) {
    this.store = new SkillTestsStore(options.directory)
    this.runner = new SkillTestRunner(this.store, options.launch, options.changed)
  }
  view(owner: number): SkillTestsView {
    return {
      suites: this.store.list(),
      runs: this.store.runs().map((r) => ({
        ...r,
        suiteSnapshot: undefined,
        cases: r.cases.map((c) => ({
          ...c,
          trace: [],
          answer: '',
          dialogue: undefined,
          evidence: undefined,
          assessments: c.assessments?.map((a) => ({ ...a, reason: '', evidenceIds: [] })),
          checks: c.checks.map((x) => ({ ...x, detail: '' }))
        }))
      })),
      activeBatchId: this.runner.activeId,
      permissions: this.runner.permissions(owner),
      inputs: this.runner.inputs(owner),
      planning: this.operation?.kind === 'plan'
    }
  }
  save(value: unknown, cwd: string | null): SkillTestSuite {
    const input = suiteDefinition(value),
      previous = input.id ? this.store.get(input.id) : null
    const source =
      previous && previous.skillId === input.skillId && previous.scope === input.scope
        ? previous.sourceCwd
        : cwd
    const skill = this.options.skills.get(input.scope, input.skillId, source)
    return this.store.save(input, skill.entry.name, source)
  }
  async run(owner: number, id: string, caseIds?: unknown): Promise<SkillTestBatch> {
    let suite = this.store.get(id)
    if (caseIds !== undefined) {
      if (
        !Array.isArray(caseIds) ||
        !caseIds.length ||
        caseIds.some((id) => typeof id !== 'string' || !suite.cases.some((c) => c.id === id))
      )
        throw Error('Unknown scenario selection')
      suite = { ...suite, cases: suite.cases.filter((c) => caseIds.includes(c.id)) }
    }
    const skill = this.options.skills.get(suite.scope, suite.skillId, suite.sourceCwd)
    return this.prepare(owner, 'launch', async (signal) => {
      const env = await this.options.environment(suite)
      if (signal.aborted) throw Error('Lab launch cancelled')
      return this.runner.start(owner, suite, skill, env)
    })
  }
  async plan(owner: number, value: unknown, cwd: string | null): Promise<SkillTestSuiteInput> {
    if (
      !record(value) ||
      !['user', 'project'].includes(String(value.scope)) ||
      typeof value.skillId !== 'string' ||
      typeof value.goal !== 'string' ||
      !value.goal.trim() ||
      value.goal.length > 12000 ||
      !['manual', 'ai'].includes(String(value.mode)) ||
      (value.modelProfileId !== null && typeof value.modelProfileId !== 'string') ||
      typeof value.language !== 'string' ||
      value.language.length > 20
    )
      throw Error('Choose a skill and describe what to test')
    const request = value as unknown as PlanSkillTestsRequest,
      skill = this.options.skills.get(request.scope, request.skillId, cwd)
    const suite: SkillTestSuite = {
      id: 'planner',
      revision: '',
      name: 'Dialogue tests: ' + skill.entry.name,
      scope: request.scope,
      skillId: skill.entry.id,
      skillName: skill.entry.name,
      sourceCwd: cwd,
      modelProfileId: request.modelProfileId,
      invocation: 'explicit',
      permissionMode: 'yolo',
      useMcp: false,
      timeoutSeconds: 1800,
      maxTurns: 60,
      maxToolCalls: 150,
      cases: []
    }
    return this.prepare(owner, 'plan', async (signal) => {
      const env = await this.options.environment(suite)
      if (signal.aborted) throw Error('Planning cancelled')
      const pkg = new SkillPackage(dirname(skill.entry.path)),
        context: { path: string; text: string }[] = [
          { path: 'SKILL.md', text: skill.raw.slice(0, 16000) }
        ]
      let bytes = context[0].text.length
      for (const node of pkg.tree().files) {
        if (bytes >= 30000 || context.length >= 16) break
        if (
          node.kind !== 'file' ||
          !node.editable ||
          node.path === 'SKILL.md' ||
          !/\.(md|py|mjs|js|ts|json|yaml|yml|sh)$/i.test(node.path) ||
          /credential|secret|token|password|\.env/i.test(node.path)
        )
          continue
        try {
          const text = pkg.read(node.path).text.slice(0, Math.min(2400, 30000 - bytes))
          context.push({ path: node.path, text })
          bytes += text.length
        } catch {}
      }
      const text = await new SkillTestRoles(this.options.launch).ask(
        'planner',
        { goal: request.goal, language: request.language, skillContext: context },
        env,
        this.store.directory,
        signal
      )
      const cases = plannedCases(text, request.mode)
      return { ...suite, id: null, revision: null, cases }
    })
  }
  import(file: string, cwd: string | null): SkillTestSuite | null {
    if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 2_000_000)
      throw Error('Choose a suite JSON file up to 2 MB')
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!record(data) || data.version !== 1 || typeof data.skillName !== 'string')
      throw Error('Suite JSON needs skillName and scenario definitions')
    const scope = data.scope === 'project' && cwd ? 'project' : 'user',
      entry = this.options.skills.list(scope, cwd).entries.find((s) => s.name === data.skillName)
    if (!entry) throw Error('Import the matching skill before importing its scenarios')
    return this.save(
      { ...data, id: null, revision: null, scope, skillId: entry.id, modelProfileId: null },
      cwd
    )
  }
  suiteJSON(id: string): string {
    const suite = this.store.get(id)
    return (
      JSON.stringify(
        {
          ...suite,
          version: 1,
          id: null,
          revision: null,
          sourceCwd: undefined,
          skillId: undefined,
          modelProfileId: null
        },
        null,
        2
      ) + '\n'
    )
  }
  reportHTML(id: string, language: UiLanguage): string {
    return skillTestReportHTML(this.store.run(id), language)
  }
  reportJSON(id: string): string {
    return JSON.stringify(this.store.run(id), null, 2) + '\n'
  }
  builtin(): SkillDocument {
    const name = 'skill-creator',
      existing = this.options.skills.list('user', null).entries.find((s) => s.name === name)
    if (existing) return this.options.skills.get('user', existing.id, null)
    return this.options.skills.importDirectory(
      'user',
      join(this.options.resources, 'skills', 'skill-creator'),
      null
    )
  }
  async creator(owner: number, value: unknown, cwd: string | null): Promise<SkillTestBatch> {
    if (
      !record(value) ||
      typeof value.name !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name) ||
      typeof value.description !== 'string' ||
      !value.description.trim() ||
      value.description.length > 20000 ||
      !['user', 'project'].includes(String(value.scope)) ||
      (value.modelProfileId !== null && typeof value.modelProfileId !== 'string') ||
      typeof value.timeoutSeconds !== 'number' ||
      !Number.isInteger(value.timeoutSeconds) ||
      value.timeoutSeconds < 15 ||
      value.timeoutSeconds > 900
    )
      throw Error('Specify a skill name, requirements and time limit')
    const request = value as unknown as CreatorRequest
    if (request.scope === 'project' && !cwd) throw Error('Select a project folder first')
    const skill = this.builtin(),
      prompt = `Create a complete reusable skill named ${request.name}. The user requirements are:\n${request.description}\n\nWrite the package into ${request.name}/, including SKILL.md and useful scripts/references/assets. Do not install anything into the real home or project. Use Qwen Desktop's installed Node where appropriate; do not require Claude CLI. Create evals/suite.json inside the generated package using the Desktop test suite format from references/qwen-desktop.md. Include realistic input fixtures and objective file/JSON checks. All output paths must be relative to the scenario workspace. Finish by summarizing the generated files and any prerequisites.`
    const suite: SkillTestSuite = {
      id: 'creator',
      revision: '',
      name: `Create ${request.name}`,
      scope: request.scope,
      skillId: skill.entry.id,
      skillName: 'skill-creator',
      sourceCwd: cwd,
      modelProfileId: request.modelProfileId,
      invocation: 'explicit',
      permissionMode: 'auto-edit',
      useMcp: false,
      timeoutSeconds: request.timeoutSeconds,
      maxTurns: 50,
      maxToolCalls: 100,
      cases: [
        {
          id: 'create',
          name: request.name,
          prompt,
          files: [],
          checks: [
            { kind: 'skill-valid', path: request.name + '/SKILL.md' },
            { kind: 'test-suite-valid', path: request.name + '/evals/suite.json' }
          ]
        }
      ]
    }
    return this.prepare(owner, 'launch', async (signal) => {
      const env = await this.options.environment(suite)
      if (signal.aborted) throw Error('Creator cancelled')
      return this.runner.start(owner, suite, skill, env, 'creator', request.name)
    })
  }
  installCreated(id: string): SkillDocument {
    const batch = this.store.run(id)
    if (
      batch.purpose !== 'creator' ||
      batch.status !== 'done' ||
      !batch.creatorName ||
      !batch.cases.some((c) => c.status === 'passed')
    )
      throw Error('A successful creator run is required before installation')
    const workspace = this.runner.workspace(id, 'create'),
      source = join(workspace, batch.creatorName)
    // Validate every supplied path and never follow a generated symlink.
    if (!existsSync(source) || lstatSync(source).isSymbolicLink())
      throw Error('Generated skill folder is unavailable')
    return this.options.skills.importDirectory(batch.scope, source, batch.sourceCwd)
  }
  exportFile(path: string, text: string): void {
    writeFileSync(path, text, { mode: 0o600 })
  }
  removeRun(id: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid test run ID')
    if (this.runner.activeId === id) throw Error('Cancel the active run before removing it')
    const report = join(this.store.directory, id + '.json'),
      backup = report + '.bak'
    if (!existsSync(report) && !existsSync(backup)) throw Error('Test report not found')
    const parent = join(this.store.directory, 'workspaces'),
      workspace = join(parent, id)
    for (const path of [parent, workspace])
      if (existsSync(path) && lstatSync(path).isSymbolicLink())
        throw Error('Test workspace is redirected; deletion refused')
    rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    rmSync(report, { force: true })
    rmSync(backup, { force: true })
    this.options.changed(this.runner.activeId ?? id, this.busy)
  }
  clearHistory(): void {
    if (this.busy) throw Error('Finish or cancel the active Lab operation before clearing history')
    const ids = new Set(
      readdirSync(this.store.directory)
        .filter((n) => /^[a-f0-9-]{36}\.json(?:\.bak)?$/.test(n))
        .map((n) => n.slice(0, 36))
    )
    for (const id of ids) this.removeRun(id)
  }
}
