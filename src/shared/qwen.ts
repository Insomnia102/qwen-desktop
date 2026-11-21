export type Reply<T = undefined> = { ok: true; value: T } | { ok: false; error: string }
export type PermissionDecision = 'allow-once' | 'allow-session' | 'deny'
export type TurnStatus = 'running' | 'done' | 'stopped' | 'error' | 'interrupted'
export interface SavedTurn {
  requestId: string
  prompt: string
  startedAt: string
  finishedAt?: string
  status: TurnStatus
  events: QwenEvent[]
}
export interface Workdir {
  id: string
  path: string
  name: string
  lastChatId: string | null
  closed?: boolean
}
export interface ChatSummary {
  id: string
  workdirId: string
  title: string
  customTitle?: boolean
  createdAt: string
  updatedAt: string
  status: TurnStatus | 'empty'
}
export interface SavedChat extends ChatSummary {
  sessionId: string | null
  turns: SavedTurn[]
}
export interface WorkspaceIndex {
  version: 1
  workdirs: Workdir[]
  chats: ChatSummary[]
  activeChatId: string | null
}
export interface WorkspaceView {
  index: WorkspaceIndex
  chat: SavedChat | null
  warnings: string[]
  allowAll: boolean
  mode: ApprovalMode
  modeOverride: boolean
  modelProfileId?: string | null
  skillTestsRunning?:boolean
  modelLabel?: string
}

export type QwenEvent = { requestId: string } & (
  | { type: 'text'; messageId: string; text: string }
  | { type: 'final'; messageId: string; text: string }
  | { type: 'thinking'; messageId: string; text: string; state: 'streaming' | 'done' }
  | { type: 'tool'; toolId: string; name: string; state: 'running' | 'done' | 'error'; input?: unknown; output?: string }
  | { type: 'permission'; permissionId: string; tool: string; details: string }
  | { type: 'permission-closed'; permissionId: string; allowed: boolean; decision?: PermissionDecision }
  | { type: 'approval-mode'; allowAll: boolean; mode?: ApprovalMode }
  | { type: 'warning' | 'error'; text: string }
  | { type: 'storage-error'; text: string }
  | { type:'runtime-progress'; phase:import('./desktop').RuntimePhase }
  | { type: 'done'; cancelled: boolean; allowAll?: boolean; mode?: ApprovalMode }
)

export interface QwenAPI {
  planSkillTests(request:import('./skill-tests').PlanSkillTestsRequest):Promise<Reply<import('./skill-tests').SkillTestSuiteInput>>
  replySkillTest(id:string,text:string|null):Promise<Reply>
  getSkillTests():Promise<Reply<import('./skill-tests').SkillTestsView>>
  saveSkillTestSuite(input:import('./skill-tests').SkillTestSuiteInput):Promise<Reply<import('./skill-tests').SkillTestSuite>>
  deleteSkillTestSuite(id:string,revision:string):Promise<Reply>
  runSkillTestSuite(id:string,caseIds?:string[]):Promise<Reply<import('./skill-tests').SkillTestBatch>>
  deleteSkillTestRun(id:string):Promise<Reply>
  clearSkillTestHistory():Promise<Reply>
  getSkillTestRun(id:string):Promise<Reply<import('./skill-tests').SkillTestBatch>>
  cancelSkillTests():Promise<Reply>
  approveSkillTest(id:string,decision:'allow-once'|'allow-run'|'deny'):Promise<Reply>
  getSkillTestArtifact(batchId:string,caseId:string,path:string):Promise<Reply<import('./skill-tests').TestArtifact>>
  revealSkillTestRun(batchId:string,caseId:string):Promise<Reply>
  importSkillTestSuite():Promise<Reply<import('./skill-tests').SkillTestSuite|null>>
  exportSkillTestSuite(id:string):Promise<Reply>
  exportSkillTestRun(id:string,format?:'html'|'json'):Promise<Reply>
  runSkillCreator(request:import('./skill-tests').CreatorRequest):Promise<Reply<import('./skill-tests').SkillTestBatch>>
  installCreatedSkill(batchId:string):Promise<Reply<SkillDocument>>
  onSkillTestEvent(callback:(event:import('./skill-tests').SkillTestEvent)=>void):()=>void

  prepareRuntime():Promise<Reply<ConnectionState>>
  cancelRuntime():Promise<Reply>
  getConnectionState():Promise<Reply<ConnectionState>>
  setUiLanguage(language:UiLanguage):Promise<Reply<DesktopPreferences>>
  completeOnboarding(profileId:string|null,skip:boolean):Promise<Reply<ConnectionState>>
  testConnection(profileId:string|null):Promise<Reply<ConnectionTestResult>>
  cancelConnectionTest():Promise<Reply>
  load(): Promise<Reply<WorkspaceView>>
  selectFolder(): Promise<Reply<WorkspaceView | null>>
  selectChat(chatId: string): Promise<Reply<WorkspaceView>>
  selectWorkdir(workdirId: string): Promise<Reply<WorkspaceView>>
  closeWorkdir(workdirId: string): Promise<Reply<WorkspaceView>>
  renameChat(chatId: string, title: string): Promise<Reply<WorkspaceView>>
  deleteChat(chatId: string): Promise<Reply<WorkspaceView>>
  setMode(mode: ApprovalMode | null): Promise<Reply<WorkspaceView>>
  getSettings(scope: 'user' | 'project'): Promise<Reply<SettingsView>>
  saveSettings(request: SettingsSaveRequest): Promise<Reply<{ settings: SettingsView; workspace: WorkspaceView }>>
  getCoreTools(scope: 'user' | 'project'): Promise<Reply<CoreToolsView>>
  saveCoreTools(request: CoreToolsSaveRequest): Promise<Reply<CoreToolsView>>
  getMcp(scope: 'user' | 'project'): Promise<Reply<McpView>>
  mutateMcp(request: McpMutation): Promise<Reply<McpView>>
  probeMcp(request: McpProbeRequest): Promise<Reply<McpProbeResult>>
  cancelMcpProbe(): Promise<Reply>
  setTheme(theme: 'dark' | 'light' | 'system'): Promise<Reply>
  getStudio(scope: 'user'|'project'): Promise<Reply<StudioView>>
  saveModel(request: ModelSaveRequest): Promise<Reply<StudioView>>
  deleteModel(id: string, revision: string): Promise<Reply<StudioView>>
  selectModel(id: string | null): Promise<Reply<WorkspaceView>>
  savePrompt(request: PromptSaveRequest): Promise<Reply<StudioView>>
  getCommands(): Promise<Reply<SlashCommand[]>>
  getSkills(scope: 'user'|'project'): Promise<Reply<SkillsView>>
  getSkill(scope: 'user'|'project', id: string): Promise<Reply<SkillDocument>>
  saveSkill(request: SkillSaveRequest): Promise<Reply<SkillDocument>>
  saveRawSkill(scope:'user'|'project',id:string,revision:string,raw:string):Promise<Reply<SkillDocument>>
  toggleSkill(scope: 'user'|'project', id: string, enabled: boolean, revision: string): Promise<Reply<SkillsView>>
  deleteSkill(scope: 'user'|'project', id: string, revision: string): Promise<Reply<SkillsView>>
  importSkill(scope: 'user'|'project'): Promise<Reply<SkillDocument|null>>
  getSkillDirectory(scope:'user'|'project',id:string,path:string,offset:number):Promise<Reply<import('./studio').SkillDirectoryPage>>
  getSkillFile(scope: 'user'|'project', id: string, path: string): Promise<Reply<SkillFile>>
  inspectSkillFile(scope: 'user'|'project', id: string, path: string): Promise<Reply<SkillAsset>>
  changeSkillPath(scope: 'user'|'project', id: string, request: SkillPathChange): Promise<Reply<SkillDocument>>
  importSkillFile(scope: 'user'|'project', id: string, directory: string, revision: string): Promise<Reply<SkillDocument|null>>
  saveSkillFile(scope: 'user'|'project', id: string, file: SkillFile): Promise<Reply<SkillFile>>
  start(request: { requestId: string; prompt: string }): Promise<Reply>
  cancel(): Promise<Reply>
  newChat(): Promise<Reply<WorkspaceView>>
  approve(permissionId: string, decision: PermissionDecision): Promise<Reply>
  onEvent(callback: (event: QwenEvent) => void): () => void
}
import type { ApprovalMode, SettingsSaveRequest, SettingsView } from './settings'
import type { CoreToolsSaveRequest, CoreToolsView } from './core-tools'
import type { McpMutation, McpView, McpProbeRequest, McpProbeResult } from './mcp'
import type { StudioView, ModelSaveRequest, PromptSaveRequest, SlashCommand, SkillsView, SkillDocument, SkillSaveRequest, SkillFile, SkillAsset, SkillPathChange } from './studio'

import type {ConnectionState,ConnectionTestResult,DesktopPreferences,UiLanguage} from './desktop'
