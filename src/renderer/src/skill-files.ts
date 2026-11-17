// SPDX-License-Identifier: GPL-3.0-only
import { t, msg } from '../../shared/i18n'
import type { QwenAPI, Reply } from '../../shared/qwen'
import type { SkillPathChange } from '../../shared/studio'
import { el, button, field, input, select, panel, confirmAction } from './panel-kit'
import { SkillDrafts } from './skill-drafts'
import { skillCodeEditor, type SkillCodeEditor } from './skill-code-editor'
const value = <T>(r: Reply<T>): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const parent = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const basename = (path: string): string => path.split('/').pop() ?? path
const mime = 'application/x-qwen-skill-path'

export function skillFiles(api: QwenAPI, p: ReturnType<typeof panel>, drafts: SkillDrafts) {
  const section = el('section', 'skill-files skill-files-v2'),
    toolbar = el('fieldset', 'skill-path-tools'),
    layout = el('div', 'skill-package-layout'),
    tree = el('nav', 'skill-file-tree'),
    workspace = el('div', 'skill-file-workspace'),
    tabs = el('div', 'skill-file-tabs'),
    content = el('div', 'skill-file-content')
  toolbar.dataset.readonly = String(!drafts.document.entry.editable)
  tree.setAttribute('aria-label', t('Файлы и папки skill'))
  tabs.setAttribute('role', 'tablist')
  const add = button(t('+ Файл')),
    folder = button(t('+ Папка')),
    upload = button(t('Добавить с диска')),
    rename = button(t('Переименовать')),
    move = button(t('Переместить')),
    remove = button(t('Убрать'), 'button mcp-remove'),
    reload = button(t('Обновить дерево')),
    revert = button(t('Отменить изменения файла'))
  for (const [node, id] of [
    [add, 'skill-file-add'],
    [folder, 'skill-folder-add'],
    [upload, 'skill-file-import'],
    [rename, 'skill-path-rename'],
    [move, 'skill-path-move'],
    [remove, 'skill-path-remove'],
    [reload, 'skill-tree-reload'],
    [revert, 'skill-file-cancel']
  ] as const) {
    node.id = id
    toolbar.append(node)
  }
  const heading = el('h5', 'skill-file-title'),
    hint = el(
      'p',
      'skill-file-hint',
      t('Изменения сохраняются автоматически. Файлы и папки можно перетаскивать в дереве.')
    )
  workspace.append(tabs, heading, content)
  layout.append(tree, workspace)
  section.append(toolbar, hint, layout)
  let chosen = 'SKILL.md',
    disposed = false,
    sequence = 0
  const editors = new Map<
      string,
      { element: HTMLElement; source: HTMLTextAreaElement; code: SkillCodeEditor }
    >(),
    opened = new Set<string>(),
    expanded = new Set<string>()
  const save = (): void => {
    void drafts.flush().catch((error) => p.status(String(error.message ?? error), true))
  }
  function highlight(): void {
    tree.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => {
      const path = details.querySelector<HTMLElement>('summary')?.dataset.path
      if (path && chosen.startsWith(path + '/')) details.open = true
    })
    tree
      .querySelectorAll<HTMLElement>('[data-path]')
      .forEach((node) => node.setAttribute('aria-current', String(node.dataset.path === chosen)))
    const fixed = !chosen || chosen === 'SKILL.md'
    rename.disabled = fixed
    move.disabled = fixed
    remove.disabled = fixed
    revert.disabled = !drafts.drafts.has(chosen)
    tabs.replaceChildren()
    for (const path of opened) {
      const tab = button('', 'skill-file-tab')
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(chosen === path))
      tab.title = path
      tab.textContent = basename(path) + (drafts.pending.includes(path) ? ' •' : '')
      tab.onclick = () => void reveal(path)
      tabs.append(tab)
    }
  }
  function folders(exclude = ''): Array<readonly [string, string]> {
    return [
      ['', t('Корень пакета')],
      ...drafts.document.files
        .filter(
          (f) =>
            f.kind === 'directory' &&
            (!exclude || (f.path !== exclude && !f.path.startsWith(exclude + '/')))
        )
        .map((f) => [f.path, f.path] as const)
    ]
  }
  function directory(): string {
    return drafts.document.files.find((f) => f.path === chosen)?.kind === 'directory'
      ? chosen
      : parent(chosen)
  }
  async function structural(
    change: Omit<SkillPathChange, 'revision'>,
    selection: string
  ): Promise<void> {
    await p.perform(
      async () => {
        await drafts.change(change)
        return selection
      },
      (path) => {
        refresh()
        void reveal(path)
        p.status(
          t('Путь изменён. Обновите ссылки на него в инструкциях и скриптах при необходимости.')
        )
      }
    )
  }
  function pathDialog(action: 'file' | 'directory' | 'rename' | 'move'): void {
    if (p.isBusy()) return
    const selected = chosen,
      title =
        action === 'file'
          ? t('Новый файл')
          : action === 'directory'
            ? t('Новая папка')
            : action === 'rename'
              ? t('Переименовать')
              : t('Переместить'),
      dialog = el('dialog', 'chat-dialog skill-path-dialog'),
      form = el('form'),
      fields = el('fieldset'),
      name = input(action === 'rename' || action === 'move' ? basename(selected) : ''),
      location = select(folders(action === 'move' ? selected : '')),
      message = el('p', 'chat-dialog-error'),
      actions = el('div', 'chat-dialog-actions'),
      cancel = button(t('Отмена')),
      confirm = button(t('Применить'), 'button button-primary')
    name.id = 'skill-file-name'
    name.required = true
    name.setAttribute('aria-label', t('Имя'))
    location.id = 'skill-file-directory'
    location.value = directory()
    confirm.type = 'submit'
    dialog.append(el('h2', '', title), form)
    form.append(fields, message, actions)
    if (action !== 'move') field(fields, t('Имя'), name)
    if (action !== 'rename') field(fields, t('Папка назначения'), location)
    actions.append(cancel, confirm)
    const close = (): void => {
      dialog.close()
      dialog.remove()
    }
    cancel.onclick = close
    dialog.addEventListener('cancel', (e) => {
      if (confirm.disabled) e.preventDefault()
    })
    dialog.addEventListener('close', () => dialog.remove())
    form.onsubmit = async (e) => {
      e.preventDefault()
      if (!form.reportValidity() || confirm.disabled) return
      confirm.disabled = true
      cancel.disabled = true
      fields.disabled = true
      const target =
        action === 'rename'
          ? [parent(selected), name.value.trim()].filter(Boolean).join('/')
          : [location.value, action === 'move' ? basename(selected) : name.value.trim()]
              .filter(Boolean)
              .join('/')
      try {
        await drafts.flush()
        await drafts.change(
          action === 'rename' || action === 'move'
            ? { action: 'rename', path: selected, target }
            : { action, path: target }
        )
        close()
        refresh()
        await reveal(target)
        if (action === 'rename' || action === 'move')
          p.status(
            t('Путь изменён. Обновите ссылки на него в инструкциях и скриптах при необходимости.')
          )
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        confirm.disabled = false
        cancel.disabled = false
        fields.disabled = false
      }
    }
    document.body.append(dialog)
    dialog.showModal()
    ;(action === 'move' ? location : name).focus()
  }
  async function reveal(path = chosen): Promise<void> {
    if (disposed) return
    for (const editor of editors.values()) editor.source.removeAttribute('id')
    const ticket = ++sequence
    chosen = path
    heading.textContent = path || t('Корень пакета')
    for (const editor of editors.values()) editor.element.hidden = true
    content.querySelectorAll('.skill-resource').forEach((node) => node.remove())
    highlight()
    const node = drafts.document.files.find((f) => f.path === path)
    if (!path || node?.kind === 'directory') {
      content.append(
        el('p', 'mcp-help skill-resource', t('Выберите файл или создайте новый в этой папке.'))
      )
      return
    }
    try {
      let editor = editors.get(path)
      if (!editor) {
        const asset =
          path === 'SKILL.md'
            ? { kind: 'text' as const }
            : value(await api.inspectSkillFile(drafts.scope, drafts.document.entry.id, path))
        if (ticket !== sequence || disposed) return
        if (asset.kind !== 'text') {
          if (asset.kind === 'image' && 'dataUrl' in asset && asset.dataUrl) {
            const image = el('img', 'skill-asset-preview skill-resource')
            image.src = asset.dataUrl
            image.alt = path
            content.append(image)
          } else
            content.append(
              el(
                'p',
                'mcp-help skill-resource',
                t(
                  'Этот формат хранится как ресурс. Для замены уберите файл в архив и добавьте новую версию с диска. Текстовый редактор: UTF-8 и UTF-16 с BOM, до 512 КБ.'
                )
              )
            )
          return
        }
        const draft = await drafts.file(path)
        if (ticket !== sequence || disposed) return
        const element = el('fieldset', 'skill-text-pane'),
          source = el('textarea')
        element.dataset.readonly = String(!drafts.document.entry.editable)
        element.disabled = p.isBusy() || !drafts.document.entry.editable
        source.readOnly = !drafts.document.entry.editable
        source.value = draft.text
        source.spellcheck = false
        source.setAttribute('aria-label', t('Содержимое выбранного файла'))
        source.oninput = () => drafts.edit(path, source.value)
        element.append(source)
        content.append(element)
        const code = skillCodeEditor(source, path, save)
        editor = { element, source, code }
        editors.set(path, editor)
      }
      editor.element.hidden = false
      opened.add(path)
      highlight()
      for (const item of editors.values()) item.source.removeAttribute('id')
      editor.source.id = 'skill-file-text'
    } catch (error) {
      if (ticket === sequence && !disposed)
        p.status(error instanceof Error ? error.message : String(error), true)
    }
  }
  function dropTarget(node: HTMLElement, target: string): void {
    node.ondragover = (e) => {
      if (p.isBusy() || !drafts.document.entry.editable || !e.dataTransfer?.types.includes(mime))
        return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      node.classList.add('skill-drop-target')
    }
    node.ondragleave = () => node.classList.remove('skill-drop-target')
    node.ondrop = (e) => {
      node.classList.remove('skill-drop-target')
      const path = e.dataTransfer?.getData(mime)
      if (!path || p.isBusy() || !drafts.document.entry.editable) return
      e.preventDefault()
      e.stopPropagation()
      if (
        path === 'SKILL.md' ||
        !drafts.document.files.some((f) => f.path === path) ||
        path === target ||
        target.startsWith(path + '/')
      )
        return
      const destination = [target, basename(path)].filter(Boolean).join('/')
      if (destination !== path)
        void structural({ action: 'rename', path, target: destination }, destination)
    }
  }
  function build(parentPath: string, container: HTMLElement): void {
    const ul = el('ul')
    container.append(ul)
    for (const node of drafts.document.files
      .filter((f) => parent(f.path) === parentPath)
      .sort((a, b) =>
        a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1
      )) {
      const li = el('li')
      ul.append(li)
      let control: HTMLElement
      if (node.kind === 'directory') {
        const details = el('details'),
          summary = el('summary', 'skill-tree-folder', basename(node.path))
        details.open = expanded.has(node.path) || chosen.startsWith(node.path + '/')
        details.ontoggle = () => {
          if (details.open) expanded.add(node.path)
          else expanded.delete(node.path)
        }
        summary.onclick = () => void reveal(node.path)
        details.append(summary)
        li.append(details)
        build(node.path, details)
        control = summary
        dropTarget(summary, node.path)
      } else {
        const file = button(basename(node.path), 'skill-tree-file')
        file.onclick = () => void reveal(node.path)
        li.append(file)
        control = file
      }
      control.dataset.path = node.path
      control.title = node.path
      control.draggable = drafts.document.entry.editable && node.path !== 'SKILL.md'
      control.ondragstart = (e) => {
        if (p.isBusy() || !e.dataTransfer) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData(mime, node.path)
        e.dataTransfer.effectAllowed = 'move'
      }
    }
  }
  function refresh(): void {
    ++sequence
    for (const editor of editors.values()) editor.code.destroy()
    editors.clear()
    opened.forEach((path) => {
      if (!drafts.document.files.some((f) => f.path === path)) opened.delete(path)
    })
    content.replaceChildren()
    tree.replaceChildren()
    const root = button(t('Пакет /'), 'skill-tree-root')
    root.dataset.path = ''
    root.onclick = () => void reveal('')
    dropTarget(root, '')
    tree.append(root)
    build('', tree)
    highlight()
  }
  add.onclick = () => pathDialog('file')
  folder.onclick = () => pathDialog('directory')
  rename.onclick = () => pathDialog('rename')
  move.onclick = () => pathDialog('move')
  revert.onclick = () => {
    const path = chosen
    if (!drafts.drafts.has(path)) return
    confirmAction(
      t('Отменить изменения файла?'),
      t(
        'Черновик этого файла будет заменён последней версией с диска. Остальные черновики сохранятся.'
      ),
      async () => {
        await drafts.revert(path)
      },
      t('Отменить изменения')
    )
  }
  remove.onclick = () => {
    const path = chosen
    if (!path || path === 'SKILL.md') return
    confirmAction(
      msg`Убрать ${path}?`,
      t(
        'Файл или папка со всем содержимым будет перенесена в desktop-skill-file-trash рядом с skills. Можно восстановить вручную.'
      ),
      async () => {
        await drafts.change({ action: 'remove', path })
        refresh()
        await reveal('SKILL.md')
      }
    )
  }
  upload.onclick = () => {
    void p.perform(
      async () => {
        await drafts.flush()
        return value(
          await api.importSkillFile(
            drafts.scope,
            drafts.document.entry.id,
            directory(),
            drafts.document.treeRevision
          )
        )
      },
      (document) => {
        if (document) {
          drafts.accept(document)
          refresh()
          void reveal(chosen)
        }
      }
    )
  }
  reload.onclick = () => {
    void p.perform(
      () => drafts.reload(),
      () => {
        refresh()
        void reveal(drafts.document.files.some((f) => f.path === chosen) ? chosen : 'SKILL.md')
      }
    )
  }
  const unsubscribe = drafts.subscribe(() => {
    for (const [path, editor] of editors) {
      const draft = drafts.drafts.get(path)
      if (draft && editor.source.value !== draft.text) {
        editor.source.value = draft.text
        editor.code.setValue(draft.text)
      }
    }
    highlight()
  })
  refresh()
  return {
    element: section,
    reveal,
    refresh,
    dispose: () => {
      disposed = true
      ++sequence
      unsubscribe()
      for (const editor of editors.values()) editor.code.destroy()
    }
  }
}
