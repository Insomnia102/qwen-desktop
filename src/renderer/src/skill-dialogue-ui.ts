// SPDX-License-Identifier: GPL-3.0-only
import { t, translateMessage } from '../../shared/i18n'
import type {
  SkillTestCase,
  SkillTestCaseResult,
  TestDialogueInput
} from '../../shared/skill-tests'
import type { QwenAPI } from '../../shared/qwen'
import { el, button, field, select, input } from './panel-kit'
import { renderMarkdown } from './markdown'
export const dialoguePhase = (phase: string | undefined): string =>
  phase === 'waiting-user'
    ? t('Ожидает вашего ответа')
    : phase === 'actor'
      ? t('ИИ-пользователь готовит ответ')
      : phase === 'evaluating'
        ? t('Проверяющий оценивает результат')
        : t('Агент выполняет задачу')
export function dialogueFields(
  parent: HTMLElement,
  scenario: SkillTestCase,
  mark: () => void,
  rerender: () => void
): void {
  const mode = select([
    ['single', t('Один запрос')],
    ['manual', t('Тестирую сам')],
    ['ai', t('Тестирует ИИ')]
  ])
  mode.id = 'test-dialogue-mode'
  mode.value = scenario.dialogue?.mode ?? 'single'
  mode.onchange = () => {
    if (mode.value === 'single') {
      scenario.dialogue = undefined
      if (!scenario.checks.length) scenario.checks = [{ kind: 'answer-contains', value: '' }]
    } else {
      scenario.dialogue = {
        mode: mode.value as 'manual' | 'ai',
        persona: scenario.dialogue?.persona ?? '',
        criteria: scenario.dialogue?.criteria ?? [],
        maxMessages: scenario.dialogue?.maxMessages ?? 32,
        replyTimeoutSeconds: scenario.dialogue?.replyTimeoutSeconds ?? 1800
      }
      if (
        scenario.checks.length === 1 &&
        scenario.checks[0].kind === 'file-exists' &&
        scenario.checks[0].path === 'report.json'
      )
        scenario.checks = []
    }
    mark()
    rerender()
  }
  field(parent, t('Управление тестовым диалогом'), mode)
  if (!scenario.dialogue) return
  const d = scenario.dialogue,
    box = el('section', 'test-dialogue-config'),
    persona = el('textarea'),
    criteria = el('textarea'),
    limits = el('div', 'test-config-grid'),
    messages = input(String(d.maxMessages)),
    wait = input(String(d.replyTimeoutSeconds))
  persona.id = 'test-persona'
  persona.value = d.persona
  persona.rows = 4
  persona.maxLength = 12000
  persona.oninput = () => {
    d.persona = persona.value
    mark()
  }
  criteria.id = 'test-criteria'
  criteria.value = d.criteria.join('\n')
  criteria.rows = 5
  criteria.required = true
  criteria.oninput = () => {
    d.criteria = criteria.value
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
    mark()
  }
  field(
    box,
    t('Роль и поведение тестового пользователя'),
    persona,
    t(
      'Что пользователь знает, чего хочет и как выбирает варианты. ИИ отвечает по фактическому диалогу, а не по фиксированному списку.'
    )
  )
  field(
    box,
    t('Ожидаемое поведение и результат'),
    criteria,
    t(
      'Одно требование на строку. Например: агент собирает параметры перед запуском; итог подтверждён результатом инструмента.'
    )
  )
  messages.type = wait.type = 'number'
  messages.min = '1'
  messages.max = '40'
  messages.required = true
  wait.min = '30'
  wait.max = '7200'
  wait.required = true
  messages.oninput = () => {
    d.maxMessages = Number(messages.value)
    mark()
  }
  wait.oninput = () => {
    d.replyTimeoutSeconds = Number(wait.value)
    mark()
  }
  field(limits, t('Максимум ответов агента'), messages)
  field(limits, t('Ожидание ручного ответа, секунд'), wait)
  box.append(
    limits,
    el(
      'p',
      'mcp-help',
      t(
        'Режим разрешений задаётся для набора. В YOLO shell и подключённые MCP выполняются без подтверждений.'
      )
    )
  )
  parent.append(box)
}
export function dialogueReport(
  parent: HTMLElement,
  result: SkillTestCaseResult,
  inputs: TestDialogueInput[],
  api: QwenAPI,
  drafts: Map<string, string>,
  error: (text: string) => void
): void {
  if (result.budget)
    parent.append(
      el(
        'p',
        'mcp-help',
        t('Шаги модели') +
          ': ' +
          result.budget.modelTurns +
          '/' +
          result.budget.maxModelTurns +
          ' · ' +
          t('Вызовы инструментов') +
          ': ' +
          result.budget.toolCalls +
          '/' +
          result.budget.maxToolCalls
      )
    )
  if (!result.dialogue) return
  const conversation = el('div', 'test-conversation')
  conversation.setAttribute('aria-label', t('Тестовый диалог'))
  for (const m of result.dialogue) {
    const bubble = el('article', 'test-dialogue-message')
    bubble.dataset.role = m.role
    const label =
      m.role === 'assistant'
        ? t('Проверяемый агент')
        : m.source === 'actor'
          ? t('ИИ-пользователь')
          : m.source === 'initial'
            ? t('Начальная задача')
            : t('Вы')
    const content = el('div', 'markdown-body')
    renderMarkdown(content, m.text)
    bubble.append(el('small', '', label), content)
    conversation.append(bubble)
  }
  parent.append(conversation)
  if (result.status === 'running') parent.append(el('p', 'test-phase', dialoguePhase(result.phase)))
  for (const pending of inputs.filter((v) => v.caseId === result.id)) {
    const form = el('form', 'test-live-reply'),
      text = el('textarea'),
      send = button(t('Ответить'), 'button button-primary'),
      finish = button(t('Завершить и оценить'))
    text.id = 'lab-reply-' + pending.id
    text.dataset.dialogueInput = pending.id
    text.value = drafts.get(pending.id) ?? ''
    text.rows = 3
    text.maxLength = 8000
    text.placeholder = t('Ответьте на вопрос агента…')
    text.setAttribute('aria-label', t('Ответ тестового пользователя'))
    text.oninput = () => drafts.set(pending.id, text.value)
    send.type = 'submit'
    finish.id = 'test-dialogue-finish'
    send.id = 'test-dialogue-reply'
    const submit = async (value: string | null): Promise<void> => {
      if (send.disabled) return
      send.disabled = finish.disabled = true
      try {
        const r = await api.replySkillTest(pending.id, value)
        if (!r.ok) throw Error(r.error)
        drafts.delete(pending.id)
      } catch (e) {
        send.disabled = finish.disabled = false
        error(e instanceof Error ? e.message : String(e))
      }
    }
    form.onsubmit = (e) => {
      e.preventDefault()
      if (text.value.trim()) void submit(text.value)
    }
    text.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (text.value.trim()) void submit(text.value)
      }
    }
    finish.onclick = () => void submit(null)
    form.append(
      el('strong', '', t('Ваш ответ')),
      el('p', 'mcp-help', pending.reason),
      text,
      send,
      finish
    )
    parent.append(form)
  }
  if (result.stopReason) parent.append(el('p', 'mcp-help', translateMessage(result.stopReason)))
  if (result.assessments?.length) {
    parent.append(el('h4', 'test-assessment-title', t('Оценка ИИ по требованиям')))
    for (const a of result.assessments) {
      const row = el('section', 'test-assessment')
      row.dataset.verdict = a.status
      row.append(
        el('strong', '', a.criterion),
        el(
          'span',
          'test-verdict',
          a.status === 'passed'
            ? t('Подтверждено')
            : a.status === 'failed'
              ? t('Не выполнено')
              : t('Не удалось подтвердить')
        ),
        el('p', '', a.reason)
      )
      for (const id of a.evidenceIds) {
        const b = button(id, 'test-evidence-link')
        b.onclick = () => {
          const target = parent.querySelector<HTMLElement>('[data-evidence="' + id + '"]')
          if (target) {
            const details = target.closest('details')
            if (details) details.open = true
            target.scrollIntoView?.({ block: 'nearest' })
          }
        }
        row.append(b)
      }
      parent.append(row)
    }
  }
  if (result.evidence?.length) {
    const evidence = el('details', 'test-evidence')
    evidence.dataset.key = result.id + ':evidence'
    evidence.append(el('summary', '', t('Основания оценки: сообщения и результаты инструментов')))
    if (result.evidenceTruncated)
      evidence.append(
        el(
          'p',
          'mcp-help',
          t('Часть длинных событий сокращена. Неподтверждённые требования требуют ручной проверки.')
        )
      )
    for (const e of result.evidence) {
      const item = el('div')
      item.dataset.evidence = e.id
      item.append(el('strong', '', e.id + ' · ' + e.kind), el('pre', '', e.text))
      evidence.append(item)
    }
    parent.append(evidence)
  }
}
