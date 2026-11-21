// SPDX-License-Identifier: GPL-3.0-only
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  opendirSync,
  copyFileSync,
  rmSync
} from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { query, CanUseTool, SDKMessage } from '@qwen-code/sdk'
import type { McpConfig } from '../shared/mcp'
import type { SkillDocument } from '../shared/studio'
import type {
  SkillTestBatch,
  SkillTestSuite,
  SkillTestCase,
  TestCheckResult,
  TestPermission,
  TestArtifact,
  TestDialogueInput
} from '../shared/skill-tests'
import { SkillPackage } from './skill-package'
import { parseSkill } from './skills-store'
import { SkillTestsStore, testPath, suiteDefinition, record } from './skill-tests-store'
import { SkillTestInput } from './skill-test-input'
import { SkillTestRoles } from './skill-test-roles'
import { Transcript } from './transcript'
import { waitFor, closeSession } from './async-lifecycle'
export interface TestEnvironment {
  bootstrap: string
  cli: string
  model?: string
  authType?: 'openai' | 'anthropic' | 'gemini'
  env: Record<string, string>
  settings: Record<string, unknown>
  oauthFile?: string
  systemPrompt: string | { type: 'preset'; preset: 'qwen_code'; append: string }
  disabledTools: string[]
  mcpServers: Record<string, McpConfig>
  modelLabel: string
}
function safeFile(root: string, path: string): string {
  path = testPath(path)
  const target = resolve(root, path)
  if (!target.startsWith(resolve(root) + sep))
    throw Error('Artifact is outside the scenario directory')
  let cursor = root
  for (const part of path.split('/')) {
    cursor = join(cursor, part)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw Error('Symbolic links are not read by the test checker')
  }
  return target
}
function contents(root: string, path: string): string {
  const file = safeFile(root, path),
    st = lstatSync(file)
  if (!st.isFile() || st.size > 512000) throw Error('Expected a regular file up to 512 KB')
  return readFileSync(file, 'utf8')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
export function evaluateScenario(
  scenario: SkillTestCase,
  workspace: string,
  answer: string,
  tools: Set<string>,
  skillUsed: boolean
): TestCheckResult[] {
  return scenario.checks.map((check) => {
    try {
      let passed = false,
        detail = ''
      if (check.kind === 'file-exists' || check.kind === 'file-absent') {
        const file = safeFile(workspace, check.path!),
          present = existsSync(file) && lstatSync(file).isFile()
        passed = check.kind === 'file-exists' ? present : !present
        detail = present ? 'File exists' : 'File absent'
      } else if (check.kind === 'file-contains' || check.kind === 'file-equals') {
        const text = contents(workspace, check.path!)
        passed =
          check.kind === 'file-contains' ? text.includes(String(check.value)) : text === check.value
        detail = passed ? 'File check passed' : text.slice(0, 500)
      } else if (check.kind === 'json-equals') {
        let actual: unknown = JSON.parse(contents(workspace, check.path!))
        if (check.pointer)
          for (const part of check.pointer.slice(1).split('/')) {
            if (
              !actual ||
              typeof actual !== 'object' ||
              !Object.hasOwn(actual, part.replace(/~1/g, '/').replace(/~0/g, '~'))
            )
              throw Error('JSON Pointer not found')
            actual = (actual as Record<string, unknown>)[
              part.replace(/~1/g, '/').replace(/~0/g, '~')
            ]
          }
        passed = canonical(actual) === canonical(check.value)
        detail = JSON.stringify(actual).slice(0, 500)
      } else if (check.kind === 'skill-valid') {
        const parsed = parseSkill(contents(workspace, check.path!))
        passed = true
        detail = 'Valid SKILL.md: ' + parsed.meta.name
      } else if (check.kind === 'test-suite-valid') {
        const data: unknown = JSON.parse(contents(workspace, check.path!))
        if (
          !record(data) ||
          data.version !== 1 ||
          typeof data.skillName !== 'string' ||
          !data.skillName.trim()
        )
          throw Error('Expected a version 1 suite with skillName')
        const validated = suiteDefinition({
          ...data,
          id: null,
          revision: null,
          scope: 'user',
          skillId: 'generated',
          modelProfileId: null
        })
        passed = true
        detail = `Valid suite: ${validated.cases.length} scenarios`
      } else if (check.kind === 'answer-contains') {
        passed = answer.includes(String(check.value))
        detail = passed ? 'Answer contains expected text' : 'Expected answer text not found'
      } else if (check.kind === 'tool-used') {
        passed = tools.has(String(check.value))
        detail = passed ? 'Tool completed' : `Completed tools: ${[...tools].join(', ')}`
      } else if (check.kind === 'skill-used') {
        passed = skillUsed === check.value
        detail = skillUsed ? 'Skill was loaded' : 'No skill load was observed'
      }
      return { check, passed, detail }
    } catch (error) {
      return {
        check,
        passed: false,
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
function artifacts(root: string): string[] {
  const out: string[] = [],
    queue = ['']
  while (queue.length && out.length < 200) {
    const prefix = queue.shift()!,
      dir = opendirSync(join(root, prefix))
    try {
      for (let item = dir.readSync(); item && out.length < 200; item = dir.readSync()) {
        if (
          ['.qwen', '.git', 'node_modules', '.agents'].includes(item.name) ||
          item.isSymbolicLink()
        )
          continue
        const path = prefix ? prefix + '/' + item.name : item.name
        if (item.isDirectory() && path.split('/').length < 12) queue.push(path)
        else if (item.isFile()) out.push(path)
      }
    } finally {
      dir.closeSync()
    }
  }
  return out
}
export class SkillTestRunner {
  private active:
    | {
        owner: number
        batch: SkillTestBatch
        abort: AbortController
        allowAll: boolean
        pending: Map<string, { permission: TestPermission; finish: (allow: boolean) => void }>
        inputs: Map<string, { input: TestDialogueInput; finish: (text: string | null) => void }>
      }
    | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(
    readonly store: SkillTestsStore,
    private launch: typeof query,
    private changed: (batchId: string, active: boolean) => void
  ) {
    store.recover()
  }
  get running(): boolean {
    return Boolean(this.active)
  }
  get activeId(): string | null {
    return this.active?.batch.id ?? null
  }
  permissions(owner: number): TestPermission[] {
    return this.active?.owner === owner
      ? [...this.active.pending.values()].map((p) => p.permission)
      : []
  }
  inputs(owner: number): TestDialogueInput[] {
    return this.active?.owner === owner ? [...this.active.inputs.values()].map((v) => v.input) : []
  }
  reply(owner: number, id: string, text: string | null): void {
    const active = this.active,
      pending = active?.inputs.get(id)
    if (!active || active.owner !== owner || !pending || active.abort.signal.aborted)
      throw Error('Dialogue input is no longer active')
    if (text !== null && (typeof text !== 'string' || !text.trim() || text.length > 8000))
      throw Error('Reply must contain 1–8000 characters')
    pending.finish(text)
  }
  cancel(owner?: number): void {
    if (!this.active || (owner !== undefined && this.active.owner !== owner)) return
    this.active.abort.abort()
    for (const p of [...this.active.pending.values()]) p.finish(false)
  }
  approve(owner: number, id: string, decision: 'allow-once' | 'allow-run' | 'deny'): void {
    const active = this.active
    if (!active || active.owner !== owner || active.abort.signal.aborted)
      throw Error('Test permission is no longer active')
    const pending = active.pending.get(id)
    if (!pending) throw Error('Test permission is no longer active')
    if (decision === 'allow-run') {
      active.allowAll = true
      for (const p of [...active.pending.values()]) p.finish(true)
    } else pending.finish(decision === 'allow-once')
  }
  private publish(force = false): void {
    if (!this.active) return
    const active = this.active
    const flush = (): void => {
      this.timer = undefined
      try {
        this.store.saveRun(active.batch)
      } catch (error) {
        active.abort.abort()
        console.error('Could not persist skill test report', error)
      }
      this.changed(active.batch.id, true)
    }
    if (force) {
      clearTimeout(this.timer)
      flush()
    } else if (!this.timer) this.timer = setTimeout(flush, 250)
  }
  start(
    owner: number,
    suite: SkillTestSuite,
    skill: SkillDocument,
    environment: TestEnvironment,
    purpose: 'test' | 'creator' = 'test',
    creatorName?: string
  ): SkillTestBatch {
    if (this.active) throw Error('A skill test run is already active')
    if (!skill.entry.enabled) throw Error('Enable this skill before testing it')
    const batch: SkillTestBatch = {
      id: randomUUID(),
      suiteId: purpose === 'test' ? suite.id : null,
      name: suite.name,
      purpose,
      skillName: skill.entry.name,
      skillRevision: skill.entry.revision + ':' + skill.treeRevision,
      suiteSnapshot: suite,
      status: 'running',
      createdAt: new Date().toISOString(),
      modelLabel: environment.modelLabel,
      scope: suite.scope,
      sourceCwd: suite.sourceCwd,
      ...(creatorName ? { creatorName } : {}),
      cases: suite.cases.map((c) => ({
        id: c.id,
        name: c.name,
        status: 'queued',
        answer: '',
        checks: [],
        trace: [],
        artifacts: []
      }))
    }
    this.store.saveRun(batch)
    this.active = {
      owner,
      batch,
      abort: new AbortController(),
      allowAll: suite.permissionMode === 'yolo',
      pending: new Map(),
      inputs: new Map()
    }
    this.changed(batch.id, true)
    // Leave the IPC response available before preparation begins.
    setTimeout(() => {
      void this.execute(suite, skill, environment).catch((error) =>
        console.error('Skill test runner cleanup failed', error)
      )
    }, 0)
    return structuredClone(batch)
  }
  private async execute(
    suite: SkillTestSuite,
    skill: SkillDocument,
    env: TestEnvironment
  ): Promise<void> {
    const active = this.active!
    const secrets = Object.entries(env.env)
      .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v.length > 5)
      .map(([, v]) => v)
    const collect = (v: unknown, key = ''): void => {
      if (
        typeof v === 'string' &&
        /api.?key|token|secret|password|authorization/i.test(key) &&
        v.length > 5
      )
        secrets.push(v)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collect(x, k)
    }
    collect(env.settings)
    collect(env.mcpServers)
    const clean = (v: string): string => {
      for (const secret of secrets) v = v.split(secret).join('[redacted]')
      return v
    }
    const snapshot = join(this.store.directory, 'workspaces', active.batch.id, '.skill-snapshot')
    try {
      if (active.abort.signal.aborted) {
        active.batch.status = 'cancelled'
        for (const c of active.batch.cases) c.status = 'cancelled'
        return
      }
      SkillPackage.copy(dirname(skill.entry.path), snapshot)
      if (readFileSync(join(snapshot, 'SKILL.md'), 'utf8') !== skill.raw)
        throw Error('Skill changed before its snapshot was prepared; run again')
      for (let index = 0; index < suite.cases.length; index++) {
        const scenario = suite.cases[index],
          result = active.batch.cases[index]
        if (active.abort.signal.aborted) {
          result.status = 'cancelled'
          continue
        }
        const base = this.store.runDirectory(active.batch.id, scenario.id),
          workspace = join(base, 'workspace'),
          home = join(base, 'home'),
          abort = new AbortController()
        let session: ReturnType<typeof query> | undefined,
          input: SkillTestInput | undefined,
          iterator: AsyncIterator<SDKMessage> | undefined,
          timedOut = false
        const started = Date.now(),
          cancel = (): void => abort.abort()
        active.abort.signal.addEventListener('abort', cancel, { once: true })
        result.status = 'running'
        result.startedAt = new Date().toISOString()
        this.publish(true)
        let budget = suite.timeoutSeconds * 1000,
          budgetStart = Date.now(),
          deadline: ReturnType<typeof setTimeout> | undefined
        const pauseBudget = (): void => {
          if (deadline) {
            clearTimeout(deadline)
            deadline = undefined
            budget -= Date.now() - budgetStart
          }
        }
        const resumeBudget = (): void => {
          budgetStart = Date.now()
          deadline = setTimeout(
            () => {
              timedOut = true
              abort.abort()
            },
            Math.max(1, budget)
          )
        }
        resumeBudget()
        try {
          mkdirSync(workspace, { recursive: true })
          mkdirSync(home, { recursive: true, mode: 0o700 })
          SkillPackage.copy(snapshot, join(workspace, '.qwen/skills/under-test'))
          writeFileSync(
            join(home, 'settings.json'),
            JSON.stringify({
              ...env.settings,
              mcpServers: {},
              hooks: {},
              memory: {
                enableManagedAutoMemory: false,
                enableManagedAutoDream: false,
                enableAutoSkill: false
              }
            }),
            { mode: 0o600 }
          )
          if (env.oauthFile && existsSync(env.oauthFile))
            copyFileSync(env.oauthFile, join(home, 'oauth_creds.json'))
          for (const fixture of scenario.files) {
            const file = safeFile(workspace, fixture.path)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, fixture.text, { flag: 'wx', mode: 0o600 })
          }
          if (scenario.dialogue) {
            result.dialogue = []
            result.evidence = []
          }
          let used = suite.invocation === 'explicit',
            gotResult = false,
            successful = false
          const sessionId = randomUUID()
          result.nativeSessionId = sessionId
          let exchanges = 0,
            agentSteps = 0,
            toolCalls = 0,
            incomplete = false
          const seenCalls = new Set<string>(),
            roles = new SkillTestRoles(this.launch)
          const evidence = (kind: 'message' | 'tool', text: string): void => {
            if (!result.evidence) return
            if (result.evidence.length >= 200) {
              result.evidenceTruncated = true
              return
            }
            if (text.length > 2000) result.evidenceTruncated = true
            result.evidence.push({
              id: 'e' + (result.evidence.length + 1),
              kind,
              text: clean(text).slice(0, 2000)
            })
          }
          const message = (
            role: 'user' | 'assistant',
            text: string,
            source: 'human' | 'actor' | 'agent' | 'initial'
          ): void => {
            if (!result.dialogue) return
            if (text.length > 8000) result.evidenceTruncated = true
            result.dialogue.push({
              id: randomUUID(),
              role,
              text: clean(text).slice(0, 8000),
              source,
              at: new Date().toISOString()
            })
            evidence('message', role + ': ' + text)
            this.publish(true)
          }
          const human = async (reason: string): Promise<string | null> => {
            pauseBudget()
            result.phase = 'waiting-user'
            const id = randomUUID(),
              input: TestDialogueInput = {
                id,
                batchId: active.batch.id,
                caseId: scenario.id,
                reason: clean(reason)
              }
            try {
              return await new Promise<string | null>((resolve, reject) => {
                let timer: ReturnType<typeof setTimeout>,
                  expired = false
                const finish = (text: string | null): void => {
                  if (!active.inputs.has(id)) return
                  active.inputs.delete(id)
                  clearTimeout(timer)
                  abort.signal.removeEventListener('abort', cancel)
                  this.changed(active.batch.id, true)
                  resolve(text)
                }
                const cancel = (): void => {
                  if (!active.inputs.has(id)) return
                  active.inputs.delete(id)
                  clearTimeout(timer)
                  abort.signal.removeEventListener('abort', cancel)
                  reject(
                    Error(expired ? 'Timed out waiting for a manual reply' : 'Dialogue cancelled')
                  )
                }
                active.inputs.set(id, { input, finish })
                timer = setTimeout(
                  () => {
                    expired = true
                    abort.abort()
                  },
                  (scenario.dialogue?.replyTimeoutSeconds ?? 1800) * 1000
                )
                abort.signal.addEventListener('abort', cancel, { once: true })
                this.publish(true)
                if (abort.signal.aborted) cancel()
              })
            } finally {
              resumeBudget()
            }
          }
          const tools = new Set<string>(),
            toolInputs = new Map<string, unknown>()
          const trace = (
            type: 'text' | 'thinking' | 'tool' | 'warning' | 'error' | 'permission',
            text: string,
            name?: string
          ): void => {
            if (result.trace.length >= 120) result.trace.shift()
            result.trace.push({
              at: new Date().toISOString(),
              type,
              text: clean(text).slice(0, 800),
              ...(name ? { name } : {})
            })
            this.publish()
          }
          const canUseTool: CanUseTool = async (tool, input, context) => {
            if (active.abort.signal.aborted || abort.signal.aborted || context.signal.aborted)
              return { behavior: 'deny', message: 'Test cancelled' }
            if (active.allowAll) return { behavior: 'allow', updatedInput: input }
            const id = randomUUID(),
              permission: TestPermission = {
                id,
                batchId: active.batch.id,
                caseId: scenario.id,
                tool,
                details: clean(JSON.stringify(input, null, 2)).slice(0, 8000)
              }
            const allow = await new Promise<boolean>((resolve) => {
              const finish = (value: boolean): void => {
                if (!active.pending.has(id)) return
                active.pending.delete(id)
                abort.signal.removeEventListener('abort', stop)
                context.signal.removeEventListener('abort', stop)
                this.changed(active.batch.id, true)
                resolve(value)
              }
              const stop = (): void => finish(false)
              active.pending.set(id, { permission, finish })
              abort.signal.addEventListener('abort', stop, { once: true })
              context.signal.addEventListener('abort', stop, { once: true })
              trace('permission', permission.details, tool)
              this.publish(true)
              if (abort.signal.aborted || context.signal.aborted) stop()
            })
            return allow && !abort.signal.aborted
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'Not approved for this test run' }
          }
          const transcript = new Transcript(randomUUID(), (event) => {
            if (event.type === 'text' || event.type === 'final') {
              result.answer = clean(event.text).slice(0, 100000)
              if (event.type === 'final') trace('text', event.text)
            }
            if (event.type === 'thinking' && event.state === 'done') trace('thinking', event.text)
            if (event.type === 'tool') {
              if (event.input !== undefined) toolInputs.set(event.toolId, event.input)
              if (event.state === 'running' && !seenCalls.has(event.toolId)) {
                seenCalls.add(event.toolId)
                toolCalls++
              }
              if (event.state === 'done' || event.state === 'error')
                evidence(
                  'tool',
                  JSON.stringify({
                    tool: event.name,
                    state: event.state,
                    input: event.input ?? toolInputs.get(event.toolId),
                    output: event.output ?? ''
                  })
                )
              if (event.state === 'done') {
                tools.add(event.name)
                const input = toolInputs.get(event.toolId) as Record<string, unknown> | undefined
                if (event.name === 'skill' && input?.skill === skill.entry.name) used = true
                if (
                  event.name === 'read_file' &&
                  String(input?.absolute_path ?? input?.file_path ?? input?.path ?? '')
                    .replace(/\\/g, '/')
                    .endsWith('/under-test/SKILL.md')
                )
                  used = true
              }
              trace(
                'tool',
                `${event.state}\n${JSON.stringify(event.input ?? toolInputs.get(event.toolId) ?? {})}\n${event.output ?? ''}`,
                event.name
              )
            }
            if (event.type === 'warning' || event.type === 'error') trace(event.type, event.text)
          })
          let prompt =
            suite.invocation === 'explicit'
              ? skill.entry.userInvocable
                ? `/${skill.entry.name} ${scenario.prompt}`
                : `Read .qwen/skills/under-test/SKILL.md and follow its instructions for this task:\n${scenario.prompt}`
              : scenario.prompt
          if (scenario.dialogue) input = new SkillTestInput(sessionId)
          message('user', scenario.prompt, 'initial')
          while (true) {
            result.phase = 'agent'
            gotResult = false
            successful = false
            result.answer = ''
            this.publish(true)
            if (input) input.send(prompt)
            if (!session) {
              session = this.launch({
                prompt: input ?? prompt,
                options: {
                  cwd: workspace,
                  sessionId,
                  pathToQwenExecutable: env.bootstrap,
                  ...(env.model ? { model: env.model, authType: env.authType } : {}),
                  env: {
                    ...env.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    FORK_MODE: '0',
                    NO_COLOR: '1',
                    FORCE_COLOR: '0',
                    QWEN_CODE_NO_RELAUNCH: 'true',
                    QWEN_DESKTOP_CLI_ENTRY: env.cli,
                    QWEN_HOME: home,
                    QWEN_USAGE_STATISTICS_ENABLED: 'false',
                    QWEN_TELEMETRY_ENABLED: 'false',
                    OTEL_SDK_DISABLED: 'true',
                    QWEN_CODE_MODELS_DEV_REFRESH: 'off'
                  },
                  permissionMode: suite.permissionMode,
                  canUseTool,
                  systemPrompt: env.systemPrompt,
                  excludeTools: [...new Set(['ask_user_question', ...env.disabledTools])],
                  mcpServers: env.mcpServers,
                  allowedMcpServerNames: Object.keys(env.mcpServers),
                  extensions: [],
                  abortController: abort,
                  maxSessionTurns: suite.maxTurns,
                  maxToolCalls: suite.maxToolCalls,
                  includePartialMessages: true,
                  timeout: { canUseTool: 300000 },
                  stderr: () => {},
                  logLevel: 'error'
                }
              })
              await waitFor(
                session.initialized,
                abort.signal,
                Math.min(45000, suite.timeoutSeconds * 1000),
                'Skill test initialization timed out'
              )
              iterator = session[Symbol.asyncIterator]()
            }
            let reportedTurns: number | undefined,
              streamStarts = 0,
              budgetReason = ''
            while (true) {
              const next = await waitFor(
                iterator!.next(),
                abort.signal,
                suite.timeoutSeconds * 1000,
                'Skill test timed out'
              )
              if (next.done) break
              const message = next.value
              if ('parent_tool_use_id' in message && message.parent_tool_use_id) continue
              transcript.accept(message)
              if (
                message.type === 'stream_event' &&
                message.event.type === 'message_start' &&
                !message.parent_tool_use_id
              )
                streamStarts++
              if (message.type === 'result') {
                gotResult = true
                if (scenario.dialogue && message.session_id && message.session_id !== sessionId)
                  throw Error('Unexpected dialogue session ID')
                if (
                  typeof message.num_turns === 'number' &&
                  Number.isInteger(message.num_turns) &&
                  message.num_turns >= 0
                )
                  reportedTurns = message.num_turns
                if (message.is_error && message.subtype === 'error_max_turns')
                  budgetReason = 'Достигнут лимит шагов модели'
                successful = !message.is_error
                if (message.is_error)
                  result.error = clean(message.error?.message ?? message.subtype)
                const usage = message.usage as unknown as Record<string, unknown> | undefined
                if (usage && typeof usage.total_tokens === 'number')
                  result.tokens = (result.tokens ?? 0) + usage.total_tokens
                if (scenario.dialogue) break
              }
            }
            if (scenario.dialogue) {
              agentSteps += reportedTurns ?? Math.max(1, streamStarts)
              result.budget = {
                modelTurns: agentSteps,
                toolCalls,
                maxModelTurns: suite.maxTurns,
                maxToolCalls: suite.maxToolCalls
              }
              if (agentSteps > suite.maxTurns) budgetReason = 'Достигнут лимит шагов модели'
              if (toolCalls > suite.maxToolCalls)
                budgetReason = 'Достигнут лимит вызовов инструментов'
            }
            if (!gotResult || (!successful && !budgetReason))
              throw Error(result.error ?? 'Qwen CLI did not return a successful result')
            if (!scenario.dialogue) break
            if (result.answer.trim()) message('assistant', result.answer, 'agent')
            if (budgetReason) {
              result.stopReason = budgetReason
              result.error = undefined
              incomplete = true
              break
            }
            exchanges++
            let reply: string | null,
              source: 'human' | 'actor' = 'human'
            if (scenario.dialogue.mode === 'manual') reply = await human('')
            else {
              result.phase = 'actor'
              this.publish(true)
              try {
                const decision = await roles.next(scenario, result, env, base, abort.signal)
                if (decision.action === 'finish') {
                  result.stopReason = clean(decision.text) || 'Test user finished the dialogue'
                  break
                }
                if (decision.action === 'needs-human') reply = await human(decision.text)
                else {
                  reply = decision.text
                  source = 'actor'
                  if (decision.delaySeconds)
                    await new Promise<void>((resolve, reject) => {
                      const cancel = (): void => {
                        clearTimeout(timer)
                        reject(Error('Dialogue cancelled'))
                      }
                      const timer = setTimeout(() => {
                        abort.signal.removeEventListener('abort', cancel)
                        resolve()
                      }, decision.delaySeconds * 1000)
                      abort.signal.addEventListener('abort', cancel, { once: true })
                      if (abort.signal.aborted) cancel()
                    })
                }
              } catch (error) {
                if (abort.signal.aborted) throw error
                reply = await human(
                  'AI test user needs help: ' +
                    (error instanceof Error ? error.message : String(error))
                )
              }
            }
            if (reply === null) {
              result.stopReason = 'Human finished the dialogue'
              break
            }
            if (exchanges >= scenario.dialogue.maxMessages) {
              result.stopReason = 'Dialogue message limit reached'
              incomplete = true
              break
            }
            message('user', reply, source)
            prompt = reply
          }
          input?.close()
          if (scenario.dialogue) {
            await closeSession(session)
            session = undefined
          }
          if (scenario.dialogue) {
            result.phase = 'evaluating'
            this.publish(true)
            try {
              result.assessments = (
                await roles.review(scenario, result, env, base, abort.signal)
              ).map((a) => ({ ...a, reason: clean(a.reason) }))
            } catch (error) {
              if (abort.signal.aborted) throw error
              result.assessments = scenario.dialogue.criteria.map((criterion) => ({
                criterion,
                status: 'uncertain' as const,
                reason: clean(error instanceof Error ? error.message : String(error)),
                evidenceIds: []
              }))
            }
          }
          result.checks = evaluateScenario(scenario, workspace, result.answer, tools, used).map(
            (r) => ({ ...r, detail: clean(r.detail) })
          )
          result.status =
            result.checks.some((c) => !c.passed) ||
            result.assessments?.some((a) => a.status === 'failed')
              ? 'failed'
              : incomplete || result.assessments?.some((a) => a.status === 'uncertain')
                ? 'review'
                : 'passed'
          result.phase = undefined
        } catch (error) {
          result.status = active.abort.signal.aborted ? 'cancelled' : 'error'
          result.error = timedOut
            ? 'Scenario timed out'
            : clean(error instanceof Error ? error.message : String(error)).slice(0, 2000)
        } finally {
          clearTimeout(deadline)
          input?.close()
          abort.abort()
          result.phase = undefined
          for (const p of [...active.pending.values()]) p.finish(false)
          await closeSession(session)
          active.abort.signal.removeEventListener('abort', cancel)
          rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
          try {
            result.artifacts = existsSync(workspace) ? artifacts(workspace) : []
          } catch {
            result.artifacts = []
            result.trace.push({
              at: new Date().toISOString(),
              type: 'warning',
              text: 'Some artifacts could not be listed'
            })
          }
          result.finishedAt = new Date().toISOString()
          result.durationMs = Date.now() - started
          this.publish(true)
        }
      }
      active.batch.status = active.abort.signal.aborted ? 'cancelled' : 'done'
    } catch (error) {
      active.batch.status = 'error'
      for (const c of active.batch.cases)
        if (c.status === 'queued' || c.status === 'running') {
          c.status = 'error'
          c.error = clean(error instanceof Error ? error.message : String(error))
        }
    } finally {
      clearTimeout(this.timer)
      this.timer = undefined
      active.batch.finishedAt = new Date().toISOString()
      try {
        this.store.saveRun(active.batch)
      } finally {
        this.active = undefined
        this.changed(active.batch.id, false)
      }
    }
  }
  artifact(batchId: string, caseId: string, path: string): TestArtifact {
    const batch = this.store.run(batchId)
    if (!batch.cases.some((c) => c.id === caseId)) throw Error('Scenario not found')
    return {
      path,
      text: contents(join(this.store.runDirectory(batchId, caseId), 'workspace'), path)
    }
  }
  workspace(batchId: string, caseId: string): string {
    const batch = this.store.run(batchId)
    if (!batch.cases.some((c) => c.id === caseId)) throw Error('Scenario not found')
    const root = join(this.store.runDirectory(batchId, caseId), 'workspace')
    if (
      !existsSync(root) ||
      relative(resolve(this.store.directory), realpathSync(root)).startsWith('..')
    )
      throw Error('Test workspace unavailable')
    return root
  }
}
