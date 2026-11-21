// SPDX-License-Identifier: GPL-3.0-only
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  SkillAsset,
  SkillDirectoryPage,
  SkillFile,
  SkillPathChange,
  SkillTreeNode
} from '../shared/studio'
const digest = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const TEXT_LIMIT = 512_000,
  PAGE = 200,
  TREE_LIMIT = 2000,
  IMPORT_BYTES = 512_000_000,
  IMPORT_FILES = 50_000
const reserved = (name: string): boolean =>
  [
    '.git',
    'node_modules',
    '.venv',
    'venv',
    '__pycache__',
    '.cache',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache'
  ].includes(name.toLowerCase()) || /\.desktop\.bak$|\.[a-f\d-]{36}\.tmp$/i.test(name)
const same = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const stamp = (st: Stats): string => `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.mode & 0o777}`
function decode(bytes: Buffer): { text: string; encoding: string } | null {
  if (bytes.length > TEXT_LIMIT) return null
  let encoding = 'utf8',
    offset = 0,
    label = 'utf-8'
  if (bytes[0] === 255 && bytes[1] === 254) {
    encoding = 'utf16le'
    label = 'utf-16le'
    offset = 2
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    encoding = 'utf16be'
    label = 'utf-16be'
    offset = 2
  } else if (bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]))) {
    encoding = 'utf8-bom'
    offset = 3
  }
  try {
    const text = new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(offset)
    )
    return /[\x00-\x08\x0b\x0e-\x1f]/.test(text) ? null : { text, encoding }
  } catch {
    return null
  }
}
function encode(text: string, encoding: string, lineEnding: string): Buffer {
  if (lineEnding === 'CRLF') text = text.replace(/\r?\n/g, '\r\n')
  if (encoding === 'utf16le' || encoding === 'utf16be') {
    const body = Buffer.from(text, 'utf16le')
    if (encoding === 'utf16be') body.swap16()
    return Buffer.concat([Buffer.from(encoding === 'utf16le' ? [255, 254] : [254, 255]), body])
  }
  return Buffer.concat([
    Buffer.from(encoding === 'utf8-bom' ? [239, 187, 191] : []),
    Buffer.from(text, 'utf8')
  ])
}
export class SkillPackage {
  private ignoreRules: string[] = []
  private ignoreWarning: string | undefined
  constructor(readonly root: string) {
    if (lstatSync(root).isSymbolicLink() || !same(realpathSync(root), resolve(root)))
      throw new Error('Папка skill перенаправлена через ссылку')
    const file = join(root, '.skillignore')
    if (existsSync(file)) {
      try {
        if (lstatSync(file).isSymbolicLink() || statSync(file).size > 16000)
          throw new Error('Invalid .skillignore (regular UTF-8 file, at most 16 KB)')
        this.ignoreRules = readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((s) => s.trim().replace(/\/$/, ''))
          .filter((s) => s && !s.startsWith('#'))
      } catch (error) {
        this.ignoreWarning = error instanceof Error ? error.message : String(error)
      }
    }
  }
  private ignored(path: string): boolean {
    if (path === 'SKILL.md' || path === '.skillignore') return false
    if (path.split('/').some(reserved)) return true
    return this.ignoreRules.some((rule) => path === rule || path.startsWith(rule + '/'))
  }
  path(path: string, create = false): string {
    if (
      typeof path !== 'string' ||
      !path ||
      path.length > 1000 ||
      isAbsolute(path) ||
      path.includes('\\') ||
      path.split('/').length > 64 ||
      path
        .split('/')
        .some(
          (n) =>
            !n ||
            n === '.' ||
            n === '..' ||
            /[<>:"|?*\x00-\x1f]/.test(n) ||
            /[. ]$/.test(n) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n) ||
            reserved(n)
        )
    )
      throw new Error('Некорректный относительный путь файла или папки')
    const target = resolve(this.root, path),
      rel = relative(this.root, target)
    if (rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Путь вне папки skill')
    let current = this.root
    for (const part of path.split('/')) {
      current = join(current, part)
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error('Ссылки внутри skill не поддерживаются')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    if (!create && !existsSync(target)) throw new Error('Файл или папка не найдены')
    return target
  }
  directory(path = '', offset = 0): SkillDirectoryPage {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000)
      throw new Error('Invalid directory offset')
    const target = path ? this.path(path) : this.root,
      st = statSync(target)
    if (!st.isDirectory()) throw new Error('Not a directory')
    const items: SkillTreeNode[] = [],
      warnings: string[] = this.ignoreWarning ? [this.ignoreWarning] : [],
      tokens: string[] = [stamp(st)]
    let count = 0,
      more = false
    const dir = opendirSync(target)
    try {
      for (let item = dir.readSync(); item; item = dir.readSync()) {
        const name = path ? path + '/' + item.name : item.name
        if (this.ignored(name)) continue
        if (count++ < offset) continue
        if (items.length === PAGE) {
          more = true
          break
        }
        try {
          const file = this.path(name),
            info = lstatSync(file)
          if (!info.isFile() && !info.isDirectory())
            throw new Error('Not a regular file or directory')
          items.push({
            path: name,
            kind: info.isDirectory() ? 'directory' : 'file',
            size: info.isFile() ? info.size : 0,
            editable: info.isFile() && info.size <= TEXT_LIMIT
          })
          tokens.push(name + ':' + stamp(info))
        } catch (error) {
          warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      dir.closeSync()
    }
    return {
      path,
      files: items.sort((a, b) =>
        a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1
      ),
      nextOffset: more ? count - 1 : null,
      revision: digest(tokens.join('\n')),
      warnings
    }
  }
  tree(): {
    files: SkillTreeNode[]
    treeRevision: string
    treeComplete: boolean
    treeWarnings: string[]
  } {
    const files: SkillTreeNode[] = [],
      tokens: string[] = [],
      warnings: string[] = [],
      queue = ['']
    let complete = true
    while (queue.length && files.length < TREE_LIMIT) {
      const path = queue.shift()!
      const page = this.directory(path)
      tokens.push(path + ':' + page.revision)
      warnings.push(...page.warnings)
      if (page.nextOffset !== null) complete = false
      for (const item of page.files) {
        if (files.length >= TREE_LIMIT) {
          complete = false
          break
        }
        files.push(item)
        if (item.kind === 'directory' && item.path.split('/').length < 64) queue.push(item.path)
      }
    }
    if (queue.length) complete = false
    return {
      files,
      treeRevision: digest(tokens.join('\n')),
      treeComplete: complete,
      treeWarnings: warnings
    }
  }
  private bytes(path: string, max = TEXT_LIMIT): Buffer {
    const target = this.path(path),
      st = statSync(target)
    if (!st.isFile() || st.size > max)
      throw new Error(
        'Двоичный файл или текст больше 512 КБ: доступен просмотр свойств и замена через импорт'
      )
    return readFileSync(target)
  }
  read(path: string): SkillFile {
    const bytes = this.bytes(path),
      content = decode(bytes)
    if (!content)
      throw new Error(
        'Двоичный файл или текст больше 512 КБ: доступен просмотр свойств и замена через импорт'
      )
    return {
      path,
      ...content,
      revision: digest(bytes),
      lineEnding: content.text.includes('\r\n') ? 'CRLF' : 'LF'
    }
  }
  inspect(path: string): SkillAsset {
    const target = this.path(path),
      st = statSync(target)
    if (!st.isFile()) throw new Error('Not a regular file')
    const base = { path, size: st.size, revision: digest(stamp(st)) }
    if (st.size > 2_000_000) return { ...base, kind: 'binary' }
    const bytes = readFileSync(target),
      content = decode(bytes)
    if (content)
      return { ...base, revision: digest(bytes), kind: 'text', encoding: content.encoding }
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
          ? 'image/gif'
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : null
    return mime
      ? {
          ...base,
          revision: digest(bytes),
          kind: 'image',
          dataUrl: `data:${mime};base64,${bytes.toString('base64')}`
        }
      : { ...base, kind: 'binary' }
  }
  private atomic(target: string, bytes: Buffer, mode?: number): void {
    mkdirSync(dirname(target), { recursive: true })
    const temp = target + '.' + randomUUID() + '.tmp'
    try {
      try {
        if (lstatSync(target + '.desktop.bak').isSymbolicLink())
          throw new Error('Резервная копия является ссылкой')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      writeFileSync(temp, bytes, {
        flag: 'wx',
        mode: mode ?? (existsSync(target) ? statSync(target).mode & 0o777 : 0o600)
      })
      if (existsSync(target)) copyFileSync(target, target + '.desktop.bak')
      renameSync(temp, target)
    } finally {
      if (existsSync(temp)) unlinkSync(temp)
    }
  }
  save(file: SkillFile): SkillFile {
    if (
      !file ||
      typeof file.text !== 'string' ||
      Buffer.byteLength(file.text) > TEXT_LIMIT ||
      typeof file.path !== 'string' ||
      file.path.toLowerCase() === 'skill.md'
    )
      throw new Error('SKILL.md изменяется через редактор основного файла; текст до 512 КБ')
    const target = this.path(file.path, true),
      current = existsSync(target)
        ? this.read(file.path)
        : { text: '', revision: digest(''), encoding: 'utf8', lineEnding: 'LF' }
    if (current.revision !== file.revision)
      throw new Error('Файл изменился. Перечитайте его перед сохранением.')
    const bytes = encode(file.text, current.encoding ?? 'utf8', current.lineEnding ?? 'LF')
    if (bytes.length > TEXT_LIMIT) throw new Error('Текст в исходной кодировке больше 512 КБ')
    this.atomic(target, bytes)
    return this.read(file.path)
  }
  change(request: SkillPathChange, trash: string): void {
    if (!request || this.tree().treeRevision !== request.revision)
      throw new Error('Состав или содержимое пакета изменились. Обновите дерево файлов.')
    const target = this.path(request.path, true)
    if (request.path.toLowerCase() === 'skill.md')
      throw new Error('SKILL.md — точка входа; используйте основной редактор')
    if (request.action === 'remove') {
      if (!existsSync(target)) throw new Error('Файл или папка не найдены')
      mkdirSync(trash, { recursive: true })
      renameSync(target, join(trash, randomUUID() + '-' + basename(target)))
      return
    }
    if (request.action === 'rename') {
      if (typeof request.target !== 'string') throw new Error('Укажите новое имя')
      const dest = this.path(request.target, true)
      if (request.target.toLowerCase() === 'skill.md' || existsSync(dest))
        throw new Error('Файл или папка уже существуют')
      if (!existsSync(target)) throw new Error('Файл или папка не найдены')
      if (dest.startsWith(target + sep)) throw new Error('Нельзя перемещать папку внутрь себя')
      // Validate all descendant names before an atomic rename, without reading file contents.
      const root = new SkillPackage(this.root)
      const visit = (dir: string, prefix: string): void => {
        const d = opendirSync(dir)
        try {
          for (let item = d.readSync(); item; item = d.readSync()) {
            const old = prefix + '/' + item.name
            if (this.ignored(old)) continue
            root.path(request.target! + old.slice(request.path.length), true)
            const src = this.path(old)
            if (lstatSync(src).isDirectory()) visit(src, old)
          }
        } finally {
          d.closeSync()
        }
      }
      if (statSync(target).isDirectory()) visit(target, request.path)
      mkdirSync(dirname(dest), { recursive: true })
      renameSync(target, dest)
      return
    }
    if (existsSync(target)) throw new Error('Файл или папка уже существуют')
    if (request.action === 'file') this.atomic(target, Buffer.alloc(0))
    else if (request.action === 'directory') mkdirSync(target, { recursive: true })
    else throw new Error('Unknown file operation')
  }
  importFile(source: string, directory: string, revision: string): void {
    if (this.tree().treeRevision !== revision)
      throw new Error('Состав или содержимое пакета изменились. Обновите дерево файлов.')
    const st = lstatSync(source)
    if (st.isSymbolicLink() || !st.isFile() || st.size > IMPORT_BYTES)
      throw new Error('Choose a regular file up to 512 MB')
    const path = (directory ? directory + '/' : '') + basename(source),
      target = this.path(path, true)
    if (existsSync(target)) throw new Error('Файл или папка уже существуют')
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  static copy(source: string, destination: string): void {
    const pkg = new SkillPackage(source)
    let total = 0,
      count = 0
    const walk = (dir: string, prefix = ''): void => {
      const d = opendirSync(dir)
      try {
        for (let item = d.readSync(); item; item = d.readSync()) {
          const path = prefix + item.name
          if (pkg.ignored(path)) continue
          if (++count > IMPORT_FILES)
            throw new Error(
              'Skill snapshot exceeds 50,000 files/folders; exclude runtime data with .skillignore'
            )
          const from = pkg.path(path),
            to = join(destination, path),
            st = lstatSync(from)
          if (st.isDirectory()) {
            mkdirSync(to, { recursive: true })
            walk(from, path + '/')
          } else if (st.isFile()) {
            total += st.size
            if (total > IMPORT_BYTES)
              throw new Error(
                'Skill snapshot exceeds 512 MB; exclude runtime data with .skillignore'
              )
            mkdirSync(dirname(to), { recursive: true })
            copyFileSync(from, to)
          } else throw new Error('Only regular files and folders can be copied')
        }
      } finally {
        d.closeSync()
      }
    }
    mkdirSync(destination, { recursive: true })
    try {
      walk(source)
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      throw error
    }
  }
}
