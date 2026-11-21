import {t} from './i18n'
import type { SettingsScope } from './settings'
export type PromptMode = 'append' | 'replace'
export interface PromptConfig { mode: PromptMode; text: string }
export type ModelProvider = 'openai' | 'anthropic' | 'gemini'
export type KeySource = 'inherit' | 'environment' | 'stored'
export interface ModelProfile {
  id: string; label: string; model: string; provider: ModelProvider; baseUrl: string
  keySource: KeySource; envKey: string; hasKey: boolean
}
export interface StudioView {
  revision: string; defaultModelId?:string|null; profiles: ModelProfile[]; selectedModelId: string | null; secureStorage: boolean
  prompt: PromptConfig; localPrompt: PromptConfig | null; promptScope: SettingsScope; promptSource: string
}
export interface ModelSaveRequest {
  revision: string; id: string | null; label: string; model: string; provider: ModelProvider; baseUrl: string
  keySource: KeySource; envKey: string; apiKey?: string
}
export interface PromptSaveRequest { revision: string; scope: SettingsScope; prompt: PromptConfig | null }
export interface SlashCommand { name: string; description: string; kind: 'desktop' | 'skill' | 'qwen' }
export const DESKTOP_COMMANDS: SlashCommand[] = [
  {name:'new',get description(){return t('Новый диалог в текущей папке')},kind:'desktop'},
  {name:'clear',get description(){return t('Начать отдельный диалог, сохранив старый')},kind:'desktop'},
  {name:'model',get description(){return t('Выбрать модель или изменить её профиль')},kind:'desktop'},
  {name:'skills',get description(){return t('Создать, изменить или запустить skill')},kind:'desktop'},
  {name:'system',get description(){return t('Системный промпт')},kind:'desktop'},
  {name:'mcp',get description(){return t('Подключения MCP')},kind:'desktop'},
  {name:'settings',get description(){return t('Настройки Qwen')},kind:'desktop'},
  {name:'tools',get description(){return t('Встроенные инструменты Qwen')},kind:'desktop'},
  {name:'approval-mode',get description(){return t('Режим разрешений: plan, default, auto-edit, auto, yolo')},kind:'desktop'},
  {name:'help',get description(){return t('Подсказка по командам Desktop')},kind:'desktop'}
]
export const QWEN_COMMANDS: SlashCommand[] = [
  {name:'init',get description(){return t('Создать инструкции проекта через Qwen')},kind:'qwen'},
  {name:'compress',get description(){return t('Сжать контекст сессии через Qwen')},kind:'qwen'},
  {name:'context',get description(){return t('Сведения о контексте Qwen')},kind:'qwen'},
]
export interface SkillEntry {
  id: string; name: string; description: string; path: string; scope: SettingsScope; source: string
  editable: boolean; enabled: boolean; locked: boolean; reason: string
  userInvocable: boolean; modelInvocable: boolean; revision: string
}
export interface SkillsView { scope: SettingsScope; root: string; entries: SkillEntry[]; warnings: string[] }
export interface SkillDocument { entry: SkillEntry; body: string; raw: string; files: SkillTreeNode[]; treeRevision: string; treeComplete?:boolean; treeWarnings?:string[] }
export interface SkillSaveRequest {
  scope: SettingsScope; id: string | null; revision: string | null; name: string; description: string; body: string
  userInvocable: boolean; modelInvocable: boolean
}
export interface SkillTreeNode { path: string; kind: 'file'|'directory'; editable: boolean; size: number }
export interface SkillFile { path: string; text: string; revision: string; encoding?: string; lineEnding?: string }
export interface SkillAsset { path: string; size: number; revision: string; kind: 'text'|'image'|'binary'; dataUrl?: string; encoding?: string }
export interface SkillPathChange { action: 'file'|'directory'|'rename'|'remove'; path: string; target?: string; revision: string }

export interface SkillDirectoryPage {path:string;files:SkillTreeNode[];nextOffset:number|null;revision:string;warnings:string[]}
