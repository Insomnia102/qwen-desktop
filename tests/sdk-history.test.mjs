// Two independently initialized desktop services, two real CLI processes, one
// persisted chat. A local model fixture verifies the resumed context itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@qwen-code/sdk'
import { harness } from './main-harness.mjs'

test('real CLI restores model context after desktop restart using the saved session ID', { timeout: 60_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'qwen-sdk-history-'))
  const home=join(base,'isolated-qwen-home');await mkdir(home)
  const secret = 'lotus-private-marker-740'
  let sawPreviousUserMessage = false
  let requestCount = 0
  const logs = [], resumes = []
  const server = createServer(async (req, res) => {
    try {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      const users = body.messages.filter(item => item.role === 'user').map(item => JSON.stringify(item.content))
      const continuing = users.at(-1)?.includes('What was the marker?')
      if (continuing) sawPreviousUserMessage ||= users.slice(0, -1).some(item => item.includes(secret))
      requestCount++
      const content = continuing ? 'The remembered marker is lotus-private-marker-740.' : 'I have remembered the marker.'
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const packet = (delta, finish_reason = null) => ({ id: 'chatcmpl-history-fixture', object: 'chat.completion.chunk',
          created: 1, model: 'fixture-qwen', choices: [{ index: 0, delta, finish_reason }] })
        res.write(`data: ${JSON.stringify(packet({ role: 'assistant', content }))}\n\n`)
        res.write(`data: ${JSON.stringify({ ...packet({}, 'stop'), usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`)
        res.end('data: [DONE]\n\n')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'chatcmpl-history-fixture', object: 'chat.completion', created: 1, model: 'fixture-qwen',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
      }
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const launch = config => {
    resumes.push(config.options.resume)
    return query({ prompt: config.prompt, options: { ...config.options,
      authType: 'openai', model: 'fixture-qwen', safeMode: true, coreTools: ['read_file'],
      env: { ...config.options.env,QWEN_HOME:home,QWEN_USAGE_STATISTICS_ENABLED:'false',QWEN_TELEMETRY_ENABLED:'false',OTEL_SDK_DISABLED:'true',QWEN_CODE_MODELS_DEV_REFRESH:'off', OPENAI_API_KEY: 'fixture-local-only',
        OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` },
      stderr: text => logs.push(text)
    } })
  }
  let h = await harness({ userData: join(base, 'app-data'), folder: base, query: launch })
  try {
    await h.invoke('select-folder')
    await h.start('remember', `Remember this marker: ${secret}`)
    await h.done('remember', 25_000)
    let value = await h.view()
    assert.equal(value.chat.status, 'done', JSON.stringify(value.chat))
    assert.equal(value.chat.turns[0].events.filter(x => x.type === 'final').length, 1)
    const sessionId = value.chat.sessionId, chatId = value.chat.id
    assert.ok(sessionId)
    await h.close()
    h = await harness({ userData: join(base, 'app-data'), folder: base, query: launch })
    value = await h.view()
    assert.equal(value.chat.id, chatId)
    assert.equal(value.chat.sessionId, sessionId)
    assert.equal(value.chat.turns.length, 1)
    await h.start('recall', 'What was the marker?')
    await h.done('recall', 25_000)
    value = await h.view()
    assert.equal(value.chat.status, 'done', JSON.stringify(value.chat))
    assert.equal(resumes[0], undefined)
    assert.equal(resumes[1], sessionId)
    assert.equal(sawPreviousUserMessage, true, 'The second provider request did not contain the previous user message')
    assert.equal(value.chat.turns.length, 2)
    assert.ok(value.chat.turns[1].events.some(x => x.type === 'text' && x.text.includes(secret)))
    assert.ok(requestCount >= 2)
  } catch (error) {
    console.error(logs.join('').slice(-10_000))
    throw error
  } finally {
    await h.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(base, { recursive: true, force: true })
  }
})
