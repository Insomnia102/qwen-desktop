import {initDesktop} from './onboarding'
import {localizedApi,bindText,bindAttribute,localizeShell} from './interface-language'
import {t,msg,translateMessage,dateLocale} from '../../shared/i18n'
import type { PermissionDecision, QwenAPI, QwenEvent, Reply, WorkspaceIndex, WorkspaceView } from '../../shared/qwen'
import { renderMarkdown } from './markdown'
import { APPROVAL_MODES, MODE_INFO, type ApprovalMode } from '../../shared/settings'
import { openSettings } from './settings-panel'
import { openCoreTools } from './core-tools-panel'
import { openMcp } from './mcp-panel'
import { initTheme } from './theme'
import { openSkills } from './skills-panel'
import {openSkillTests} from './skill-tests-panel'
import { openModels, openSystemPrompt } from './studio-panels'
import { initSlashMenu } from './slash-menu'
import type { StudioView } from '../../shared/studio'

declare global {
  interface Window { api: QwenAPI }
}

function init(): void {
  function required<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id)
    if (!node) throw new Error(msg`Не найден #${id}. Обновите index.html вместе с renderer.ts.`)
    return node as T
  }
  const history = required<HTMLDivElement>('chat-history')
  const messages = required<HTMLDivElement>('messages')
  const empty = required<HTMLElement>('empty-state')
  const emptyDescription = required<HTMLElement>('empty-description')
  const input = required<HTMLTextAreaElement>('chat-input')
  const form = required<HTMLFormElement>('chat-form')
  const choose = required<HTMLButtonElement>('choose-workdir')
  const reset = required<HTMLButtonElement>('new-chat')
  const stop = required<HTMLButtonElement>('stop-qwen')
  bindAttribute(reset,'title','Новый диалог в текущей папке. Предыдущий останется в истории.')
  bindAttribute(stop,'title','Остановить текущую работу Qwen. Полученный вывод сохранится.')
  const submit = required<HTMLButtonElement>('send-message')
  const status = required<HTMLElement>('agent-status')
  const dot = required<HTMLElement>('status-dot')
  const workdirItem = required<HTMLElement>('current-workdir')
  const workdirName = required<HTMLElement>('workdir-name')
  const workdirEmpty = required<HTMLElement>('workdir-empty')
  const workspaceName = required<HTMLElement>('workspace-name')
  const workspacePath = required<HTMLElement>('workspace-path')
  const nav = required<HTMLButtonElement>('nav-workdirs')
  const workdirs = required<HTMLElement>('workdirs-list')

  let api: QwenAPI
  let skillTestsRunning=false
  let ready = false
  let workdir = ''
  let action: 'folder' | 'reset' | 'chat' | 'manage' | 'mode' | 'settings' | null = null
  let currentMode: ApprovalMode = 'auto'
  let modeOverride = false
  const modeControl = document.createElement('label')
  modeControl.className = 'composer-mode'
  modeControl.append(bindText(document.createTextNode(''),'Режим'))
  const modeSelect = document.createElement('select')
  modeSelect.id = 'approval-mode'; bindAttribute(modeSelect,'aria-label','Режим разрешений Qwen')
  const inheritedMode = document.createElement('option')
  inheritedMode.value = '__settings'; modeSelect.append(inheritedMode)
  for (const mode of APPROVAL_MODES) {
    const option = document.createElement('option')
    option.value = mode; bindText(option,()=>MODE_INFO[mode].label); modeSelect.append(option)
  }
  modeControl.append(modeSelect)
  required<HTMLElement>('chat-form').querySelector('.composer-footer')?.prepend(modeControl)
  const settingsButton = document.createElement('button')
  settingsButton.type = 'button'; settingsButton.className = 'nav-item'; settingsButton.id = 'open-settings'
  const coreToolsButton = document.createElement('button')
  coreToolsButton.type = 'button'; coreToolsButton.className = 'nav-item'; coreToolsButton.id = 'open-core-tools'
  for (const [button, text, kind] of [[coreToolsButton, 'Инструменты Qwen', 'tools'], [settingsButton, 'Настройки', 'gear']] as const) {
    const mark = document.createElement('span'); mark.className = 'nav-icon'; mark.append(icon(kind))
    const label = document.createElement('span'); label.className = 'nav-label'; bindText(label,text)
    button.append(mark, label)
  }
  const mcpButton = required<HTMLButtonElement>('nav-mcp')
  const skillsButton = required<HTMLButtonElement>('nav-skills')
  skillsButton.disabled = false; skillsButton.removeAttribute('title'); skillsButton.querySelector('.nav-badge')?.remove()
  const promptButton = document.createElement('button');promptButton.type='button';promptButton.className='nav-item';promptButton.id='open-system-prompt'
  const promptIcon=document.createElement('span');promptIcon.className='nav-icon';promptIcon.textContent='≋'
  const promptLabel=document.createElement('span');promptLabel.className='nav-label';bindText(promptLabel,'Системный промпт');promptButton.append(promptIcon,promptLabel);skillsButton.after(promptButton)
  const testerButton=document.createElement('button');testerButton.type='button';testerButton.id='open-skill-tests';testerButton.className='nav-item';const testerIcon=document.createElement('span');testerIcon.className='nav-icon';testerIcon.textContent='▷';const testerLabel=document.createElement('span');testerLabel.className='nav-label';bindText(testerLabel,()=>skillTestsRunning?t('Skills Lab · выполняется'):t('Skills Lab'));testerButton.append(testerIcon,testerLabel);skillsButton.after(testerButton)
  const modelControl=document.createElement('label');modelControl.className='composer-mode composer-model';modelControl.append(bindText(document.createTextNode(''),'Модель'))
  const modelSelect=document.createElement('select');modelSelect.id='model-profile';bindAttribute(modelSelect,'aria-label','Модель диалога');modelControl.append(modelSelect)
  const modelsButton=document.createElement('button');modelsButton.type='button';modelsButton.className='model-manage';modelsButton.id='open-models';modelsButton.textContent='＋';bindAttribute(modelsButton,'title','Добавить или изменить модель');bindAttribute(modelsButton,'aria-label','Управление моделями');modelControl.append(modelsButton)
  modeControl.after(modelControl)
  let studioView:StudioView|undefined
  let selectedModelId:string|null=null
  let slashMenu:ReturnType<typeof initSlashMenu>|undefined
  const navigation = document.querySelector('.nav-menu')
  navigation?.append(coreToolsButton, settingsButton)
  let workspace: WorkspaceIndex = { version: 1, workdirs: [], chats: [], activeChatId: null }
  let activeChatId: string | null = null
  let hasReadableChat = false
  let restoring = false
  let booting = true
  let storageFailed = false
  const expanded = new Set<string>()
  const tree = document.createElement('li')
  tree.id = 'saved-workdirs'
  workdirs.insertBefore(tree, workdirs.querySelector('.folder-action'))
  const chatCaption = document.createElement('p')
  chatCaption.className = 'chat-caption'
  workspaceName.parentElement?.append(chatCaption)
  let requestId: string | null = null
  let stopping = false
  let allowAll = false
  let unsubscribe: (() => void) | undefined
  const outputs = new Map<string, HTMLElement>()
  const toolRows = new Map<string, { element: HTMLDetailsElement; title: HTMLElement; status: HTMLElement; params: HTMLElement; output: HTMLElement; name: string; running: boolean }>()
  const thinkingRows = new Map<string, { element: HTMLDetailsElement; body: HTMLElement; state: HTMLElement; running: boolean }>()
  const permissions = new Map<string, { element: HTMLElement; result: HTMLElement; buttons: HTMLButtonElement[] }>()
  let activity: { element: HTMLDetailsElement; title: HTMLElement; badge: HTMLElement; items: HTMLElement; placeholder: HTMLElement; note: HTMLElement; finalId?: string } | undefined
  let legacyFinalCandidate: string | undefined
  let legacySuccessfulTurn = false
  let hadError = false
  const renderQueue = new Map<HTMLElement, string>()
  let renderFrame: number | null = null

  function followScroll(force = false): () => void {
    if (restoring) return () => {}
    const follow = force || history.scrollHeight - history.scrollTop - history.clientHeight < 72
    return () => {
      if (follow) requestAnimationFrame(() => { history.scrollTop = history.scrollHeight })
    }
  }
  function emptyState(): void {
    empty.hidden = messages.childElementCount > 0
    emptyDescription.textContent = workdir
      ? t('Опишите задачу: например, попросите создать файл или разобраться в коде.')
      : t('Выберите рабочую папку слева, затем напишите задачу для Qwen.')
  }
  function row(role: string, text: string, label?: string, parent = messages as HTMLElement): { element: HTMLElement; content: HTMLElement } {
    const element = document.createElement('article')
    element.className = `message ${role}`
    if (label) {
      const name = document.createElement('span')
      name.className = 'message-label'
      if (role === 'assistant') {
        const logo = document.createElement('img'); logo.src = document.querySelector<HTMLImageElement>('.brand-logo')?.src ?? ''; logo.alt = ''; logo.className = 'message-avatar'; name.append(logo)
      }
      name.append(document.createTextNode(label))
      element.append(name)
    }
    const content = document.createElement('div')
    content.className = 'message-content'
    content.textContent = text
    element.append(content)
    parent.append(element)
    emptyState()
    return { element, content }
  }
  function queueMarkdown(element: HTMLElement, text: string): void {
    renderQueue.set(element, text)
    if (renderFrame !== null) return
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null
      const follow = followScroll()
      for (const [target, source] of renderQueue) if (target.isConnected) renderMarkdown(target, source)
      renderQueue.clear()
      follow()
    })
  }
  function flushMarkdown(): void {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame)
    renderFrame = null
    for (const [target, source] of renderQueue) if (target.isConnected) renderMarkdown(target, source)
    renderQueue.clear()
  }
  function createActivity(): void {
    legacyFinalCandidate = undefined
    legacySuccessfulTurn = false
    const element = document.createElement('details')
    element.className = 'activity'
    element.open = true
    element.dataset.state = 'running'
    const summary = document.createElement('summary')
    const title = document.createElement('span')
    title.className = 'activity-title'
    title.textContent = t('Ход работы')
    const badge = document.createElement('span')
    badge.className = 'activity-badge'
    badge.textContent = t('Выполняется')
    summary.append(title, badge)
    const items = document.createElement('div')
    items.className = 'activity-items'
    const placeholder = document.createElement('p')
    placeholder.className = 'activity-placeholder'
    placeholder.textContent = t('Запрос запущен. Ожидаю события модели…')
    const note = document.createElement('p')
    note.className = 'activity-note'
    note.hidden = true
    element.append(summary, placeholder, items, note)
    messages.append(element)
    activity = { element, title, badge, items, placeholder, note }
    emptyState()
  }
  function activityChanged(): void {
    if (activity) activity.placeholder.hidden = thinkingRows.size > 0 || activity.items.childElementCount > 0
    update()
  }
  function promoteFinal(messageId: string): void {
    const element = outputs.get(messageId)?.closest<HTMLElement>('.message')
    if (!element || !activity) return
    if (activity.finalId && activity.finalId !== messageId) {
      const previous = outputs.get(activity.finalId)?.closest<HTMLElement>('.message')
      if (previous) { delete previous.dataset.final; activity.items.append(previous) }
    }
    activity.finalId = messageId
    element.dataset.final = 'true'
    messages.append(element)
  }
  function finishActivity(cancelled: boolean): void {
    if (!activity) return
    for (const item of thinkingRows.values()) {
      item.running = false
      item.state.textContent = cancelled ? t('Остановлено') : t('Завершено')
    }
    for (const item of toolRows.values()) {
      if (item.running) {
        item.running = false
        item.status.textContent = cancelled ? t('Остановлено') : t('Вызов завершён')
        item.element.dataset.state = 'closed'
      }
    }
    activity.element.dataset.state = cancelled ? 'stopped' : hadError ? 'error' : 'done'
    activity.badge.textContent = cancelled ? t('Остановлено') : hadError ? t('Есть ошибки') : t('Завершено')
    activity.placeholder.hidden = true
    if (!thinkingRows.size && toolRows.size) {
      activity.note.textContent = t('Текст thinking не передан моделью. Выше показаны реальные вызовы инструментов.')
      activity.note.hidden = false
    }
    if (activity.finalId && !cancelled) activity.element.open = false
    if (!activity.items.childElementCount) activity.element.remove()
  }
  function showThinking(event: Extract<QwenEvent, { type: 'thinking' }>): void {
    if (!event.text.trim() || !activity) return
    let item = thinkingRows.get(event.messageId)
    if (!item) {
      const element = document.createElement('details')
      element.className = 'thinking-panel'
      element.open = true
      const summary = document.createElement('summary')
      const title = document.createElement('span')
      title.textContent = t('Рассуждения модели')
      const state = document.createElement('span')
      state.className = 'thinking-state'
      summary.append(title, state)
      const body = document.createElement('pre')
      body.className = 'thinking-content'
      element.append(summary, body)
      activity.items.append(element)
      item = { element, body, state, running: false }
      thinkingRows.set(event.messageId, item)
    }
    const follow = item.body.scrollHeight - item.body.scrollTop - item.body.clientHeight < 48
    item.body.textContent = event.text.replace(/^\s*\n/, '').trimEnd()
    if (follow) item.body.scrollTop = item.body.scrollHeight
    item.running = event.state === 'streaming'
    item.state.textContent = item.running ? t('В процессе') : t('Завершено')
    activityChanged()
  }
  function describeTool(name: string, input: unknown): string {
    const names: Record<string, string> = {
      read_file: t('Чтение файла'), write_file: t('Запись файла'), edit: t('Редактирование'),
      run_shell_command: t('Выполнение команды'), glob: t('Поиск файлов'), grep_search: t('Поиск в коде'),
      web_fetch: t('Загрузка страницы'), tool_search: t('Поиск инструмента'), tool_call: t('Вызов инструмента')
    }
    const args = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    // Deferred MCP tools are called through tool_call in this CLI version.
    // Display the underlying name while retaining the full wrapper arguments.
    const wrapped = name === 'tool_call' && typeof args.name === 'string' ? args.name : undefined
    const nested = wrapped && args.arguments && typeof args.arguments === 'object'
      ? args.arguments as Record<string, unknown> : args
    const detail = [nested.file_path, nested.path, nested.command, nested.pattern, nested.url, nested.query]
      .find(value => typeof value === 'string' && value.trim())
    return `${wrapped ?? names[name] ?? name}${typeof detail === 'string' ? ` · ${detail.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`
  }
  function showTool(event: Extract<QwenEvent, { type: 'tool' }>): void {
    if (!activity) return
    let item = toolRows.get(event.toolId)
    if (!item) {
      const element = document.createElement('details')
      element.className = 'tool-entry'
      const summary = document.createElement('summary')
      const title = document.createElement('span')
      title.className = 'tool-title'
      const status = document.createElement('span')
      status.className = 'tool-status'
      summary.append(title, status)
      const params = document.createElement('pre')
      params.className = 'tool-data'
      params.hidden = true
      const output = document.createElement('pre')
      output.className = 'tool-data tool-output'
      output.hidden = true
      element.append(summary, params, output)
      activity.items.append(element)
      item = { element, title, status, params, output, name: event.name, running: false }
      toolRows.set(event.toolId, item)
    }
    item.name = event.name
    item.title.textContent = describeTool(event.name, event.input)
    item.title.title = event.name
    item.running = event.state === 'running'
    item.element.dataset.state = event.state
    item.status.textContent = { running: t('Выполняется'), done: t('Завершено'), error: t('Ошибка') }[event.state]
    if (event.input !== undefined) {
      item.params.textContent = `${event.name}\n${JSON.stringify(event.input, null, 2)}`
      item.params.hidden = false
    }
    if (event.output) { item.output.textContent = event.output; item.output.hidden = false }
    if (event.state === 'error') { hadError = true; item.element.open = true }
    activityChanged()
  }
  function notice(text: string, kind: 'system' | 'warning' | 'error' = 'system'): void {
    const follow = followScroll()
    row(kind === 'system' ? 'system' : `system ${kind}`, text)
    follow()
  }
  function fail(error: unknown): void {
    notice(error instanceof Error ? error.message : String(error), 'error')
  }
  function check<T>(reply: Reply<T>): reply is { ok: true; value: T } {
    if (!reply.ok) notice(reply.error, 'error')
    return reply.ok
  }
  function update(): void {
    const busy = action !== null || requestId !== null || skillTestsRunning
    input.disabled = !ready || !workdir || !hasReadableChat || busy
    choose.disabled = !ready || busy
    reset.disabled = !ready || !workdir || busy
    stop.disabled = !ready || requestId === null || stopping
    submit.disabled = input.disabled || !input.value.trim()
    modeSelect.disabled = !ready || !activeChatId || busy
    settingsButton.disabled = !ready || busy
    coreToolsButton.disabled = !ready || busy
    mcpButton.disabled = !ready || busy
    skillsButton.disabled = !ready || busy
    testerButton.disabled = !ready || action!==null || requestId!==null
    promptButton.disabled = !ready || busy
    modelsButton.disabled = !ready || busy
    modelSelect.disabled = !ready || !activeChatId || busy
    inheritedMode.textContent = modeOverride ? t('Из настроек') : msg`Из настроек · ${MODE_INFO[currentMode].label}`
    modeSelect.value = modeOverride ? currentMode : '__settings'
    modeSelect.title = msg`${MODE_INFO[currentMode].description} Режим меняется между запросами.`
    modeControl.dataset.mode = currentMode
    input.placeholder = !ready ? t('Нет подключения к приложению') : !workdir
      ? t('Сначала выберите рабочую папку') : busy ? t('Qwen работает…') : t('Напишите задачу для Qwen…')
    let text = workdir ? t('Готов к задаче') : t('Выберите рабочую папку')
    let state = workdir ? 'ready' : 'idle'
    if (!ready) { text = t('Ошибка подключения к приложению'); state = 'error' }
    else if (action === 'folder') { text = t('Выбор рабочей папки…'); state = 'running' }
    else if (action === 'reset') { text = t('Создание диалога…'); state = 'running' }
    else if (action === 'chat') { text = t('Загрузка истории…'); state = 'running' }
    else if (action === 'mode') { text = t('Изменение режима…'); state = 'running' }
    else if (stopping) { text = t('Остановка…'); state = 'running' }
    else if (permissions.size) { text = t('Ожидает подтверждения операции'); state = 'waiting' }
    else if (requestId) {
      text = [...thinkingRows.values()].some(item => item.running) ? t('Модель рассуждает…') : t('Qwen работает…')
      state = 'running'
    }
    if (booting) { text = t('Загрузка рабочих папок и диалогов…'); state = 'running' }
    else if (storageFailed) { text = t('Ошибка сохранения истории'); state = 'error' }
    status.textContent = allowAll && ready && workdir ? msg`${text} · Всё разрешено в этом диалоге` : text
    dot.dataset.state = state
    document.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('#ui-language,#open-connection-setup').forEach(el=>{el.disabled=!ready||busy})
    tree.querySelectorAll('button').forEach(button => { button.disabled = !ready || busy })
    tree.querySelectorAll<HTMLDetailsElement>('.chat-menu').forEach(menu => { menu.inert = !ready || busy })
  }
  function clearMessages(): void {
    allowAll = false
    if (renderFrame !== null) cancelAnimationFrame(renderFrame)
    renderFrame = null
    renderQueue.clear()
    messages.replaceChildren()
    outputs.clear()
    toolRows.clear()
    thinkingRows.clear()
    activity = undefined
    permissions.clear()
    emptyState()
  }
  function resizeInput(): void {
    input.style.height = 'auto'
    input.style.height = `${Math.min(180, Math.max(76, input.scrollHeight))}px`
  }

  function icon(kind: 'chevron' | 'more' | 'close' | 'gear' | 'tools'): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16')
    svg.setAttribute('aria-hidden', 'true')
    if (kind !== 'more') {
      const path = document.createElementNS(ns, 'path')
      const paths = { chevron: 'm9 5 7 7-7 7', close: 'm6 6 12 12M18 6 6 18',
        gear: 'm9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3z',
        tools: 'm14 6 4 4M3 21l7-7M15 3a6 6 0 0 0-5 9L3 19l2 2 7-7a6 6 0 0 0 9-5l-4 4-4-4 4-4z' }
      path.setAttribute('d', paths[kind])
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.7'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round')
      svg.append(path)
      if (kind === 'gear') {
        const circle = document.createElementNS(ns, 'circle')
        circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '3')
        circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', '1.7'); svg.append(circle)
      }
    } else for (const x of ['5', '12', '19']) {
      const circle = document.createElementNS(ns, 'circle')
      circle.setAttribute('cx', x); circle.setAttribute('cy', '12'); circle.setAttribute('r', '1.7')
      circle.setAttribute('fill', 'currentColor'); svg.append(circle)
    }
    return svg
  }

  function renderSidebar(): void {
    const closedOpen=tree.querySelector<HTMLDetailsElement>('.closed-workdirs')?.open??false
    tree.replaceChildren()
    const openDirs = workspace.workdirs.filter(dir => !dir.closed)
    workdirEmpty.hidden = openDirs.length > 0
    workdirEmpty.textContent = t('Нет открытых папок')
    workdirItem.hidden = true
    for (const dir of openDirs) {
      const section = document.createElement('section')
      section.className = 'saved-workdir'
      section.dataset.workdirId = dir.id
      const heading = document.createElement('div')
      heading.className = 'saved-workdir-heading'
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'workdir-toggle'
      toggle.append(icon('chevron'))
      toggle.setAttribute('aria-label', msg`Диалоги в ${dir.name}`)
      toggle.setAttribute('aria-expanded', String(expanded.has(dir.id)))
      toggle.addEventListener('click', () => {
        if (expanded.has(dir.id)) expanded.delete(dir.id); else expanded.add(dir.id)
        renderSidebar(); update()
      })
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'workdir-select'
      open.title = dir.path
      open.textContent = dir.name
      open.addEventListener('click', () => { void switchView(() => api.selectWorkdir(dir.id)) })
      const active = workspace.chats.find(chat => chat.id === activeChatId)?.workdirId === dir.id
      if (active) heading.classList.add('selected-workdir')
      const close = document.createElement('button')
      close.type = 'button'; close.className = 'workdir-close'; close.title = msg`Закрыть папку «${dir.name}»`
      close.setAttribute('aria-label', close.title); close.dataset.closeWorkdir = dir.id; close.append(icon('close'))
      close.addEventListener('click', () => { void switchView(() => api.closeWorkdir(dir.id)) })
      heading.append(toggle, open, close)
      const list = document.createElement('ul')
      list.className = 'saved-chat-list'
      list.hidden = !expanded.has(dir.id)
      for (const chat of workspace.chats.filter(item => item.workdirId === dir.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        const item = document.createElement('li')
        item.className = 'saved-chat-row'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'saved-chat'
        button.dataset.chatId = chat.id
        button.title = !chat.customTitle&&chat.status==='empty'&&chat.title==='Новый диалог'?t('Новый диалог'):chat.title
        button.setAttribute('aria-current', chat.id === activeChatId ? 'true' : 'false')
        const title = document.createElement('span')
        title.className = 'saved-chat-title'
        title.textContent = !chat.customTitle&&chat.status==='empty'&&chat.title==='Новый диалог'?t('Новый диалог'):chat.title
        const detail = document.createElement('span')
        detail.className = 'saved-chat-detail'
        const date = new Date(chat.updatedAt)
        const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        detail.textContent = `${chat.status === 'running' ? t('Выполняется · ') : chat.status === 'interrupted' ? t('Прерван · ') : ''}${when}`
        button.append(title, detail)
        button.addEventListener('click', () => { void switchView(() => api.selectChat(chat.id)) })
        const menu = document.createElement('details')
        menu.className = 'chat-menu'
        const trigger = document.createElement('summary')
        trigger.className = 'chat-menu-trigger'
        trigger.title = msg`Действия с чатом «${chat.title}»`
        trigger.setAttribute('aria-label', trigger.title)
        trigger.append(icon('more'))
        const actions = document.createElement('div')
        actions.className = 'chat-menu-actions'
        for (const [label, mode] of [[t('Переименовать'), 'rename'], [t('Удалить'), 'delete']] as const) {
          const control = document.createElement('button')
          control.type = 'button'; control.textContent = label
          control.className = `chat-${mode}`
          control.addEventListener('click', () => { menu.open = false; manageChat(chat.id, mode) })
          actions.append(control)
        }
        menu.append(trigger, actions)
        menu.addEventListener('toggle', () => {
          if (menu.open) tree.querySelectorAll<HTMLDetailsElement>('.chat-menu').forEach(other => { if (other !== menu) other.open = false })
        })
        item.append(button, menu); list.append(item)
      }
      section.append(heading, list)
      tree.append(section)
    }
    const closedDirs = workspace.workdirs.filter(dir => dir.closed)
    if (closedDirs.length) {
      const closed = document.createElement('details'); closed.className = 'closed-workdirs';closed.open=closedOpen
      const summary = document.createElement('summary'); summary.textContent = msg`Закрытые папки (${closedDirs.length})`
      closed.append(summary)
      for (const dir of closedDirs) {
        const reopen = document.createElement('button')
        reopen.type = 'button'; reopen.className = 'workdir-reopen'; reopen.title = dir.path
        reopen.dataset.reopenWorkdir = dir.id; reopen.textContent = dir.name
        reopen.addEventListener('click', () => { void switchView(() => api.selectWorkdir(dir.id)) })
        closed.append(reopen)
      }
      tree.append(closed)
    }
  }

  function showWorkspace(value: WorkspaceView): void {
    skillTestsRunning=Boolean(value.skillTestsRunning)
    selectedModelId=value.modelProfileId??null
    clearMessages()
    input.value = ''
    resizeInput()
    workspace = value.index
    activeChatId = value.index.activeChatId
    void refreshStudio()
    hasReadableChat = value.chat !== null
    const summary = workspace.chats.find(chat => chat.id === activeChatId)
    const dir = workspace.workdirs.find(item => item.id === summary?.workdirId)
    workdir = dir?.path ?? ''
    workspaceName.textContent = dir?.name ?? t('Папка не выбрана')
    workspacePath.textContent = workdir || t('Откройте папку проекта, чтобы начать.')
    workspacePath.title = workdir
    workdirName.textContent = dir?.name ?? ''
    chatCaption.textContent = value.chat&&!value.chat.customTitle&&value.chat.status==='empty'&&value.chat.title==='Новый диалог'?t('Новый диалог'):value.chat?.title??''
    if (dir) expanded.add(dir.id)
    restoring = true
    try {
      for (const turn of value.chat?.turns ?? []) {
        requestId = turn.requestId
        outputs.clear(); toolRows.clear(); thinkingRows.clear(); permissions.clear()
        hadError = turn.status === 'error'
        row('user', turn.prompt, t('Вы'))
        createActivity()
        legacySuccessfulTurn = turn.status === 'done'
        for (const event of turn.events) onEvent(event)
        if (requestId !== null) onEvent({ requestId: turn.requestId, type: 'done',
          cancelled: turn.status === 'interrupted' || turn.status === 'stopped' })
      }
    } finally { restoring = false; requestId = null; stopping = false }
    allowAll = value.allowAll
    currentMode = value.mode
    modeOverride = value.modeOverride
    storageFailed = false
    renderSidebar()
    for (const warning of value.warnings) notice(translateMessage(warning), 'warning')
    emptyState()
    update()
    followScroll(true)()
  }

  async function switchView(operation: () => Promise<Reply<WorkspaceView>>): Promise<void> {
    if (!ready || action || requestId) return
    action = 'chat'; update()
    try { const reply = await operation(); if (check(reply)) showWorkspace(reply.value) }
    catch (error) { fail(error) }
    finally { action = null; update(); if (!input.disabled) input.focus() }
  }

  function applyMode(value: WorkspaceView): void {
    skillTestsRunning=Boolean(value.skillTestsRunning)
    selectedModelId=value.modelProfileId??null
    renderModels()
    currentMode = value.mode; modeOverride = value.modeOverride; allowAll = value.allowAll
    update()
  }
  modeSelect.addEventListener('change', async () => {
    if (!ready || action || requestId || !activeChatId) return
    const mode = modeSelect.value === '__settings' ? null : modeSelect.value as ApprovalMode
    action = 'mode'; update()
    try { const reply = await api.setMode(mode); if (check(reply)) applyMode(reply.value) }
    catch (error) { fail(error) }
    finally { action = null; update(); if (!input.disabled) input.focus() }
  })
  function renderModels():void {
    modelSelect.replaceChildren();const inherited=document.createElement('option');inherited.value='__default';inherited.textContent=t('Из настроек Qwen');modelSelect.append(inherited)
    for(const profile of studioView?.profiles??[]){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.label;modelSelect.append(option)}
    modelSelect.value=selectedModelId??'__default';if(!modelSelect.value)modelSelect.value='__default'
  }
  async function refreshStudio():Promise<void>{
    if(!api)return
    const ownChatId=activeChatId
    try{const reply=await api.getStudio('user');if(!reply.ok||ownChatId!==activeChatId)return;studioView=reply.value;selectedModelId=reply.value.selectedModelId;renderModels();await slashMenu?.refresh()}catch(error){fail(error)}
  }
  const closeStudio=():void=>{action=null;update();void refreshStudio();if(!input.disabled)input.focus()}
  modelsButton.addEventListener('click',()=>{if(!ready||requestId||action)return;action='settings';update();openModels(api,Boolean(activeChatId),()=>{void refreshStudio()},closeStudio)})
  promptButton.addEventListener('click',()=>{if(!ready||requestId||action)return;action='settings';update();openSystemPrompt(api,Boolean(workdir),closeStudio)})
  testerButton.addEventListener('click',()=>{if(!ready||requestId||action)return;action='settings';update();openSkillTests(api,Boolean(workdir),closeStudio)})
  skillsButton.addEventListener('click',()=>{if(!ready||requestId||action)return;action='settings';update();openSkills(api,Boolean(workdir),name=>{input.value=`/${name} `;resizeInput();update();input.focus()},closeStudio)})
  modelSelect.addEventListener('change',async()=>{
    if(!ready||requestId||action||!activeChatId)return
    action='mode';update()
    try{const reply=await api.selectModel(modelSelect.value==='__default'?null:modelSelect.value);if(check(reply)){selectedModelId=reply.value.modelProfileId??null;renderModels()}}catch(error){fail(error)}finally{action=null;update()}
  })
  async function localCommand(prompt:string):Promise<boolean>{
    const match=/^\s*\/([a-zA-Z-]+)(?:\s+([\s\S]*))?$/.exec(prompt.trim());if(!match)return false
    const name=match[1].toLowerCase(),args=(match[2]??'').trim()
    const local=['new','clear','model','skills','system','mcp','settings','tools','approval-mode','help']
    if(!local.includes(name))return false
    await slashMenu?.refresh()
    if(!slashMenu?.commands().some(command=>command.kind==='desktop'&&command.name===name)){notice(msg`Команда /${name} отключена настройками.`,'error');return true}
    input.value='';slashMenu?.hide();resizeInput();update()
    if(name==='help'){notice(t('Команды Desktop: /new, /clear, /model, /skills, /system, /mcp, /settings, /tools, /approval-mode. /имя-skill вызывает skill. Команды Qwen, например /init, /compress и /context, передаются CLI. ↑/↓ выбирают пункт меню, Tab вставляет команду, Enter отправляет.'));return true}
    if(name==='new'||name==='clear'){reset.click();return true}
    if(name==='model'&&args){const profile=studioView?.profiles.find(p=>p.id===args||p.label.toLocaleLowerCase()===args.toLocaleLowerCase());if(!profile&&!['default','__default'].includes(args)){notice(t('Модель не найдена. Добавьте профиль через /model.'),'error');return true}action='mode';update();try{const reply=await api.selectModel(profile?.id??null);if(check(reply)){selectedModelId=reply.value.modelProfileId??null;renderModels();notice(msg`Модель: ${reply.value.modelLabel??t('из настроек Qwen')}.`)}}finally{action=null;update()};return true}
    if(name==='approval-mode'){if(args){const requested=args==='ask'?'default':args;const option=Array.from(modeSelect.options).find(o=>o.value===requested);if(!option){notice(t('Режимы: plan, default (Ask), auto-edit, auto, yolo.'),'error');return true}modeSelect.value=requested;modeSelect.dispatchEvent(new Event('change',{bubbles:true}))}else modeSelect.focus();return true}
    if(args){notice(msg`Команда /${name} открывает панель без аргументов. Skill вызывается как /имя-skill.`,'warning');return true}
    const target:Record<string,HTMLButtonElement>={model:modelsButton,skills:skillsButton,system:promptButton,mcp:mcpButton,settings:settingsButton,tools:coreToolsButton};target[name]?.click();return true
  }
  mcpButton.addEventListener('click', () => {
    if (!ready || requestId || action) return
    action = 'settings'; update()
    openMcp(api, Boolean(workdir), () => { action = null; update(); if (!input.disabled) input.focus() })
  })
  settingsButton.addEventListener('click', () => {
    if (!ready || action || requestId) return
    action = 'settings'; update()
    openSettings(api, Boolean(workdir), value => {
      applyMode(value)
      for (const warning of value.warnings) notice(translateMessage(warning), 'warning')
    }, () => { action = null; update(); if (!input.disabled) input.focus() })
  })
  coreToolsButton.addEventListener('click', () => {
    if (!ready || action || requestId) return
    action = 'settings'; update()
    openCoreTools(api, Boolean(workdir), () => { action = null; update(); if (!input.disabled) input.focus() })
  })

  function manageChat(chatId: string, mode: 'rename' | 'delete'): void {
    if (!ready || action || requestId) return
    const chat = workspace.chats.find(item => item.id === chatId)
    if (!chat) return
    action = 'manage'; update()
    const ownChatId = activeChatId, draft = input.value
    const dialog = document.createElement('dialog')
    dialog.className = 'chat-dialog'
    const heading = document.createElement('h2')
    heading.id = `chat-dialog-${crypto.randomUUID()}`
    heading.textContent = mode === 'rename' ? t('Переименовать диалог') : t('Удалить диалог?')
    dialog.setAttribute('aria-labelledby', heading.id)
    const form = document.createElement('form')
    const label = document.createElement('label')
    label.textContent = t('Название диалога')
    const name = document.createElement('input')
    name.type = 'text'; name.value = chat.title; name.maxLength = 120
    name.id = `${heading.id}-name`; label.htmlFor = name.id
    const explanation = document.createElement('p')
    explanation.textContent = msg`История «${chat.title}» будет удалена из Qwen Desktop.`
    const error = document.createElement('p')
    error.className = 'chat-dialog-error'; error.setAttribute('role', 'alert')
    const controls = document.createElement('div')
    controls.className = 'chat-dialog-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'; cancel.className = 'button button-secondary'; cancel.textContent = t('Отмена')
    const save = document.createElement('button')
    save.type = 'submit'; save.className = `button ${mode === 'delete' ? 'button-danger' : 'button-primary'}`
    save.textContent = mode === 'rename' ? t('Сохранить') : t('Удалить')
    controls.append(cancel, save)
    form.append(heading)
    if (mode === 'rename') form.append(label, name); else form.append(explanation)
    form.append(error, controls); dialog.append(form); document.body.append(dialog)
    let sending = false
    const close = (): void => { dialog.close(); dialog.remove(); action = null; update(); if (!input.disabled) input.focus() }
    cancel.addEventListener('click', () => { if (!sending) close() })
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!sending) close() })
    form.addEventListener('submit', async event => {
      event.preventDefault()
      if (sending) return
      const title = name.value.trim().replace(/\s+/g, ' ')
      if (mode === 'rename' && !title) { error.textContent = t('Введите название диалога.'); name.focus(); return }
      sending = true; save.disabled = true; cancel.disabled = true; name.disabled = true
      error.textContent = ''
      try {
        const reply = mode === 'rename' ? await api.renameChat(chatId, title) : await api.deleteChat(chatId)
        if (!reply.ok) { error.textContent = reply.error; return }
        close(); showWorkspace(reply.value)
        if (activeChatId === ownChatId) { input.value = draft; resizeInput(); update() }
      } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause) }
      finally { sending = false; save.disabled = false; cancel.disabled = false; name.disabled = false }
    })
    dialog.showModal()
    if (mode === 'rename') { name.focus(); name.select() } else cancel.focus()
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.chat-menu')) {
      tree.querySelectorAll<HTMLDetailsElement>('.chat-menu').forEach(menu => { menu.open = false })
    }
  })

  nav.addEventListener('click', () => {
    const collapsed = workdirs.classList.toggle('collapsed')
    nav.setAttribute('aria-expanded', String(!collapsed))
    nav.querySelector('.nav-chevron')?.classList.toggle('collapsed', collapsed)
  })

  function closePermission(id: string, text: string): void {
    const pending = permissions.get(id)
    if (!pending) return
    pending.buttons.forEach(button => { button.disabled = true })
    pending.result.textContent = text
    permissions.delete(id)
    update()
  }
  function permissionResult(decision: PermissionDecision): string {
    return {
      'allow-once': t('Операция разрешена один раз.'),
      'allow-session': restoring ? t('Во время этого запроса были разрешены все операции. Сохранённая карточка не включает автоодобрение.') :
        t('Все операции разрешены в этом чате, включая shell и MCP. Переключение чатов сохраняет выбор до закрытия приложения.'),
      deny: t('Операция не разрешена.')
    }[decision]
  }
  function showPermission(event: Extract<QwenEvent, { type: 'permission' }>): void {
    if (permissions.has(event.permissionId)) return
    const follow = followScroll()
    const element = document.createElement('article')
    element.className = 'message permission'
    const title = document.createElement('h3')
    title.className = 'permission-title'
    title.textContent = msg`Разрешить ${event.tool}?`
    const details = document.createElement('details')
    details.className = 'permission-details'
    const summary = document.createElement('summary')
    summary.textContent = t('Параметры операции')
    const pre = document.createElement('pre')
    pre.textContent = event.details
    details.append(summary, pre)
    const actions = document.createElement('div')
    actions.className = 'permission-actions'
    const result = document.createElement('p')
    result.className = 'permission-result'
    const buttons: HTMLButtonElement[] = []
    for (const [text, decision] of (restoring ? [] : [
      [t('Разрешить один раз'), 'allow-once'],
      [t('Разрешить всё в этом диалоге'), 'allow-session'],
      [t('Отклонить'), 'deny']
    ] as const)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `button ${decision === 'allow-once' ? 'button-primary' : 'button-secondary'}`
      button.textContent = text
      if (decision === 'allow-session') {
        button.title = t('Автоматически подтверждать операции shell и MCP только в этом чате до закрытия приложения.')
      }
      button.addEventListener('click', async () => {
        buttons.forEach(item => { item.disabled = true })
        result.textContent = t('Отправка решения…')
        try {
          const reply = await api.approve(event.permissionId, decision)
          if (!permissions.has(event.permissionId)) return
          if (check(reply)) {
            closePermission(event.permissionId, permissionResult(decision))
          } else {
            result.textContent = t('Решение не принято. Попробуйте ещё раз или остановите запрос.')
            buttons.forEach(item => { item.disabled = false })
          }
        } catch (error) {
          if (!permissions.has(event.permissionId)) return
          fail(error)
          result.textContent = t('Не удалось отправить решение. Повторите попытку.')
          buttons.forEach(item => { item.disabled = false })
        }
      })
      buttons.push(button)
      actions.append(button)
    }
    element.append(title, details, actions, result)
    if (restoring) result.textContent = t('Сохранённый запрос разрешения. Подтвердить его повторно нельзя.')
    ;(activity?.items ?? messages).append(element)
    activityChanged()
    permissions.set(event.permissionId, { element, result, buttons })
    emptyState()
    update()
    follow()
  }

  function onEvent(event: QwenEvent): void {
    if (event.type === 'storage-error') { storageFailed = true; notice(event.text, 'error'); update(); return }
    if (event.requestId !== requestId) return
    const follow = followScroll()
    switch (event.type) {
      case 'text': {
        if (!event.text.trim()) break
        let content = outputs.get(event.messageId)
        if (!content) {
          content = row('assistant', '', 'Qwen', activity?.items ?? messages).content
          content.classList.add('markdown-body')
          outputs.set(event.messageId, content)
        }
        queueMarkdown(content, event.text)
        legacyFinalCandidate = event.messageId
        activityChanged()
        break
      }
      case 'final': {
        let content = outputs.get(event.messageId)
        if (!content) {
          content = row('assistant', '', 'Qwen', activity?.items ?? messages).content
          content.classList.add('markdown-body'); outputs.set(event.messageId, content)
        }
        queueMarkdown(content, event.text)
        promoteFinal(event.messageId)
        break
      }
      case 'thinking': showThinking(event); break
      case 'tool': legacyFinalCandidate = undefined; showTool(event); break
      case 'approval-mode':
        if (!restoring) {
          allowAll = event.allowAll
          if (event.mode) currentMode = event.mode
          if (event.allowAll) modeOverride = true
        }
        update(); break
      case 'permission': showPermission(event); break
      case 'permission-closed':
        closePermission(event.permissionId, permissionResult(event.decision ?? (event.allowed ? 'allow-once' : 'deny')))
        break
      case 'warning': notice(event.text, 'warning'); break
      case 'error': hadError = true; notice(event.text, 'error'); break
      case 'done':
        if (restoring && legacySuccessfulTurn && !activity?.finalId && legacyFinalCandidate) promoteFinal(legacyFinalCandidate)
        if (!restoring) allowAll = event.allowAll ?? false
        if (!restoring && event.mode) currentMode = event.mode
        flushMarkdown()
        for (const id of [...permissions.keys()]) closePermission(id, t('Запрос подтверждения закрыт.'))
        finishActivity(event.cancelled)
        if (event.cancelled) notice(t('Запрос остановлен.'))
        requestId = null
        stopping = false
        update()
        if (!restoring) {
          input.focus()
          const ownChatId = activeChatId
          void api.load().then(reply => {
            if (!reply.ok || requestId || action || activeChatId !== ownChatId) return
            workspace = reply.value.index
            applyMode(reply.value)
            void refreshStudio()
            renderSidebar(); update()
          }).catch(error => { if (activeChatId === ownChatId) fail(error) })
        }
        break
    }
    follow()
  }

  // Opening index.html in a regular browser does not supply the preload API.
  // Show a readable error rather than leaving a misleading "initialized" label.
  const bridge = window.api as QwenAPI | undefined
  if (!bridge || ['prepareRuntime','cancelRuntime','getConnectionState','setUiLanguage','completeOnboarding','testConnection','cancelConnectionTest','load', 'selectFolder', 'selectChat', 'selectWorkdir', 'closeWorkdir', 'renameChat', 'deleteChat', 'setMode', 'getStudio', 'getCommands', 'getSkills','getSkillDirectory','getSkillTests','onSkillTestEvent', 'saveModel', 'savePrompt', 'selectModel', 'getSettings', 'saveSettings', 'getCoreTools', 'saveCoreTools', 'start', 'cancel', 'newChat', 'approve', 'onEvent']
    .some(name => typeof bridge[name as keyof QwenAPI] !== 'function')) {
    booting = false
    notice(t('Нет актуального window.api. Запустите приложение через Electron и проверьте, что preload/index.ts обновлён и собран.'), 'error')
    update()
    return
  }
  api = localizedApi(bridge)
  const refreshLanguage=async():Promise<void>=>{
    const draft=input.value,selectionStart=input.selectionStart,selectionEnd=input.selectionEnd
    const top=history.scrollTop,navTop=navigation?.scrollTop??0
    const disclosure=Array.from(messages.querySelectorAll<HTMLDetailsElement>('details')).map(node=>node.open)
    const expandedBefore=[...expanded],closedOpen=tree.querySelector<HTMLDetailsElement>('.closed-workdirs')?.open??false
    action='settings'
    localizeShell();renderModels();update()
    disposeTheme();disposeTheme=initTheme(api)
    try{
      const reply=await api.load()
      if(check(reply))showWorkspace(reply.value)
      expanded.clear();expandedBefore.forEach(id=>expanded.add(id));renderSidebar()
      const closed=tree.querySelector<HTMLDetailsElement>('.closed-workdirs');if(closed)closed.open=closedOpen
      messages.querySelectorAll<HTMLDetailsElement>('details').forEach((node,index)=>{if(index<disclosure.length)node.open=disclosure[index]})
    }finally{
      input.value=draft;resizeInput();input.setSelectionRange(selectionStart,selectionEnd)
      history.scrollTop=top;if(navigation)navigation.scrollTop=navTop
      action=null;update()
    }
  }
  const desktopReady=initDesktop(api,refreshLanguage,async()=>{const reply=await api.load();if(check(reply))showWorkspace(reply.value);await refreshStudio()}).catch(fail)
  slashMenu=initSlashMenu(api,input)
  void slashMenu.refresh().catch(fail)
  let disposeTheme = initTheme(api)
  window.addEventListener('beforeunload',()=>disposeTheme(), { once: true })
  document.querySelectorAll<HTMLButtonElement>('.starter').forEach(button => button.addEventListener('click', () => {
    if (input.disabled) { choose.click(); return }
    input.value = button.dataset.prompt ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus()
  }))
  try {
    unsubscribe = api.onEvent(onEvent)
    const offTests=api.onSkillTestEvent(event=>{skillTestsRunning=event.active;testerLabel.textContent=skillTestsRunning?t('Skills Lab · выполняется'):t('Skills Lab');update()});window.addEventListener('beforeunload',offTests,{once:true})
  } catch (error) { booting = false; fail(error); update(); return }
  void api.load().then(async reply => {
    if (check(reply)) { await desktopReady;ready = true; showWorkspace(reply.value);try{const raw=sessionStorage.getItem('qwen-language-draft');if(raw){const draft=JSON.parse(raw);sessionStorage.removeItem('qwen-language-draft');if(draft.chatId===activeChatId&&typeof draft.text==='string'){input.value=draft.text;resizeInput()}}}catch{} }
  }).catch(fail).finally(() => { booting = false; update() })
  window.addEventListener('beforeunload', () => unsubscribe?.(), { once: true })

  choose.addEventListener('click', async () => {
    if (!ready || action || requestId) return
    action = 'folder'
    update()
    try {
      const reply = await api.selectFolder()
      if (!check(reply) || !reply.value) return
      showWorkspace(reply.value)
    } catch (error) { fail(error) }
    finally { action = null; update(); if (!input.disabled) input.focus() }
  })

  reset.addEventListener('click', async () => {
    if (!ready || !workdir || action || requestId) return
    action = 'reset'
    update()
    try { const reply = await api.newChat(); if (check(reply)) showWorkspace(reply.value) }
    catch (error) { fail(error) }
    finally { action = null; update(); if (!input.disabled) input.focus() }
  })

  stop.addEventListener('click', async () => {
    if (!ready || !requestId || stopping) return
    const ownId = requestId
    stopping = true
    update()
    try {
      const reply = await api.cancel()
      if (requestId === ownId && !check(reply)) { stopping = false; update() }
    } catch (error) {
      if (requestId === ownId) { fail(error); stopping = false; update() }
    }
    // done from main is the only event that releases the run lock.
  })

  async function send(): Promise<void> {
    if (!ready || !workdir || action || requestId || !input.value.trim()) return
    const prompt = input.value
    try{if(await localCommand(prompt))return}catch(error){fail(error);return}
    if(action||requestId)return
    slashMenu?.hide()
    const ownId = crypto.randomUUID()
    requestId = ownId
    stopping = false
    outputs.clear()
    toolRows.clear()
    thinkingRows.clear()
    hadError = false
    input.value = ''
    resizeInput()
    row('user', prompt, t('Вы'))
    const summary = workspace.chats.find(chat => chat.id === activeChatId)
    if (summary) {
      if (summary.status === 'empty' && !summary.customTitle) summary.title = prompt.trim().replace(/\s+/g, ' ').slice(0, 70)
      summary.updatedAt = new Date().toISOString(); summary.status = 'running'
      chatCaption.textContent = summary.title
      renderSidebar()
    }
    createActivity()
    followScroll(true)()
    update()
    try {
      const reply = await api.start({ requestId: ownId, prompt })
      if (requestId !== ownId) return
      if (!check(reply)) {
        hadError = true
        finishActivity(false)
        requestId = null
        stopping = false
        input.value = prompt
        resizeInput()
        update()
        input.focus()
      }
    } catch (error) {
      if (requestId !== ownId) return
      fail(error)
      hadError = true
      finishActivity(false)
      requestId = null
      stopping = false
      input.value = prompt
      resizeInput()
      update()
      input.focus()
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void send() })
  input.addEventListener('input', () => { resizeInput(); update() })
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    }
  })
  emptyState()
  update()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
else init()
