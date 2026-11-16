import {t,msg,translateMessage} from '../../shared/i18n'
import type { QwenAPI, WorkspaceView } from '../../shared/qwen'
import { SETTINGS_FIELDS, type SettingDefinition, type SettingValue, type SettingsScope, type SettingsView } from '../../shared/settings'
import { SETTINGS_HELP } from '../../shared/settings-help'

export function openSettings(api: QwenAPI, hasProject: boolean, onSaved: (workspace: WorkspaceView) => void, onClose: () => void): void {
  const dialog = document.createElement('dialog')
  dialog.className = 'settings-dialog'
  dialog.setAttribute('aria-labelledby', 'settings-title')
  const header = document.createElement('header')
  header.className = 'settings-header'
  const heading = document.createElement('h2')
  heading.id = 'settings-title'; heading.textContent = t('Настройки Qwen')
  const subtitle = document.createElement('p')
  subtitle.textContent = t('Выберите параметры. Изменения применятся к следующему запросу.')
  const scopes = document.createElement('div')
  scopes.className = 'settings-scopes'
  const scopeButtons = new Map<SettingsScope, HTMLButtonElement>()
  for (const [scope, text] of [['user', t('Для всех проектов')], ['project', t('Для текущей папки')]] as const) {
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = text; button.dataset.scope = scope
    button.addEventListener('click', () => { if (scope !== currentScope) void load(scope) })
    scopes.append(button); scopeButtons.set(scope, button)
  }
  const search = document.createElement('input')
  search.type = 'search'; search.className = 'settings-search'; search.placeholder = t('Найти настройку…')
  search.setAttribute('aria-label', t('Поиск настроек'))
  header.append(heading, subtitle, scopes, search)
  const body = document.createElement('div')
  body.className = 'settings-body'
  const navigation = document.createElement('nav')
  navigation.className = 'settings-navigation'; navigation.setAttribute('aria-label', t('Разделы настроек'))
  const fields = document.createElement('fieldset')
  fields.className = 'settings-fields'
  const path = document.createElement('p')
  path.className = 'settings-path'
  const message = document.createElement('p')
  message.className = 'settings-message'; message.setAttribute('role', 'status')
  const footer = document.createElement('footer')
  footer.className = 'settings-footer'
  const reload = document.createElement('button')
  reload.type = 'button'; reload.className = 'button button-secondary'; reload.textContent = t('Перезагрузить')
  reload.title = t('Загрузить файл заново и сбросить несохранённые изменения этой области')
  const cancel = document.createElement('button')
  cancel.type = 'button'; cancel.className = 'button button-secondary'; cancel.textContent = t('Закрыть')
  const save = document.createElement('button')
  save.type = 'button'; save.className = 'button button-primary'; save.textContent = t('Сохранить')
  footer.append(reload, cancel, save)
  body.append(navigation, fields)
  dialog.append(header, body, path, message, footer)
  document.body.append(dialog)
  let currentScope: SettingsScope = 'user'
  let section = SETTINGS_FIELDS[0].section
  let busy = false, closed = false
  const drafts = new Map<SettingsScope, { view: SettingsView; changes: Record<string, SettingValue | null> }>()
  const current = (): { view: SettingsView; changes: Record<string, SettingValue | null> } | undefined => drafts.get(currentScope)
  const titleOf = (definition: SettingDefinition, value: SettingValue | null): string => {
    if (value === null) return t('определяет Qwen')
    if (typeof value === 'boolean') return value ? t('включено') : t('выключено')
    return definition.labels?.[String(value)] ?? String(value)
  }
  function status(text: string, error = false): void {
    message.textContent = text; message.dataset.error = String(error)
  }
  function update(): void {
    const draft = current()
    save.disabled = busy || !draft || !Object.keys(draft.changes).length
    reload.disabled = busy; cancel.disabled = busy
    fields.disabled = busy; search.disabled = busy
    for (const [scope, button] of scopeButtons) {
      button.disabled = busy || (scope === 'project' && !hasProject)
      button.setAttribute('aria-pressed', String(scope === currentScope))
    }
    navigation.querySelectorAll('button').forEach(button => { button.disabled = busy })
    save.textContent = busy ? t('Подождите…') : msg`Сохранить${draft && Object.keys(draft.changes).length ? ` (${Object.keys(draft.changes).length})` : ''}`
  }
  function change(key: string, value: SettingValue | null): void {
    const draft = current()
    if (!draft) return
    if (Object.is(value, draft.view.fields[key].local)) delete draft.changes[key]
    else draft.changes[key] = value
    const definition = SETTINGS_FIELDS.find(field => field.key === key)!
    const hint = fields.querySelector<HTMLElement>(`[data-setting="${key}"] .setting-info small`)
    if (hint) hint.textContent = value === null ? msg`Наследуется: ${titleOf(definition, draft.view.fields[key].inherited)}` : msg`Выбрано: ${titleOf(definition, value)}`
    status(Object.keys(draft.changes).length ? t('Есть несохранённые изменения.') : '')
    update()
  }
  function renderField(definition: SettingDefinition): HTMLElement {
    const draft = current()!
    const state = draft.view.fields[definition.key]
    const value = Object.hasOwn(draft.changes, definition.key) ? draft.changes[definition.key] : state.local
    const element = document.createElement('div')
    element.className = 'setting-row'; element.dataset.setting = definition.key
    const info = document.createElement('div')
    info.className = 'setting-info'
    const label = document.createElement('label')
    const id = `setting-${definition.key.replaceAll('.', '-')}`
    label.htmlFor = id; label.textContent = definition.label
    const description = document.createElement('p')
    description.textContent = SETTINGS_HELP[definition.key] ?? definition.description ?? ''
    const source = document.createElement('small')
    source.textContent = state.locked ? t('Задано на системном уровне или доступно только для всех проектов.') :
      value === null ? msg`Наследуется: ${titleOf(definition, state.inherited)}` :
        msg`В этой области: ${titleOf(definition, value)}${state.source !== (currentScope === 'user' ? 'Все проекты' : 'Текущая папка') ? msg` · Приоритет в файлах: ${translateMessage(state.source)}` : ''}`
    info.append(label)
    if (description.textContent) info.append(description)
    info.append(source)
    const control = document.createElement('div')
    control.className = 'setting-control'
    if (definition.type === 'boolean') {
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'; checkbox.id = id; checkbox.className = 'setting-switch'
      checkbox.setAttribute('role', 'switch')
      checkbox.checked = Boolean(value ?? state.inherited ?? definition.default)
      checkbox.disabled = state.locked
      checkbox.addEventListener('change', () => {
        change(definition.key, checkbox.checked)
        const replacement = renderField(definition)
        element.replaceWith(replacement)
        replacement.querySelector<HTMLInputElement>('input')?.focus()
      })
      const override = document.createElement('button')
      override.type = 'button'; override.className = 'setting-reset'
      override.textContent = t('Сбросить')
      override.disabled = state.locked || value === null
      override.addEventListener('click', () => {
        change(definition.key, null)
        render(); fields.querySelector<HTMLElement>(`[data-setting="${definition.key}"] input`)?.focus()
      })
      control.append(checkbox, override)
    } else {
      const select = document.createElement('select')
      select.id = id; select.disabled = state.locked
      const inherit = document.createElement('option')
      inherit.value = '__inherit'; inherit.textContent = msg`Наследовать: ${titleOf(definition, state.inherited)}`
      select.append(inherit)
      const choices = [...(definition.choices ?? [])]
      if (value !== null && !choices.some(item => Object.is(item, value))) choices.push(value)
      for (const choice of choices) {
        const option = document.createElement('option')
        option.value = JSON.stringify(choice); option.textContent = titleOf(definition, choice)
        select.append(option)
      }
      select.value = value === null ? '__inherit' : JSON.stringify(value)
      select.addEventListener('change', () => {
        if (select.value === '__inherit') change(definition.key, null)
        else { const chosen = choices.find(choice => JSON.stringify(choice) === select.value); if (chosen !== undefined) change(definition.key, chosen) }
      })
      control.append(select)
    }
    element.append(info, control)
    return element
  }
  function render(): void {
    const draft = current()
    navigation.replaceChildren(); fields.replaceChildren()
    for (const name of [...new Set(SETTINGS_FIELDS.map(field => field.section))]) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = name; button.dataset.active = String(name === section)
      button.addEventListener('click', () => { section = name; search.value = ''; render() })
      navigation.append(button)
    }
    if (draft) {
      path.textContent = draft.view.path; path.title = draft.view.path
      const term = search.value.trim().toLocaleLowerCase()
      const selected = SETTINGS_FIELDS.filter(field => term ? `${field.label} ${SETTINGS_HELP[field.key] ?? field.description ?? ''}`.toLocaleLowerCase().includes(term) : field.section === section)
      for (const definition of selected) fields.append(renderField(definition))
      if (!selected.length) { const empty = document.createElement('p'); empty.textContent = t('Таких настроек не найдено.'); fields.append(empty) }
    }
    update()
  }
  async function load(scope: SettingsScope, force = false): Promise<void> {
    if (busy) return
    currentScope = scope; busy = true; status(t('Загрузка настроек…')); update()
    try {
      const reply = await api.getSettings(scope)
      if (closed) return
      if (!reply.ok) { status(reply.error, true); return }
      const previous = drafts.get(scope)
      if (!force && previous && Object.keys(previous.changes).length && previous.view.revision !== reply.value.revision) {
        status(t('Файл изменился. Ваши несохранённые изменения сохранены в форме; нажмите «Перезагрузить», чтобы перечитать файл.'), true)
      } else {
        drafts.set(scope, { view: reply.value, changes: force ? {} : previous?.changes ?? {} })
        status('')
      }
      render()
    } catch (error) { if (!closed) status(error instanceof Error ? error.message : String(error), true) }
    finally { busy = false; if (!closed) { render(); update() } }
  }
  const close = (): void => { if (!busy) { closed = true; dialog.close(); dialog.remove(); onClose() } }
  cancel.addEventListener('click', close)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  reload.addEventListener('click', () => { void load(currentScope, true) })
  search.addEventListener('input', render)
  save.addEventListener('click', async () => {
    const draft = current()
    if (busy || !draft || !Object.keys(draft.changes).length) return
    busy = true; status(t('Сохранение…')); update()
    try {
      const reply = await api.saveSettings({ scope: currentScope, revision: draft.view.revision, changes: { ...draft.changes } })
      if (!reply.ok) { status(reply.error, true); return }
      drafts.set(currentScope, { view: reply.value.settings, changes: {} })
      // Re-read other scopes next time: their inherited values may have changed.
      const otherScope = currentScope === 'user' ? 'project' : 'user'
      if (!Object.keys(drafts.get(otherScope)?.changes ?? {}).length) drafts.delete(otherScope)
      onSaved(reply.value.workspace)
      status(t('Сохранено. Настройки применятся к следующему запросу.'))
      render()
    } catch (error) { status(error instanceof Error ? error.message : String(error), true) }
    finally { busy = false; update() }
  })
  // Ordinary Tab navigation is preserved; this is a native accessible dialog.
  dialog.showModal()
  void load('user')
  search.focus()
}
