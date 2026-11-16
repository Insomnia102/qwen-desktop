import {localizeShell} from './interface-language'
import {openOnboarding,rememberLanguage} from './onboarding'
import {localizedApi} from './interface-language'
import {t,msg} from '../../shared/i18n'
// Styles are linked directly from HTML and do not depend on this module graph.
// If a dependency or renderer fails to load, keep the styled shell and show
// the actual error instead of leaving an unexplained white page.
async function boot():Promise<void>{
 const app=document.querySelector<HTMLElement>('.app-container');if(app)app.inert=true
 const status=document.getElementById('agent-status');if(status)status.textContent=t('Checking Qwen CLI…')
 const bridge=window.api
 if(bridge&&typeof bridge.getConnectionState==='function'){
  const api=localizedApi(bridge),reply=await api.getConnectionState();if(!reply.ok)throw new Error(reply.error)
  rememberLanguage(reply.value.preferences.language)
  if(!reply.value.preferences.onboardingCompleted||!reply.value.configurationFound||!reply.value.runtimeReady)await openOnboarding(api,reply.value)
 }
 localizeShell()
 await import('./renderer')
 if(app)app.inert=false
}
void boot().catch((error: unknown) => {
  console.error('[renderer bootstrap]', error)
  const status = document.getElementById('agent-status')
  if (status) status.textContent = t('Ошибка загрузки интерфейса')
  const dot = document.getElementById('status-dot')
  if (dot) dot.dataset.state = 'error'
  const message = document.createElement('article')
  message.className = 'message system error'
  const content = document.createElement('div')
  content.className = 'message-content'
  const detail = error instanceof Error ? error.message : String(error)
  content.textContent = msg`Не удалось загрузить интерфейс: ${detail}\nПроверьте установку marked и dompurify и ошибки в Console (F12).`
  message.append(content)
  const messages = document.getElementById('messages')
  if (messages) {
    messages.append(message)
    const empty = document.getElementById('empty-state')
    if (empty) empty.hidden = true
  } else document.body.append(message)
})
