import type { SettingsScope } from './settings'

export interface McpConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  httpUrl?: string
  headers?: Record<string, string>
  timeout?: number
  trust?: boolean
  description?: string
  includeTools?: string[]
  excludeTools?: string[]
  [key: string]: unknown
}
export interface McpEntry {
  name: string
  config: McpConfig
  source: string
  editable: boolean
  enabled: boolean
  toggleLocked: boolean
  reason: string
  needsApproval?: boolean
}
export interface McpView {
  scope: SettingsScope
  path: string
  revision: string
  contextRevision: string
  servers: McpEntry[]
}
export type McpMutation = { scope: SettingsScope; revision: string; name: string } & (
  | { action: 'save'; config: McpConfig; create: boolean }
  | { action: 'remove' }
  | { action: 'toggle'; enabled: boolean }
  | { action: 'approve' }
)
export interface McpProbeRequest { scope: SettingsScope; name: string; contextRevision: string }
export interface McpProbeResult {
  name: string
  checkedAt: string
  tools: { name: string; description: string; enabled: boolean }[]
  serverName?: string
  serverVersion?: string
}
