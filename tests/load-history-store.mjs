// Run the real TypeScript store without changing the application's tsconfigs.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const source = await readFile(new URL('../src/main/history-store.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, require, process,
  structuredClone, setTimeout, clearTimeout, console })
export const HistoryStore = module.exports.HistoryStore
