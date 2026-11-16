import {t} from '../../shared/i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Only assistant prose uses HTML. User messages, tool data and thinking remain
// plain text. No model-supplied styles, images, forms or embedded documents.
export function renderMarkdown(element: HTMLElement, source: string): void {
  const html = marked.parse(source, { async: false, gfm: true, breaks: false })
  element.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'blockquote',
      'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'hr', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'start', 'align'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_ATTR: ['style', 'id', 'name']
  })

  for (const node of Array.from(element.querySelectorAll('[class]'))) {
    const language = node.tagName === 'CODE' ? /(?:^|\s)language-([\w+-]+)/.exec(node.className) : null
    if (language) node.className = `language-${language[1]}`
    else node.removeAttribute('class')
  }

  for (const anchor of Array.from(element.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href') ?? ''
    let valid = false
    try { valid = /^https?:\/\//i.test(href) && ['https:', 'http:'].includes(new URL(href).protocol) } catch { /* Invalid link. */ }
    if (valid) {
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    } else {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.className = 'inactive-link'
      anchor.title = t('Открытие этого типа ссылки не подключено')
    }
  }
  for (const table of Array.from(element.querySelectorAll('table'))) {
    const wrapper = document.createElement('div')
    wrapper.className = 'table-scroll'
    table.before(wrapper)
    wrapper.append(table)
  }
  for (const pre of Array.from(element.querySelectorAll('pre'))) {
    const code = pre.querySelector('code')
    if (!code) continue
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block'
    const header = document.createElement('div')
    header.className = 'code-header'
    const language = document.createElement('span')
    const match = /(?:^|\s)language-([\w+-]+)/.exec(code.className)
    language.textContent = match?.[1] ?? t('Код')
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'copy-code'
    copy.textContent = t('Копировать')
    copy.setAttribute('aria-label', t('Копировать код'))
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '')
        copy.textContent = t('Скопировано')
      } catch { copy.textContent = t('Не удалось скопировать') }
      setTimeout(() => { if (copy.isConnected) copy.textContent = t('Копировать') }, 1800)
    })
    header.append(language, copy)
    pre.before(wrapper)
    wrapper.append(header, pre)
  }
}
