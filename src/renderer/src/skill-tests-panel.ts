// SPDX-License-Identifier: GPL-3.0-only
import { t, translateMessage } from '../../shared/i18n'
import type { QwenAPI, Reply } from '../../shared/qwen'
import type { SkillEntry, ModelProfile } from '../../shared/studio'
import type {
  SkillTestSuiteInput,
  SkillTestSuite,
  SkillTestsView,
  SkillTestBatch,
  SkillTestCase,
  TestCheck,
  TestCheckKind,
  CreatorRequest
} from '../../shared/skill-tests'
import { el, button, field, input, select, panel, confirmAction } from './panel-kit'
import { renderMarkdown } from './markdown'
import { getLanguage } from '../../shared/i18n'
import { dialogueFields, dialogueReport } from './skill-dialogue-ui'
const value = <T>(r: Reply<T>): T => {
  if (!r.ok) throw Error(r.error)
  return r.value
}
const checkNames: Record<TestCheckKind, string> = {
  'file-exists': 'Файл существует',
  'file-absent': 'Файл отсутствует',
  'file-contains': 'Файл содержит текст',
  'file-equals': 'Точное содержимое файла',
  'json-equals': 'Значение в JSON',
  'answer-contains': 'Ответ содержит текст',
  'tool-used': 'Инструмент выполнен',
  'skill-used': 'Skill был загружен',
  'skill-valid': 'Корректный SKILL.md',
  'test-suite-valid': 'Корректный набор сценариев'
}
const statusNames: Record<string, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  passed: 'Пройден',
  failed: 'Не пройден',
  error: 'Ошибка',
  cancelled: 'Отменён',
  interrupted: 'Прерван',
  done: 'Завершено',
  review: 'Нужна проверка'
}
const newCase = (): SkillTestCase => ({
  id: crypto.randomUUID(),
  name: t('Новый сценарий'),
  prompt: '',
  files: [],
  checks: [{ kind: 'file-exists', path: 'report.json' }]
})
export function openSkillTests(
  api: QwenAPI,
  hasProject: boolean,
  onClose: () => void,
  initialMode: 'tester' | 'creator' = 'tester'
): void {
  const p = panel(
    t('Skills Lab'),
    t('Создавайте skills, проверяйте рабочие сценарии и изучайте результаты каждого запуска.'),
    () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe?.()
      onClose()
    }
  )
  p.dialog.classList.add('skill-tests-dialog')
  const toolbar = el('div', 'mcp-toolbar'),
    add = button(t('+ Набор сценариев'), 'button button-primary'),
    importButton = button(t('Импорт JSON')),
    creator = button(t('Создать skill с ИИ')),
    planner = button(t('Составить сценарии с ИИ')),
    clearHistory = button(t('Очистить историю')),
    list = el('nav', 'studio-list'),
    detail = el('section', 'studio-detail'),
    save = button(t('Сохранить')),
    discard = button(t('Отменить изменения')),
    run = button(t('Запустить все'), 'button button-primary'),
    runOne = button(t('Запустить сценарий')),
    cancel = button(t('Остановить'), 'button button-danger')
  add.id = 'test-suite-add'
  importButton.id = 'test-suite-import'
  creator.id = 'test-creator'
  save.id = 'test-suite-save'
  run.id = 'test-run-all'
  runOne.id = 'test-run-one'
  cancel.id = 'test-run-cancel'
  planner.id = 'test-planner'
  clearHistory.id = 'test-history-clear'
  toolbar.append(add, planner, importButton, creator, clearHistory)
  p.header.append(toolbar)
  p.body.append(list, detail)
  p.footer.prepend(save, discard, runOne, run, cancel)
  discard.id = 'test-suite-discard'
  let view: SkillTestsView = { suites: [], runs: [], activeBatchId: null, permissions: [] },
    skills: SkillEntry[] = [],
    models: ModelProfile[] = [],
    draft: SkillTestSuiteInput | undefined,
    caseId = '',
    selectedRun = '',
    mode: 'suite' | 'run' | 'creator' | 'planner' = 'suite',
    disposed = false,
    dirty = false,
    generation = 0,
    form: HTMLFormElement | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    queue: Promise<unknown> = Promise.resolve(),
    unsubscribe: (() => void) | undefined,
    refreshing = false,
    again = false
  const replyDrafts = new Map<string, string>()
  let plannerDraft = {
    skill: '',
    goal: '',
    mode: 'ai' as 'manual' | 'ai',
    modelProfileId: null as string | null
  }
  const jsonInputs = new WeakMap<TestCheck, string>()
  let creatorDraft: CreatorRequest = {
    name: '',
    description: '',
    scope: hasProject ? 'project' : 'user',
    modelProfileId: null,
    timeoutSeconds: 300
  }
  function controls(): void {
    const active = Boolean(view.activeBatchId) || Boolean(view.planning)
    for (const b of [add, importButton, creator, planner, clearHistory]) {
      b.disabled = active
      b.dataset.unavailable = String(active)
    }
    clearHistory.disabled = active || !view.runs.length
    clearHistory.dataset.unavailable = String(clearHistory.disabled)
    save.hidden = discard.hidden = run.hidden = runOne.hidden = mode !== 'suite' || !draft
    save.disabled = discard.disabled = run.disabled = runOne.disabled = active
    cancel.hidden = !active
    cancel.disabled = !active
    detail.querySelectorAll<HTMLFieldSetElement>('[data-test-edit]').forEach((f) => {
      f.disabled = active
      f.dataset.readonly = String(active)
    })
  }
  // Keep selected values without custom DOM extensions.
  function modelsControl(selected: string | null): HTMLSelectElement {
    const s = select([
      ['', t('Модель по умолчанию')],
      ...models.map((m) => [m.id, m.label] as const)
    ])
    s.value = selected ?? ''
    return s
  }
  function nav(): void {
    list.replaceChildren(el('h3', 'test-list-heading', t('Наборы сценариев')))
    for (const suite of view.suites) {
      const b = button('', 'studio-list-item')
      b.dataset.suite = suite.id
      b.setAttribute('aria-current', String(mode === 'suite' && draft?.id === suite.id))
      b.append(
        el('strong', '', suite.name),
        el('small', '', `${suite.skillName} · ${suite.cases.length}`)
      )
      b.onclick = () => void chooseSuite(suite)
      list.append(b)
    }
    list.append(el('h3', 'test-list-heading', t('История запусков')))
    for (const batch of view.runs.slice(0, 50)) {
      const b = button('', 'studio-list-item')
      b.dataset.testRun = batch.id
      b.setAttribute('aria-current', String(mode === 'run' && selectedRun === batch.id))
      b.append(
        el('strong', '', batch.name),
        el(
          'small',
          '',
          `${t(statusNames[batch.status] ?? batch.status)} · ${batch.cases.filter((c) => c.status === 'passed').length}/${batch.cases.length}`
        )
      )
      b.onclick = () => void showRun(batch.id)
      list.append(b)
    }
  }
  function mark(): void {
    dirty = true
    generation++
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (form?.checkValidity())
        void flush().catch((error) =>
          p.status(error instanceof Error ? error.message : String(error), true)
        )
    }, 700)
    p.setDirty(true)
    p.status(t('Ожидание автосохранения…'))
  }
  function flush(): Promise<void> {
    clearTimeout(timer)
    const target = draft
    if (mode !== 'suite' || !target || !dirty) return Promise.resolve()
    const requested = generation
    const work = queue.then(async () => {
      if (disposed || draft !== target) return
      if (form && !form.checkValidity()) throw Error(t('Заполните запросы и проверки сценариев.'))
      const snapshot = structuredClone(target)
      const saved = value(await api.saveSkillTestSuite(snapshot))
      if (disposed || draft !== target) return
      target.id = saved.id
      target.revision = saved.revision
      if (generation === requested) {
        dirty = false
        p.setDirty(false)
        p.status(t('Все изменения сохранены'))
      }
      view.suites = view.suites.filter((s) => s.id !== saved.id).concat(saved)
      nav()
    })
    queue = work.catch(() => {})
    return work
  }
  async function leave(): Promise<boolean> {
    try {
      await flush()
      return !dirty
    } catch (error) {
      p.status(error instanceof Error ? error.message : String(error), true)
      return false
    }
  }
  p.setBeforeDismiss(leave)
  async function chooseSuite(suite: SkillTestSuite): Promise<void> {
    if (!(await leave())) return
    draft = structuredClone(suite)
    caseId = draft.cases[0].id
    mode = 'suite'
    selectedRun = ''
    dirty = false
    generation = 0
    renderSuite()
    nav()
  }
  function createSuite(): void {
    void leave().then((ok) => {
      if (!ok) return
      const skill = skills.find((s) => s.enabled)
      if (!skill) {
        p.status(t('Сначала создайте или импортируйте skill.'), true)
        return
      }
      draft = {
        id: null,
        revision: null,
        name: t('Новый набор'),
        scope: skill.scope,
        skillId: skill.id,
        modelProfileId: null,
        invocation: 'explicit',
        permissionMode: 'yolo',
        useMcp: false,
        timeoutSeconds: 180,
        maxTurns: 60,
        maxToolCalls: 150,
        cases: [newCase()]
      }
      caseId = draft.cases[0].id
      mode = 'suite'
      generation = 0
      dirty = true
      p.setDirty(true)
      renderSuite()
      nav()
    })
  }
  function renderSuite(): void {
    detail.replaceChildren()
    form = undefined
    if (!draft) {
      detail.append(
        el('h3', '', t('Проверка skills на реальных сценариях')),
        el(
          'p',
          'mcp-help',
          t(
            'Создайте набор сценариев или поручите это ИИ. Каждый прогон начнётся с новой сессии и отдельной рабочей папки.'
          )
        )
      )
      controls()
      return
    }
    const current = draft,
      main = el('form', 'mcp-form test-suite-form'),
      fields = el('fieldset', 'mcp-form-fields')
    fields.dataset.testEdit = 'true'
    main.append(fields)
    detail.append(main)
    form = main
    main.onsubmit = (e) => {
      e.preventDefault()
      void launch()
    }
    const row = el('div', 'test-config-grid'),
      name = input(current.name),
      skillSelect = select(
        skills.map(
          (s) =>
            [
              s.scope + ':' + s.id,
              `${s.scope === 'project' ? t('Проект') : t('Личный')}: ${s.name}${s.enabled ? '' : ' · ' + t('Выключен')}`
            ] as const
        )
      ),
      model = modelsControl(current.modelProfileId),
      invocation = select([
        ['explicit', t('Явный запуск skill')],
        ['auto', t('Проверка автовыбора')]
      ])
    name.id = 'test-suite-name'
    name.required = true
    name.maxLength = 160
    name.oninput = () => {
      current.name = name.value
      mark()
    }
    skillSelect.id = 'test-suite-skill'
    skillSelect.value = current.scope + ':' + current.skillId
    skillSelect.onchange = () => {
      const skill = skills.find((s) => s.scope + ':' + s.id === skillSelect.value)
      if (skill) {
        current.skillId = skill.id
        current.scope = skill.scope
        mark()
      }
    }
    model.id = 'test-suite-model'
    model.onchange = () => {
      current.modelProfileId = model.value || null
      mark()
    }
    invocation.value = current.invocation
    invocation.id = 'test-suite-invocation'
    invocation.onchange = () => {
      current.invocation = invocation.value as 'auto' | 'explicit'
      mark()
    }
    field(row, t('Название набора'), name)
    field(row, t('Skill'), skillSelect)
    field(row, t('Модель'), model)
    field(
      row,
      t('Способ запуска'),
      invocation,
      t(
        'Явный запуск проверяет выполнение. Автовыбор проверяет, догадается ли модель загрузить skill.'
      )
    )
    fields.append(row)
    const advanced = el('details', 'mcp-advanced'),
      settings = el('div', 'test-config-grid')
    advanced.append(el('summary', '', t('Ограничения и разрешения')), settings)
    const permission = select([
      ['default', t('Спрашивать разрешение')],
      ['auto-edit', t('Автоматически редактировать файлы')],
      ['yolo', t('YOLO — разрешить все инструменты')]
    ])
    permission.value = current.permissionMode
    permission.id = 'test-suite-permissions'
    permission.onchange = () => {
      current.permissionMode = permission.value as typeof current.permissionMode
      mark()
    }
    field(row, t('Режим разрешений'), permission)
    for (const [key, label, min, max] of [
      ['timeoutSeconds', 'Время на сценарий, секунд', 15, 7200],
      ['maxTurns', 'Лимит шагов модели', 1, 100],
      ['maxToolCalls', 'Лимит вызовов инструментов', 1, 200]
    ] as const) {
      const n = input(String(current[key]))
      n.type = 'number'
      n.min = String(min)
      n.max = String(max)
      n.required = true
      n.oninput = () => {
        current[key] = Number(n.value)
        mark()
      }
      field(settings, t(label), n)
    }
    const mcp = el('input', 'setting-switch')
    mcp.type = 'checkbox'
    mcp.checked = current.useMcp
    mcp.onchange = () => {
      current.useMcp = mcp.checked
      mark()
    }
    field(settings, t('Использовать разрешённые MCP-подключения'), mcp)
    fields.append(
      advanced,
      el(
        'p',
        'test-safety-note',
        t(
          'Запуски используют API модели и могут расходовать токены. Отдельная папка не является системной песочницей; разрешённые shell и MCP могут обращаться к внешним ресурсам.'
        )
      )
    )
    const cases = el('div', 'test-case-tabs')
    for (const scenario of current.cases) {
      const b = button(scenario.name, 'test-case-tab')
      b.dataset.testCase = scenario.id
      b.setAttribute('aria-selected', String(caseId === scenario.id))
      b.onclick = () => {
        caseId = scenario.id
        renderSuite()
      }
      cases.append(b)
    }
    const addCase = button(t('+ Сценарий'))
    addCase.id = 'test-case-add'
    addCase.disabled = current.cases.length >= 20
    addCase.onclick = () => {
      const next = newCase()
      current.cases.push(next)
      caseId = next.id
      mark()
      renderSuite()
    }
    cases.append(addCase)
    fields.append(cases)
    const scenario = current.cases.find((c) => c.id === caseId) ?? current.cases[0]
    caseId = scenario.id
    const caseName = input(scenario.name),
      prompt = el('textarea'),
      remove = button(t('Удалить сценарий'), 'button mcp-remove')
    caseName.id = 'test-case-name'
    caseName.required = true
    caseName.oninput = () => {
      scenario.name = caseName.value
      mark()
    }
    prompt.id = 'test-case-prompt'
    prompt.rows = 5
    prompt.required = true
    prompt.maxLength = 20000
    prompt.value = scenario.prompt
    prompt.oninput = () => {
      scenario.prompt = prompt.value
      mark()
    }
    field(fields, t('Название сценария'), caseName)
    field(fields, t('Запрос'), prompt)
    remove.disabled = current.cases.length === 1
    remove.onclick = () => {
      current.cases = current.cases.filter((c) => c !== scenario)
      caseId = current.cases[0].id
      mark()
      renderSuite()
    }
    fields.append(remove)
    dialogueFields(fields, scenario, mark, renderSuite)
    const fixtures = el('section', 'test-fixtures')
    fixtures.append(el('h4', '', t('Входные файлы')))
    for (const file of scenario.files) {
      const card = el('div', 'test-fixture'),
        path = input(file.path, 'input/data.json'),
        content = el('textarea'),
        drop = button(t('Убрать'))
      path.required = true
      path.setAttribute('aria-label', t('Путь входного файла'))
      path.oninput = () => {
        file.path = path.value
        mark()
      }
      content.value = file.text
      content.rows = 4
      content.setAttribute('aria-label', t('Содержимое входного файла'))
      content.oninput = () => {
        file.text = content.value
        mark()
      }
      drop.onclick = () => {
        scenario.files = scenario.files.filter((f) => f !== file)
        mark()
        renderSuite()
      }
      card.append(path, content, drop)
      fixtures.append(card)
    }
    const addFile = button(t('+ Входной файл'))
    addFile.id = 'test-fixture-add'
    addFile.onclick = () => {
      scenario.files.push({ path: '', text: '' })
      mark()
      renderSuite()
    }
    fixtures.append(addFile)
    if (!scenario.dialogue) fields.append(fixtures)
    const checks = el('section', 'test-checks')
    checks.append(el('h4', '', t('Критерии успеха')))
    for (const check of scenario.checks) {
      const card = el('div', 'test-check'),
        kind = select(Object.entries(checkNames).map(([k, v]) => [k, t(v)] as const)),
        drop = button('×')
      drop.setAttribute('aria-label', t('Удалить проверку'))
      kind.value = check.kind
      kind.onchange = () => {
        check.kind = kind.value as TestCheckKind
        check.value = check.kind === 'skill-used' ? true : check.kind === 'json-equals' ? null : ''
        jsonInputs.delete(check)
        mark()
        renderSuite()
      }
      card.append(kind)
      if (
        check.kind.startsWith('file-') ||
        check.kind === 'json-equals' ||
        check.kind === 'skill-valid' ||
        check.kind === 'test-suite-valid'
      ) {
        const path = input(check.path ?? '', 'output/report.json')
        path.required = true
        path.setAttribute('aria-label', t('Проверяемый файл'))
        path.oninput = () => {
          check.path = path.value
          mark()
        }
        card.append(path)
      }
      if (check.kind === 'json-equals') {
        const pointer = input(check.pointer ?? '', '/summary/status')
        pointer.setAttribute('aria-label', 'JSON Pointer')
        pointer.oninput = () => {
          check.pointer = pointer.value
          mark()
        }
        card.append(pointer)
      }
      if (
        ['file-contains', 'file-equals', 'answer-contains', 'tool-used', 'json-equals'].includes(
          check.kind
        )
      ) {
        const expected = el('textarea')
        expected.rows = 2
        expected.setAttribute('aria-label', t('Ожидаемое значение'))
        expected.value =
          check.kind === 'json-equals'
            ? (jsonInputs.get(check) ?? JSON.stringify(check.value ?? null))
            : String(check.value ?? '')
        expected.oninput = () => {
          if (check.kind === 'json-equals') {
            jsonInputs.set(check, expected.value)
            try {
              check.value = JSON.parse(expected.value)
              expected.setCustomValidity('')
            } catch {
              check.value = undefined
              expected.setCustomValidity(t('Введите корректный JSON'))
            }
          } else check.value = expected.value
          mark()
        }
        card.append(expected)
      }
      if (check.kind === 'skill-used') {
        const expected = select([
          ['true', t('Должен загрузиться')],
          ['false', t('Не должен загружаться')]
        ])
        expected.value = String(check.value ?? true)
        expected.onchange = () => {
          check.value = expected.value === 'true'
          mark()
        }
        card.append(expected)
      }
      drop.disabled = scenario.checks.length === 1 && !scenario.dialogue
      drop.onclick = () => {
        scenario.checks = scenario.checks.filter((c) => c !== check)
        mark()
        renderSuite()
      }
      card.append(drop)
      checks.append(card)
    }
    const addCheck = button(t('+ Проверка'))
    addCheck.id = 'test-check-add'
    addCheck.onclick = () => {
      scenario.checks.push({ kind: 'file-exists', path: '' })
      mark()
      renderSuite()
    }
    checks.append(addCheck)
    if (scenario.dialogue) {
      const extra = el('details', 'test-extra-checks')
      extra.append(
        el('summary', '', t('Дополнительно: входные файлы и точные проверки')),
        fixtures,
        checks
      )
      fields.append(extra)
    } else fields.append(checks)
    const actions = el('div', 'mcp-form-actions'),
      exportButton = button(t('Экспорт сценариев')),
      removeSuite = button(t('Удалить набор'), 'button mcp-remove')
    exportButton.disabled = !current.id
    exportButton.onclick = () =>
      void flush()
        .then(() => api.exportSkillTestSuite(current.id!))
        .then((r) => r && value(r))
        .catch((error) => p.status(error instanceof Error ? error.message : String(error), true))
    removeSuite.disabled = !current.id
    removeSuite.onclick = () =>
      confirmAction(
        t('Удалить набор сценариев?'),
        t('Сохранённые отчёты останутся в истории.'),
        async () => {
          value(await api.deleteSkillTestSuite(current.id!, current.revision!))
          dirty = false
          p.setDirty(false)
          draft = undefined
          await refresh()
          renderSuite()
        }
      )
    actions.append(exportButton, removeSuite)
    fields.append(actions)
    controls()
  }
  async function launch(only = false): Promise<void> {
    if (!draft || view.activeBatchId) return
    await p.perform(
      async () => {
        for (let i = 0; dirty && i < 5; i++) await flush()
        if (dirty) throw Error(t('Сначала завершите редактирование набора.'))
        return value(await api.runSkillTestSuite(draft!.id!, only ? [caseId] : undefined))
      },
      (batch) => {
        selectedRun = batch.id
        mode = 'run'
        renderRun(batch)
        void refresh()
      }
    )
  }
  function renderRun(batch: SkillTestBatch): void {
    const scroll = detail.scrollTop,
      focused = detail.querySelector<HTMLTextAreaElement>('textarea[data-dialogue-input]:focus'),
      focusId = focused?.id,
      selection = focused ? [focused.selectionStart, focused.selectionEnd] : undefined
    const open = new Set(
      Array.from(detail.querySelectorAll<HTMLDetailsElement>('details[open]')).map(
        (n) => n.dataset.key ?? ''
      )
    )
    detail.replaceChildren()
    form = undefined
    const heading = el('div', 'test-run-heading'),
      exportButton = button(t('HTML-отчёт')),
      remove = button(t('Удалить прогон'), 'button button-danger')
    remove.id = 'test-report-delete'
    remove.disabled = view.activeBatchId === batch.id
    remove.onclick = () =>
      confirmAction(
        t('Удалить этот прогон?'),
        t('Будут удалены отчёт и рабочие файлы этого прогона. Набор сценариев сохранится.'),
        async () => {
          value(await api.deleteSkillTestRun(batch.id))
          selectedRun = ''
          mode = 'suite'
          await refresh()
          renderSuite()
          nav()
        }
      )
    exportButton.id = 'test-report-export'
    exportButton.onclick = () =>
      void api
        .exportSkillTestRun(batch.id)
        .then(value)
        .catch((error) => p.status(String(error), true))
    heading.append(el('h3', '', batch.name), exportButton, remove)
    detail.append(
      heading,
      el(
        'p',
        'mcp-help',
        `${batch.modelLabel} · ${t(statusNames[batch.status] ?? batch.status)} · ${batch.cases.filter((c) => c.status === 'passed').length}/${batch.cases.length}`
      )
    )
    for (const permission of view.permissions.filter((p) => p.batchId === batch.id)) {
      const card = el('section', 'test-permission')
      card.dataset.permission = permission.id
      card.append(
        el('strong', '', t('Требуется разрешение') + ': ' + permission.tool),
        el('pre', '', permission.details)
      )
      for (const [decision, label] of [
        ['allow-once', 'Разрешить один раз'],
        ['allow-run', 'Разрешить всё в этом прогоне'],
        ['deny', 'Отклонить']
      ] as const) {
        const b = button(t(label))
        b.onclick = () =>
          void api
            .approveSkillTest(permission.id, decision)
            .then((r) => {
              value(r)
              return refresh()
            })
            .catch((error) => p.status(String(error), true))
        card.append(b)
      }
      detail.append(card)
    }
    if (
      batch.purpose === 'creator' &&
      batch.status === 'done' &&
      batch.cases.every((c) => c.status === 'passed')
    ) {
      const install = button(t('Установить созданный skill'), 'button button-primary')
      install.id = 'creator-install'
      install.onclick = () =>
        void p.perform(
          () => api.installCreatedSkill(batch.id),
          (r) => {
            const skill = value(r)
            p.status(t('Skill установлен. Откройте редактор skills для проверки файлов.'))
            install.disabled = true
            void loadSkills()
            const evalPath = batch.creatorName + '/evals/suite.json'
            const importGenerated = button(t('Добавить созданные сценарии'))
            importGenerated.onclick = () =>
              void p.perform(
                async () => {
                  const artifact = value(
                      await api.getSkillTestArtifact(batch.id, 'create', evalPath)
                    ),
                    data = JSON.parse(artifact.text)
                  return api.saveSkillTestSuite({
                    ...data,
                    id: null,
                    revision: null,
                    scope: skill.entry.scope,
                    skillId: skill.entry.id,
                    modelProfileId: null
                  })
                },
                (result) => {
                  const suite = value(result)
                  void refresh().then(() => chooseSuite(suite))
                }
              )
            detail.append(importGenerated)
          }
        )
      detail.append(install)
    }
    for (const c of batch.cases) {
      const section = el('details', 'test-case-result')
      section.dataset.key = c.id
      section.dataset.status = c.status
      section.open = open.has(c.id) || batch.cases.length === 1
      const summary = el('summary')
      summary.append(
        el('strong', '', c.name),
        el(
          'span',
          '',
          t(statusNames[c.status] ?? c.status) +
            (c.durationMs !== undefined ? ' · ' + (c.durationMs / 1000).toFixed(1) + ' s' : '')
        )
      )
      section.append(summary)
      if (c.error) section.append(el('p', 'chat-dialog-error', translateMessage(c.error)))
      for (const check of c.checks) {
        const row = el('div', 'test-check-result')
        row.dataset.passed = String(check.passed)
        row.append(
          el(
            'strong',
            '',
            (check.passed ? '✓ ' : '× ') +
              t(checkNames[check.check.kind]) +
              ': ' +
              (check.check.path ?? '')
          ),
          el('pre', '', check.detail)
        )
        section.append(row)
      }
      dialogueReport(section, c, view.inputs ?? [], api, replyDrafts, (text) =>
        p.status(text, true)
      )
      if (c.answer && !c.dialogue) {
        const answer = el('div', 'markdown-body test-answer')
        renderMarkdown(answer, c.answer)
        section.append(answer)
      }
      const trace = el('details', 'test-trace')
      trace.dataset.key = c.id + ':trace'
      trace.open = open.has(trace.dataset.key)
      trace.append(
        el('summary', '', t('Ход выполнения')),
        el('pre', '', c.trace.map((e) => `[${e.type}] ${e.name ?? ''}\n${e.text}`).join('\n\n'))
      )
      section.append(trace)
      const files = el('div', 'test-artifacts')
      for (const path of c.artifacts) {
        const b = button(path, 'test-artifact')
        b.onclick = () =>
          void api
            .getSkillTestArtifact(batch.id, c.id, path)
            .then((r) => {
              const file = value(r)
              const preview = el('dialog', 'test-artifact-dialog'),
                close = button(t('Закрыть'))
              close.onclick = () => {
                preview.close()
                preview.remove()
              }
              preview.addEventListener('cancel', () => preview.remove())
              preview.append(el('h3', '', path), el('pre', '', file.text), close)
              document.body.append(preview)
              preview.showModal()
            })
            .catch((error) =>
              p.status(error instanceof Error ? error.message : String(error), true)
            )
        files.append(b)
      }
      const reveal = button(t('Открыть рабочую папку'))
      reveal.onclick = () =>
        void api
          .revealSkillTestRun(batch.id, c.id)
          .then(value)
          .catch((error) => p.status(error instanceof Error ? error.message : String(error), true))
      files.append(reveal)
      section.append(files)
      detail.append(section)
    }
    for (const d of Array.from(detail.querySelectorAll<HTMLDetailsElement>('details[data-key]')))
      if (open.has(d.dataset.key!)) d.open = true
    detail.scrollTop = scroll
    if (focusId) {
      const n = document.getElementById(focusId) as HTMLTextAreaElement | null
      if (n) {
        n.focus({ preventScroll: true })
        if (selection) n.setSelectionRange(selection[0], selection[1])
      }
    }
    controls()
  }
  async function showRun(id: string): Promise<void> {
    if (!(await leave())) return
    selectedRun = id
    mode = 'run'
    try {
      renderRun(value(await api.getSkillTestRun(id)))
      nav()
    } catch (error) {
      p.status(String(error), true)
    }
  }
  function renderPlanner(): void {
    mode = 'planner'
    detail.replaceChildren()
    form = undefined
    const main = el('form', 'mcp-form'),
      fields = el('fieldset', 'mcp-form-fields')
    fields.dataset.testEdit = 'true'
    main.append(fields)
    detail.append(
      el('h3', '', t('Опишите, что проверить')),
      el(
        'p',
        'mcp-help',
        t(
          'ИИ изучит инструкции и часть ресурсов скилла, затем предложит сценарии. Перед запуском вы сможете изменить запросы, пользователя и требования.'
        )
      ),
      main
    )
    const skill = select(
        skills
          .filter((s) => s.enabled)
          .map((s) => [s.scope + ':' + s.id, `${s.scope}: ${s.name}`] as const)
      ),
      model = modelsControl(plannerDraft.modelProfileId),
      modeSelect = select([
        ['ai', t('Тестирует ИИ')],
        ['manual', t('Тестирую сам')]
      ]),
      goal = el('textarea'),
      generate = button(t('Подготовить сценарии'), 'button button-primary')
    skill.id = 'test-plan-skill'
    skill.value =
      plannerDraft.skill ||
      (draft ? draft.scope + ':' + draft.skillId : (skill.options[0]?.value ?? ''))
    plannerDraft.skill = skill.value
    skill.onchange = () => (plannerDraft.skill = skill.value)
    model.onchange = () => (plannerDraft.modelProfileId = model.value || null)
    modeSelect.value = plannerDraft.mode
    modeSelect.onchange = () => (plannerDraft.mode = modeSelect.value as 'manual' | 'ai')
    goal.id = 'test-plan-goal'
    goal.rows = 7
    goal.required = true
    goal.maxLength = 12000
    goal.value = plannerDraft.goal
    goal.oninput = () => (plannerDraft.goal = goal.value)
    field(fields, t('Skill'), skill)
    field(fields, t('Модель'), model)
    field(fields, t('Кто отвечает агенту'), modeSelect)
    field(fields, t('Что и в каких ситуациях проверить'), goal)
    fields.append(
      el(
        'p',
        'test-safety-note',
        t(
          'Планирование, ИИ-пользователь и оценка используют выбранную модель и расходуют токены. Служебные роли доступны только в Lab и не могут запускать инструменты.'
        )
      ),
      generate
    )
    generate.id = 'test-plan-generate'
    generate.type = 'submit'
    main.onsubmit = (e) => {
      e.preventDefault()
      if (!main.reportValidity()) return
      const selected = skills.find((s) => s.scope + ':' + s.id === skill.value)
      if (!selected) return
      p.status(t('ИИ составляет сценарии…'))
      void p.perform(
        () =>
          api.planSkillTests({
            scope: selected.scope,
            skillId: selected.id,
            modelProfileId: plannerDraft.modelProfileId,
            goal: plannerDraft.goal,
            mode: plannerDraft.mode,
            language: getLanguage()
          }),
        (r) => {
          draft = value(r)
          mode = 'suite'
          caseId = draft.cases[0].id
          dirty = true
          generation++
          p.setDirty(true)
          renderSuite()
          nav()
          p.status(t('Сценарии подготовлены. Проверьте их и запустите нужные.'))
        }
      )
    }
    controls()
    nav()
  }
  function renderCreator(): void {
    mode = 'creator'
    detail.replaceChildren()
    form = undefined
    const main = el('form', 'mcp-form'),
      fields = el('fieldset', 'mcp-form-fields')
    fields.dataset.testEdit = 'true'
    main.append(fields)
    detail.append(
      el('h3', '', t('Skill Creator от Anthropic')),
      el(
        'p',
        'mcp-help',
        t(
          'Комплектный skill-creator адаптирован для Qwen. Результат сначала появится в отдельной папке; установку вы подтверждаете после просмотра.'
        )
      ),
      main
    )
    const name = input(creatorDraft.name, 'repo-helper'),
      requirements = el('textarea'),
      model = modelsControl(creatorDraft.modelProfileId),
      scope = select([
        ['user', t('Для всех проектов')],
        ...(hasProject ? [['project', t('Для текущей папки')] as const] : [])
      ]),
      seconds = input(String(creatorDraft.timeoutSeconds))
    name.id = 'creator-name'
    name.required = true
    name.pattern = '[a-z0-9][a-z0-9-]{0,63}'
    name.oninput = () => (creatorDraft.name = name.value)
    requirements.id = 'creator-description'
    requirements.value = creatorDraft.description
    requirements.required = true
    requirements.rows = 8
    requirements.oninput = () => (creatorDraft.description = requirements.value)
    model.onchange = () => (creatorDraft.modelProfileId = model.value || null)
    scope.value = creatorDraft.scope
    scope.onchange = () => (creatorDraft.scope = scope.value as 'user' | 'project')
    seconds.type = 'number'
    seconds.min = '15'
    seconds.max = '900'
    seconds.oninput = () => (creatorDraft.timeoutSeconds = Number(seconds.value))
    field(fields, t('Имя нового skill'), name)
    field(fields, t('Задачи, входные данные и ожидаемый результат'), requirements)
    field(fields, t('Модель'), model)
    field(fields, t('Установить после проверки в'), scope)
    field(fields, t('Время на сценарий, секунд'), seconds)
    const create = button(t('Создать и подготовить сценарии'), 'button button-primary')
    create.id = 'creator-run'
    create.type = 'submit'
    fields.append(
      create,
      el(
        'p',
        'test-safety-note',
        t(
          'Создание использует API модели. Команды требуют подтверждения; глобальные skills автоматически не перезаписываются.'
        )
      )
    )
    main.onsubmit = (e) => {
      e.preventDefault()
      if (!main.reportValidity()) return
      void p.perform(
        () => api.runSkillCreator(creatorDraft),
        (r) => {
          const batch = value(r)
          selectedRun = batch.id
          mode = 'run'
          renderRun(batch)
          void refresh()
        }
      )
    }
    controls()
    nav()
  }
  async function loadSkills(): Promise<void> {
    const all = await Promise.all([
      api.getSkills('user'),
      ...(hasProject ? [api.getSkills('project')] : [])
    ])
    skills = all.flatMap((r) => value(r).entries)
  }
  async function refresh(): Promise<void> {
    if (disposed) return
    if (refreshing) {
      again = true
      return
    }
    refreshing = true
    try {
      view = value(await api.getSkillTests())
      if (disposed) return
      nav()
      controls()
      if (mode === 'run' && selectedRun && !view.runs.some((r) => r.id === selectedRun)) {
        selectedRun = ''
        mode = 'suite'
        renderSuite()
        nav()
      }
      if (mode === 'run' && selectedRun) renderRun(value(await api.getSkillTestRun(selectedRun)))
    } catch (error) {
      if (!disposed) p.status(error instanceof Error ? error.message : String(error), true)
    } finally {
      refreshing = false
      if (again) {
        again = false
        void refresh()
      }
    }
  }
  discard.onclick = () => {
    clearTimeout(timer)
    const id = draft?.id
    const saved = view.suites.find((s) => s.id === id)
    draft = saved ? structuredClone(saved) : undefined
    caseId = draft?.cases[0]?.id ?? ''
    dirty = false
    generation++
    p.setDirty(false)
    renderSuite()
    nav()
  }
  add.onclick = createSuite
  save.onclick = () =>
    void flush().catch((error) =>
      p.status(error instanceof Error ? error.message : String(error), true)
    )
  run.onclick = () => void launch()
  runOne.onclick = () => void launch(true)
  cancel.onclick = () =>
    void api
      .cancelSkillTests()
      .then(value)
      .catch((error) => p.status(String(error), true))
  creator.onclick = () =>
    void leave().then((ok) => {
      if (ok) renderCreator()
    })
  importButton.onclick = () =>
    void leave().then((ok) => {
      if (ok)
        void p.perform(
          () => api.importSkillTestSuite(),
          (r) => {
            const suite = value(r)
            if (suite) void refresh().then(() => chooseSuite(suite))
          }
        )
    })
  planner.onclick = () =>
    void leave().then((ok) => {
      if (ok) renderPlanner()
    })
  clearHistory.onclick = () =>
    void leave().then((ok) => {
      if (ok)
        confirmAction(
          t('Очистить историю прогонов?'),
          t(
            'Будут удалены все отчёты и рабочие папки прогонов. Скиллы и наборы сценариев сохранятся.'
          ),
          async () => {
            value(await api.clearSkillTestHistory())
            selectedRun = ''
            if (mode === 'run') mode = 'suite'
            await refresh()
            if (mode === 'suite') renderSuite()
            nav()
          },
          t('Очистить историю')
        )
    })
  controls()
  void p.perform(
    async () => {
      await loadSkills()
      models = value(await api.getStudio('user')).profiles
      view = value(await api.getSkillTests())
    },
    () => {
      nav()
      if (view.activeBatchId) {
        selectedRun = view.activeBatchId
        mode = 'run'
        void api
          .getSkillTestRun(selectedRun)
          .then((r) => {
            renderRun(value(r))
            nav()
          })
          .catch((error) => p.status(String(error), true))
      } else if (initialMode === 'creator') renderCreator()
      else renderSuite()
      unsubscribe = api.onSkillTestEvent(() => void refresh())
    }
  )
}
