// SPDX-License-Identifier: GPL-3.0-only
export type TestCheckKind =
  | 'file-exists'
  | 'file-absent'
  | 'file-contains'
  | 'file-equals'
  | 'json-equals'
  | 'answer-contains'
  | 'tool-used'
  | 'skill-used'
  | 'skill-valid'
  | 'test-suite-valid'
export interface TestCheck {
  kind: TestCheckKind
  path?: string
  pointer?: string
  value?: unknown
}
export interface TestFixture {
  path: string
  text: string
}
export interface SkillTestCase {
  id: string
  name: string
  prompt: string
  files: TestFixture[]
  checks: TestCheck[]
  dialogue?: TestDialogue
}
export interface SkillTestSuite {
  id: string
  name: string
  scope: 'user' | 'project'
  skillId: string
  skillName: string
  sourceCwd: string | null
  modelProfileId: string | null
  invocation: 'explicit' | 'auto'
  permissionMode: 'default' | 'auto-edit' | 'yolo'
  useMcp: boolean
  timeoutSeconds: number
  maxTurns: number
  maxToolCalls: number
  cases: SkillTestCase[]
  revision: string
}
export type SkillTestSuiteInput = Omit<
  SkillTestSuite,
  'id' | 'revision' | 'sourceCwd' | 'skillName'
> & { id: string | null; revision: string | null }
export type TestCaseStatus =
  'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled' | 'interrupted' | 'review'
export interface TestCheckResult {
  check: TestCheck
  passed: boolean
  detail: string
}
export interface TestTrace {
  at: string
  type: 'text' | 'thinking' | 'tool' | 'warning' | 'error' | 'permission'
  name?: string
  text: string
}
export interface SkillTestCaseResult {
  id: string
  name: string
  status: TestCaseStatus
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  answer: string
  checks: TestCheckResult[]
  trace: TestTrace[]
  artifacts: string[]
  error?: string
  nativeSessionId?:string
  budget?:{modelTurns:number;toolCalls:number;maxModelTurns:number;maxToolCalls:number}
  tokens?: number
  dialogue?: DialogueMessage[]
  evidence?: TestEvidence[]
  assessments?: TestAssessment[]
  phase?: 'agent' | 'waiting-user' | 'actor' | 'evaluating'
  stopReason?: string
  evidenceTruncated?: boolean
}
export interface SkillTestBatch {
  id: string
  suiteId: string | null
  name: string
  purpose: 'test' | 'creator'
  skillName: string
  skillRevision: string
  suiteSnapshot?: SkillTestSuite
  status: 'running' | 'done' | 'cancelled' | 'error' | 'interrupted'
  createdAt: string
  finishedAt?: string
  modelLabel: string
  cases: SkillTestCaseResult[]
  sourceCwd: string | null
  scope: 'user' | 'project'
  creatorName?: string
}
export interface TestPermission {
  id: string
  batchId: string
  caseId: string
  tool: string
  details: string
}
export interface SkillTestsView {
  suites: SkillTestSuite[]
  runs: SkillTestBatch[]
  activeBatchId: string | null
  permissions: TestPermission[]
  inputs?: TestDialogueInput[]
  planning?: boolean
}
export interface SkillTestEvent {
  type: 'changed'
  batchId: string
  active: boolean
}
export interface CreatorRequest {
  name: string
  description: string
  scope: 'user' | 'project'
  modelProfileId: string | null
  timeoutSeconds: number
}
export interface TestArtifact {
  path: string
  text: string
}

export interface TestDialogue {
  mode: 'manual' | 'ai'
  persona: string
  criteria: string[]
  maxMessages: number
  replyTimeoutSeconds: number
}
export interface DialogueMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  source: 'human' | 'actor' | 'agent' | 'initial'
}
export interface TestEvidence {
  id: string
  kind: 'message' | 'tool'
  text: string
}
export interface TestAssessment {
  criterion: string
  status: 'passed' | 'failed' | 'uncertain'
  reason: string
  evidenceIds: string[]
}
export interface TestDialogueInput {
  id: string
  batchId: string
  caseId: string
  reason: string
}
export interface PlanSkillTestsRequest {
  scope: 'user' | 'project'
  skillId: string
  modelProfileId: string | null
  goal: string
  mode: 'manual' | 'ai'
  language: string
}
export interface TestActorDecision {
  action: 'reply' | 'finish' | 'needs-human'
  text: string
  delaySeconds: number
}
