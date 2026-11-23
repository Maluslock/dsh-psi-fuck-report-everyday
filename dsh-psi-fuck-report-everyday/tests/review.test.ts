import { describe, expect, it } from 'vitest'
import { REVIEW_SYSTEM, reviewSections } from '../src/host/report/review'
import type { LlmLike, LlmStreamOptions } from '../src/host/report/llm'
import type { Sections } from '../src/host/types'

const model = { provider: 'deepseek', model: 'deepseek-v4' }

function fakeLlm(reply: string, calls: LlmStreamOptions[] = []): LlmLike {
  return {
    async *stream(options: LlmStreamOptions) {
      calls.push(options)
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

const sections: Sections = {
  done: ['修复登录接口', '今天天气不错，聊了会儿天'],
  risks: ['发版窗口只剩一天'],
  tomorrow: ['补回归测试'],
}

describe('reviewSections', () => {
  it('只保留审稿模型 keep 里的条目', async () => {
    const calls: LlmStreamOptions[] = []
    const result = await reviewSections(fakeLlm('{"keep":[0,2,3]}', calls), model, sections)
    expect(result.done).toEqual(['修复登录接口'])
    expect(result.risks).toEqual(['发版窗口只剩一天'])
    expect(result.tomorrow).toEqual(['补回归测试'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toContain('严格审稿人')
  })

  it('未出现在 keep 里的条目一律删除', async () => {
    const result = await reviewSections(fakeLlm('{"keep":[0]}'), model, sections)
    expect(result.done).toEqual(['修复登录接口'])
    expect(result.risks).toEqual([])
    expect(result.tomorrow).toEqual([])
  })

  it('审稿输出不是合法 JSON 时 fail-closed', async () => {
    await expect(reviewSections(fakeLlm('我觉得都挺好'), model, sections)).rejects.toMatchObject({
      code: 'E_REVIEW_FAILED',
    })
  })

  it('空报告不调用模型', async () => {
    const calls: LlmStreamOptions[] = []
    const empty = await reviewSections(fakeLlm('{"keep":[]}', calls), model, { done: [], risks: [] })
    expect(calls).toHaveLength(0)
    expect(empty).toEqual({ done: [], risks: [] })
  })
})
