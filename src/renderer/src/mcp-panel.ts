import {t,msg,translateMessage,dateLocale} from '../../shared/i18n'
import type { QwenAPI } from '../../shared/qwen'
import type { McpConfig, McpEntry, McpMutation, McpProbeResult, McpView } from '../../shared/mcp'
import type { SettingsScope } from '../../shared/settings'
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n }
const btn = (text: string, cls = 'button button-secondary'): HTMLButtonElement => { const n = el('button', cls, text); n.type = 'button'; return n }
const transportOf = (c: McpConfig): string => c.httpUrl ? 'http' : c.url ? 'sse' : 'stdio'
export function openMcp(api: QwenAPI, hasProject: boolean, onClose: () => void): void {
  const dialog = el('dialog', 'settings-dialog mcp-dialog'); dialog.setAttribute('aria-labelledby', 'mcp-title')
  const header = el('header', 'settings-header'), title = el('h2', '', t('MCP-серверы')); title.id = 'mcp-title'
  const scopes = el('div', 'settings-scopes'), scopeButtons = new Map<SettingsScope, HTMLButtonElement>()
  for (const [scope, label] of [['user', t('Для всех проектов')], ['project', t('Для текущей папки')]] as const) {
    const b = btn(label, ''); b.dataset.scope = scope; b.onclick = () => { if (!busy && scope !== currentScope && discard()) void load(scope) }; scopes.append(b); scopeButtons.set(scope, b)
  }
  const toolbar = el('div', 'mcp-toolbar'), search = el('input', 'settings-search'), add = btn(t('+ Добавить сервер'), 'button button-primary'); add.id = 'mcp-add'
  search.type = 'search'; search.placeholder = t('Найти сервер…'); search.setAttribute('aria-label', t('Поиск MCP-серверов')); toolbar.append(search, add)
  header.append(title, el('p', '', t('Ваши инструменты для Qwen. Подключения сохраняются и обновляются при следующем запросе.')), scopes, toolbar)
  const body = el('div', 'mcp-body'), list = el('nav', 'mcp-servers'), detail = el('section', 'mcp-detail'); list.setAttribute('aria-label', t('MCP-серверы')); body.append(list, detail)
  const path = el('p', 'settings-path'), message = el('p', 'settings-message'); message.setAttribute('role', 'status')
  const footer = el('footer', 'settings-footer'), reload = btn(t('Обновить список')), close = btn(t('Закрыть')), cancelCheck = btn(t('Отменить проверку')); cancelCheck.hidden = true
  footer.append(reload, cancelCheck, close); dialog.append(header, body, path, message, footer); document.body.append(dialog)
  let currentScope: SettingsScope = 'user', view: McpView | undefined, selected: string | null = null, busy = false, probing = false, closed = false, dirty = false, creating = false
  let confirmation: HTMLDialogElement | undefined
  const results = new Map<string, McpProbeResult>()
  const status = (text: string, error = false): void => { message.textContent = text; message.dataset.error = String(error) }
  const discard = (): boolean => { if (!dirty) return true; status(t('Есть несохранённые изменения. Сохраните форму или нажмите «Отменить» в ней.'), true); return false }
  function update(): void {
    reload.disabled = busy || dirty; add.disabled = busy; search.disabled = busy; close.disabled = busy && !probing; cancelCheck.hidden = !probing
    for (const [scope, b] of scopeButtons) { b.disabled = busy || (scope === 'project' && !hasProject); b.setAttribute('aria-pressed', String(scope === currentScope)) }
    list.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = busy })
    detail.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(f => { f.disabled = busy || f.dataset.readonly === 'true' })
  }
  function renderList(): void {
    list.replaceChildren(); const term = search.value.trim().toLocaleLowerCase()
    for (const s of view?.servers ?? []) {
      if (term && !`${s.name} ${s.config.description ?? ''}`.toLocaleLowerCase().includes(term)) continue
      const b = btn('', 'mcp-server'), line = el('span', 'mcp-server-line'), dot = el('span', 'mcp-state-dot'); b.dataset.server = s.name; b.setAttribute('aria-current', String(s.name === selected)); dot.dataset.enabled = String(s.enabled)
      line.append(dot, el('strong', '', s.name)); b.append(line, el('span', 'mcp-server-meta', `${transportOf(s.config).toUpperCase()} · ${s.enabled ? t('Включён') : t('Выключен')}`))
      b.onclick = () => { if (!busy && discard()) { selected = s.name; creating = false; renderList(); renderDetail() } }; list.append(b)
    }
    if (!list.childElementCount) list.append(el('p', 'mcp-list-empty', view?.servers.length ? t('Ничего не найдено') : t('Пока нет подключений'))); update()
  }
  async function mutate(request: McpMutation, success: string): Promise<boolean> {
    if (busy) return false; busy = true; status(t('Сохранение…')); update()
    try {
      const reply = await api.mutateMcp(request); if (closed) return false
      if (!reply.ok) { status(reply.error, true); return false }
      view = reply.value; dirty = false; results.clear(); status(success); return true
    } catch (e) { status(e instanceof Error ? e.message : String(e), true); return false }
    finally { busy = false; if (!closed) update() }
  }
  async function check(entry: McpEntry): Promise<void> {
    if (busy || !view || !discard()) return; busy = true; probing = true; status(t('Проверяю соединение и список инструментов…')); update()
    try {
      const reply = await api.probeMcp({ scope: currentScope, name: entry.name, contextRevision: view.contextRevision }); if (closed) return
      if (!reply.ok) { results.delete(entry.name); status(reply.error, true); return }
      results.set(entry.name, reply.value); status(msg`Проверка успешна: ${reply.value.tools.length} инструментов. Проверочное подключение закрыто; Qwen подключится при следующей задаче.`)
    } catch (e) { status(e instanceof Error ? e.message : String(e), true) }
    finally { busy = false; probing = false; if (!closed) { renderDetail(); update() } }
  }
  function remove(entry: McpEntry): void {
    if (!view || busy || !discard()) return
    const d = el('dialog', 'chat-dialog'); confirmation = d
    const actions = el('div', 'chat-dialog-actions'), no = btn(t('Отмена')), yes = btn(t('Удалить'), 'button button-danger')
    actions.append(no, yes); d.append(el('h2', '', msg`Удалить «${entry.name}»?`), el('p', '', t('Удалится только конфигурация выбранной области. Сервер и его данные останутся. Одноимённая настройка другого уровня снова станет видна.')), actions); document.body.append(d)
    const dismiss = (): void => { d.close(); d.remove(); confirmation = undefined }; no.onclick = dismiss; d.addEventListener('cancel', e => { e.preventDefault(); dismiss() })
    yes.onclick = async () => {
      if (!view || yes.disabled) return; yes.disabled = true; no.disabled = true
      if (await mutate({ action: 'remove', scope: currentScope, revision: view.revision, name: entry.name }, t('Конфигурация удалена.'))) { selected = null; dismiss(); renderList(); renderDetail() }
      else { yes.disabled = false; no.disabled = false }
    }; d.showModal()
  }
  function renderTools(entry: McpEntry, result: McpProbeResult): void {
    const section = el('section', 'mcp-discovered'); section.append(el('h4', '', msg`Инструменты · ${result.tools.length}`), el('p', 'mcp-source', msg`Проверено ${new Date(result.checkedAt).toLocaleTimeString(dateLocale())} · ${result.serverName ?? entry.name} ${result.serverVersion ?? ''}`))
    if (!result.tools.length) section.append(el('p', 'mcp-help', t('Сервер отвечает, но инструментов не объявил. Он может предоставлять только ресурсы или промпты.')))
    const fields = el('fieldset', 'mcp-form-fields'); fields.dataset.readonly = String(!entry.editable)
    for (const tool of result.tools) {
      const row = el('label', 'mcp-tool-row'), info = el('span'); info.append(el('code', '', tool.name), el('small', '', tool.description))
      const enabled = el('input', 'setting-switch'); enabled.type = 'checkbox'; enabled.checked = tool.enabled; enabled.setAttribute('role', 'switch'); enabled.dataset.mcpTool = tool.name
      enabled.onchange = async () => {
        if (!view || busy || !discard()) { enabled.checked = tool.enabled; return }
        const next = structuredClone(entry.config), checked = enabled.checked; next.excludeTools = (next.excludeTools ?? []).filter(x => x !== tool.name)
        if (!checked) next.excludeTools.push(tool.name)
        if (checked && next.includeTools && !next.includeTools.includes(tool.name)) next.includeTools.push(tool.name)
        if (await mutate({ action: 'save', scope: currentScope, revision: view.revision, name: entry.name, create: false, config: next }, t('Инструмент обновлён. Применится со следующего запроса.'))) { tool.enabled = checked; results.set(entry.name, result); renderList(); renderDetail() }
        else enabled.checked = tool.enabled
      }; row.append(info, enabled); fields.append(row)
    }
    section.append(fields); detail.append(section)
  }
  function renderDetail(): void {
    detail.replaceChildren(); const entry = view?.servers.find(s => s.name === selected)
    if (!creating && !entry) { detail.append(el('span', 'panel-kicker', t('ВАШИ ПОДКЛЮЧЕНИЯ')), el('h3', '', t('Инструменты для ваших задач')), el('p', 'mcp-help', t('Подключите локальный MCP-сервер через команду или удалённый — по HTTP/SSE. Qwen сможет вызывать его инструменты в обычном диалоге с выбранным вами режимом разрешений.')), el('p', 'mcp-help', t('Проверка запускает команду или обращается к серверу, запрашивает только список инструментов и закрывает соединение. Модель и платный API для этого не используются.'))); return }
    const config: McpConfig = entry ? structuredClone(entry.config) : { command: '', args: [], trust: false }, editable = creating || Boolean(entry?.editable)
    const top = el('div', 'mcp-detail-top'); top.append(el('h3', '', creating ? t('Новое подключение') : entry!.name))
    if (entry) { const chip = el('span', 'mcp-status-chip', entry.enabled ? t('Включён') : t('Выключен')); chip.dataset.enabled = String(entry.enabled); top.append(chip) }
    detail.append(top)
    if (entry) {
      detail.append(el('p', 'mcp-source', `${translateMessage(entry.source)}${entry.reason ? ' · ' + translateMessage(entry.reason) : ''}`))
      const controls = el('fieldset', 'mcp-actions-fieldset'), probe = btn(t('Проверить соединение')), toggle = btn(entry.enabled ? t('Выключить') : t('Включить')); probe.id = 'mcp-probe'; probe.disabled = !entry.enabled; probe.onclick = () => { void check(entry) }
      toggle.dataset.mcpToggle = entry.name; toggle.disabled = entry.toggleLocked; toggle.onclick = async () => { if (view && discard() && await mutate({ action: 'toggle', scope: currentScope, revision: view.revision, name: entry.name, enabled: !entry.enabled }, t('Сохранено. Применится к следующему запросу.'))) { renderList(); renderDetail() } }
      controls.append(probe, toggle)
      if (entry.needsApproval) {
        detail.append(el('p', 'mcp-approval-note', t('Подключение из проекта ещё не разрешено для Qwen. Проверьте команду или адрес. Разрешение запомнит эту конфигурацию; при внешнем изменении потребуется новый допуск.')))
        const approve = btn(t('Разрешить Qwen'), 'button button-primary'); approve.id = 'mcp-approve'; approve.disabled = !entry.enabled
        approve.onclick = async () => { if (view && discard() && await mutate({ action: 'approve', scope: currentScope, revision: view.revision, name: entry.name }, t('Qwen сможет подключиться при следующем запросе. Подтверждения вызовов инструментов управляются режимом чата.'))) { renderList(); renderDetail() } }
        controls.append(approve)
      }
      if (entry.editable) { const b = btn(t('Удалить'), 'button mcp-remove'); b.id = 'mcp-remove'; b.onclick = () => remove(entry); controls.append(b) }; detail.append(controls)
      const result = results.get(entry.name); if (result) renderTools(entry, result)
    }
    const form = el('form', 'mcp-form'), fields = el('fieldset', 'mcp-form-fields'); fields.dataset.readonly = String(!editable)
    const field = (label: string, n: HTMLElement, help = ''): HTMLLabelElement => { const wrap = el('label', 'mcp-field'); wrap.append(el('span', '', label), n); if (help) wrap.append(el('small', '', help)); fields.append(wrap); return wrap }
    const input = (value = '', placeholder = ''): HTMLInputElement => { const n = el('input'); n.value = value; n.placeholder = placeholder; return n }
    const name = input(entry?.name ?? '', t('Например, my-tools')); name.id = 'mcp-name'; name.required = true; name.readOnly = !creating; name.maxLength = 128; field(t('Имя сервера'), name, t('Латинские буквы, цифры, дефис, точка и подчёркивание.'))
    const description = input(String(config.description ?? '')); description.id = 'mcp-description'; field(t('Описание'), description)
    const transport = el('select'); transport.id = 'mcp-transport'
    for (const [value, label] of [['stdio', t('Локальная команда · stdio')], ['http', t('Удалённый сервер · HTTP')], ['sse', t('Совместимость · SSE')]]) { const opt = el('option', '', label); opt.value = value; transport.append(opt) }; transport.value = transportOf(config); field(t('Подключение'), transport)
    const command = input(String(config.command ?? ''), t('npx, uvx, node или полный путь')); command.id = 'mcp-command'; field(t('Команда'), command, t('Только исполняемый файл. Аргументы задаются ниже, без shell-обёртки.'))
    const args = el('textarea'); args.value = (config.args ?? []).join('\n'); args.rows = 3; args.id = 'mcp-args'; field(t('Аргументы — по одному на строку'), args, t('Например: -y, затем npm-пакет на следующей строке. Путь с пробелами — одной строкой без внешних кавычек.'))
    const cwd = input(String(config.cwd ?? ''), t('Рабочая папка проекта')); cwd.id = 'mcp-cwd'; field(t('Рабочая папка сервера'), cwd)
    const url = input(String(config.httpUrl ?? config.url ?? ''), 'https://example.com/mcp'); url.id = 'mcp-url'; field(t('Адрес сервера'), url)
    function pairs(label: string, values: Record<string, string>): { block: HTMLElement; get: () => Record<string, string> } {
      const block = el('section', 'mcp-pairs'), container = el('div'), rows: { n: HTMLElement; k: HTMLInputElement; v: HTMLInputElement }[] = []; block.append(el('h4', '', label), container)
      const addRow = (key = '', value = ''): void => {
        const n = el('div', 'mcp-pair'), k = input(key, t('Имя')), v = input(value, t('Значение или $ENV_VAR')); v.type = 'password'; v.autocomplete = 'off'; k.setAttribute('aria-label', label + t(': имя')); v.setAttribute('aria-label', label + t(': значение'))
        const show = btn('◉', 'mcp-pair-eye'), del = btn('×', 'mcp-pair-remove'); show.setAttribute('aria-label', t('Показать или скрыть значение')); del.setAttribute('aria-label', t('Удалить строку'))
        show.onclick = () => { v.type = v.type === 'password' ? 'text' : 'password' }; del.onclick = () => { n.remove(); dirty = true; update() }; n.append(k, v, show, del); container.append(n); rows.push({ n, k, v })
      }
      for (const [k, v] of Object.entries(values)) addRow(k, v)
      const more = btn(t('+ Добавить строку'), 'mcp-text-button'); more.onclick = () => { addRow(); dirty = true; update() }; block.append(more)
      return { block, get: () => {
        const entries: [string, string][] = []; for (const row of rows.filter(r => r.n.isConnected)) { const key = row.k.value.trim(); if (!key && !row.v.value) continue; if (!key || entries.some(([k]) => k === key)) throw new Error(t('Укажите уникальные имена переменных и заголовков')); entries.push([key, row.v.value]) }; return Object.fromEntries(entries)
      } }
    }
    const env = pairs(t('Переменные окружения'), config.env ?? {}), headers = pairs(t('HTTP-заголовки'), config.headers ?? {}); fields.append(env.block, headers.block)
    const advanced = el('details', 'mcp-advanced'), advancedFields = el('div'); advanced.append(el('summary', '', t('Дополнительные параметры')), advancedFields)
    const timeout = input(String((config.timeout ?? 600_000) / 1000)); timeout.type = 'number'; timeout.min = '1'; timeout.max = '3600'; timeout.step = '1'; timeout.id = 'mcp-timeout'; advancedFields.append(field(t('Тайм-аут, секунды'), timeout))
    const include = el('textarea'); include.rows = 2; include.value = (config.includeTools ?? []).join('\n'); include.id = 'mcp-include'; advancedFields.append(field(t('Разрешать только эти инструменты'), include, t('По одному имени на строку. Пусто — без списка разрешённых.')))
    const exclude = el('textarea'); exclude.rows = 2; exclude.value = (config.excludeTools ?? []).join('\n'); exclude.id = 'mcp-exclude'; advancedFields.append(field(t('Отключённые инструменты'), exclude, t('Точные имена из MCP-сервера, по одному на строку.')))
    const trust = el('input', 'setting-switch'); trust.type = 'checkbox'; trust.checked = config.trust === true; trust.id = 'mcp-trust'; trust.setAttribute('role', 'switch'); advancedFields.append(field(t('Доверять этому серверу'), trust, t('Пропускать подтверждения его инструментов в доверенной рабочей папке. По умолчанию выключено.')))
    fields.append(advanced, el('p', 'mcp-secret-note', t('Значения сохраняются в settings.json. Для секретов удобнее ссылки $ENV_VAR; переменные должны быть доступны приложению. OAuth-вход в Desktop пока не подключён.')))
    const actions = el('div', 'mcp-form-actions'), save = btn(creating ? t('Добавить сервер') : t('Сохранить'), 'button button-primary'), cancel = btn(t('Отменить')); save.type = 'submit'; save.id = 'mcp-save'; cancel.onclick = () => { dirty = false; creating = false; renderDetail(); update(); status('') }
    if (editable) actions.append(cancel, save); else fields.append(el('p', 'mcp-help', t('Конфигурация унаследована. Для редактирования выберите её область. Серверы из .mcp.json доступны здесь для просмотра и отключения.')))
    fields.append(actions); form.append(fields); detail.append(form)
    const visibility = (): void => { const local = transport.value === 'stdio'; for (const n of [command, args, cwd]) n.closest<HTMLElement>('.mcp-field')!.hidden = !local; url.closest<HTMLElement>('.mcp-field')!.hidden = local; env.block.hidden = !local; headers.block.hidden = local; command.required = local; url.required = !local }; transport.onchange = visibility; visibility()
    form.addEventListener('input', () => { dirty = true; status(t('Есть несохранённые изменения.')); update() }); form.addEventListener('change', () => { dirty = true; update() })
    form.onsubmit = async event => {
      event.preventDefault(); if (!view || busy || !editable || !form.reportValidity()) return
      try {
        const next: McpConfig = { ...config, description: description.value.trim(), timeout: Number(timeout.value) * 1000, trust: trust.checked }
        for (const k of ['command', 'args', 'env', 'cwd', 'httpUrl', 'url', 'headers', 'type']) delete next[k]
        if (transport.value === 'stdio') { next.command = command.value.trim(); next.args = args.value.split(/\r?\n/).filter(x => x.length > 0); next.env = env.get(); if (cwd.value.trim()) next.cwd = cwd.value.trim() }
        else { next[transport.value === 'http' ? 'httpUrl' : 'url'] = url.value.trim(); next.headers = headers.get() }
        const lines = (v: string): string[] => [...new Set(v.split(/\r?\n/).map(x => x.trim()).filter(Boolean))]
        if (include.value.trim()) next.includeTools = lines(include.value); else delete next.includeTools
        if (exclude.value.trim()) next.excludeTools = lines(exclude.value); else delete next.excludeTools
        const serverName = name.value.trim()
        if (await mutate({ action: 'save', scope: currentScope, revision: view.revision, name: serverName, config: next, create: creating }, t('Сохранено. Подключение будет использовано при следующем запросе.'))) { creating = false; selected = serverName; renderList(); renderDetail() }
      } catch (e) { status(e instanceof Error ? e.message : String(e), true) }
    }; update()
  }
  async function load(scope: SettingsScope): Promise<void> {
    busy = true; status(t('Загрузка…')); update()
    try {
      const reply = await api.getMcp(scope); if (closed) return; if (!reply.ok) { status(reply.error, true); return }
      currentScope = scope; view = reply.value; path.textContent = view.path; path.title = view.path; selected = null; creating = false; dirty = false; results.clear(); status(''); renderList(); renderDetail()
    } catch (e) { status(e instanceof Error ? e.message : String(e), true) }
    finally { busy = false; if (!closed) update() }
  }
  const dismiss = (): void => { if (closed || (busy && !probing) || !discard()) return; closed = true; if (probing) void api.cancelMcpProbe(); confirmation?.close(); confirmation?.remove(); dialog.close(); dialog.remove(); onClose() }
  close.onclick = dismiss; dialog.addEventListener('cancel', e => { e.preventDefault(); dismiss() }); cancelCheck.onclick = () => { void api.cancelMcpProbe() }
  reload.onclick = () => { if (!busy && discard()) void load(currentScope) }; add.onclick = () => { if (!busy && discard()) { creating = true; selected = null; dirty = false; renderList(); renderDetail(); detail.querySelector<HTMLInputElement>('#mcp-name')?.focus() } }; search.oninput = renderList
  dialog.showModal(); void load(currentScope)
}
