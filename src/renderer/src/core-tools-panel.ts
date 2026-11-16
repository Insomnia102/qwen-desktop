import {t,msg,translateMessage} from '../../shared/i18n'
import type { QwenAPI } from '../../shared/qwen'
import { CORE_TOOLS, type CoreToolsView } from '../../shared/core-tools'
import type { SettingsScope } from '../../shared/settings'

export function openCoreTools(api: QwenAPI, hasProject: boolean, onClose: () => void): void {
  const dialog = document.createElement('dialog')
  dialog.className = 'settings-dialog core-tools-dialog'; dialog.setAttribute('aria-labelledby', 'core-tools-title')
  const header = document.createElement('header'); header.className = 'settings-header'
  const title = document.createElement('h2'); title.id = 'core-tools-title'; title.textContent = t('Инструменты Qwen')
  const intro = document.createElement('p')
  intro.textContent = t('Разрешите или запретите встроенные инструменты. Доступность также зависит от режима, модели, ОС и включённых функций. Изменения — со следующего запроса.')
  const scopes = document.createElement('div'); scopes.className = 'settings-scopes'
  const scopeButtons = new Map<SettingsScope, HTMLButtonElement>()
  for (const [scope, label] of [['user', t('Для всех проектов')], ['project', t('Для текущей папки')]] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.scope = scope
    button.addEventListener('click', () => { if (!busy && currentScope !== scope) void load(scope) })
    scopes.append(button); scopeButtons.set(scope, button)
  }
  const search = document.createElement('input'); search.type = 'search'; search.className = 'settings-search'
  search.placeholder = t('Найти инструмент…'); search.setAttribute('aria-label', t('Поиск встроенных инструментов'))
  header.append(title, intro, scopes, search)
  const body = document.createElement('div'); body.className = 'settings-body'
  const navigation = document.createElement('nav'); navigation.className = 'settings-navigation'
  navigation.setAttribute('aria-label', t('Группы инструментов'))
  const fields = document.createElement('fieldset'); fields.className = 'settings-fields'
  body.append(navigation, fields)
  const path = document.createElement('p'); path.className = 'settings-path'
  const message = document.createElement('p'); message.className = 'settings-message'; message.setAttribute('role', 'status')
  const footer = document.createElement('footer'); footer.className = 'settings-footer'
  const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = t('Перезагрузить'); reload.className = 'button button-secondary'
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('Закрыть'); cancel.className = 'button button-secondary'
  const save = document.createElement('button'); save.type = 'button'; save.textContent = t('Сохранить'); save.className = 'button button-primary'
  footer.append(reload, cancel, save); dialog.append(header, body, path, message, footer); document.body.append(dialog)
  let currentScope: SettingsScope = 'user', group = t('Файлы'), busy = false, closed = false
  const drafts = new Map<SettingsScope, { view: CoreToolsView; changes: Record<string, boolean> }>()
  const current = (): { view: CoreToolsView; changes: Record<string, boolean> } | undefined => drafts.get(currentScope)
  const status = (text: string, error = false): void => { message.textContent = text; message.dataset.error = String(error) }
  function update(): void {
    const count = Object.keys(current()?.changes ?? {}).length
    save.disabled = busy || !count; save.textContent = busy ? t('Подождите…') : msg`Сохранить${count ? ` (${count})` : ''}`
    cancel.disabled = busy; reload.disabled = busy; search.disabled = busy; fields.disabled = busy
    scopeButtons.forEach((button, scope) => { button.disabled = busy || (scope === 'project' && !hasProject); button.setAttribute('aria-pressed', String(scope === currentScope)) })
    navigation.querySelectorAll('button').forEach(button => { button.disabled = busy })
  }
  function render(): void {
    fields.replaceChildren(); navigation.replaceChildren()
    for (const name of [...new Set(CORE_TOOLS.map(tool => tool.group))]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.dataset.active = String(group === name)
      button.addEventListener('click', () => { group = name; search.value = ''; render() }); navigation.append(button)
    }
    const draft = current()
    if (draft) {
      path.textContent = draft.view.path; path.title = draft.view.path
      const term = search.value.trim().toLocaleLowerCase()
      for (const tool of CORE_TOOLS.filter(tool => term ? `${tool.name} ${tool.label} ${tool.description}`.toLocaleLowerCase().includes(term) : tool.group === group)) {
        const state = draft.view.tools[tool.name]
        const row = document.createElement('div'); row.className = 'setting-row core-tool'; row.dataset.tool = tool.name
        const info = document.createElement('div'); info.className = 'setting-info'
        const label = document.createElement('label'); label.htmlFor = `core-${tool.name}`; label.textContent = tool.label
        const name = document.createElement('code'); name.className = 'core-tool-name'; name.textContent = tool.name
        const description = document.createElement('p'); description.textContent = tool.description
        const reason = document.createElement('small')
        reason.textContent = translateMessage(state.reason) || (state.localDisabled ? t('Выключено в этой области.') : t('Разрешён настройками. При необходимости Qwen загрузит его сам.'))
        info.append(label, name, description, reason)
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = label.htmlFor
        checkbox.className = 'setting-switch'; checkbox.setAttribute('role', 'switch')
        checkbox.checked = draft.changes[tool.name] ?? state.enabled; checkbox.disabled = state.locked
        checkbox.addEventListener('change', () => {
          if (checkbox.checked === state.enabled) delete draft.changes[tool.name]; else draft.changes[tool.name] = checkbox.checked
          reason.textContent = t('Изменение применится после сохранения.')
          status(Object.keys(draft.changes).length ? t('Есть несохранённые изменения.') : ''); update()
        })
        row.append(info, checkbox); fields.append(row)
      }
      if (!fields.childElementCount) { const empty = document.createElement('p'); empty.textContent = t('Инструменты не найдены.'); fields.append(empty) }
    }
    update()
  }
  async function load(scope: SettingsScope, force = false): Promise<void> {
    if (busy) return
    currentScope = scope; busy = true; status(t('Загрузка…')); update()
    try {
      const reply = await api.getCoreTools(scope)
      if (closed) return
      if (!reply.ok) { status(reply.error, true); return }
      const previous = drafts.get(scope)
      if (!force && previous && Object.keys(previous.changes).length && previous.view.revision !== reply.value.revision) {
        status(t('Настройки изменились. Нажмите «Перезагрузить», чтобы перечитать файл.'), true)
      } else {
        drafts.set(scope, { view: reply.value, changes: force ? {} : previous?.changes ?? {} }); status('')
      }
    } catch (error) { status(error instanceof Error ? error.message : String(error), true) }
    finally { busy = false; if (!closed) render() }
  }
  const close = (): void => { if (!busy) { closed = true; dialog.close(); dialog.remove(); onClose() } }
  cancel.addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  search.addEventListener('input', render); reload.addEventListener('click', () => { void load(currentScope, true) })
  save.addEventListener('click', async () => {
    const draft = current(); if (busy || !draft || !Object.keys(draft.changes).length) return
    busy = true; status(t('Сохранение…')); update()
    try {
      const reply = await api.saveCoreTools({ scope: currentScope, revision: draft.view.revision, changes: { ...draft.changes } })
      if (!reply.ok) { status(reply.error, true); return }
      drafts.set(currentScope, { view: reply.value, changes: {} })
      status(t('Сохранено. Применится к следующему запросу.')); render()
    } catch (error) { status(error instanceof Error ? error.message : String(error), true) }
    finally { busy = false; update() }
  })
  dialog.showModal(); void load('user')
}
