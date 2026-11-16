import type { SDKMessage } from '@qwen-code/sdk'
import type { QwenEvent } from '../shared/qwen'

type Frame = {
  id: string
  sourceId: string
  blocks: Map<number, string>
  thoughts: Map<number, string>
  text: string
  thinking: string
}

// The UI uses local IDs. Providers can change their message ID between
// stream_event and the complete assistant envelope; that is still one message.
export class Transcript {
  private sequence = 0
  private current: Frame | undefined
  private pending: Frame[] = []
  private lastVisible: Frame | undefined
  private textSinceTool = false
  private seenAssistant = new Set<string>()
  private tools = new Map<string, { name: string; input: unknown }>()

  constructor(
    private requestId: string,
    private emit: (event: QwenEvent) => void
  ) {}

  accept(message: SDKMessage): void {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return
    if (message.type === 'stream_event') {
      const event = message.event
      if (event.type === 'message_start') {
        this.current = this.frame(event.message.id)
        this.pending.push(this.current)
      } else if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        const frame = this.streamingFrame()
        frame.blocks.set(event.index, event.content_block.text)
        this.publishBlocks(frame)
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const frame = this.streamingFrame()
        frame.blocks.set(event.index, (frame.blocks.get(event.index) ?? '') + event.delta.text)
        this.publishBlocks(frame)
      } else if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
        const frame = this.streamingFrame()
        frame.thoughts.set(event.index, event.content_block.thinking)
        this.publishThoughts(frame, 'streaming')
      } else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        const frame = this.streamingFrame()
        frame.thoughts.set(event.index, (frame.thoughts.get(event.index) ?? '') + event.delta.thinking)
        this.publishThoughts(frame, 'streaming')
      } else if (event.type === 'content_block_stop' && this.current?.thoughts.has(event.index)) {
        this.publishThoughts(this.current, 'done')
      } else if (event.type === 'message_stop' && this.current) {
        this.publishThoughts(this.current, 'done')
      }
      // Keep the frame after message_stop until its assistant envelope arrives.
    } else if (message.type === 'assistant') {
      if (message.uuid && this.seenAssistant.has(message.uuid)) return
      if (message.uuid) this.seenAssistant.add(message.uuid)
      const text = message.message.content.filter(block => block.type === 'text')
        .map(block => block.text).join('\n')
      const thinking = message.message.content.filter(block => block.type === 'thinking')
        .map(block => block.thinking).join('\n')
      const pending = this.matchPending(message.message.id, text, thinking)
      const frame = pending ?? this.frame(message.message.id)
      if (pending) this.complete(pending)
      if (thinking.trim()) this.publishThinking(frame, thinking, 'done')
      else if (frame.thinking.trim()) this.publishThinking(frame, frame.thinking, 'done')
      if (text.trim()) this.publish(frame, text)
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          this.textSinceTool = false
          this.tools.set(block.id, { name: block.name, input: block.input })
          this.emit({ requestId: this.requestId, type: 'tool', toolId: block.id,
            name: block.name, state: 'running', input: block.input })
        }
      }
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_result') {
          const tool = this.tools.get(block.tool_use_id)
          this.emit({ requestId: this.requestId, type: 'tool', toolId: block.tool_use_id,
            name: tool?.name ?? 'Инструмент', input: tool?.input,
            state: block.is_error ? 'error' : 'done', output: this.toolOutput(block.content) })
        }
      }
    } else if (message.type === 'result') {
      if (!message.is_error && message.result?.trim() &&
          this.lastVisible?.text.trim() !== message.result.trim()) {
        const frame = this.matchPending('', message.result)
        if (frame) this.complete(frame)
        this.publish(frame ?? this.frame('result'), message.result)
      }
      // Only a successful SDK result confirms the final answer. Progress
      // prose before a trailing tool call is never promoted to a final reply.
      if (!message.is_error && this.lastVisible && (message.result?.trim() || this.textSinceTool)) {
        this.emit({ requestId: this.requestId, type: 'final',
          messageId: this.lastVisible.id, text: this.lastVisible.text })
      }
      if (message.permission_denials?.length) {
        const names = [...new Set(message.permission_denials.map(item => item.tool_name))]
        this.emit({ requestId: this.requestId, type: 'warning',
          text: `Отклонены операции: ${names.join(', ')}. Проверьте подтверждения и настройки разрешений Qwen.` })
      }
      if (message.is_error) {
        this.emit({ requestId: this.requestId, type: 'error',
          text: message.error?.message ?? `Ошибка Qwen: ${message.subtype}` })
      }
    }
  }

  private frame(sourceId: string): Frame {
    return { id: `assistant-${++this.sequence}`, sourceId, blocks: new Map(), thoughts: new Map(), text: '', thinking: '' }
  }

  private streamingFrame(): Frame {
    if (!this.current) {
      this.current = this.frame('')
      this.pending.push(this.current)
    }
    return this.current
  }

  private matchPending(sourceId: string, text: string, thinking = ''): Frame | undefined {
    const exact = sourceId ? this.pending.find(frame => frame.sourceId === sourceId) : undefined
    if (exact) return exact
    const normalized = text.trim()
    const sameText = normalized ? this.pending.find(frame => frame.text.trim() &&
      (normalized.startsWith(frame.text.trim()) || frame.text.trim().startsWith(normalized))) : undefined
    // Root assistant envelopes are sequential; fall back to their pending
    // stream when the provider rewrites IDs or final text during completion.
    const normalizedThought = thinking.trim()
    const sameThinking = normalizedThought ? this.pending.find(frame => frame.thinking.trim() &&
      (normalizedThought.startsWith(frame.thinking.trim()) || frame.thinking.trim().startsWith(normalizedThought))) : undefined
    return sameText ?? sameThinking ?? this.pending.at(-1)
  }

  private complete(frame: Frame): void {
    this.pending = this.pending.filter(item => item !== frame)
    if (this.current === frame) this.current = undefined
  }

  private publishBlocks(frame: Frame): void {
    const text = [...frame.blocks.entries()].sort(([a], [b]) => a - b)
      .map(([, value]) => value).join('\n')
    frame.text = text
    if (text.trim()) this.publish(frame, text)
  }

  private publish(frame: Frame, text: string): void {
    this.textSinceTool = true
    frame.text = text
    this.lastVisible = frame
    this.emit({ requestId: this.requestId, type: 'text', messageId: frame.id, text })
  }

  private publishThoughts(frame: Frame, state: 'streaming' | 'done'): void {
    const thinking = [...frame.thoughts.entries()].sort(([a], [b]) => a - b)
      .map(([, value]) => value).join('\n')
    if (thinking.trim()) this.publishThinking(frame, thinking, state)
  }

  private publishThinking(frame: Frame, text: string, state: 'streaming' | 'done'): void {
    frame.thinking = text
    this.emit({ requestId: this.requestId, type: 'thinking', messageId: frame.id, text, state })
  }

  private toolOutput(content: unknown): string | undefined {
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter(item => item && item.type === 'text' && typeof item.text === 'string')
        .map(item => item.text).join('\n') : ''
    if (!text) return undefined
    return text.length <= 16_000 ? text : `${text.slice(0, 8_000)}\n\n… Вывод сокращён …\n\n${text.slice(-8_000)}`
  }
}
