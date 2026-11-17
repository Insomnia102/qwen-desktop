// SPDX-License-Identifier: GPL-3.0-only
import { t, translateMessage } from '../../shared/i18n'
import type { QwenAPI, Reply } from '../../shared/qwen'
import type { SkillsView, SkillDocument } from '../../shared/studio'
import type { SettingsScope } from '../../shared/settings'
import { el, button, field, input, panel, confirmAction } from './panel-kit'
import { renderMarkdown } from './markdown'
import { skillFiles } from './skill-files'
import { SkillDrafts, skillMetadata, updateSkillMetadata } from './skill-drafts'
import { skillCodeEditor, type SkillCodeEditor } from './skill-code-editor'
const val = <T>(r: Reply<T>): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}
export function openSkills(
  api: QwenAPI,
  hasProject: boolean,
  onInvoke: (name: string) => void,
  onClose: () => void
): void {
  let drafts: SkillDrafts | undefined,
    disposeDetail = () => {},
    creating = false,
    scope: SettingsScope = 'user',
    view: SkillsView | undefined,
    invokeAfterClose: string | undefined
  const p = panel(
    t('Skills'),
    t(
      'Создавайте инструкции для повторяющихся задач, редактируйте файлы и вызывайте skills из чата.'
    ),
    () => {
      disposeDetail()
      drafts?.dispose()
      onClose()
      if (invokeAfterClose) onInvoke(invokeAfterClose)
    }
  )
  p.dialog.classList.add('skills-dialog', 'skills-editor-v2')
  const scopes = el('div', 'settings-scopes'),
    toolbar = el('div', 'mcp-toolbar'),
    search = input('', t('Найти skill…')),
    add = button(t('+ Создать'), 'button button-primary'),
    importButton = button(t('Импорт папки')),
    list = el('nav', 'studio-list'),
    detail = el('section', 'studio-detail'),
    saveAll = button(t('Сохранить сейчас'))
  saveAll.hidden = true
  saveAll.id = 'skill-save-all'
  saveAll.onclick = () => {
    void flush()
  }
  p.footer.prepend(saveAll)
  search.type = 'search'
  search.setAttribute('aria-label', t('Поиск skills'))
  add.id = 'skill-add'
  importButton.id = 'skill-import'
  toolbar.append(search, importButton, add)
  p.header.append(scopes, toolbar)
  p.body.append(list, detail)
  async function flush(): Promise<boolean> {
    if (creating) return p.canLeave()
    try {
      await drafts?.flush()
      return true
    } catch (error) {
      p.status(error instanceof Error ? error.message : String(error), true)
      return false
    }
  }
  p.setBeforeDismiss(async () => {
    if (creating) return p.canLeave()
    p.setBusy(true)
    try {
      const ok = await flush()
      if (ok) p.setDirty(false)
      else invokeAfterClose = undefined
      return ok
    } finally {
      p.setBusy(false)
    }
  })
  const switchTo = (action: () => Promise<void>): void => {
    if (p.isBusy() || (creating && !p.canLeave())) return
    void (async () => {
      let ready = false
      await p.perform(
        async () => {
          await drafts?.flush()
        },
        () => {
          ready = true
        }
      )
      if (ready && !p.isClosed()) await action()
    })().catch((error) => p.status(String(error), true))
  }
  async function refreshList(): Promise<void> {
    const result = val(await api.getSkills(scope))
    if (!p.isClosed()) {
      view = result
      renderList()
    }
  }
  function renderList(): void {
    list.replaceChildren()
    for (const s of view?.entries ?? []) {
      if (
        search.value &&
        !`${s.name} ${s.description}`.toLowerCase().includes(search.value.toLowerCase())
      )
        continue
      const b = button('', 'studio-list-item')
      b.dataset.skill = s.id
      b.setAttribute('aria-current', String(drafts?.document.entry.id === s.id))
      b.append(el('strong', '', s.name), el('small', '', s.enabled ? t('Включён') : t('Выключен')))
      b.onclick = () =>
        switchTo(async () => {
          await p.perform(
            () => api.getSkill(scope, s.id),
            (document) => openDocument(val(document))
          )
        })
      list.append(b)
    }
    if (!list.childElementCount)
      list.append(
        el(
          'p',
          'mcp-list-empty',
          t('Пока нет skills. Создайте новый или импортируйте папку со SKILL.md.')
        )
      )
  }
  function clear(): void {
    disposeDetail()
    disposeDetail = () => {}
    drafts?.dispose()
    drafts = undefined
    saveAll.hidden = true
    detail.replaceChildren()
    p.setDirty(false)
  }
  function openDocument(document: SkillDocument): void {
    clear()
    creating = false
    saveAll.hidden = false
    drafts = new SkillDrafts(api, scope, document)
    renderEditor()
    renderList()
    void refreshList().catch((error) => p.status(String(error), true))
  }
  function renderEditor(): void {
    const session = drafts!,
      document = session.document,
      editable = document.entry.editable,
      heading = el('div', 'skill-editor-heading'),
      actions = el('fieldset', 'mcp-actions-fieldset'),
      tabs = el('div', 'skill-section-tabs'),
      generalButton = button(t('Общее')),
      filesButton = button(t('Файлы')),
      general = el('section', 'skill-general'),
      files = skillFiles(api, p, session),
      form = el('form', 'mcp-form'),
      fields = el('fieldset', 'mcp-form-fields')
    heading.append(
      el('h3', '', document.entry.name),
      el('p', 'mcp-source', `${translateMessage(document.entry.source)} · ${document.entry.path}`)
    )
    generalButton.id = 'skill-tab-general'
    filesButton.id = 'skill-tab-files'
    tabs.setAttribute('role', 'tablist')
    tabs.append(generalButton, filesButton)
    const toggle = button(document.entry.enabled ? t('Выключить') : t('Включить'))
    toggle.id = 'skill-toggle'
    toggle.disabled = document.entry.locked
    toggle.onclick = () => {
      void p.perform(async () => {
        await session.flush()
        val(
          await api.toggleSkill(
            scope,
            session.document.entry.id,
            !session.document.entry.enabled,
            session.document.entry.revision
          )
        )
        return val(await api.getSkill(scope, session.document.entry.id))
      }, openDocument)
    }
    actions.append(toggle)
    {
      const invoke = button(t('Вставить /') + document.entry.name, 'button button-primary')
      invoke.id = 'skill-invoke'
      invoke.disabled = !hasProject
      invoke.hidden = !document.entry.enabled || !document.entry.userInvocable
      invoke.onclick = () => {
        invokeAfterClose = session.document.entry.name
        p.dismiss()
      }
      actions.append(invoke)
    }
    if (editable) {
      const remove = button(t('Удалить'), 'button mcp-remove')
      remove.id = 'skill-remove'
      remove.onclick = () =>
        confirmAction(
          t('Убрать skill из списка?'),
          t(
            'Папка будет перенесена в desktop-skill-trash рядом с каталогом skills. Её можно восстановить вручную.'
          ),
          async () => {
            await session.flush()
            val(
              await api.deleteSkill(
                scope,
                session.document.entry.id,
                session.document.entry.revision
              )
            )
            clear()
            await refreshList()
            renderEmpty()
          }
        )
      actions.append(remove)
    }
    const raw = button(t('Редактировать SKILL.md целиком'))
    raw.id = 'skill-raw-toggle'
    actions.append(raw)
    detail.append(heading, actions, tabs, general, files.element)
    fields.dataset.readonly = String(!editable)
    fields.disabled = !editable
    form.append(fields)
    general.append(form)
    const name = input(document.entry.name)
    name.id = 'skill-name'
    name.readOnly = true
    field(fields, t('Имя / команда'), name)
    const description = el('textarea')
    description.id = 'skill-description'
    description.rows = 3
    description.required = true
    description.maxLength = 4000
    field(
      fields,
      t('Когда использовать'),
      description,
      t(
        'Опишите задачу и слова, по которым модель должна выбрать этот skill. Это описание попадает в список доступных skills.'
      )
    )
    const options = el('div', 'skill-invocation-options'),
      user = el('input', 'setting-switch'),
      model = el('input', 'setting-switch')
    for (const checkbox of [user, model]) {
      checkbox.type = 'checkbox'
      checkbox.setAttribute('role', 'switch')
    }
    user.id = 'skill-user-invocable'
    model.id = 'skill-model-invocable'
    field(options, t('Разрешить команду /имя'), user)
    field(options, t('Разрешить модели выбирать skill самостоятельно'), model)
    fields.append(options)
    const body = el('textarea', 'studio-editor')
    body.id = 'skill-body'
    body.readOnly = !editable
    body.spellcheck = false
    body.setAttribute('aria-label', t('Инструкции'))
    field(fields, t('Инструкции'), body)
    const invalid = el('p', 'skill-form-error'),
      preview = el('div', 'markdown-body studio-preview'),
      previewDetails = el('details', 'mcp-advanced')
    previewDetails.append(el('summary', '', t('Предпросмотр инструкций')), preview)
    fields.append(previewDetails)
    general.prepend(invalid)
    let bodyEditor: SkillCodeEditor,
      updating = false
    function sync(): void {
      try {
        const metadata = skillMetadata(session.raw)
        updating = true
        description.value = metadata.description
        user.checked = metadata.userInvocable
        const invoke = actions.querySelector<HTMLButtonElement>('#skill-invoke')
        if (invoke) invoke.hidden = !session.document.entry.enabled || !metadata.userInvocable
        model.checked = metadata.modelInvocable
        body.value = metadata.body
        bodyEditor?.setValue(metadata.body)
        renderMarkdown(preview, metadata.body)
        invalid.textContent = ''
        fields.disabled = p.isBusy() || !editable
      } catch {
        invalid.textContent = t(
          'Исправьте YAML-заголовок в разделе «Файлы», чтобы открыть общие настройки.'
        )
        fields.disabled = true
      } finally {
        updating = false
      }
    }
    sync()
    bodyEditor = skillCodeEditor(body, 'instructions.md', () => {
      void flush()
    })
    const edit = (): void => {
      if (updating || !editable) return
      try {
        session.edit(
          'SKILL.md',
          updateSkillMetadata(session.raw, {
            name: name.value,
            description: description.value,
            body: body.value,
            userInvocable: user.checked,
            modelInvocable: model.checked
          })
        )
      } catch (error) {
        p.status(String(error), true)
      }
    }
    form.oninput = edit
    form.onchange = edit
    form.onsubmit = (e) => {
      e.preventDefault()
      void flush()
    }
    const choose = (tab: 'general' | 'files'): void => {
      general.hidden = tab !== 'general'
      files.element.hidden = tab !== 'files'
      generalButton.setAttribute('aria-selected', String(tab === 'general'))
      filesButton.setAttribute('aria-selected', String(tab === 'files'))
      if (tab === 'general') sync()
      else void files.reveal()
    }
    generalButton.setAttribute('role', 'tab')
    filesButton.setAttribute('role', 'tab')
    generalButton.onclick = () => choose('general')
    filesButton.onclick = () => choose('files')
    raw.onclick = () => {
      choose('files')
      void files.reveal('SKILL.md')
    }
    choose('general')
    const unsubscribe = session.subscribe(() => {
      p.setDirty(session.dirty)
      p.status(
        session.error
          ? translateMessage(session.error)
          : session.saving
            ? t('Сохранение…')
            : session.dirty
              ? t('Ожидание автосохранения…')
              : t('Все изменения сохранены'),
        Boolean(session.error)
      )
      const invoke = actions.querySelector<HTMLButtonElement>('#skill-invoke')
      try {
        if (invoke)
          invoke.hidden =
            !session.document.entry.enabled || !skillMetadata(session.raw).userInvocable
      } catch {
        if (invoke) invoke.hidden = true
      }
      if (general.hidden) sync()
    })
    disposeDetail = () => {
      unsubscribe()
      bodyEditor.destroy()
      files.dispose()
    }
    p.setBusy(p.isBusy())
    p.status(t('Изменения сохраняются автоматически.'))
  }
  function renderEmpty(): void {
    detail.replaceChildren(
      el('h3', '', t('Ваши рабочие приёмы')),
      el(
        'p',
        'mcp-help',
        t(
          'Skill — папка с точкой входа SKILL.md, скриптами, справками, шаблонами и другими ресурсами. По описанию Qwen выбирает подходящий skill сам. Его можно также запустить командой /имя.'
        )
      ),
      el('p', 'mcp-source', view?.root ?? '')
    )
  }
  function renderCreate(): void {
    clear()
    creating = true
    detail.append(el('h3', '', t('Новый skill')))
    const form = el('form', 'mcp-form'),
      fields = el('fieldset', 'mcp-form-fields'),
      name = input('', t('Например, explain-project')),
      description = el('textarea'),
      body = el('textarea', 'studio-editor'),
      user = el('input', 'setting-switch'),
      model = el('input', 'setting-switch'),
      save = button(t('Создать skill'), 'button button-primary')
    name.id = 'skill-name'
    name.required = true
    description.id = 'skill-description'
    description.required = true
    description.maxLength = 4000
    body.id = 'skill-body'
    body.setAttribute('aria-label', t('Инструкции'))
    for (const box of [user, model]) {
      box.type = 'checkbox'
      box.checked = true
    }
    user.id = 'skill-user-invocable'
    model.id = 'skill-model-invocable'
    save.id = 'skill-save'
    save.type = 'submit'
    field(fields, t('Имя / команда'), name)
    field(fields, t('Когда использовать'), description)
    field(fields, t('Разрешить команду /имя'), user)
    field(fields, t('Разрешить модели выбирать skill самостоятельно'), model)
    field(fields, t('Инструкции'), body)
    const cancel = button(t('Отменить'))
    cancel.onclick = () => {
      p.setDirty(false)
      creating = false
      clear()
      renderEmpty()
    }
    fields.append(cancel, save)
    form.append(fields)
    detail.append(form)
    const editor = skillCodeEditor(body, 'instructions.md', () => form.requestSubmit())
    disposeDetail = () => editor.destroy()
    form.oninput = () => p.setDirty(true)
    form.onchange = () => p.setDirty(true)
    form.onsubmit = (e) => {
      e.preventDefault()
      if (!form.reportValidity()) return
      void p.perform(
        () =>
          api.saveSkill({
            scope,
            id: null,
            revision: null,
            name: name.value,
            description: description.value,
            body: body.value,
            userInvocable: user.checked,
            modelInvocable: model.checked
          }),
        (result) => openDocument(val(result))
      )
    }
    name.focus()
  }
  async function load(next: SettingsScope): Promise<void> {
    await p.perform(
      () => api.getSkills(next),
      (result) => {
        clear()
        creating = false
        scope = next
        view = val(result)
        scopes
          .querySelectorAll('button')
          .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)))
        renderList()
        renderEmpty()
        p.status(view.warnings.map((w) => translateMessage(w)).join('\n'), view.warnings.length > 0)
      }
    )
  }
  for (const [s, label] of [
    ['user', t('Для всех проектов')],
    ['project', t('Для текущей папки')]
  ] as const) {
    const b = button(label, '')
    b.dataset.scope = s
    b.dataset.unavailable = String(s === 'project' && !hasProject)
    b.disabled = s === 'project' && !hasProject
    b.onclick = () => {
      if (s !== scope) switchTo(() => load(s))
    }
    scopes.append(b)
  }
  add.onclick = () => switchTo(async () => renderCreate())
  importButton.onclick = () =>
    switchTo(async () => {
      await p.perform(
        () => api.importSkill(scope),
        (result) => {
          const document = val(result)
          if (document) openDocument(document)
        }
      )
    })
  search.oninput = renderList
  void load('user')
}
