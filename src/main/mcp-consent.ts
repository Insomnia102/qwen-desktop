import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { McpConfig } from '../shared/mcp'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  return value
}
// Authorizes an exact, user-selected project server definition. A repository
// edit changes the fingerprint and must not silently run a different command.
export class McpConsent {
  constructor(private file: string) {}
  private key(cwd: string, name: string): string {
    const path = resolve(cwd)
    return createHash('sha256').update(`${process.platform === 'win32' ? path.toLowerCase() : path}\0${name}`).digest('hex')
  }
  private fingerprint(config: McpConfig): string { return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex') }
  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([k, v]) => !/^[a-f0-9]{64}$/.test(k) || typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) throw new Error('Повреждён список разрешённых MCP-подключений Desktop')
    return data as Record<string, string>
  }
  has(cwd: string, name: string, config: McpConfig): boolean { return this.read()[this.key(cwd, name)] === this.fingerprint(config) }
  grant(cwd: string, name: string, config: McpConfig): void {
    const data = this.read(); data[this.key(cwd, name)] = this.fingerprint(config)
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try { writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.file) }
    finally { if (existsSync(temporary)) unlinkSync(temporary) }
  }
}
