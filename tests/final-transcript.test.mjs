import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
const module = { exports: {} }
const source = await readFile(new URL('../src/main/transcript.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports })
const { Transcript } = module.exports
const assistant = (uuid, content) => ({ type: 'assistant', uuid, message: { id: uuid, content } })
const result = extra => ({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], ...extra })

test('result identifies the existing final bubble without deleting progress or thinking events', () => {
  const events = [], t = new Transcript('r', event => events.push(event))
  t.accept(assistant('progress', [{ type: 'text', text: 'Checking files' }, { type: 'thinking', thinking: 'Reasoning' },
    { type: 'tool_use', id: 'call', name: 'read_file', input: {} }]))
  assert.equal(events.some(x => x.type === 'final'), false)
  t.accept(assistant('answer', [{ type: 'text', text: 'Final answer' }]))
  const id = events.findLast(x => x.type === 'text').messageId
  t.accept(result({ result: 'Final answer' }))
  assert.equal(events.filter(x => x.type === 'final').length, 1)
  assert.equal(events.find(x => x.type === 'final').messageId, id)
  assert.ok(events.some(x => x.type === 'text' && x.text === 'Checking files'))
  assert.ok(events.some(x => x.type === 'thinking' && x.text === 'Reasoning'))
})

test('no final is invented after an error or after progress followed only by a tool', () => {
  for (const ending of [result({}), result({ is_error: true, subtype: 'error_during_execution', error: { message: 'Failed' } })]) {
    const events = [], t = new Transcript('r', event => events.push(event))
    t.accept(assistant('progress', [{ type: 'text', text: 'I will check this' }, { type: 'tool_use', id: 'call', name: 'read_file', input: {} }]))
    t.accept(ending)
    assert.equal(events.some(x => x.type === 'final'), false)
  }
})

test('a result-only answer gets a final marker, and successful final prose works without result text', () => {
  for (const direct of [true, false]) {
    const events = [], t = new Transcript('r', event => events.push(event))
    if (!direct) t.accept(assistant('answer', [{ type: 'text', text: 'Answer' }]))
    t.accept(result(direct ? { result: 'Answer' } : {}))
    assert.equal(events.find(x => x.type === 'final').text, 'Answer')
  }
})
