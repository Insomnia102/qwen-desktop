// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  readdirSync,
  realpathSync,
  lstatSync
} from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  SkillTestSuite,
  SkillTestSuiteInput,
  SkillTestCase,
  SkillTestBatch,
  TestCheck,
  TestFixture,
  TestDialogue
} from '../shared/skill-tests'
export const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)
export function testPath(path: unknown): string {
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 500 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[<>:"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
      )
  )
    throw Error('Use a safe relative file path')
  return path
}
function text(v: unknown, max: number, empty = false): string {
  if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()))
    throw Error('Invalid or empty text field')
  return v
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw Error(`Expected an integer from ${min} to ${max}`)
  return v
}
export function checkDefinition(value: unknown): TestCheck {
  if (
    !record(value) ||
    ![
      'file-exists',
      'file-absent',
      'file-contains',
      'file-equals',
      'json-equals',
      'answer-contains',
      'tool-used',
      'skill-used',
      'skill-valid',
      'test-suite-valid'
    ].includes(String(value.kind))
  )
    throw Error('Unknown test check')
  const kind = value.kind as TestCheck['kind'],
    check: TestCheck = { kind }
  if (
    kind.startsWith('file-') ||
    kind === 'json-equals' ||
    kind === 'skill-valid' ||
    kind === 'test-suite-valid'
  )
    check.path = testPath(value.path)
  if (['file-contains', 'file-equals', 'answer-contains', 'tool-used'].includes(kind))
    check.value = text(value.value, 50000, kind === 'file-equals')
  if (kind === 'skill-used') {
    if (typeof value.value !== 'boolean') throw Error('Skill check expects true or false')
    check.value = value.value
  }
  if (kind === 'json-equals') {
    check.pointer = text(value.pointer ?? '', 500, true)
    if (check.pointer !== '' && !check.pointer.startsWith('/'))
      throw Error('Use a JSON Pointer starting with /')
    if (value.value === undefined || JSON.stringify(value.value).length > 50000)
      throw Error('Invalid JSON expectation')
    check.value = structuredClone(value.value)
  }
  return check
}
export function dialogueDefinition(value: unknown): TestDialogue | undefined {
  if (value === undefined || value === null) return undefined
  if (
    !record(value) ||
    !['manual', 'ai'].includes(String(value.mode)) ||
    !Array.isArray(value.criteria) ||
    value.criteria.length < 1 ||
    value.criteria.length > 20
  )
    throw Error('Dialogue needs 1–20 requirements and a manual or AI mode')
  return {
    mode: value.mode as 'manual' | 'ai',
    persona: text(value.persona ?? '', 12000, true),
    criteria: value.criteria.map((v) => text(v, 1000)),
    maxMessages: integer(value.maxMessages ?? 32, 1, 40),
    replyTimeoutSeconds: integer(value.replyTimeoutSeconds ?? 1800, 30, 7200)
  }
}
export function casesDefinition(value: unknown): SkillTestCase[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20)
    throw Error('A suite needs 1–20 scenarios')
  let bytes = 0
  const ids = new Set<string>()
  return value.map((item) => {
    if (!record(item)) throw Error('Invalid scenario')
    const id =
      typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : randomUUID()
    if (ids.has(id)) throw Error('Duplicate scenario ID')
    ids.add(id)
    const dialogue = dialogueDefinition(item.dialogue)
    if (
      !Array.isArray(item.files) ||
      item.files.length > 40 ||
      !Array.isArray(item.checks) ||
      (!item.checks.length && !dialogue) ||
      item.checks.length > 100
    )
      throw Error('A scenario needs checks and at most 40 input files')
    const paths = new Set<string>(),
      files: TestFixture[] = item.files.map((file) => {
        if (!record(file)) throw Error('Invalid input file')
        const path = testPath(file.path),
          content = text(file.text, 200000, true)
        if (
          ['.qwen', '.agents', '.git', 'node_modules', '.mcp.json'].includes(path.split('/')[0]) ||
          paths.has(path)
        )
          throw Error('Duplicate or reserved input path')
        paths.add(path)
        bytes += Buffer.byteLength(content)
        if (bytes > 1_000_000) throw Error('Scenario inputs exceed 1 MB')
        return { path, text: content }
      })
    return {
      id,
      name: text(item.name, 160),
      prompt: text(item.prompt, 20000),
      files,
      checks: item.checks.map(checkDefinition),
      ...(dialogue ? { dialogue } : {})
    }
  })
}
export function suiteDefinition(value: unknown): SkillTestSuiteInput {
  if (
    !record(value) ||
    !['user', 'project'].includes(String(value.scope)) ||
    !['explicit', 'auto'].includes(String(value.invocation)) ||
    !['default', 'auto-edit', 'yolo'].includes(String(value.permissionMode))
  )
    throw Error('Invalid test suite settings')
  const id = value.id === null ? null : text(value.id, 80),
    revision = value.revision === null ? null : text(value.revision, 100)
  return {
    id,
    revision,
    name: text(value.name, 160),
    scope: value.scope as 'user' | 'project',
    skillId: text(value.skillId, 100),
    modelProfileId: value.modelProfileId === null ? null : text(value.modelProfileId, 100),
    invocation: value.invocation as 'explicit' | 'auto',
    permissionMode: value.permissionMode as 'default' | 'auto-edit' | 'yolo',
    useMcp: value.useMcp === true,
    timeoutSeconds: integer(value.timeoutSeconds, 15, 7200),
    maxTurns: integer(value.maxTurns, 1, 100),
    maxToolCalls: integer(value.maxToolCalls, 1, 200),
    cases: casesDefinition(value.cases)
  }
}
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')
export class SkillTestsStore {
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    // macOS temp paths can use /var -> /private/var aliases. Keep every
    // derived Lab workspace canonical before SkillPackage validates it.
    this.directory = realpathSync.native(directory)
  }
  private write(file: string, value: unknown): void {
    const temp = file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      if (existsSync(file)) copyFileSync(file, file + '.bak')
      renameSync(temp, file)
    } finally {
      if (existsSync(temp)) unlinkSync(temp)
    }
  }
  private suites(): SkillTestSuite[] {
    const file = join(this.directory, 'suites.json')
    if (!existsSync(file)) return []
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(data)) throw Error('Test suite storage is damaged; original file preserved')
    return data.map((item) => {
      if (
        !record(item) ||
        typeof item.skillName !== 'string' ||
        (item.sourceCwd !== null && typeof item.sourceCwd !== 'string') ||
        typeof item.revision !== 'string'
      )
        throw Error('Invalid saved test suite')
      const checked = suiteDefinition(item)
      return {
        ...checked,
        id: checked.id!,
        revision: item.revision,
        skillName: item.skillName,
        sourceCwd: item.sourceCwd as string | null
      }
    })
  }
  list(): SkillTestSuite[] {
    return structuredClone(this.suites())
  }
  get(id: string): SkillTestSuite {
    const suite = this.suites().find((s) => s.id === id)
    if (!suite) throw Error('Test suite not found')
    return suite
  }
  save(input: SkillTestSuiteInput, skillName: string, cwd: string | null): SkillTestSuite {
    const all = this.suites(),
      previous = input.id ? all.find((s) => s.id === input.id) : undefined
    if ((input.id && !previous) || (previous && input.revision !== previous.revision))
      throw Error('Test suite changed; reload before saving')
    if (!previous && all.length >= 100) throw Error('At most 100 test suites are allowed')
    const suite: SkillTestSuite = {
      ...input,
      id: previous?.id ?? randomUUID(),
      skillName,
      sourceCwd: cwd,
      revision: ''
    }
    suite.revision = hash({ ...suite, revision: undefined })
    this.write(
      join(this.directory, 'suites.json'),
      previous ? all.map((s) => (s.id === suite.id ? suite : s)) : [...all, suite]
    )
    return suite
  }
  remove(id: string, revision: string): void {
    const suite = this.get(id)
    if (suite.revision !== revision) throw Error('Test suite changed; reload before deleting')
    this.write(
      join(this.directory, 'suites.json'),
      this.suites().filter((s) => s.id !== id)
    )
  }
  saveRun(batch: SkillTestBatch): void {
    if (!/^[a-f0-9-]{36}$/.test(batch.id)) throw Error('Invalid test run ID')
    this.write(join(this.directory, batch.id + '.json'), batch)
  }
  runs(): SkillTestBatch[] {
    return readdirSync(this.directory)
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map((n) => {
        const path = join(this.directory, n)
        if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 64_000_000)
          throw Error('Invalid test report')
        const batch = JSON.parse(readFileSync(path, 'utf8')) as SkillTestBatch
        if (!batch || batch.id + '.json' !== n || !Array.isArray(batch.cases))
          throw Error('Test report is damaged')
        return batch
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  run(id: string): SkillTestBatch {
    const batch = this.runs().find((r) => r.id === id)
    if (!batch) throw Error('Test report not found')
    return batch
  }
  recover(): void {
    for (const batch of this.runs())
      if (batch.status === 'running') {
        batch.status = 'interrupted'
        batch.finishedAt = new Date().toISOString()
        for (const c of batch.cases)
          if (c.status === 'running' || c.status === 'queued') {
            c.status = 'interrupted'
            c.error = 'Application closed before this scenario completed'
          }
        this.saveRun(batch)
      }
  }
  runDirectory(id: string, caseId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(caseId))
      throw Error('Invalid run path')
    return join(this.directory, 'workspaces', id, caseId)
  }
}
