// Integration test: the real bundled Qwen CLI calls its real write_file tool.
// Only the model provider is a local HTTP fixture: no API key or paid model needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@qwen-code/sdk'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const cliEntry = join(dirname(require.resolve('@qwen-code/sdk/package.json')), 'dist/cli/cli.js')
const bootstrap = fileURLToPath(new URL('../resources/qwen-bootstrap.cjs', import.meta.url))
import { loadTypeScript } from './load-typescript.mjs'
const { Transcript } = loadTypeScript('src/main/transcript.ts')

for (const scenario of [
  { name: 'Plan blocks writes', mode: 'plan', allow: false, callback: false },
  { name: 'Ask requires approval', mode: 'default', allow: true, callback: true },
  { name: 'Ask refusal prevents writes', mode: 'default', allow: false, callback: true },
  { name: 'Auto-Edit approves file editing', mode: 'auto-edit', allow: true, callback: false },
  { name: 'YOLO approves file editing', mode: 'yolo', allow: true, callback: false }
]) test(`real bundled CLI: ${scenario.name}`, { timeout: 60_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'qwen-desktop-'))
  const target = join(cwd, 'hello.txt')
  let launcher = bootstrap
  if (scenario.electron) {
    launcher = join(cwd, 'simulate-electron.cjs')
    await writeFile(launcher, `Object.defineProperty(process.versions, 'electron', {value:'44.10.2', configurable:true});\nrequire(process.env.QWEN_DESKTOP_TEST_BOOTSTRAP);\n`)
  }
  let requests = 0
  let toolOffered = false
  let issuedTool = false
  let approvals = 0
  let sawUserPrompt = false
  const diagnostics = []
  const server = createServer(async (req, res) => {
    try {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests++
      sawUserPrompt ||= JSON.stringify(body.messages).includes('Create hello.txt containing exactly Hello from qwen')
      const tool = body.tools?.find(item => item.function?.name === 'write_file')
      toolOffered ||= Boolean(tool)
      const toolCall = { id: 'call_write_hello', type: 'function', function: {
        name: 'write_file', arguments: JSON.stringify({ file_path: target, content: 'Hello from qwen' })
      } }
      const first = !issuedTool
      if (first) issuedTool = true
      const content = first ? null : 'Tool request handled'
      const finish = first ? 'tool_calls' : 'stop'
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const chunk = delta => ({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk',
          created: 1, model: 'fixture-qwen', choices: [{ index: 0, delta, finish_reason: null }] })
        const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] } :
          { role: 'assistant', content }
        res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
        const end = chunk({})
        end.choices[0].finish_reason = finish
        end.usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        res.write(`data: ${JSON.stringify(end)}\n\n`)
        res.end('data: [DONE]\n\n')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion',
          created: 1, model: 'fixture-qwen', choices: [{ index: 0,
            message: { role: 'assistant', content, ...(first ? { tool_calls: [toolCall] } : {}) },
            finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
      }
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 45_000)
  let session
  try {
    session = query({ prompt: 'Create hello.txt containing exactly Hello from qwen', options: {
      cwd, authType: 'openai', model: 'fixture-qwen', permissionMode: scenario.mode, safeMode: true,
      pathToQwenExecutable: launcher, excludeTools: ['ask_user_question'],
      canUseTool: async (_name, input) => {
        approvals++
        return scenario.allow ? { behavior: 'allow', updatedInput: input } :
          { behavior: 'deny', message: 'Fixture denied this tool' }
      },
      coreTools: ['write_file', 'read_file'], includePartialMessages: true,
      env: { QWEN_CODE_NO_RELAUNCH: 'true', QWEN_DESKTOP_CLI_ENTRY: cliEntry, QWEN_DESKTOP_TEST_BOOTSTRAP: bootstrap, QWEN_HOME: join(cwd, 'isolated-qwen'), OPENAI_API_KEY: 'fixture-local-only',
        OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` },
      abortController: abort, stderr: text => diagnostics.push(text), logLevel: 'debug'
    } })
    await session.initialized
    let result
    const snapshots = new Map()
    const transcript = new Transcript('fixture-request', event => {
      if (event.type === 'text') snapshots.set(event.messageId, event.text)
    })
    for await (const event of session) {
      transcript.accept(event)
      if (event.type === 'result') result = event
    }
    if (scenario.mode !== 'plan') assert.equal(toolOffered, true)
    assert.equal(sawUserPrompt, true)
    assert.equal(result?.is_error, false, JSON.stringify(result))
    if (scenario.allow) {
      assert.equal(await readFile(target, 'utf8'), 'Hello from qwen')
      assert.deepEqual(result.permission_denials, [])
    } else {
      await assert.rejects(readFile(target, 'utf8'), { code: 'ENOENT' })
      // This CLI version can leave permission_denials empty after a custom
      // callback rejection. Check the actual absence of the file instead.
    }
    assert.equal(approvals, scenario.callback ? 1 : 0)
    assert.ok(requests >= 2)
    assert.deepEqual([...snapshots.values()], ['Tool request handled'])
  } catch (error) {
    console.error(diagnostics.join('').slice(-10_000))
    throw error
  } finally {
    clearTimeout(timer)
    await session?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(cwd, { recursive: true, force: true })
  }
})
