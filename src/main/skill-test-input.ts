// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@qwen-code/sdk'
/** A bounded, cancellable input stream: one CLI process owns the whole dialogue. */
export class SkillTestInput implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting: ((value: IteratorResult<SDKUserMessage>) => void) | undefined
  private ended = false
  constructor(private sessionId: string) {}
  send(text: string): void {
    if (this.ended) throw Error('Dialogue input is closed')
    const message: SDKUserMessage = {
      type: 'user',
      uuid: randomUUID(),
      session_id: this.sessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: text }
    }
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = undefined
      resolve({ done: false, value: message })
    } else {
      if (this.queue.length >= 2) throw Error('Dialogue input queue is full')
      this.queue.push(message)
    }
  }
  close(): void {
    this.ended = true
    this.queue = []
    this.waiting?.({ done: true, value: undefined })
    this.waiting = undefined
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.queue.shift()
        if (value) return Promise.resolve({ done: false, value })
        if (this.ended) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => {
          this.waiting = resolve
        })
      },
      return: async () => {
        this.close()
        return { done: true, value: undefined }
      }
    }
  }
}
