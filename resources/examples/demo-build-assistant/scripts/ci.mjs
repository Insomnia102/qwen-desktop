// SPDX-License-Identifier: GPL-3.0-only
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  appendFileSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const root = join(process.cwd(), '.demo-ci'),
  repository = JSON.parse(
    readFileSync(new URL('../assets/repository.json', import.meta.url), 'utf8')
  )
function regular(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw Error('Simulation state cannot use symlinks')
}
regular(root)
mkdirSync(root, { recursive: true })
const jobs = join(root, 'jobs')
regular(jobs)
mkdirSync(jobs, { recursive: true })
const args = process.argv.slice(2),
  command = args.shift(),
  get = (flag) => {
    const i = args.indexOf('--' + flag)
    return i < 0 ? undefined : args[i + 1]
  }
const emit = (value) => console.log(JSON.stringify(value))
const event = (value) => {
  const file = join(root, 'events.jsonl')
  regular(file)
  appendFileSync(file, JSON.stringify(value) + '\n')
}
function job() {
  const id = get('id')
  if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw Error('Valid job ID required')
  const file = join(jobs, id + '.json')
  regular(file)
  return JSON.parse(readFileSync(file, 'utf8'))
}
try {
  if (command === 'catalog') {
    const checkout = join(root, 'repository')
    regular(checkout)
    mkdirSync(checkout, { recursive: true })
    const file = join(checkout, 'repository.json')
    regular(file)
    writeFileSync(file, JSON.stringify(repository, null, 2))
    emit({ phase: 'repository-ready', ...repository })
  } else if (command === 'profiles') {
    const service = get('service')
    if (!Object.hasOwn(repository.services, service ?? ''))
      throw Error('Unknown service. Choose api, web or worker')
    emit({ service, profiles: repository.services[service] })
  } else if (command === 'start') {
    const service = get('service'),
      profile = get('profile')
    if (
      !Object.hasOwn(repository.services, service ?? '') ||
      !Object.hasOwn(repository.services[service], profile ?? '')
    )
      throw Error('Choose a valid service and its dependent profile before launch')
    let control = {}
    if (existsSync('demo-control.json')) {
      regular('demo-control.json')
      if (lstatSync('demo-control.json').size > 4096) throw Error('Control file too large')
      control = JSON.parse(readFileSync('demo-control.json', 'utf8'))
    }
    const delay = control.delayMs ?? 1500
    if (!Number.isInteger(delay) || delay < 0 || delay > 600000)
      throw Error('delayMs must be 0–600000')
    const record = {
      id: randomUUID(),
      service,
      profile,
      outcome: control.outcome === 'failure' ? 'FAILURE' : 'SUCCESS',
      readyAt: Date.now() + delay
    }
    writeFileSync(join(jobs, record.id + '.json'), JSON.stringify(record), { flag: 'wx' })
    event({ phase: 'started', id: record.id, service, profile })
    emit({ id: record.id, service, profile, status: 'RUNNING' })
  } else if (command === 'status') {
    const record = job(),
      wait = Number(get('wait-ms') ?? 0)
    if (!Number.isInteger(wait) || wait < 0 || wait > 1000) throw Error('wait-ms must be 0–1000')
    if (Date.now() < record.readyAt && wait)
      await new Promise((r) => setTimeout(r, Math.min(wait, record.readyAt - Date.now())))
    const status = Date.now() < record.readyAt ? 'RUNNING' : record.outcome
    event({ phase: 'status', id: record.id, status })
    emit({ id: record.id, service: record.service, profile: record.profile, status })
  } else if (command === 'log') {
    const record = job()
    if (Date.now() < record.readyAt) throw Error('Job is still running')
    const text =
      record.outcome === 'FAILURE'
        ? 'Integration check failed: required configuration key DEMO_ENDPOINT is missing. Add the missing key to the test configuration and rerun.'
        : 'Compilation and selected checks completed successfully.'
    event({ phase: 'analysis', id: record.id })
    emit({ id: record.id, status: record.outcome, log: text })
  } else throw Error('Use catalog, profiles, start, status or log')
} catch (error) {
  console.error(JSON.stringify({ error: error.message }))
  process.exitCode = 1
}
