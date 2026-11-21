# Skills Lab — Qwen Desktop 1.0.2

[Русский](#русский) · [English](#english)

## Русский

### Первый запуск

1. Откройте рабочую папку и подключите модель обычным способом.
2. Откройте **Skills Lab** под кнопкой Skills.
3. Установите свой скилл через панель Skills. В Lab создайте **Набор сценариев** или выберите **Составить сценарии с ИИ**. Встроенных демонстрационных кнопок больше нет.
4. Выберите модель. «Модель по умолчанию» использует профиль по умолчанию приложения, а при его отсутствии — конфигурацию Qwen.
5. Нажмите **Запустить все**. Запросы к модели расходуют её токены. Новые наборы используют YOLO: shell и подключённые MCP выполняются без подтверждений. Режим разрешений доступен в основных настройках набора. «Разрешить всё в этом прогоне» действует только до окончания текущего прогона.
6. Откройте результат сценария: проверки, финальный ответ, ход выполнения, созданные файлы. Можно просмотреть текст файла, открыть рабочую папку и экспортировать HTML-отчёт.

Закрытие окна Skills Lab не останавливает очередь. Откройте его снова, чтобы вернуться к запуску или остановить его. Закрытие самого приложения отменяет запуск; после аварийного завершения незаконченные отчёты помечаются как прерванные. Наборы и отчёты сохраняются между запусками приложения отдельно от обычных чатов.

### Диалоговые тесты: ручной режим и ИИ-пользователь

В наборе выберите диалоговый сценарий, задайте начальную задачу, роль пользователя и ожидаемое поведение. В режиме **Тестирую сам** после каждого завершённого ответа агента появляется поле ввода. Можно выбирать варианты, уточнять, исправлять решение или нажать **Завершить и оценить**.

Весь диалог выполняется в одном процессе CLI и одной тестовой рабочей папке. Каждый новый прогон получает новый ID сессии; старый отчёт не используется как история запроса. После перезапуска приложения прерванный прогон не возобновляется автоматически. Локальные фоновые процессы после окончания/отмены теста не гарантируются; внешние операции на сервере могут продолжаться независимо от CLI.

В режиме **Тестирует ИИ** отдельная модельная роль играет пользователя. Она видит начальную задачу, заданную роль пользователя, диалог и результаты инструментов. Она выбирает ответы по фактическим вопросам, может уточнять различия вариантов и запрашивать проверку статуса с задержкой до 30 секунд. Если нужны неизвестные ей данные или модель вернула неподдерживаемый ответ, Lab передаёт вопрос настоящему пользователю. После ручного ответа автоматический режим продолжается.

**Составить сценарии с ИИ**: выберите скилл, модель, кто будет отвечать, и опишите задачу обычным текстом. Например:

> Проверь ручной и автоматический режимы. Пользователь не знает внутренние названия параметров и уточняет варианты. Проверь успех, ошибочный параметр и анализ упавшей сборки.

Планировщик читает SKILL.md и выбранные текстовые ресурсы, максимум около 30 000 символов и 16 файлов вместе с основным файлом. Это ограниченный обзор, а не полный анализ всех скачанных репозиториев. Он предложит 1–6 сценариев. Они появятся как редактируемый набор: начальная задача, поведение пользователя и **ожидаемое поведение и результат**, по одному требованию на строку. Запуск выполняется отдельной кнопкой после просмотра. При необходимости входные файлы и точные проверки добавляются в раскрывающемся блоке.

Планировщик, ИИ-пользователь и проверяющий доступны только в Lab: они не устанавливаются как глобальные скиллы, не имеют инструментов, MCP или полномочий подтверждать операции. Все роли используют выбранный профиль модели и расходуют её токены. Режим диалога и разрешения независимы: новые наборы создаются с YOLO, а в существующих сохраняется выбранный режим. Чтобы весь прогон прошёл без вопросов о shell/MCP, выберите **YOLO — разрешить все инструменты**. В режиме **Тестирую сам** вопросы по самой задаче по-прежнему ждут вашего ответа.

Проверяющий получает требования отдельно от проверяемого агента и оценивает каждое:

- **Подтверждено** — есть указанные основания.
- **Не выполнено** — есть данные о нарушении требования.
- **Не удалось подтвердить** — недостаточно данных, некорректная оценка или отсутствующие ссылки на события.

Ссылки `e1`, `e2` и т. п. открывают сообщения и результаты инструментов в отчёте. Заявление агента об успехе не является доказательством выполнения внешней операции. Смысловую оценку делает модель, поэтому её аргументы следует проверять; интерфейс не объявляет её объективной гарантией. Сочетайте её с точными проверками, когда результат можно проверить кодом. Невыполненная точная проверка или отрицательная оценка даёт **Не пройден**. Неопределённая оценка или исчерпание лимита диалога даёт **Нужна проверка**. Сбой самой CLI остаётся **Ошибкой**.

Ограничения: до 20 требований и 40 ответов агента на сценарий; по умолчанию новые диалоговые сценарии допускают 32 ответа. Активное выполнение — 15–7200 секунд, ожидание каждого ручного ответа — отдельно 30–7200 секунд. Время ручного ожидания не уменьшает активный бюджет. Вызов каждой служебной роли ограничен 90 секундами. Для десятиминутной внешней job оставьте запас активного времени, например 1800 секунд. Для длинных диалогов контекст служебных ролей сокращается с сохранением начала и последних событий; отсутствие доказательств должно приводить к ручной проверке.

История содержит все сохранённые ходы диалога в рамках лимита, до 200 фрагментов доказательств по 2000 символов, обычный ограниченный журнал и файлы. Длинные сообщения/события сокращаются, что отмечается в отчёте. После закрытия панели тест продолжается. При закрытии приложения он отменяется или восстанавливается как прерванный; автоматическое продолжение прерванного теста пока не предусмотрено.

### История и лимиты

В отчёте показаны фактические **Шаги модели** и **Вызовы инструментов** с их лимитами. Шаги считаются по `num_turns` результата CLI, а не по количеству фрагментов текста/thinking. Один пользовательский ответ может требовать нескольких обращений к модели и инструментам. Достижение лимита сохраняет диалог и даёт **Нужна проверка**, если уже не установлено нарушение требования.

**Удалить прогон** удаляет выбранный отчёт, резервную копию и рабочую папку. **Очистить историю** удаляет все отчёты и рабочие папки прогонов; скиллы и наборы сценариев сохраняются. Активный прогон сначала нужно остановить. Уже установленные демонстрационные скиллы/наборы не удаляются автоматически: удалите ненужные наборы в Lab, а пакеты — в Skills.

### HTML-отчёт по прогону

Откройте завершённый или текущий прогон и нажмите **HTML-отчёт**. Сохраняется один автономный файл: сводка, статусы сценариев, параметры, диалог, оценки с переходами к доказательствам, точные проверки, журнал инструментов и список файлов. Скрипты и интернет для просмотра не нужны; тема следует настройкам браузера/системы. Размер шрифта ответов единый, Markdown-таблицы и код сохраняют оформление.

Это снимок на момент экспорта, не живой монитор. Для текущего прогона в отчёте останется текущий статус. Отчёт можно открыть в браузере, передать коллеге или напечатать в PDF. Содержимое файлов артефактов не встраивается, отображаются их пути. Исходные JSON-данные остаются во внутренней истории; экспорт наборов сценариев по-прежнему JSON.

### Собственные сценарии

Создайте **Набор сценариев**, выберите установленный скилл, задайте запросы, входные текстовые файлы и критерии успеха. Каждый сценарий получает новую CLI-сессию, отдельную рабочую папку и снимок пакета скилла. Разрешения обычного чата не используются. Сценарии выполняются последовательно; одновременно работает один прогон.

Изменения сохраняются автоматически; **Запустить все** и **Запустить сценарий** сначала сохраняют текущие правки. Для незавершённого набора есть **Отменить изменения**.

| Проверка | Что задавать |
| --- | --- |
| Файл существует / отсутствует | Относительный путь к файлу |
| Файл содержит текст | Путь и ожидаемую подстроку |
| Точное содержимое файла | Путь и полный текст, включая переводы строк |
| Значение в JSON | Путь, JSON Pointer (`/summary/count`) и JSON-значение (`3`, `true`, `"ready"`, объект или массив) |
| Ответ содержит текст | Короткую ожидаемую подстроку в финальном ответе |
| Инструмент выполнен | Реальное имя инструмента Qwen, например `write_file`; неудачный вызов не засчитывается |
| Skill был загружен | Ожидаемое значение true/false; для проверки автовыбора используйте режим Auto |
| Корректный SKILL.md | Путь к файлу с валидными YAML-метаданными name/description |
| Корректный набор сценариев | Путь к JSON-набору версии 1 с валидными сценариями |

**Явный запуск** передаёт скилл через `/имя` или инструкцию прочитать SKILL.md. **Проверка автовыбора** отправляет только запрос пользователя и фиксирует вызов инструмента `skill` либо чтение тестируемого SKILL.md. В явном режиме «Skill был загружен = true» не является тестом автоматического выбора.

Статус **Пройден** означает: CLI успешно завершился и все заданные проверки прошли. **Не пройден** означает несовпадение результата с проверками. **Ошибка** означает сбой запуска/модели или превышение времени. Ответ модели «готово» сам по себе не даёт успешный результат. Набор проверок оценивает только то, что вы в нём описали.

Зарезервированы корневые `.qwen`, `.agents`, `.git`, `node_modules` и `.mcp.json`: сценарий не может подложить конфигурацию CLI в его рабочую папку. Входные файлы — UTF-8, до 40 на сценарий, суммарно до 1 МБ на набор. Сценариев 1–20, проверок 1–100 на сценарий. Время 15–7200 секунд, до 100 шагов модели и 200 вызовов инструментов. Предпросмотр и проверки читают текстовые файлы до 512 КБ. Журнал ограничен последними 120 событиями, длинные значения сокращаются; список результатов содержит до 200 путей. Сами файлы остаются в рабочей папке.

Рабочая папка — **не системная песочница**. Разрешённые shell-команды и MCP могут обращаться к внешним ресурсам. MCP изначально выключены; при включении используются разрешённые подключения исходного проекта. Входные файлы не должны содержать настоящие ключи и пароли. Проверки не запускают произвольные shell-выражения или пользовательский код оценки.

Набор сохраняет исходную папку проекта. Переключение обычного чата не переносит его на другой проект. Экспорт сценариев не включает API-ключи, внутренний ID скилла или исходный абсолютный путь. При импорте установите соответствующий скилл и откройте нужный проект. Полный отчёт содержит запросы, тестовые входные данные, результаты и локальный путь проекта — проверьте его перед публикацией.

### Skill Creator

В Skills Lab нажмите **Создать skill с ИИ**. Укажите имя, задачи, входные данные, ожидаемый результат, модель и область установки. Creator использует ту же модель Qwen; отдельная подписка Claude или Claude CLI для этого процесса не нужны.

В комплект входит зафиксированная версия `anthropics/skills/skill-creator`, её ресурсы и Apache-2.0 license. Входные инструкции адаптированы для Qwen Desktop; оригинальный SKILL.md сохранён как UPSTREAM_SKILL.md. Оригинальные вспомогательные сценарии, завязанные на Claude CLI, остаются исходными ресурсами и не запускаются автоматически Desktop-процессом.

Сначала Creator создаёт пакет и `evals/suite.json` в отдельной рабочей папке. Приложение проверяет корректность SKILL.md и формата сценариев. Затем можно просмотреть файлы, **Установить созданный skill** и **Добавить созданные сценарии**. Существующий одноимённый скилл не перезаписывается. Структурная проверка не заменяет запуск созданных сценариев и ручную проверку полезности скилла.

### Большие пакеты и скачанные репозитории

Суммарного ограничения 20 МБ и лимита 500 файлов в редакторе больше нет. Дерево получает метаданные, не загружая содержимое всех файлов. Каталоги показываются страницами по 200 записей; нажмите **Загрузить ещё**. Начальное дерево ограничено 2000 записями, остальные папки открываются по запросу. Текстовый редактор ограничен 512 КБ на файл; крупные и двоичные файлы показываются как ресурсы.

Кнопка **Скрыть папку из дерева** добавляет относительный путь в `.skillignore`. Формат — один точный путь на строку, `#` для комментариев; это не glob/gitignore. Например:

```text
# Runtime repositories downloaded by my skill
runtime/repos/
work-cache/
```

Файлы остаются на диске. `.git`, `node_modules`, виртуальные Python-окружения и распространённые кэши скрыты по умолчанию. Эти же правила исключения применяются при импорте и подготовке тестового снимка: не скрывайте ресурсы, необходимые для выполнения сценариев. SKILL.md и `.skillignore` остаются видимыми. Снимок/импорт ограничен 512 МБ и 50 000 файлов/папок; превышение даёт понятную ошибку, исходный пакет сохраняется.

## English

**Dialogue testing:** install your own skill through Skills, then create a suite or use **Generate scenarios with AI**. Built-in demo installers have been removed. Select **I will test manually** to answer follow-up questions yourself and press **Finish and evaluate** when ready. Select **AI tests it** to let a separate model role answer adaptively, ask clarifying questions and wait for terminal outcomes. It can request human help and then continue automatically.

**Generate scenarios with AI** reads the skill instructions and selected resources (up to roughly 30,000 characters / 16 files), then proposes 1–6 editable scenarios from a plain-language goal. Each dialogue case has a persona and natural-language requirements. Fixtures and exact checks remain optional. Review scenarios before running.

The planner, AI user and reviewer are Lab-only roles with no tools, MCP or approval authority. They use the selected model and consume tokens. New suites default to YOLO, running shell commands and connected MCP tools without approval prompts. Existing suites retain their saved permission mode; choose **YOLO — allow all tools** to change it. Dialogue mode is independent: manual tests still wait for task answers. The reviewer cites recorded event IDs; invalid or missing citations become uncertain. AI judgments are reviewable assessments, not correctness guarantees. A failed requirement/check fails the case; uncertainty or exhausting the dialogue budget yields **Needs review**.

All messages in a dialogue share one live CLI process and workspace. Each new run has a fresh explicit session ID and does not replay a previous report. Background processes are not guaranteed after the test ends; remote jobs may continue independently. Up to 40 agent replies (default 32 for new cases), 20 requirements and 15–7200 seconds of active execution are allowed. Manual reply waiting has a separate 30–7200-second timeout and pauses active execution time. Each helper role has a 90-second limit. Long context is bounded and truncation is flagged; reports keep up to 200 evidence fragments. Closing the panel leaves the test running; closing the application cancels it or leaves an interrupted report, without automatic continuation.

Select the model and run a case or the whole suite. The report shows actual model-turn and tool-call counts. Model turns come from CLI results, not separate thinking/text envelopes. Genuine budget exhaustion preserves the conversation and requires review.

**Delete run** removes one report, its backup and workspace. **Clear history** removes all reports and run workspaces, preserving skills and suites. Stop the active run first. Previously installed demo suites and skills can be removed using the normal suite/skill controls; they are not automatically deleted.

Create a suite to edit prompts, UTF-8 input fixtures and objective file, JSON, answer, tool-completion or skill-loading checks. Edits autosave before running. Each scenario gets a fresh CLI session and workspace containing a skill snapshot; chat history and chat approvals are not reused. Runs are sequential. Results and suites persist across restarts; closing the panel leaves the run active. Reopen it to inspect or cancel. Interrupted runs are marked accordingly after restart.

A case passes only if CLI execution succeeds and every check passes. A model saying “done” is insufficient. Explicit invocation supplies the skill; automatic selection tests whether the model loads it. `skill-used` is an activation check only in automatic mode.

Choose **Create skill with AI** to use the bundled Anthropic skill-creator adapted for Qwen. Review generated files and scenarios before installing. Existing skills are never overwritten. The original resources and Apache-2.0 license are retained, with provenance pinned in PROVENANCE.json. Claude-dependent upstream helper programs are retained as references, not automatically executed by Desktop. Generated structural validation does not replace testing the new skill.

The default model is the app’s default profile, falling back to native Qwen configuration. MCP is off by default; enabling it uses approved connections from the source project. Test permissions apply only to the current batch. A workspace is not an OS sandbox: approved shell/MCP tools may access external resources. Runs use the model API and may incur usage charges.

Limits: 1–20 cases per suite, 1–100 checks and 40 input files per case, 1 MB total fixture text, 15–7200 seconds per case, 100 model turns and 200 tool calls maximum. Text grading/preview reads files up to 512 KB. Reports keep the last 120 trace events and up to 200 artifact paths; long trace values are truncated. Full output files remain in the workspace. Exported full reports contain prompts, fixture data and local paths: review before sharing.

Large skill directories load in pages of 200 entries; **Load more** opens subsequent pages. Initial metadata is bounded at 2000 entries. Files are not all loaded into memory, and packages above the old 20 MB/500-file limit remain editable. Text editing is limited to 512 KB per file. **Hide folder from tree** adds an exact relative path to `.skillignore`; it does not delete the folder. One path per line, comments start with `#`, no glob patterns. Exclusions also apply to import and test snapshots. `.git`, `node_modules`, Python environments and common caches are excluded by default. Snapshot/import has a separate 512 MB / 50,000-entry budget.

Use **HTML report** on a run to save one standalone, offline report with a summary, scenario settings, conversation, assessments with evidence anchors, checks, trace and artifact paths. It follows the system theme and can be printed to PDF. This is a snapshot at export time, including for active runs. Artifact contents are not embedded. Internal history and portable suite export remain JSON.

Export/import suites as version-1 JSON. Imports resolve the installed skill by name and bind the current source project. Suite exports omit keys, internal IDs and source paths. Application test fixtures remain in the source tree for automated regression tests and are excluded from packaged application examples.
