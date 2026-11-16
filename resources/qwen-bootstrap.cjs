'use strict'

// SDK 0.1.32 spawns process.execPath (electron.exe in this application).
// Run inside that child only: the Electron main process is never modified.
const { existsSync } = require('node:fs')
const { isAbsolute } = require('node:path')
const { pathToFileURL } = require('node:url')

console.error('[qwen-bootstrap] start', JSON.stringify({
  pid: process.pid,
  node: process.versions.node,
  electron: process.versions.electron ?? null,
  noRelaunch: process.env.QWEN_CODE_NO_RELAUNCH ?? null
}))
process.on('exit', code => console.error('[qwen-bootstrap] exit', code))
process.on('uncaughtExceptionMonitor', error => console.error('[qwen-bootstrap] uncaught', error?.stack ?? String(error)))

async function main() {
  const entry = process.env.QWEN_DESKTOP_CLI_ENTRY
  if (!entry || !isAbsolute(entry) || !existsSync(entry)) {
    throw new Error('QWEN_DESKTOP_CLI_ENTRY must point to the existing bundled cli.js')
  }
  delete process.env.QWEN_DESKTOP_CLI_ENTRY

  // cli.js checks argv[1] to decide whether it is the main entry point.
  process.argv[1] = process.platform === 'win32' ? entry.replace(/\\/g, '/') : entry

  // yargs hideBin otherwise treats Electron-as-Node like a packaged GUI app
  // and retains cli.js as a positional prompt instead of slicing it off.
  if (process.versions.electron && !process.defaultApp) {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'defaultApp')
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(process, 'defaultApp', { value: true, writable: true, configurable: true })
    } else if (descriptor.writable) {
      process.defaultApp = true
    }
    // For a locked property, the forward-slash path above also satisfies
    // the bundled CLI's own entry-path guard on Windows.
  }

  console.error('[qwen-bootstrap] importing-cli', entry)
  await import(pathToFileURL(entry).href)
  console.error('[qwen-bootstrap] import-complete')
}

main().catch(error => {
  console.error('[qwen-bootstrap]', error?.stack ?? String(error))
  process.exitCode = 1
})
