import { PluginError } from '../errors.js'
import type { ModelRef } from '../types.js'

/** 一次模型调用所需的最小请求形状；真实 ctx.llm 结构上兼容。 */
export interface LlmStreamOptions {
  provider: string
  model: string
  system?: string
  messages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }> }>
  maxTokens?: number
  signal?: AbortSignal
}

export interface LlmLike {
  stream(options: LlmStreamOptions): AsyncIterable<unknown>
}

export interface CallModelInput {
  system: string
  user: string
  model: ModelRef
  maxTokens?: number
  signal?: AbortSignal
  timeoutMs?: number
}

interface ChunkLike {
  type?: string
  text?: string
  reason?: {
    kind?: string
    message?: string
    failure?: { message?: string; code?: string }
  }
}

const DEFAULT_TIMEOUT_MS = 30_000

function finishFailure(reason: ChunkLike['reason']): string | undefined {
  if (!reason || typeof reason !== 'object') return undefined
  if (reason.kind !== 'error' && reason.kind !== 'aborted') return undefined
  return reason.failure?.message ?? reason.message ?? reason.failure?.code ?? reason.kind
}

/**
 * 以非流式语义调用一次模型：收集 text-delta，遇到 finish error/aborted 抛
 * E_LLM_UNAVAILABLE；默认 30s 超时；空文本抛 E_LLM_BAD_OUTPUT。
 */
export async function callModel(llm: LlmLike, input: CallModelInput): Promise<string> {
  if (input.signal?.aborted) {
    throw new PluginError('E_LLM_UNAVAILABLE', '模型调用已取消', input.signal.reason)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('E_LLM_TIMEOUT')), input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = (): void => controller.abort(input.signal?.reason)

  let text = ''
  let failure: string | undefined
  try {
    input.signal?.addEventListener('abort', onAbort, { once: true })
    for await (const chunk of llm.stream({
      provider: input.model.provider,
      model: input.model.model,
      system: input.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: input.user }] }],
      maxTokens: input.maxTokens,
      signal: controller.signal,
    })) {
      if (!chunk || typeof chunk !== 'object') continue
      const item = chunk as ChunkLike
      if (item.type === 'text-delta' && typeof item.text === 'string') text += item.text
      if (item.type === 'finish') failure = finishFailure(item.reason) ?? failure
    }
  } catch (error) {
    throw new PluginError('E_LLM_UNAVAILABLE', '模型调用失败或超时', String(error))
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }

  if (failure) throw new PluginError('E_LLM_UNAVAILABLE', '模型返回错误', failure)
  if (!text.trim()) throw new PluginError('E_LLM_BAD_OUTPUT', '模型返回空内容')
  return text
}
