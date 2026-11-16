import {t} from '../../shared/i18n'
import type { QwenAPI } from '../../shared/qwen'
type Theme = 'dark' | 'light' | 'system'
const KEY = 'qwen-desktop-theme'
export function initTheme(api?: QwenAPI): () => void {
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  let theme: Theme = 'system'
  try { const stored = localStorage.getItem(KEY); if (stored === 'dark' || stored === 'light') theme = stored } catch { /* storage unavailable */ }
  const select = document.querySelector<HTMLSelectElement>('#theme-select')
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle')
  function apply(animate = false): void {
    const resolved = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme
    if (animate) { document.documentElement.classList.add('theme-transition'); setTimeout(() => document.documentElement.classList.remove('theme-transition'), 220) }
    document.documentElement.dataset.theme = resolved
    if (select) select.value = theme
    if (button) {
      button.setAttribute('aria-label', resolved === 'dark' ? t('Включить светлую тему') : t('Включить тёмную тему'))
      button.title = button.getAttribute('aria-label')!
      button.dataset.theme = resolved
    }
    void api?.setTheme(theme).catch(() => {})
  }
  const set = (value: Theme): void => { theme = value; try { localStorage.setItem(KEY, value) } catch { /* retain for this window */ } apply(true) }
  const change = (): void => { if (select) set(select.value as Theme) }
  const toggle = (): void => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  const osChange = (): void => { if (theme === 'system') apply() }
  select?.addEventListener('change', change); button?.addEventListener('click', toggle); system.addEventListener('change', osChange)
  apply()
  return () => { select?.removeEventListener('change', change); button?.removeEventListener('click', toggle); system.removeEventListener('change', osChange) }
}
