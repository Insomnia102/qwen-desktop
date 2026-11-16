import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { McpConfig, McpProbeResult } from '../shared/mcp'

class PublicProbeError extends Error {}

function expand(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a: string, b: string) => {
    const name = a || b
    if (env[name] === undefined) throw new PublicProbeError(`В окружении приложения отсутствует переменная ${name}`)
    return env[name]!
  })
}
export async function probeMcp(name: string, config: McpConfig, cwd: string | null, signal: AbortSignal): Promise<McpProbeResult> {
  const env = process.env
  const client = new Client({ name: 'qwen-desktop-connection-check', version: '0.1.0' })
  const timeout = Math.min(config.timeout ?? 15_000, 30_000)
  let transport: Transport | undefined
  const controller = new AbortController()
  let rejectAbort: (error: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = (): void => { controller.abort(); rejectAbort(new PublicProbeError(signal.aborted ? 'Проверка отменена' : 'Сервер не ответил за отведённое время')) }
  const timer = setTimeout(abort, timeout)
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (signal.aborted) throw new Error('Проверка отменена')
    const base = cwd ?? homedir()
    if (config.command) {
      const childEnv: Record<string, string> = Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
      delete childEnv.ELECTRON_RUN_AS_NODE; delete childEnv.NODE_OPTIONS
      for (const [key, value] of Object.entries(config.env ?? {})) childEnv[key] = expand(value, env)
      const command = expand(config.command, env)
      if (resolve(command).toLowerCase() === resolve(process.execPath).toLowerCase() && process.versions.electron) childEnv.ELECTRON_RUN_AS_NODE = '1'
      transport = new StdioClientTransport({ command, args: (config.args ?? []).map(value => expand(value, env)), env: childEnv,
        cwd: resolve(base, expand(config.cwd ?? '.', env).replace(/^~(?=$|[\\/])/, homedir())), stderr: 'pipe' })
      // Drain diagnostic output; it can contain credentials and never belongs in the renderer/chat.
      ;(transport as StdioClientTransport).stderr?.on('data', () => {})
    } else {
      const url = new URL(expand(config.httpUrl ?? config.url!, env))
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Некорректный HTTP(S)-адрес MCP')
      const headers = Object.fromEntries(Object.entries(config.headers ?? {}).map(([k, v]) => [k, expand(v, env)]))
      const options = { requestInit: { headers, signal: controller.signal } }
      transport = config.httpUrl ? new StreamableHTTPClientTransport(url, options) : new SSEClientTransport(url, options)
    }
    const work = async (): Promise<McpProbeResult> => {
      await client.connect(transport!, { timeout, signal: controller.signal })
      const tools: McpProbeResult['tools'] = []
      let cursor: string | undefined
      const cursors = new Set<string>()
      if (client.getServerCapabilities()?.tools) do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout, signal: controller.signal })
        for (const tool of page.tools) {
          tools.push({ name: tool.name, description: (tool.description ?? '').slice(0, 3000),
            enabled: (!config.includeTools || config.includeTools.some(x => x === tool.name)) && !(config.excludeTools ?? []).includes(tool.name) })
          if (tools.length > 1000) throw new PublicProbeError('Сервер вернул больше 1000 инструментов')
        }
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new PublicProbeError('Сервер повторяет страницы инструментов')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      const version = client.getServerVersion()
      return { name, tools, checkedAt: new Date().toISOString(), serverName: version?.name, serverVersion: version?.version }
    }
    return await Promise.race([work(), aborted])
  } catch (error) {
    if (signal.aborted) throw new Error('Проверка отменена')
    const message = error instanceof Error ? error.message : ''
    // Do not reflect URLs, request headers, env values or server error bodies into the UI.
    if (error instanceof PublicProbeError) throw error
    if (/401|403|unauthorized|oauth/i.test(message)) throw new Error('Сервер требует авторизацию. Проверьте заголовки и переменные окружения. OAuth-вход в этой версии Desktop ещё не реализован.')
    if (/ENOENT/.test(message)) throw new Error('Команда MCP-сервера не найдена. Проверьте путь и установку Node.js/Python.')
    throw new Error('Не удалось подключиться к MCP. Проверьте адрес, команду, аргументы и авторизацию сервера.')
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort)
    if (transport instanceof StreamableHTTPClientTransport && !controller.signal.aborted) {
      // End the temporary server-side session as well as closing its local transport.
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([transport.terminateSession(), new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 2000) })]) }
      catch { /* Servers may not support explicit termination. */ }
      finally { if (cleanupTimer) clearTimeout(cleanupTimer) }
    }
    controller.abort()
    try { await client.close() } catch { /* close partially initialized transport below */ }
    try { await transport?.close() } catch { /* already closed */ }
  }
}
