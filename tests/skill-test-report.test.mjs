import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadTypeScript } from './load-typescript.mjs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
const { skillTestReportHTML } = loadTypeScript('src/main/skill-test-report.ts')
function fixture() {
  return {
    id: 'run-1',
    name: 'Pipeline <report>',
    purpose: 'test',
    suiteId: 'suite',
    skillName: 'pipeline',
    skillRevision: 'revision',
    modelLabel: 'Test model',
    createdAt: '2026-11-21T15:00:00Z',
    finishedAt: '2026-11-21T15:01:00Z',
    status: 'done',
    sourceCwd: '/test/project',
    scope: 'user',
    suiteSnapshot: {
      permissionMode: 'yolo',
      cases: [
        {
          id: 'one',
          prompt: 'Start pipeline',
          dialogue: { persona: 'Choose full', criteria: ['Ask before starting'] }
        }
      ]
    },
    cases: [
      {
        id: 'one',
        name: 'Manual parameters',
        status: 'failed',
        startedAt: '2026-11-21T15:00:00Z',
        durationMs: 1200,
        answer: '**Actual result**',
        budget: { modelTurns: 8, maxModelTurns: 60, toolCalls: 5, maxToolCalls: 150 },
        tokens: 500,
        dialogue: [
          {
            role: 'user',
            source: 'initial',
            text: 'Start **pipeline**',
            at: '2026-11-21T15:00:00Z'
          },
          {
            role: 'assistant',
            source: 'agent',
            text: '## Result\n\n|Profile|Status|\n|---|---|\n|`smoke`|SUCCESS|\n\n[Docs](https://example.com)',
            at: '2026-11-21T15:00:01Z'
          }
        ],
        evidence: [
          { id: 'e1', kind: 'message', text: 'User requested manual mode' },
          { id: 'e2', kind: 'tool', text: 'run_shell_command: profile=smoke; status=SUCCESS' }
        ],
        assessments: [
          {
            criterion: 'Ask before starting',
            status: 'failed',
            reason: 'Defaults were used before confirmation',
            evidenceIds: ['e1', 'e2', 'missing']
          }
        ],
        checks: [
          {
            check: { kind: 'answer-contains', value: 'full' },
            passed: false,
            detail: 'Expected full'
          }
        ],
        trace: [
          {
            at: '2026-11-21T15:00:01Z',
            type: 'tool',
            name: 'run_shell_command',
            text: 'profile=smoke'
          }
        ],
        artifacts: ['output/report.json']
      }
    ]
  }
}
test('offline HTML run report shows summary, dialogue, Markdown, checks and unique evidence anchors in all interface languages', () => {
  for (const language of ['ru', 'en', 'zh-CN']) {
    const dom = new JSDOM(skillTestReportHTML(fixture(), language)),
      d = dom.window.document
    assert.equal(d.documentElement.lang, language)
    assert.equal(d.title, 'Pipeline <report> — Qwen Skills Lab')
    assert.equal(d.querySelectorAll('.case').length, 1)
    assert.equal(d.querySelectorAll('.conversation .bubble').length, 2)
    assert.equal(d.querySelectorAll('.prose table').length, 1)
    assert.equal(d.querySelector('.assessment .badge').classList.contains('failed'), true)
    assert.equal(d.querySelectorAll('.citations a').length, 2)
    for (const a of d.querySelectorAll('.citations a'))
      assert.ok(d.querySelector(a.getAttribute('href')))
    assert.equal(d.querySelectorAll('.evidence').length, 2)
    assert.ok(d.querySelector('.case').textContent.includes('8/60'))
    assert.ok(d.querySelector('.case').textContent.includes('output/report.json'))
    assert.equal(d.querySelectorAll('script,link,iframe,img,input,form').length, 0)
    assert.ok(
      d
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        .content.includes("default-src 'none'")
    )
    assert.equal(d.querySelector('a[href="https://example.com"]').rel, 'noopener noreferrer')
    if (language === 'en') {
      assert.ok(d.body.textContent.includes('Tool result · e2'))
      assert.ok(!d.body.textContent.includes('Сведения о прогоне'))
    }
    dom.window.close()
  }
})
test('HTML exporter treats model prose, tool output, metadata and Markdown URLs as untrusted text', () => {
  const b = fixture(),
    attack =
      '</pre><img src="https://evil.invalid/pixel" onerror="alert(1)"><script>alert(1)</script>'
  b.name = attack
  b.modelLabel = attack
  b.cases[0].name = attack
  b.cases[0].error = attack
  b.cases[0].artifacts = [attack]
  b.cases[0].evidence[0].text = attack
  b.cases[0].trace[0].text = attack
  b.cases[0].dialogue[1].text =
    attack +
    '\n\n[bad](javascript:alert%281%29) ![pixel](https://evil.invalid/image)\n\n```html\n' +
    attack +
    '\n```\n\n**safe bold**'
  b.cases[0].budget.modelTurns = attack
  b.cases[0].tokens = attack
  const dom = new JSDOM(skillTestReportHTML(b, 'en')),
    d = dom.window.document
  assert.equal(d.querySelectorAll('script,img,iframe,object,embed,form').length, 0)
  for (const el of d.querySelectorAll('*'))
    for (const attr of el.attributes) assert.ok(!attr.name.startsWith('on'))
  assert.equal(d.querySelectorAll('a[href^="javascript:"]').length, 0)
  assert.equal(d.querySelector('.prose strong').textContent, 'pipeline')
  assert.ok(d.querySelector('.evidence pre').textContent.includes('<img'))
  assert.ok(d.querySelector('.prose code').textContent.includes('<img'))
  dom.window.close()
})
test('reports support running/legacy cases without dialogue, snapshots or budget metadata', () => {
  const b = fixture()
  delete b.suiteSnapshot
  b.status = 'running'
  b.finishedAt = undefined
  b.cases = [
    {
      id: 'old',
      name: 'Legacy',
      status: 'running',
      answer: 'Still **working**',
      checks: [],
      trace: [],
      artifacts: []
    }
  ]
  const dom = new JSDOM(skillTestReportHTML(b, 'en')),
    d = dom.window.document
  assert.equal(d.querySelector('.answer strong').textContent, 'working')
  assert.ok(d.querySelector('.report-header').textContent.includes('snapshot'))
  assert.ok(!d.body.textContent.includes('undefined'))
  dom.window.close()
})
