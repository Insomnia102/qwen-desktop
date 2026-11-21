// SDK-shaped multi-turn fixture; the real streaming transport is covered separately.
export function streamingFixture(launch) {
  return (config) => {
    if (typeof config.prompt === 'string') return launch(config)
    const input = config.prompt,
      id = config.options.sessionId
    let closed = false,
      round = 0
    return {
      initialized: Promise.resolve(),
      getSessionId: () => id,
      close: async () => {
        closed = true
        input.close?.()
      },
      async *[Symbol.asyncIterator]() {
        for await (const item of input) {
          if (closed) return
          const c = {
            ...config,
            prompt: item.message.content,
            options: { ...config.options, ...(round++ ? { resume: id } : {}) }
          }
          const session = launch(c)
          await session.initialized
          for await (const message of session)
            yield message.type === 'result' ? { ...message, session_id: id } : message
        }
      }
    }
  }
}
