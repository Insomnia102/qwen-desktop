import { seedServiceFixture } from './lab-ui-fixtures.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { query } from '@qwen-code/sdk'
import { loadTypeScript } from './load-typescript.mjs'
import { root } from './main-harness.mjs'
const require = createRequire(import.meta.url),
  { SkillsStore } = loadTypeScript('src/main/skills-store.ts'),
  { SkillTestsService } = loadTypeScript('src/main/skill-tests-service.ts')
test(
  'real SDK keeps one live dialogue across dependent questions; repeat runs isolate context and tool-free helpers observe actual local CI execution',
  { timeout: 120000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), 'qwen-real-dialogue-')),
      launches = [],
      requests = [],
      diagnostics = []
    let previousJob = '',
      previousWorkspace = ''
    const rounds = new Map()
    let current,
      turn = 0,
      round = 0,
      service,
      workspace = '',
      approvals = 0
    const quote = (value) => '"' + value.replace(/\\/g, '/') + '"'
    const server = createServer(async (req, res) => {
      try {
        let raw = ''
        for await (const c of req) raw += c
        const body = JSON.parse(raw)
        requests.push(body)
        round++
        const textOf = (content) =>
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((b) => b.text ?? '').join('\n')
              : ''
        const user = textOf([...body.messages].reverse().find((m) => m.role === 'user')?.content)
        const marker = user.indexOf('{"labRole":')
        let role = 'agent',
          data
        if (marker >= 0) {
          const parsed = JSON.parse(user.slice(marker, user.lastIndexOf('}') + 1))
          role = parsed.labRole
          data = parsed.data
        }
        if (role === 'agent') {
          if (!rounds.size) {
            assert.ok(!JSON.stringify(body).includes(previousJob || 'NOT_A_PREVIOUS_JOB'))
            if (previousWorkspace) assert.ok(!JSON.stringify(body).includes(previousWorkspace))
          }
          turn = user.trim() === 'full' ? 3 : user.trim() === 'api' ? 2 : 1
          round = (rounds.get(turn) ?? 0) + 1
          rounds.set(turn, round)
        }
        let content, fn
        if (role === 'actor') {
          assert.equal(body.tools?.length ?? 0, 0, 'AI user unexpectedly has tools')
          const last = data.conversation.at(-1).text
          content = JSON.stringify(
            last.includes('Which service')
              ? { action: 'reply', text: 'api', delaySeconds: 0 }
              : last.includes('Which profile')
                ? { action: 'reply', text: 'full', delaySeconds: 0 }
                : { action: 'finish', text: 'Build completed', delaySeconds: 0 }
          )
        } else if (role === 'reviewer') {
          assert.equal(body.tools?.length ?? 0, 0, 'Reviewer unexpectedly has tools')
          assert.ok(
            data.evidence.some((e) => e.kind === 'tool' && e.text.includes('SUCCESS')),
            'No actual status evidence'
          )
          content = JSON.stringify({
            assessments: data.requirements.map((r) => ({
              criterionId: r.id,
              status: 'passed',
              reason: 'Actual script status confirms completion',
              evidenceIds: [
                data.evidence.find((e) => e.kind === 'tool' && e.text.includes('SUCCESS')).id
              ]
            }))
          })
        } else {
          const script = join(workspace, '.qwen/skills/under-test/scripts/ci.mjs'),
            command = quote(process.execPath) + ' ' + quote(script) + ' '
          if (round === 1)
            fn = {
              name: 'run_shell_command',
              arguments: JSON.stringify({
                command:
                  command +
                  (turn === 1
                    ? 'catalog'
                    : turn === 2
                      ? 'profiles --service api'
                      : 'start --service api --profile full')
              })
            }
          else if (turn === 3 && round === 2) {
            const jobs = await readdir(join(workspace, '.demo-ci/jobs')),
              job = JSON.parse(await readFile(join(workspace, '.demo-ci/jobs', jobs[0]), 'utf8'))
            fn = {
              name: 'run_shell_command',
              arguments: JSON.stringify({
                command: command + 'status --id ' + job.id + ' --wait-ms 1000'
              })
            }
          } else
            content =
              turn === 1
                ? 'Which service: api or web?'
                : turn === 2
                  ? 'Which profile: quick or full?'
                  : 'Build SUCCESS for api/full'
        }
        const call = { id: 'call-' + turn + '-' + round, type: 'function', function: fn },
          finish = fn ? 'tool_calls' : 'stop'
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const packet = (delta) => ({
            id: 'chatcmpl-lab',
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
              id: 'chatcmpl-lab',
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
      } catch (error) {
        res.writeHead(500)
        res.end(String(error))
        diagnostics.push(String(error))
      }
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    t.after(async () => {
      service?.cancel()
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    })
    service = new SkillTestsService({
      directory: join(base, 'lab'),
      resources: join(root, 'resources'),
      skills: new SkillsStore(base, {
        QWEN_HOME: join(base, 'qwen'),
        QWEN_CODE_SYSTEM_SETTINGS_PATH: join(base, 'system.json')
      }),
      environment: async () => ({
        bootstrap: join(root, 'resources/qwen-bootstrap.cjs'),
        cli: join(dirname(require.resolve('@qwen-code/sdk/package.json')), 'dist/cli/cli.js'),
        model: 'local-dialogue',
        authType: 'openai',
        modelLabel: 'Local test API',
        env: {
          OPENAI_API_KEY: 'fixture-key',
          OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`
        },
        settings: {},
        systemPrompt: { type: 'preset', preset: 'qwen_code', append: 'NATIVE_DIALOGUE_MARKER' },
        disabledTools: [],
        mcpServers: {}
      }),
      launch: (c) => {
        current = c
        round = 0
        let role = false
        try {
          role = Boolean(JSON.parse(c.prompt).labRole)
        } catch {}
        if (!role) {
          turn++
          rounds.clear()
          workspace = c.options.cwd
        }
        launches.push({ config: c, role })
        return query({ ...c, options: { ...c.options, stderr: (s) => diagnostics.push(s) } })
      },
      changed: () => {
        for (const p of service?.runner.permissions(1) ?? []) {
          approvals++
          service.runner.approve(1, p.id, 'allow-once')
        }
      }
    })
    try {
      const example = seedServiceFixture(service, 'demo-build-assistant', null),
        suite = service.save(
          {
            ...example,
            cases: [
              {
                ...example.cases[1],
                files: [{ path: 'demo-control.json', text: '{"delayMs":0}' }],
                dialogue: {
                  ...example.cases[1].dialogue,
                  criteria: ['Collect parameters, launch api/full and confirm actual SUCCESS'],
                  maxMessages: 6
                }
              }
            ],
            timeoutSeconds: 60
          },
          null
        )
      for (let run = 0; run < 2; run++) {
        const runSuite = run
          ? service.save({ ...service.store.get(suite.id), permissionMode: 'yolo' }, null)
          : suite
        const before = requests.length,
          priorApprovals = approvals,
          batch = await service.run(1, runSuite.id)
        const end = Date.now() + 90000
        while (service.busy) {
          if (Date.now() > end) throw Error('Native dialogue timed out')
          await new Promise((r) => setTimeout(r, 50))
        }
        const report = service.store.run(batch.id)
        assert.equal(report.cases[0].status, 'passed', JSON.stringify(report))
        assert.equal(report.cases[0].dialogue.length, 6)
        const native = launches.filter((x) => !x.role)
        assert.equal(native.length, run + 1)
        assert.ok(native[run].config.options.sessionId)
        assert.equal(native[run].config.options.resume, undefined)
        assert.equal(
          report.cases[0].budget.modelTurns,
          requests
            .slice(before)
            .filter((r) => JSON.stringify(r.messages).includes('NATIVE_DIALOGUE_MARKER')).length
        )
        if (run) {
          assert.equal(approvals, priorApprovals, 'YOLO unexpectedly requested approval')
          assert.equal(native[run].config.options.permissionMode, 'yolo')
        } else assert.ok(approvals >= 1)
        assert.ok(
          requests.some(
            (r) =>
              JSON.stringify(r.messages).includes('Which service') &&
              JSON.stringify(r.messages).includes('Which profile')
          ),
          'Earlier turns were not resumed'
        )
        const jobs = await readdir(join(workspace, '.demo-ci/jobs')),
          job = JSON.parse(await readFile(join(workspace, '.demo-ci/jobs', jobs[0]), 'utf8'))
        assert.equal(job.service, 'api')
        assert.equal(job.profile, 'full')
        if (run)
          assert.notEqual(native[0].config.options.sessionId, native[1].config.options.sessionId)
        previousJob = job.id
        previousWorkspace = workspace
      }
    } catch (error) {
      console.error(diagnostics.join('').slice(-10000))
      throw error
    }
  }
)
