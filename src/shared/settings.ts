import {t} from './i18n'
export const APPROVAL_MODES = ['plan', 'default', 'auto-edit', 'auto', 'yolo'] as const
export type ApprovalMode = typeof APPROVAL_MODES[number]
export const MODE_INFO: Record<ApprovalMode, { label: string; description: string }> = {
  plan: { get label(){return t('Plan')}, get description(){return t('Анализ и планирование без изменения файлов.')} },
  default: { get label(){return t('Ask Permissions')}, get description(){return t('Запрашивать разрешение на изменения и команды.')} },
  'auto-edit': { get label(){return t('Auto-Edit')}, get description(){return t('Разрешать изменения файлов, подтверждать команды.')} },
  auto: { get label(){return t('Auto')}, get description(){return t('Qwen оценивает операции автоматически.')} },
  yolo: { get label(){return t('YOLO')}, get description(){return t('Автоматически подтверждать операции.')} }
}
export type SettingsScope = 'user' | 'project'
export type SettingValue = boolean | string | number
export interface SettingDefinition {
  key: string
  label: string
  section: string
  description?: string
  type: 'boolean' | 'choice'
  default?: SettingValue
  choices?: readonly SettingValue[]
  labels?: Record<string, string>
  min?: number
  max?: number
  integer?: boolean
  userOnly?: boolean
}

// Verified against the bundled CLI schema in @qwen-code/sdk 0.1.32.
// Only these paths cross the settings IPC boundary; unrelated JSON is retained.
export const SETTINGS_FIELDS: readonly SettingDefinition[] = [
  { key: 'tools.approvalMode', get label(){return t('Режим разрешений по умолчанию')}, get section(){return t('Разрешения')}, type: 'choice', default: 'auto', choices: APPROVAL_MODES, labels: Object.fromEntries(APPROVAL_MODES.map(mode => [mode, MODE_INFO[mode].label])) },
  { key: 'permissions.autoMode.classifyAllShell', get label(){return t('Проверять все shell-команды в Auto')}, get section(){return t('Разрешения')}, type: 'boolean', default: false },
  { key: 'general.language', get label(){return t('Язык Qwen Code')}, get section(){return t('Общие')}, type: 'choice', default: 'auto', choices: ['auto', 'ru', 'en', 'de', 'fr', 'ja', 'zh', 'zh-TW', 'pt', 'ca'], labels: { get auto(){return t('Системный')}, get ru(){return t('Русский')}, en: 'English', de: 'Deutsch', fr: 'Français', ja: '日本語', zh: '简体中文', 'zh-TW': '繁體中文', pt: 'Português', ca: 'Català' }, get description(){return t('Язык самого Qwen Code. Язык ответов модели определяется запросом.')} },
  { key: 'general.enableAutoUpdate', get label(){return t('Автоматические обновления CLI')}, get section(){return t('Общие')}, type: 'boolean', default: true, get description(){return t('Относится к Qwen CLI, не к обновлению приложения Desktop.')} },
  { key: 'general.defaultFileEncoding', get label(){return t('Кодировка новых файлов')}, get section(){return t('Общие')}, type: 'choice', default: 'utf-8', choices: ['utf-8', 'utf-8-bom'], labels: { 'utf-8': 'UTF-8', get 'utf-8-bom'(){return t('UTF-8 с BOM')} } },
  { key: 'general.gitCoAuthor.commit', get label(){return t('Указывать Qwen соавтором коммитов')}, get section(){return t('Общие')}, type: 'boolean', default: true },
  { key: 'general.gitCoAuthor.pr', get label(){return t('Указывать Qwen соавтором PR')}, get section(){return t('Общие')}, type: 'boolean', default: true },
  { key: 'model.reasoningEffort', get label(){return t('Глубина рассуждений')}, get section(){return t('Модель и лимиты')}, type: 'choice', choices: ['low', 'medium', 'high', 'xhigh', 'max'], labels: { get low(){return t('Низкая')}, get medium(){return t('Средняя')}, get high(){return t('Высокая')}, get xhigh(){return t('Очень высокая')}, get max(){return t('Максимальная')} }, get description(){return t('Доступность уровней зависит от выбранной модели.')} },
  { key: 'model.maxSessionTurns', get label(){return t('Лимит шагов сессии')}, get section(){return t('Модель и лимиты')}, type: 'choice', default: -1, choices: [-1, 10, 25, 50, 100, 250, 500], min: -1, integer: true, labels: { get '-1'(){return t('Без ограничения')} } },
  { key: 'model.maxToolCalls', get label(){return t('Лимит вызовов инструментов за запрос')}, get section(){return t('Модель и лимиты')}, type: 'choice', default: -1, choices: [-1, 0, 10, 25, 50, 100, 250, 1000], min: -1, max: 1000000, integer: true, labels: { get '-1'(){return t('Без ограничения')}, get '0'(){return t('Не вызывать инструменты')} } },
  { key: 'model.maxWallTimeSeconds', get label(){return t('Лимит времени запроса')}, get section(){return t('Модель и лимиты')}, type: 'choice', default: -1, choices: [-1, 60, 300, 600, 1800, 3600], min: -1, max: 2147483, integer: true, labels: { get '-1'(){return t('Без ограничения')}, get '60'(){return t('1 минута')}, get '300'(){return t('5 минут')}, get '600'(){return t('10 минут')}, get '1800'(){return t('30 минут')}, get '3600'(){return t('1 час')} } },
  { key: 'model.maxSubagentDepth', get label(){return t('Глубина вложенности агентов')}, get section(){return t('Модель и лимиты')}, type: 'choice', default: 5, choices: [1, 2, 3, 5, 10, 20], min: 1, max: 100, integer: true },
  { key: 'model.loopProtection', get label(){return t('Поведение при зацикливании')}, get section(){return t('Модель и лимиты')}, type: 'choice', default: 'warn', choices: ['warn', 'stop', 'off'], labels: { get warn(){return t('Предупредить модель')}, get stop(){return t('Остановить запрос')}, get off(){return t('Не вмешиваться')} } },
  { key: 'model.skipLoopDetection', get label(){return t('Пропускать эвристический поиск циклов')}, get section(){return t('Модель и лимиты')}, type: 'boolean', default: true },
  { key: 'context.autoCompactThreshold', get label(){return t('Порог сжатия контекста')}, get section(){return t('Контекст')}, type: 'choice', choices: [0.5, 0.65, 0.75, 0.85, 0.9, 0.95], min: 0.01, max: 1, labels: { '0.5': '50%', '0.65': '65%', '0.75': '75%', '0.85': '85%', '0.9': '90%', '0.95': '95%' }, get description(){return t('Сжатие может сработать раньше, если модели нужно место для резюме.')} },
  { key: 'context.fileFiltering.respectGitIgnore', get label(){return t('Учитывать .gitignore')}, get section(){return t('Контекст')}, type: 'boolean', default: true },
  { key: 'context.fileFiltering.respectQwenIgnore', get label(){return t('Учитывать .qwenignore')}, get section(){return t('Контекст')}, type: 'boolean', default: true },
  { key: 'context.fileFiltering.enableRecursiveFileSearch', get label(){return t('Рекурсивный поиск файлов')}, get section(){return t('Контекст')}, type: 'boolean', default: true },
  { key: 'context.fileFiltering.enableFuzzySearch', get label(){return t('Нечёткий поиск файлов')}, get section(){return t('Контекст')}, type: 'boolean', default: true },
  { key: 'memory.enableManagedAutoMemory', get label(){return t('Автоматическая память')}, get section(){return t('Память')}, type: 'boolean', default: true },
  { key: 'memory.enableManagedAutoDream', get label(){return t('Фоновая обработка памяти')}, get section(){return t('Память')}, type: 'boolean', default: true },
  { key: 'tools.webSearch.enabled', get label(){return t('Веб-поиск')}, get section(){return t('Инструменты')}, type: 'boolean' },
  { key: 'tools.toolSearch.enabled', get label(){return t('Поиск отложенных инструментов')}, get section(){return t('Инструменты')}, type: 'boolean', default: true },
  { key: 'tools.useRipgrep', get label(){return t('Поиск в коде через ripgrep')}, get section(){return t('Инструменты')}, type: 'boolean', default: true },
  { key: 'tools.shell.defaultTimeoutMs', get label(){return t('Тайм-аут shell-команд')}, get section(){return t('Инструменты')}, type: 'choice', choices: [30000, 60000, 120000, 300000, 600000], min: 1, max: 2147483647, integer: true, labels: { get '30000'(){return t('30 секунд')}, get '60000'(){return t('1 минута')}, get '120000'(){return t('2 минуты')}, get '300000'(){return t('5 минут')}, get '600000'(){return t('10 минут')} } },
  { key: 'privacy.usageStatisticsEnabled', get label(){return t('Статистика использования')}, get section(){return t('Конфиденциальность')}, type: 'boolean', default: true },
  { key: 'model.catalogRefresh', get label(){return t('Обновлять каталог моделей из сети')}, get section(){return t('Конфиденциальность')}, type: 'boolean', default: true, userOnly: true },
  { key: 'model.enableOpenAILogging', get label(){return t('Логировать обращения к OpenAI-совместимому API')}, get section(){return t('Конфиденциальность')}, type: 'boolean', default: false, get description(){return t('В логах сохраняются запросы и ответы модели.')} }
]

export interface SettingsFieldState {
  local: SettingValue | null
  inherited: SettingValue | null
  effective: SettingValue | null
  source: string
  locked: boolean
}
export interface SettingsView {
  scope: SettingsScope
  path: string
  revision: string
  fields: Record<string, SettingsFieldState>
}
export interface SettingsSaveRequest {
  scope: SettingsScope
  revision: string
  changes: Record<string, SettingValue | null>
}
export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && (APPROVAL_MODES as readonly string[]).includes(value)
}
