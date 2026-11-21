// SPDX-License-Identifier: GPL-3.0-only
import { parseDocument } from 'yaml'
import type { QwenAPI, Reply } from '../../shared/qwen'
import type { SkillDocument, SkillFile, SkillPathChange } from '../../shared/studio'
import type { SettingsScope } from '../../shared/settings'

const value = <T>(r: Reply<T>): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}
export interface SkillMetadata {
  name: string
  description: string
  body: string
  userInvocable: boolean
  modelInvocable: boolean
}
export interface SkillDraft {
  base: SkillFile
  text: string
  error: string | null
}
export function skillMetadata(raw: string): SkillMetadata {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
  if (!match) throw new Error('Invalid SKILL.md frontmatter')
  const yaml = parseDocument(match[1], { uniqueKeys: true }),
    meta = yaml.toJS({ maxAliasCount: 0 })
  if (yaml.errors.length || !meta || typeof meta !== 'object' || Array.isArray(meta))
    throw new Error('Invalid SKILL.md frontmatter')
  return {
    name: String(meta.name ?? ''),
    description: String(meta.description ?? ''),
    body: match[2].replace(/^\r?\n/, ''),
    userInvocable: meta['user-invocable'] !== false,
    modelInvocable: meta['disable-model-invocation'] !== true
  }
}
export function updateSkillMetadata(raw: string, fields: SkillMetadata): string {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!match) throw new Error('Invalid SKILL.md frontmatter')
  const yaml = parseDocument(match[1], { uniqueKeys: true })
  if (yaml.errors.length) throw new Error('Invalid SKILL.md frontmatter')
  yaml.set('name', fields.name)
  yaml.set('description', fields.description)
  yaml.set('user-invocable', fields.userInvocable)
  yaml.set('disable-model-invocation', !fields.modelInvocable)
  return `---\n${yaml.toString().trimEnd()}\n---\n\n${fields.body}`
}

/** One draft per file, one save queue, and immutable optimistic-lock revisions. */
export class SkillDrafts {
  document: SkillDocument
  readonly drafts = new Map<string, SkillDraft>()
  saving = false
  error = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<() => void>()
  private disposed = false
  constructor(
    private api: QwenAPI,
    readonly scope: SettingsScope,
    document: SkillDocument,
    private delay = 800
  ) {
    this.document = document
    this.drafts.set('SKILL.md', {
      base: {
        path: 'SKILL.md',
        text: document.raw,
        revision: document.entry.revision,
        encoding: 'utf8',
        lineEnding: document.raw.includes('\r\n') ? 'CRLF' : 'LF'
      },
      text: document.raw,
      error: null
    })
  }
  private updateDocument(document:SkillDocument):void{
    if(document.treeComplete===false){const loaded=new Map(this.document.files.map(f=>[f.path,f]));for(const file of document.files)loaded.set(file.path,file);document.files=[...loaded.values()]}
    this.document=document
  }
  get dirty(): boolean {
    return [...this.drafts.values()].some((d) => d.text !== d.base.text)
  }
  get pending(): string[] {
    return [...this.drafts].filter(([, d]) => d.text !== d.base.text).map(([path]) => path)
  }
  get raw(): string {
    return this.drafts.get('SKILL.md')!.text
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    if (!this.disposed) for (const listener of this.listeners) listener()
  }
  async file(path: string): Promise<SkillDraft> {
    let draft = this.drafts.get(path)
    if (!draft) {
      const base = value(await this.api.getSkillFile(this.scope, this.document.entry.id, path))
      draft = this.drafts.get(path) ?? { base, text: base.text, error: null }
      this.drafts.set(path, draft)
    }
    return draft
  }
  edit(path: string, text: string): void {
    const draft = this.drafts.get(path)
    if (!draft || !this.document.entry.editable || this.disposed) return
    draft.text = text
    draft.error = null
    this.error = ''
    this.notify()
    this.schedule()
  }
  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {})
    }, this.delay)
  }
  flush(): Promise<void> {
    clearTimeout(this.timer)
    const run = this.queue.then(async () => {
      if (this.disposed) return
      this.saving = true
      this.error = ''
      this.notify()
      const errors: string[] = []
      try {
        for (const [path, draft] of this.drafts) {
          if (draft.text === draft.base.text) continue
          const text = draft.text,
            base = { ...draft.base }
          try {
            if (path === 'SKILL.md') {
              const document = value(
                await this.api.saveRawSkill(this.scope, this.document.entry.id, base.revision, text)
              )
              this.updateDocument(document)
              draft.base = { ...base, text: document.raw, revision: document.entry.revision }
              if (draft.text === text) draft.text = document.raw
            } else {
              draft.base = value(
                await this.api.saveSkillFile(this.scope, this.document.entry.id, { ...base, text })
              )
              if (draft.text === text) draft.text = draft.base.text
              this.updateDocument(value(await this.api.getSkill(this.scope, this.document.entry.id)))
            }
            draft.error = null
          } catch (error) {
            draft.error = error instanceof Error ? error.message : String(error)
            errors.push(draft.error)
          }
        }
      } finally {
        this.saving = false
        this.error = errors[0] ?? ''
        this.notify()
      }
      if (errors.length) throw new Error(errors[0])
    })
    this.queue = run.catch(() => {})
    return run
  }
  async revert(path: string): Promise<void> {
    clearTimeout(this.timer)
    await this.queue
    const document = value(await this.api.getSkill(this.scope, this.document.entry.id))
    const base =
      path === 'SKILL.md'
        ? {
            path,
            text: document.raw,
            revision: document.entry.revision,
            encoding: 'utf8',
            lineEnding: document.raw.includes('\r\n') ? 'CRLF' : 'LF'
          }
        : value(await this.api.getSkillFile(this.scope, this.document.entry.id, path))
    this.updateDocument(document)
    this.drafts.set(path, { base, text: base.text, error: null })
    this.error = ''
    this.notify()
    if (this.dirty) this.schedule()
  }
  async change(change: Omit<SkillPathChange, 'revision'>): Promise<void> {
    await this.flush()
    this.accept(
      value(
        await this.api.changeSkillPath(this.scope, this.document.entry.id, {
          ...change,
          revision: this.document.treeRevision
        })
      )
    )
  }
  accept(document: SkillDocument): void {
    this.document = document
    for (const [path, draft] of this.drafts) {
      if (draft.text !== draft.base.text) continue
      if (path !== 'SKILL.md') this.drafts.delete(path)
      else {
        draft.base = { ...draft.base, text: document.raw, revision: document.entry.revision }
        draft.text = document.raw
      }
    }
    this.notify()
  }
  async reload(): Promise<void> {
    await this.flush()
    this.accept(value(await this.api.getSkill(this.scope, this.document.entry.id)))
  }
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.listeners.clear()
  }
}
