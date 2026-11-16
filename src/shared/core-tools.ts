import {t} from './i18n'
import type { SettingsScope } from './settings'

export interface CoreToolDefinition { name: string; aliases: readonly string[]; label: string; group: string; description: string; fixedOff?: boolean }
// Native ToolNames in bundled CLI from SDK 0.1.32. Availability also depends on feature flags.
export const CORE_TOOLS: readonly CoreToolDefinition[] = [
  {
    "name": "exec",
    "aliases": [
      "Exec"
    ],
    get "label"(){return t("Исполнение кода (CodeMode)")},
    get "description"(){return t("Выполняет код, вызывающий встроенные инструменты в CodeMode.")},
    get "group"(){return t("Выполнение")}
  },
  {
    "name": "edit",
    "aliases": [
      "Edit",
      "replace"
    ],
    get "label"(){return t("Редактирование файла")},
    get "description"(){return t("Заменяет выбранные фрагменты существующего файла.")},
    get "group"(){return t("Файлы")}
  },
  {
    "name": "write_file",
    "aliases": [
      "WriteFile"
    ],
    get "label"(){return t("Запись файла")},
    get "description"(){return t("Создаёт файл или записывает его содержимое целиком.")},
    get "group"(){return t("Файлы")}
  },
  {
    "name": "read_file",
    "aliases": [
      "ReadFile"
    ],
    get "label"(){return t("Чтение файла")},
    get "description"(){return t("Читает содержимое файла, включая поддерживаемые изображения и документы.")},
    get "group"(){return t("Файлы")}
  },
  {
    "name": "zoom_image",
    "aliases": [
      "ZoomImage"
    ],
    get "label"(){return t("Масштабирование изображения")},
    get "description"(){return t("Увеличивает область изображения для просмотра моделью.")},
    get "group"(){return t("Медиа")}
  },
  {
    "name": "grep_search",
    "aliases": [
      "Grep",
      "search_file_content"
    ],
    get "label"(){return t("Поиск текста в файлах")},
    get "description"(){return t("Ищет строки и регулярные выражения в коде.")},
    get "group"(){return t("Поиск")}
  },
  {
    "name": "glob",
    "aliases": [
      "Glob"
    ],
    get "label"(){return t("Поиск файлов по маске")},
    get "description"(){return t("Находит пути файлов по шаблону.")},
    get "group"(){return t("Поиск")}
  },
  {
    "name": "run_shell_command",
    "aliases": [
      "Shell"
    ],
    get "label"(){return t("Команды терминала")},
    get "description"(){return t("Запускает команды shell в рабочем окружении Qwen.")},
    get "group"(){return t("Выполнение")}
  },
  {
    "name": "todo_write",
    "aliases": [
      "TodoList"
    ],
    get "label"(){return t("Список шагов")},
    get "description"(){return t("Ведёт список шагов текущей работы.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "save_memory",
    "aliases": [
      "SaveMemory"
    ],
    get "label"(){return t("Сохранение памяти")},
    get "description"(){return t("Сохраняет сведения для следующих обращений модели.")},
    get "group"(){return t("Память")}
  },
  {
    "name": "manage_memory",
    "aliases": [
      "ManageMemory"
    ],
    get "label"(){return t("Управление памятью")},
    get "description"(){return t("Создаёт и обновляет записи управляемой памяти.")},
    get "group"(){return t("Память")}
  },
  {
    "name": "search_memory",
    "aliases": [
      "SearchMemory"
    ],
    get "label"(){return t("Поиск в памяти")},
    get "description"(){return t("Ищет сведения в сохранённой памяти.")},
    get "group"(){return t("Память")}
  },
  {
    "name": "agent",
    "aliases": [
      "Agent",
      "task"
    ],
    get "label"(){return t("Запуск агента")},
    get "description"(){return t("Делегирует подзадачу другому агенту Qwen.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "skill",
    "aliases": [
      "Skill"
    ],
    get "label"(){return t("Применение навыка")},
    get "description"(){return t("Читает инструкции установленного навыка; не настраивает библиотеку навыков.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "exit_plan_mode",
    "aliases": [
      "ExitPlanMode"
    ],
    get "label"(){return t("Выход из планирования")},
    get "description"(){return t("Позволяет модели завершить план и запросить переход к исполнению.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "enter_plan_mode",
    "aliases": [
      "EnterPlanMode"
    ],
    get "label"(){return t("Переход к планированию")},
    get "description"(){return t("Позволяет самой модели перейти в режим планирования.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "web_fetch",
    "aliases": [
      "WebFetch"
    ],
    get "label"(){return t("Чтение веб-страниц")},
    get "description"(){return t("Загружает содержимое указанного URL.")},
    get "group"(){return t("Веб")}
  },
  {
    "name": "web_search",
    "aliases": [
      "WebSearch"
    ],
    get "label"(){return t("Поиск в интернете")},
    get "description"(){return t("Выполняет веб-поиск, если его поддерживает выбранный провайдер.")},
    get "group"(){return t("Веб")}
  },
  {
    "name": "image_gen",
    "aliases": [
      "ImageGen"
    ],
    get "label"(){return t("Генерация изображений")},
    get "description"(){return t("Создаёт или редактирует изображения при наличии совместимого провайдера.")},
    get "group"(){return t("Медиа")}
  },
  {
    "name": "list_directory",
    "aliases": [
      "ListFiles"
    ],
    get "label"(){return t("Список каталога")},
    get "description"(){return t("Показывает содержимое папки.")},
    get "group"(){return t("Файлы")}
  },
  {
    "name": "lsp",
    "aliases": [
      "Lsp"
    ],
    get "label"(){return t("Языковой сервер")},
    get "description"(){return t("Использует языковые серверы для анализа кода при включённой поддержке LSP.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "ask_user_question",
    "aliases": [
      "AskUserQuestion"
    ],
    get "label"(){return t("Интерактивный вопрос")},
    get "description"(){return t("Требует специальной формы выбора. В этом Desktop вопросы пока задаются обычным текстом.")},
    get "group"(){return t("Дополнительно")},
    "fixedOff": true
  },
  {
    "name": "cron_create",
    "aliases": [
      "CronCreate"
    ],
    get "label"(){return t("Создание расписания")},
    get "description"(){return t("Создаёт запланированный запуск в Qwen.")},
    get "group"(){return t("Фоновые задачи")}
  },
  {
    "name": "cron_list",
    "aliases": [
      "CronList"
    ],
    get "label"(){return t("Список расписаний")},
    get "description"(){return t("Показывает запланированные задачи Qwen.")},
    get "group"(){return t("Фоновые задачи")}
  },
  {
    "name": "cron_delete",
    "aliases": [
      "CronDelete"
    ],
    get "label"(){return t("Удаление расписания")},
    get "description"(){return t("Удаляет запланированную задачу Qwen.")},
    get "group"(){return t("Фоновые задачи")}
  },
  {
    "name": "autofix_pr",
    "aliases": [
      "AutofixPr"
    ],
    get "label"(){return t("Автоисправление PR")},
    get "description"(){return t("Запускает поддерживаемый сценарий исправления pull request.")},
    get "group"(){return t("Git и проверки")}
  },
  {
    "name": "loop_wakeup",
    "aliases": [
      "LoopWakeup"
    ],
    get "label"(){return t("Возобновление цикла")},
    get "description"(){return t("Возобновляет поддерживаемый фоновый цикл работы.")},
    get "group"(){return t("Фоновые задачи")}
  },
  {
    "name": "create_sub_session",
    "aliases": [
      "CreateSubSession"
    ],
    get "label"(){return t("Создание подсессии")},
    get "description"(){return t("Создаёт дочернюю сессию в поддерживаемом окружении.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "list_agents",
    "aliases": [
      "ListAgents"
    ],
    get "label"(){return t("Список агентов")},
    get "description"(){return t("Показывает доступных агентов и их состояние.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "task_stop",
    "aliases": [
      "TaskStop"
    ],
    get "label"(){return t("Остановка задачи")},
    get "description"(){return t("Останавливает выполняемую фоновую задачу.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "task_create",
    "aliases": [
      "TaskCreate"
    ],
    get "label"(){return t("Создание задачи")},
    get "description"(){return t("Добавляет задачу в список работы агентов.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "task_update",
    "aliases": [
      "TaskUpdate"
    ],
    get "label"(){return t("Обновление задачи")},
    get "description"(){return t("Меняет состояние и данные задачи.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "task_list",
    "aliases": [
      "TaskList"
    ],
    get "label"(){return t("Список задач")},
    get "description"(){return t("Показывает список задач команды.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "team_create",
    "aliases": [
      "TeamCreate"
    ],
    get "label"(){return t("Создание команды")},
    get "description"(){return t("Создаёт команду агентов при включённой поддержке команд.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "team_delete",
    "aliases": [
      "TeamDelete"
    ],
    get "label"(){return t("Удаление команды")},
    get "description"(){return t("Завершает или удаляет команду агентов.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "team_plan_approval",
    "aliases": [
      "TeamPlanApproval"
    ],
    get "label"(){return t("Согласование плана команды")},
    get "description"(){return t("Передаёт решение по плану участника команды.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "request_shutdown",
    "aliases": [
      "RequestShutdown"
    ],
    get "label"(){return t("Запрос завершения агента")},
    get "description"(){return t("Просит участника команды завершить работу.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "send_message",
    "aliases": [
      "SendMessage"
    ],
    get "label"(){return t("Сообщение агенту")},
    get "description"(){return t("Передаёт сообщение другому агенту Qwen.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "structured_output",
    "aliases": [
      "StructuredOutput"
    ],
    get "label"(){return t("Структурированный ответ")},
    get "description"(){return t("Формирует ответ по заданной структуре.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "monitor",
    "aliases": [
      "Monitor"
    ],
    get "label"(){return t("Наблюдение за процессом")},
    get "description"(){return t("Следит за изменениями или результатом фоновой команды.")},
    get "group"(){return t("Фоновые задачи")}
  },
  {
    "name": "notebook_edit",
    "aliases": [
      "NotebookEdit"
    ],
    get "label"(){return t("Редактирование ноутбука")},
    get "description"(){return t("Изменяет ячейки Jupyter Notebook.")},
    get "group"(){return t("Файлы")}
  },
  {
    "name": "tool_call",
    "aliases": [
      "ToolCall"
    ],
    get "label"(){return t("Вызов отложенного инструмента")},
    get "description"(){return t("Вызывает найденный инструмент. Без него часть отложенных инструментов, включая MCP, недоступна.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "tool_search",
    "aliases": [
      "ToolSearch"
    ],
    get "label"(){return t("Поиск отложенных инструментов")},
    get "description"(){return t("Находит схемы инструментов, которые не показаны модели сразу. Отключение ограничивает отложенные вызовы.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "read_mcp_resource",
    "aliases": [
      "ReadMcpResource"
    ],
    get "label"(){return t("Чтение MCP-ресурса")},
    get "description"(){return t("Читает ресурс уже подключённого MCP-сервера; не настраивает серверы.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "advisor",
    "aliases": [
      "Advisor"
    ],
    get "label"(){return t("Советник")},
    get "description"(){return t("Запрашивает дополнительную проверку или совет у модели-советника.")},
    get "group"(){return t("Агенты")}
  },
  {
    "name": "enter_worktree",
    "aliases": [
      "EnterWorktree"
    ],
    get "label"(){return t("Открытие worktree")},
    get "description"(){return t("Создаёт или выбирает изолированное рабочее дерево Git.")},
    get "group"(){return t("Git и проверки")}
  },
  {
    "name": "exit_worktree",
    "aliases": [
      "ExitWorktree"
    ],
    get "label"(){return t("Выход из worktree")},
    get "description"(){return t("Завершает работу в изолированном дереве Git.")},
    get "group"(){return t("Git и проверки")}
  },
  {
    "name": "workflow",
    "aliases": [
      "Workflow"
    ],
    get "label"(){return t("Запуск сценария")},
    get "description"(){return t("Выполняет поддерживаемый workflow Qwen.")},
    get "group"(){return t("Дополнительно")}
  },
  {
    "name": "artifact",
    "aliases": [
      "Artifact"
    ],
    get "label"(){return t("Работа с артефактами")},
    get "description"(){return t("Управляет артефактами в поддерживаемом окружении.")},
    get "group"(){return t("Артефакты")}
  },
  {
    "name": "record_artifact",
    "aliases": [
      "RecordArtifact"
    ],
    get "label"(){return t("Регистрация артефакта")},
    get "description"(){return t("Добавляет результат в реестр артефактов Qwen.")},
    get "group"(){return t("Артефакты")}
  },
  {
    "name": "record_source",
    "aliases": [
      "RecordSource"
    ],
    get "label"(){return t("Регистрация источника")},
    get "description"(){return t("Записывает источник, использованный в работе.")},
    get "group"(){return t("Артефакты")}
  },
  {
    "name": "report_findings",
    "aliases": [
      "ReportFindings"
    ],
    get "label"(){return t("Результаты проверки")},
    get "description"(){return t("Записывает структурированные замечания при проверке кода.")},
    get "group"(){return t("Git и проверки")}
  },
  {
    "name": "get_goal",
    "aliases": [
      "Goal"
    ],
    get "label"(){return t("Чтение цели")},
    get "description"(){return t("Показывает текущую цель длительной работы.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "update_goal",
    "aliases": [
      "UpdateGoal"
    ],
    get "label"(){return t("Обновление цели")},
    get "description"(){return t("Обновляет состояние текущей цели.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "omni_downsample_image",
    "aliases": [
      "DownsampleImage"
    ],
    get "label"(){return t("Уменьшение изображения (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_downscale_video",
    "aliases": [
      "DownscaleVideo"
    ],
    get "label"(){return t("Уменьшение видео (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_downsample_audio",
    "aliases": [
      "DownsampleAudio"
    ],
    get "label"(){return t("Подготовка аудио (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_extract_keyframes",
    "aliases": [
      "ExtractKeyframes"
    ],
    get "label"(){return t("Ключевые кадры (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_extract_audio",
    "aliases": [
      "ExtractAudio"
    ],
    get "label"(){return t("Извлечение аудио (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_clip_video",
    "aliases": [
      "ClipVideo"
    ],
    get "label"(){return t("Фрагмент видео (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_convert_image",
    "aliases": [
      "ConvertImage"
    ],
    get "label"(){return t("Конвертация изображения (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_transcribe_audio",
    "aliases": [
      "TranscribeAudio"
    ],
    get "label"(){return t("Расшифровка аудио (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_clip_image",
    "aliases": [
      "ClipImage"
    ],
    get "label"(){return t("Фрагмент изображения (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_clip_audio",
    "aliases": [
      "ClipAudio"
    ],
    get "label"(){return t("Фрагмент аудио (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_caption_image",
    "aliases": [
      "CaptionImage"
    ],
    get "label"(){return t("Описание изображения (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_caption_audio",
    "aliases": [
      "CaptionAudio"
    ],
    get "label"(){return t("Описание аудио (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_ocr_image",
    "aliases": [
      "OcrImage"
    ],
    get "label"(){return t("Распознавание текста (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_understand_video_segments",
    "aliases": [
      "UnderstandVideoSegments"
    ],
    get "label"(){return t("Анализ видео (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "omni_recall_media_memory",
    "aliases": [
      "RecallMediaMemory"
    ],
    get "label"(){return t("Поиск медиа в памяти (Omni)")},
    get "description"(){return t("Экспериментальная обработка медиа в Omni. Требует поддержки этого режима и модели.")},
    get "group"(){return t("Медиа (Omni)")}
  },
  {
    "name": "propose_goal",
    "aliases": [
      "ProposeGoal"
    ],
    get "label"(){return t("Предложение цели")},
    get "description"(){return t("Предлагает пользователю новую цель для длительной работы.")},
    get "group"(){return t("Планирование")}
  },
  {
    "name": "display_image",
    "aliases": [
      "DisplayImage"
    ],
    get "label"(){return t("Показ изображения")},
    get "description"(){return t("Передаёт изображение для отображения в поддерживаемом интерфейсе Qwen.")},
    get "group"(){return t("Медиа")}
  }
]

export interface CoreToolState { enabled: boolean; localDisabled: boolean; locked: boolean; reason: string }
export interface CoreToolsView { scope: SettingsScope; path: string; revision: string; tools: Record<string, CoreToolState> }
export interface CoreToolsSaveRequest { scope: SettingsScope; revision: string; changes: Record<string, boolean> }
