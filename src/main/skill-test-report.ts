// SPDX-License-Identifier: GPL-3.0-only
import { Marked, type Tokens } from 'marked'
import type { UiLanguage } from '../shared/desktop'
import { t } from '../shared/i18n'
import type { SkillTestBatch, SkillTestCaseResult } from '../shared/skill-tests'

const escape = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
// Model prose is untrusted. Generate a fixed subset of Markdown markup and
// never emit its HTML, remote images, executable links or inline styles.
const markdown = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escape(text)
    },
    text(token: Tokens.Text | Tokens.Escape) {
      return 'tokens' in token && token.tokens
        ? this.parser.parseInline(token.tokens)
        : escape(token.text)
    },
    codespan({ text }: Tokens.Codespan) {
      return '<code>' + escape(text) + '</code>'
    },
    code({ text }: Tokens.Code) {
      return '<pre><code>' + escape(text) + '</code></pre>'
    },
    image({ text }: Tokens.Image) {
      return escape(text)
    },
    link({ href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens)
      let safe = false
      try {
        safe = /^https?:\/\//i.test(href) && ['https:', 'http:'].includes(new URL(href).protocol)
      } catch {}
      return safe
        ? '<a href="' +
            escape(href) +
            '" rel="noopener noreferrer" target="_blank">' +
            label +
            '</a>'
        : label
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return checked ? '☑ ' : '☐ '
    }
  }
})
const prose = (text: string): string => markdown.parse(text, { async: false })

export function skillTestReportHTML(batch: SkillTestBatch, language: UiLanguage): string {
  const tr = (source: string): string => t(source, language)
  const labels: Record<string, string> = {
    queued: 'В очереди',
    running: 'Выполняется',
    passed: 'Пройден',
    failed: 'Не пройден',
    error: 'Ошибка',
    cancelled: 'Отменён',
    interrupted: 'Прерван',
    review: 'Нужна проверка',
    done: 'Завершено',
    uncertain: 'Не удалось подтвердить'
  }
  const status = (value: string): string =>
    '<span class="badge ' +
    (Object.hasOwn(labels, value) ? value : 'review') +
    '">' +
    escape(tr(labels[value] ?? value)) +
    '</span>'
  const date = (value: string | undefined): string => {
    if (!value) return '—'
    const d = new Date(value)
    return escape(
      Number.isNaN(d.getTime())
        ? value
        : d.toLocaleString(language === 'en' ? 'en-US' : language === 'ru' ? 'ru-RU' : 'zh-CN')
    )
  }
  const duration = (c: SkillTestCaseResult): string =>
    c.durationMs === undefined ? '—' : (c.durationMs / 1000).toFixed(1) + ' s'
  const stat = (label: string, value: unknown): string =>
    '<div class="stat"><strong>' +
    escape(value) +
    '</strong><span>' +
    escape(tr(label)) +
    '</span></div>'
  const cases = batch.cases
    .map((c, index) => {
      const prefix = 'case-' + (index + 1),
        scenario = batch.suiteSnapshot?.cases.find((s) => s.id === c.id)
      const evidenceIds = new Map(
        (c.evidence ?? []).map((e, i) => [e.id, prefix + '-evidence-' + (i + 1)])
      )
      const evidenceLabel = (kind: string, id: string): string =>
        escape(tr(kind === 'tool' ? 'Результат инструмента' : 'Сообщение')) + ' · ' + escape(id)
      const assessments = (c.assessments ?? [])
        .map(
          (a) =>
            '<article class="assessment"><div>' +
            status(a.status) +
            '<strong>' +
            escape(a.criterion) +
            '</strong></div><p>' +
            escape(a.reason) +
            '</p><div class="citations">' +
            a.evidenceIds
              .map((id) => {
                const e = c.evidence?.find((e) => e.id === id),
                  target = evidenceIds.get(id)
                return target && e
                  ? '<a href="#' + target + '">' + evidenceLabel(e.kind, id) + '</a>'
                  : '<span>' + escape(id) + '</span>'
              })
              .join(' ') +
            '</div></article>'
        )
        .join('')
      const dialogue = (c.dialogue ?? [])
        .map(
          (m) =>
            '<article class="bubble ' +
            (m.role === 'user' ? 'user' : 'assistant') +
            '"><header>' +
            escape(
              tr(
                m.source === 'initial'
                  ? 'Начальная задача'
                  : m.source === 'actor'
                    ? 'ИИ-пользователь'
                    : m.role === 'assistant'
                      ? 'Проверяемый агент'
                      : 'Вы'
              )
            ) +
            '<time>' +
            date(m.at) +
            '</time></header><div class="prose">' +
            prose(m.text) +
            '</div></article>'
        )
        .join('')
      const checks = c.checks
        .map(
          (r) =>
            '<tr><td>' +
            status(r.passed ? 'passed' : 'failed') +
            '</td><td><code>' +
            escape(r.check.kind) +
            '</code><br>' +
            escape(r.check.path ?? '') +
            '</td><td>' +
            escape(r.detail) +
            '</td></tr>'
        )
        .join('')
      const budget = c.budget
        ? '<p class="muted">' +
          escape(tr('Шаги модели')) +
          ': ' +
          escape(c.budget.modelTurns) +
          '/' +
          escape(c.budget.maxModelTurns) +
          ' · ' +
          escape(tr('Вызовы инструментов')) +
          ': ' +
          escape(c.budget.toolCalls) +
          '/' +
          escape(c.budget.maxToolCalls) +
          '</p>'
        : ''
      return (
        '<section class="case" id="' +
        prefix +
        '"><div class="case-title"><h2>' +
        escape(c.name) +
        '</h2>' +
        status(c.status) +
        '</div><p class="muted">' +
        date(c.startedAt) +
        ' · ' +
        duration(c) +
        (c.tokens === undefined ? '' : ' · ' + escape(tr('Токены')) + ': ' + escape(c.tokens)) +
        '</p>' +
        budget +
        (c.error ? '<p class="error-box">' + escape(c.error) + '</p>' : '') +
        (c.stopReason ? '<p class="notice">' + escape(tr(c.stopReason)) + '</p>' : '') +
        (c.evidenceTruncated
          ? '<p class="notice">' +
            escape(
              tr(
                'Часть длинных событий сокращена. Неподтверждённые требования требуют ручной проверки.'
              )
            ) +
            '</p>'
          : '') +
        (scenario
          ? '<details><summary>' +
            escape(tr('Параметры сценария')) +
            '</summary><h3>' +
            escape(tr('Начальная задача')) +
            '</h3><div class="prose">' +
            prose(scenario.prompt) +
            '</div>' +
            (scenario.dialogue
              ? '<h3>' +
                escape(tr('Роль пользователя')) +
                '</h3><pre>' +
                escape(scenario.dialogue.persona) +
                '</pre><h3>' +
                escape(tr('Ожидаемое поведение и результат')) +
                '</h3><ul>' +
                scenario.dialogue.criteria.map((x) => '<li>' + escape(x) + '</li>').join('') +
                '</ul>'
              : '') +
            '</details>'
          : '') +
        (assessments
          ? '<h3>' + escape(tr('Оценка ИИ по требованиям')) + '</h3>' + assessments
          : '') +
        (checks
          ? '<h3>' +
            escape(tr('Проверки')) +
            '</h3><div class="table-scroll"><table><thead><tr><th>' +
            escape(tr('Статус')) +
            '</th><th>' +
            escape(tr('Проверка')) +
            '</th><th>' +
            escape(tr('Результат')) +
            '</th></tr></thead><tbody>' +
            checks +
            '</tbody></table></div>'
          : '') +
        (dialogue
          ? '<h3>' +
            escape(tr('Тестовый диалог')) +
            '</h3><div class="conversation">' +
            dialogue +
            '</div>'
          : c.answer
            ? '<h3>' +
              escape(tr('Ответ')) +
              '</h3><div class="prose answer">' +
              prose(c.answer) +
              '</div>'
            : '') +
        (c.artifacts.length
          ? '<details><summary>' +
            escape(tr('Файлы прогона')) +
            ' (' +
            c.artifacts.length +
            ')</summary><ul>' +
            c.artifacts.map((path) => '<li><code>' + escape(path) + '</code></li>').join('') +
            '</ul></details>'
          : '') +
        (c.trace.length
          ? '<details><summary>' +
            escape(tr('Ход работы')) +
            ' (' +
            c.trace.length +
            ')</summary>' +
            c.trace
              .map(
                (e) =>
                  '<article class="trace"><header>' +
                  date(e.at) +
                  ' · ' +
                  escape(e.type) +
                  (e.name ? ' · ' + escape(e.name) : '') +
                  '</header><pre>' +
                  escape(e.text) +
                  '</pre></article>'
              )
              .join('') +
            '</details>'
          : '') +
        ((c.evidence?.length ?? 0) > 0
          ? '<h3>' +
            escape(tr('Основания оценки: сообщения и результаты инструментов')) +
            '</h3><div class="evidence-list">' +
            c
              .evidence!.map(
                (e) =>
                  '<article class="evidence" id="' +
                  evidenceIds.get(e.id) +
                  '"><header>' +
                  evidenceLabel(e.kind, e.id) +
                  '</header><pre>' +
                  escape(e.text) +
                  '</pre><a href="#' +
                  prefix +
                  '">↑ ' +
                  escape(tr('К сценарию')) +
                  '</a></article>'
              )
              .join('') +
            '</div>'
          : '') +
        '</section>'
      )
    })
    .join('')
  const mode = batch.suiteSnapshot?.permissionMode
  const permissions =
    mode === 'yolo'
      ? 'YOLO'
      : mode === 'auto-edit'
        ? tr('Автоматически редактировать файлы')
        : mode === 'default'
          ? tr('Спрашивать разрешение')
          : '—'
  return (
    '<!doctype html><html lang="' +
    language +
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>' +
    escape(batch.name) +
    ' — Qwen Skills Lab</title><style>' +
    styles +
    '</style></head><body><main><header class="report-header"><span class="brand">Qwen Desktop · Skills Lab</span><h1>' +
    escape(batch.name) +
    '</h1><div>' +
    status(batch.status) +
    '</div><p>' +
    escape(batch.skillName) +
    ' · ' +
    escape(batch.modelLabel) +
    ' · ' +
    escape(permissions) +
    '</p><p class="muted">' +
    date(batch.createdAt) +
    ' → ' +
    date(batch.finishedAt) +
    '</p><p class="muted">' +
    escape(tr('Отчёт — снимок прогона на момент экспорта.')) +
    '</p><div class="stats">' +
    stat('Сценарии', batch.cases.length) +
    stat('Пройден', batch.cases.filter((c) => c.status === 'passed').length) +
    stat('Не пройден', batch.cases.filter((c) => c.status === 'failed').length) +
    stat('Нужна проверка', batch.cases.filter((c) => c.status === 'review').length) +
    stat('Ошибка', batch.cases.filter((c) => c.status === 'error').length) +
    '</div><details><summary>' +
    escape(tr('Сведения о прогоне')) +
    '</summary><dl><dt>ID</dt><dd><code>' +
    escape(batch.id) +
    '</code></dd><dt>' +
    escape(tr('Рабочая папка')) +
    '</dt><dd>' +
    escape(batch.sourceCwd ?? '—') +
    '</dd><dt>' +
    escape(tr('Версия скилла')) +
    '</dt><dd><code>' +
    escape(batch.skillRevision) +
    '</code></dd></dl></details></header><nav class="case-nav" aria-label="' +
    escape(tr('Сценарии')) +
    '">' +
    batch.cases
      .map(
        (c, i) =>
          '<a href="#case-' + (i + 1) + '">' + status(c.status) + ' ' + escape(c.name) + '</a>'
      )
      .join('') +
    '</nav>' +
    cases +
    '<footer>Qwen Desktop · Skills Lab</footer></main></body></html>'
  )
}

const styles = `
:root{color-scheme:light dark;--bg:#f4f4f8;--card:#fff;--text:#262435;--muted:#6e6a7c;--line:#dedce8;--accent:#7657c8;--bubble:#f0ebfc;--code:#eeedf3}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:20px}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1100px;margin:auto;padding:32px 20px}h1{font-size:26px;line-height:1.3;margin:10px 0}h2{font-size:20px;margin:0}h3{font-size:15px;margin:24px 0 10px}a{color:var(--accent);overflow-wrap:anywhere}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;margin:10px 0;padding:14px;background:var(--code);border-radius:8px}code{font-size:.93em;background:var(--code);padding:1px 4px;border-radius:4px}pre code{background:none;padding:0}.report-header,.case{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:20px;overflow-wrap:anywhere}.brand{font-size:12px;letter-spacing:.07em;color:var(--accent)}.muted,time,footer{color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin:22px 0}.stat{padding:12px;border:1px solid var(--line);border-radius:10px}.stat strong{display:block;font-size:24px}.stat span{font-size:12px;color:var(--muted)}.badge{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:2px 9px;font-size:12px;white-space:nowrap}.passed,.done{color:#24704c;background:#e9f5ed}.failed,.error{color:#a33143;background:#fcecef}.review,.uncertain{color:#89580a;background:#fff4da}.running{color:#5757a3;background:#ededfc}.case-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.case-nav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.case-nav a{display:flex;align-items:center;gap:7px;border:1px solid var(--line);padding:6px 10px;border-radius:8px;text-decoration:none}.conversation{display:flex;flex-direction:column;gap:12px}.bubble{border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-width:94%}.bubble.user{align-self:flex-end;background:var(--bubble)}.bubble.assistant{align-self:flex-start;background:var(--card)}.bubble header,.trace header,.evidence header{font-size:12px;color:var(--muted);margin-bottom:8px}.bubble time{margin-left:14px}.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}.prose h1,.prose h2,.prose h3,.prose h4,.prose h5,.prose h6{font-size:14px;line-height:1.65;margin:14px 0 6px}.prose img{display:none}.prose blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:15px}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}details{margin:14px 0;border:1px solid var(--line);border-radius:8px;padding:10px 14px}summary{cursor:pointer;font-weight:600}.assessment,.evidence{border:1px solid var(--line);padding:14px;border-radius:10px;margin:10px 0}.assessment strong{margin-left:10px}.citations{display:flex;gap:8px;flex-wrap:wrap}.citations a{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:3px 7px}.evidence:target{outline:3px solid var(--accent);outline-offset:3px}.error-box,.notice{border-left:3px solid #bc5665;padding:8px 12px;background:var(--code)}.notice{border-color:#b28a37}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}dd{margin:0}footer{text-align:center;padding:24px}
@media(prefers-color-scheme:dark){:root{--bg:#17161c;--card:#222128;--text:#ece9f5;--muted:#aba6bd;--line:#3b3747;--accent:#b99afa;--bubble:#332947;--code:#2c2934}.passed,.done{color:#a4dcbd;background:#20372c}.failed,.error{color:#f1a6b0;background:#40242b}.review,.uncertain{color:#e7c985;background:#3b3221}.running{color:#bebafa;background:#2e2c44}}
@media(max-width:640px){main{padding:14px 10px}.report-header,.case{padding:16px}.bubble{max-width:100%}.case-title{align-items:flex-start}h1{font-size:22px}dl{display:block}dd{margin-bottom:10px}}
@media print{:root{color-scheme:light;--bg:#fff;--card:#fff;--text:#222;--muted:#666;--line:#ccc;--accent:#60459b;--bubble:#f4f0fc;--code:#f3f3f3}main{max-width:none;padding:0}.case{break-before:page}.case-nav{display:none}.bubble,.assessment,.evidence{break-inside:avoid}a{color:inherit;text-decoration:underline}}
`
