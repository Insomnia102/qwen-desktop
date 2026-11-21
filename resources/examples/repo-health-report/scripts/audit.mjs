// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, writeFileSync, mkdirSync, opendirSync, lstatSync } from 'node:fs'
import { resolve, join, relative, isAbsolute, extname, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const [input = 'repo', output = 'output'] = process.argv.slice(2),
  root = resolve(input),
  destination = resolve(output),
  cwd = resolve('.')
if (destination !== cwd && !destination.startsWith(cwd + sep))
  throw Error('Output must remain inside the current workspace')
for (
  let current = destination;
  current !== dirname(current) && relative(cwd, current) !== '';
  current = dirname(current)
) {
  try {
    if (lstatSync(current).isSymbolicLink()) throw Error('Output symlinks are not allowed')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}
const report = {
  schemaVersion: 1,
  project: basename(root),
  status: 'passed',
  summary: { sourceFiles: 0, todoCount: 0, hasTestScript: false, ignoredEntries: 0 },
  issues: []
}
let phase = 'input'
try {
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
    throw Error('Input must be a regular directory')
  phase = 'manifest'
  const manifestFile = join(root, 'package.json')
  if (lstatSync(manifestFile).isSymbolicLink() || lstatSync(manifestFile).size > 512000)
    throw Error('Manifest is not a regular small file')
  const pkg = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg))
    throw Error('Manifest must be a JSON object')
  report.project = typeof pkg.name === 'string' ? pkg.name : report.project
  report.summary.hasTestScript =
    typeof pkg.scripts?.test === 'string' &&
    Boolean(pkg.scripts.test.trim()) &&
    !/no test specified/i.test(pkg.scripts.test)
  if (!report.summary.hasTestScript)
    report.issues.push({ code: 'NO_TEST_SCRIPT', message: 'No usable test script is declared' })
  phase = 'scan'
  const queue = [root]
  let entries = 0
  while (queue.length) {
    const directory = queue.shift(),
      dir = opendirSync(directory)
    try {
      for (let item = dir.readSync(); item; item = dir.readSync()) {
        if (++entries > 5000) throw Error('LIMIT_EXCEEDED')
        if (
          ['.git', 'node_modules', 'dist', '.cache', '.venv'].includes(item.name) ||
          item.isSymbolicLink()
        ) {
          report.summary.ignoredEntries++
          continue
        }
        const path = join(directory, item.name)
        if (item.isDirectory()) {
          queue.push(path)
          continue
        }
        if (
          item.isFile() &&
          ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extname(item.name).toLowerCase())
        ) {
          if (lstatSync(path).size > 512000) throw Error('LIMIT_EXCEEDED')
          report.summary.sourceFiles++
          report.summary.todoCount += (readFileSync(path, 'utf8').match(/\bTODO\b/gi) ?? []).length
        }
      }
    } finally {
      dir.closeSync()
    }
  }
  if (report.summary.todoCount)
    report.issues.push({
      code: 'TODO_FOUND',
      count: report.summary.todoCount,
      message: 'Source TODO markers require review'
    })
  if (report.issues.length) report.status = 'warning'
} catch (error) {
  report.status = 'error'
  report.issues = [
    {
      code:
        error.message === 'LIMIT_EXCEEDED'
          ? 'LIMIT_EXCEEDED'
          : phase === 'manifest'
            ? 'INVALID_MANIFEST'
            : 'INPUT_UNAVAILABLE',
      message: phase === 'manifest' ? 'package.json could not be parsed' : error.message
    }
  ]
}
mkdirSync(destination, { recursive: true })
writeFileSync(join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../assets/report-template.md'),
    'utf8'
  ),
  values = {
    project: report.project,
    status: report.status,
    ...report.summary,
    findings: report.issues.length
      ? report.issues.map((i) => '- ' + i.code + ': ' + i.message).join('\n')
      : 'No issues found.'
  }
writeFileSync(
  join(destination, 'report.md'),
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''))
)
console.log(JSON.stringify({ status: report.status, output: relative(cwd, destination) || '.' }))
