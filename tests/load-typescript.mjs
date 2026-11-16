import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cache = new Map()
export function loadTypeScript(relative) {
  const path = resolve(root, relative)
  if (cache.has(path)) return cache.get(path).exports
  const module = { exports: {} }
  cache.set(path, module)
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const localRequire = name => name.startsWith('.') ? loadTypeScript(resolve(dirname(path), `${name}.ts`)) : require(name)
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, process,
    structuredClone, setTimeout, clearTimeout, console, URL, AbortController, Buffer })
  return module.exports
}
