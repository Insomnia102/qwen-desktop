import { seedServiceFixture } from './lab-ui-fixtures.mjs'
// Real bundled CLI and filesystem tools; the model endpoint is a local deterministic fixture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { query } from '@qwen-code/sdk'
import { root } from './main-harness.mjs'
import { loadTypeScript } from './load-typescript.mjs'
const require = createRequire(import.meta.url),
  { SkillsStore } = loadTypeScript('src/main/skills-store.ts'),
  { SkillTestsService } = loadTypeScript('src/main/skill-tests-service.ts')
test(
  'real SDK skills tester expands skill, detects automatic skill loads, writes artifacts and persists isolated reports',
  { timeout: 90000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), 'qwen-sdk-tester-')),
      requests = [],
      launches = [],
      diagnostics = []
    let workspace = '',
      phase = 'explicit',
      round = 0,
      service,
      approvals = 0
    const server = createServer(async (req, res) => {
      try {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw)
        requests.push({ phase, body })
        round++
        let fn
        if (phase === 'auto' && round === 1)
          fn = { name: 'skill', arguments: JSON.stringify({ skill: 'repo-health-report' }) }
        else if (round === (phase === 'auto' ? 2 : 1))
          fn = {
            name: 'write_file',
            arguments: JSON.stringify({
              file_path: join(workspace, 'answer.json'),
              content: '{"status":"ready","count":2}'
            })
          }
        if (fn)
          assert.ok(
            body.tools.some((x) => x.function?.name === fn.name),
            'Missing ' + fn.name
          )
        const content = 'Tester completed',
          call = { id: 'case-' + phase + '-' + round, type: 'function', function: fn },
          finish = fn ? 'tool_calls' : 'stop'
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const packet = (delta) => ({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: null }]
          })
          res.write(
            'data: ' +
              JSON.stringify(
                packet(
                  fn
                    ? { role: 'assistant', tool_calls: [{ index: 0, ...call }] }
                    : { role: 'assistant', content }
                )
              ) +
              '\n\n'
          )
          const end = packet({})
          end.choices[0].finish_reason = finish
          res.end('data: ' + JSON.stringify(end) + '\n\ndata: [DONE]\n\n')
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'chatcmpl-test',
              object: 'chat.completion',
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: fn ? null : content,
                    ...(fn ? { tool_calls: [call] } : {})
                  },
                  finish_reason: finish
                }
              ],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
            })
          )
        }
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    t.after(async () => {
      service?.runner.cancel()
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    })
    const skills = new SkillsStore(base, {
      QWEN_HOME: join(base, 'original-qwen'),
      QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json')
    })
    service = new SkillTestsService({
      directory: join(base, 'lab'),
      resources: join(root, 'resources'),
      skills,
      environment: async () => ({
        bootstrap: join(root, 'resources/qwen-bootstrap.cjs'),
        cli: join(dirname(require.resolve('@qwen-code/sdk/package.json')), 'dist/cli/cli.js'),
        model: 'tester-fixture',
        authType: 'openai',
        modelLabel: 'Loopback fixture',
        env: {
          OPENAI_API_KEY: 'fixture-local-only',
          OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`
        },
        settings: {},
        systemPrompt: { type: 'preset', preset: 'qwen_code', append: 'TESTER_SYSTEM_MARKER' },
        disabledTools: [],
        mcpServers: {}
      }),
      launch: (config) => {
        workspace = config.options.cwd
        launches.push(config)
        return query({
          ...config,
          options: { ...config.options, stderr: (s) => diagnostics.push(s) }
        })
      },
      changed: () => {
        for (const p of service?.runner.permissions(1) ?? []) {
          approvals++
          service.runner.approve(1, p.id, 'allow-once')
        }
      }
    })
    try {
      let suite = seedServiceFixture(service, 'repo-health-report', null)
      suite = service.save(
        {
          ...suite,
          cases: [
            {
              id: 'native',
              name: 'Native tools',
              prompt: 'Write answer.json for the fixture',
              files: [],
              checks: [
                { kind: 'json-equals', path: 'answer.json', pointer: '/status', value: 'ready' },
                { kind: 'tool-used', value: 'write_file' },
                { kind: 'skill-used', value: true }
              ]
            }
          ],
          timeoutSeconds: 30
        },
        null
      )
      for (const invocation of ['explicit', 'auto']) {
        phase = invocation
        round = 0
        suite = service.save(
          { ...suite, invocation, permissionMode: invocation === 'auto' ? 'default' : 'auto-edit' },
          null
        )
        const batch = await service.run(1, suite.id)
        const until = Date.now() + 40000
        while (service.runner.running) {
          if (Date.now() > until) throw Error('Real SDK tester timeout')
          await new Promise((r) => setTimeout(r, 50))
        }
        const report = service.store.run(batch.id)
        assert.equal(report.cases[0].status, 'passed', JSON.stringify(report))
        assert.equal(
          JSON.parse(service.runner.artifact(batch.id, 'native', 'answer.json').text).count,
          2
        )
        assert.equal(report.suiteSnapshot.invocation, invocation)
        assert.ok(
          JSON.stringify(requests.filter((r) => r.phase === invocation)).includes(
            'TESTER_SYSTEM_MARKER'
          )
        )
        assert.ok(
          JSON.stringify(requests.filter((r) => r.phase === invocation)).includes(
            'Repository Health Report'
          )
        )
      }
      assert.equal(launches.length, 2)
      assert.notEqual(launches[0].options.cwd, launches[1].options.cwd)
      assert.equal(launches[1].options.resume, undefined)
      assert.ok(approvals >= 1)
      assert.equal(JSON.stringify(service.view(1)).includes('fixture-local-only'), false)
      assert.equal(
        (await readFile(skills.get('user', suite.skillId, null).entry.path, 'utf8')).includes(
          'Repository Health Report'
        ),
        true
      )
    } catch (error) {
      console.error(diagnostics.join('').slice(-10000))
      throw error
    }
  }
)
