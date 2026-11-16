import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@qwen-code/sdk'
import { harness } from './main-harness.mjs'

test('real CLI hides and blocks disabled write_file in YOLO, then enables it on the next request', { timeout: 60_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-native-toggle-'))
  const target = join(base, 'native-result.txt')
  let phase = 'disabled'
  const offered = new Map(), issued = new Set(), requests = new Map(), diagnostics = []
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.set(phase, (requests.get(phase) ?? 0) + 1)
      offered.set(phase, (offered.get(phase) ?? false) || body.tools?.some(tool => tool.function?.name === 'write_file'))
      const first = !issued.has(phase); issued.add(phase)
      const call = { id: `native-${phase}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ file_path: target, content: 'Enabled native writer' }) } }
      const content = first ? null : 'Done'
      const finish_reason = first ? 'tool_calls' : 'stop'
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const packet = delta => ({ id: 'chatcmpl-native-toggle', object: 'chat.completion.chunk', created: 1,
          model: 'fixture-qwen', choices: [{ index: 0, delta, finish_reason: null }] })
        res.write(`data: ${JSON.stringify(packet(first ? { role: 'assistant', tool_calls: [{ index: 0, ...call }] } : { role: 'assistant', content }))}\n\n`)
        const end = packet({}); end.choices[0].finish_reason = finish_reason
        end.usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        res.write(`data: ${JSON.stringify(end)}\n\n`); res.end('data: [DONE]\n\n')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'chatcmpl-native-toggle', object: 'chat.completion', model: 'fixture-qwen', created: 1,
          choices: [{ index: 0, message: { role: 'assistant', content, ...(first ? { tool_calls: [call] } : {}) }, finish_reason }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
      }
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const h = await harness({ userData: join(base, 'app'), folder: base, query: config => query({
    prompt: config.prompt, options: { ...config.options, authType: 'openai', model: 'fixture-qwen', safeMode: true,
      coreTools: ['read_file', 'write_file'], env: { ...config.options.env, QWEN_HOME: join(base, 'isolated-qwen'),
        OPENAI_API_KEY: 'fixture-local-only', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` },
      stderr: text => diagnostics.push(text) }
  }) })
  try {
    await h.invoke('select-folder'); await h.invoke('set-mode', 'yolo')
    let view = (await h.invoke('get-core-tools', 'project')).value
    assert.equal((await h.invoke('save-core-tools', { scope: 'project', revision: view.revision, changes: { write_file: false } })).ok, true)
    await h.start('disabled', 'Use disabled writer'); await h.done('disabled', 25_000)
    assert.equal((await h.view()).chat.status, 'done')
    assert.equal(offered.get('disabled'), false)
    assert.ok(requests.get('disabled') >= 2)
    await assert.rejects(readFile(target), { code: 'ENOENT' })
    phase = 'enabled'
    view = (await h.invoke('get-core-tools', 'project')).value
    assert.equal((await h.invoke('save-core-tools', { scope: 'project', revision: view.revision, changes: { write_file: true } })).ok, true)
    await h.start('enabled', 'Use enabled writer'); await h.done('enabled', 25_000)
    assert.equal((await h.view()).chat.status, 'done')
    assert.equal(offered.get('enabled'), true)
    assert.equal(await readFile(target, 'utf8'), 'Enabled native writer')
    assert.equal(h.events.some(event => event.type === 'permission'), false)
  } catch (error) { console.error(diagnostics.join('').slice(-10_000)); throw error }
  finally {
    await h.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(base, { recursive: true, force: true })
  }
})
