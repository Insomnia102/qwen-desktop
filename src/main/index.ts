import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { restoreCommandPath } from './platform-env'
import { attachQwenWindow, registerQwenIPC, stopQwen } from './qwen'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 580,
    title: 'Qwen Desktop',
    backgroundColor: '#1c1c20',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  attachQwenWindow(window)
  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(() => {
  restoreCommandPath()
  electronApp.setAppUserModelId('com.qwen.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  app.dock?.setIcon(icon)
  registerQwenIPC()
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) { if (window.isMinimized()) window.restore(); window.focus() }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('before-quit', stopQwen)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
