// SPDX-License-Identifier: GPL-3.0-only
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, StreamLanguage } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { yaml, yamlFrontmatter } from '@codemirror/lang-yaml'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { shell } from '@codemirror/legacy-modes/mode/shell'

function language(path: string) {
  const ext = path.split('.').pop()?.toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext ?? ''))
    return javascript({
      typescript: ext === 'ts' || ext === 'tsx',
      jsx: ext === 'jsx' || ext === 'tsx'
    })
  if (ext === 'json' || ext === 'jsonc') return json()
  if (ext === 'py') return python()
  if (ext === 'md' || ext === 'mdx') return yamlFrontmatter({ content: markdown() })
  if (ext === 'yaml' || ext === 'yml') return yaml()
  if (ext === 'html' || ext === 'htm' || ext === 'svg') return html()
  if (ext === 'css') return css()
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext ?? '')) return StreamLanguage.define(shell)
  return []
}
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.comment, tags.meta], color: 'var(--code-comment)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.function(tags.variableName), tags.tagName], color: 'var(--code-function)' },
  { tag: [tags.heading, tags.strong], fontWeight: '600', color: 'var(--accent)' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' }
])
export interface SkillCodeEditor {
  view: EditorView
  setValue(text: string): void
  focus(): void
  destroy(): void
}

/** Keep the form value in sync while CodeMirror owns keyboard, selection and undo. */
export function skillCodeEditor(
  source: HTMLTextAreaElement,
  path: string,
  onSave: () => void
): SkillCodeEditor {
  const wrapper = document.createElement('div')
  wrapper.className = 'skill-code-editor'
  source.before(wrapper)
  wrapper.append(source)
  source.hidden = true
  source.required = false
  const readOnly = new Compartment()
  let silent = false,
    destroyed = false
  const disabled = (): boolean => source.readOnly || source.disabled || source.matches(':disabled')
  const view = new EditorView({
    parent: wrapper,
    doc: source.value,
    extensions: [
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSave()
            return true
          }
        },
        indentWithTab
      ]),
      basicSetup,
      language(path),
      syntaxHighlighting(colors),
      readOnly.of([EditorState.readOnly.of(disabled()), EditorView.editable.of(!disabled())]),
      EditorView.contentAttributes.of({ 'aria-label': source.getAttribute('aria-label') ?? path }),
      EditorView.theme({
        '&': { backgroundColor: 'var(--surface-0)', color: 'var(--text)', fontSize: '13px' },
        '.cm-scroller': { fontFamily: "'Cascadia Code',Consolas,monospace", lineHeight: '1.7' },
        '.cm-content': { padding: '12px 0', minHeight: '300px' },
        '.cm-gutters': {
          backgroundColor: 'var(--surface-1)',
          color: 'var(--muted)',
          borderRight: '1px solid var(--border)'
        },
        '.cm-activeLine,.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-cursor': { borderLeftColor: 'var(--text)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'var(--accent-soft)'
        },
        '.cm-panels': { backgroundColor: 'var(--surface-1)', color: 'var(--text)' },
        '.cm-search input': { backgroundColor: 'var(--surface-0)', color: 'var(--text)' }
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !silent) {
          source.value = update.state.doc.toString()
          source.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })
    ]
  })
  function setValue(text: string): void {
    if (destroyed || view.state.doc.toString() === text) return
    silent = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    } finally {
      silent = false
    }
  }
  const sync = (): void => setValue(source.value)
  source.addEventListener('input', sync)
  const observer = new MutationObserver(() => {
    if (!destroyed)
      view.dispatch({
        effects: readOnly.reconfigure([
          EditorState.readOnly.of(disabled()),
          EditorView.editable.of(!disabled())
        ])
      })
  })
  observer.observe(source, { attributes: true, attributeFilter: ['readonly', 'disabled'] })
  const fieldset = source.closest('fieldset')
  if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] })
  return {
    view,
    setValue,
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true
      observer.disconnect()
      source.removeEventListener('input', sync)
      view.destroy()
    }
  }
}
