import { describe, expect, it } from 'vitest'
import {
  buildDigestBundle,
  buildSessionDigest,
  formatSpan,
  truncate,
} from '../src/host/digest'
import type { CollectedSession } from '../src/host/types'

const at = (hours: number, minutes: number): number => new Date(2026, 10, 3, hours, minutes, 0, 0).getTime()

function session(overrides: Partial<CollectedSession> = {}): CollectedSession {
  return {
    sessionId: 's1',
    cwd: '/home/user/proj-alpha',
    title: '登录修复',
    firstTime: at(9, 0),
    lastTime: at(10, 30),
    userTexts: ['修复登录失败'],
    assistantTexts: ['已定位并修复'],
    toolCounts: { edit: 9, bash: 2, read: 1 },
    todos: [
      { content: '补充回归用例', status: 'pending' },
      { content: '同步发布说明', status: 'in_progress' },
      { content: '已完成的项', status: 'completed' },
    ],
    messages: 24,
    ...overrides,
  }
}

describe('truncate', () => {
  it('truncates by code point, not UTF-16 unit', () => {
    expect(truncate('一二三四五', 3)).toBe('一二三')
    expect(truncate('😀😀😀', 2)).toBe('😀😀')
  })

  it('keeps text at or under the limit', () => {
    expect(truncate('一二三', 5)).toBe('一二三')
    expect(truncate('一二三', 3)).toBe('一二三')
    expect(truncate('abc', 0)).toBe('')
    expect(truncate('', 10)).toBe('')
  })
})

describe('formatSpan', () => {
  it('formats a local HH:mm–HH:mm span with zero padding', () => {
    expect(formatSpan(at(9, 0), at(10, 30))).toBe('09:00–10:30')
    expect(formatSpan(at(0, 5), at(23, 59))).toBe('00:05–23:59')
    expect(formatSpan(at(13, 7), at(13, 7))).toBe('13:07–13:07')
  })
})

describe('buildSessionDigest', () => {
  it('keeps project, title, span, requests, conclusions, tools and open todos', () => {
    const digest = buildSessionDigest(session())
    expect(digest.sessionId).toBe('s1')
    expect(digest.project).toBe('proj-alpha')
    expect(digest.messages).toBe(24)
    expect(digest.text.split('\n')).toEqual([
      '[proj-alpha] 登录修复（09:00–10:30）',
      '用户诉求：修复登录失败',
      '助手结论：已定位并修复',
      '工具：edit×9, bash×2, read×1',
      '未完成：补充回归用例；同步发布说明',
    ])
  })

  it('omits empty sections and skips completed todos', () => {
    const bare = buildSessionDigest(
      session({ userTexts: [], assistantTexts: [], toolCounts: {}, todos: [{ content: '收尾', status: 'completed' }] }),
    )
    expect(bare.text).toBe('[proj-alpha] 登录修复（09:00–10:30）')

    const noTitle = buildSessionDigest(session({ title: '   ' }))
    expect(noTitle.text.startsWith('[proj-alpha] 未命名会话（')).toBe(true)
  })

  it('drops empty request/conclusion strings instead of joining blanks', () => {
    const digest = buildSessionDigest(session({ userTexts: ['', '   ', '真正诉求'], assistantTexts: [''] }))
    expect(digest.text).toContain('用户诉求：真正诉求')
    expect(digest.text).not.toContain('助手结论')
    expect(digest.text).not.toContain('；；')
  })

  it('derives the project name from POSIX and Windows cwd values', () => {
    expect(buildSessionDigest(session({ cwd: '/home/user/proj-beta/' })).project).toBe('proj-beta')
    expect(buildSessionDigest(session({ cwd: 'C:\\work\\proj-gamma\\' })).project).toBe('proj-gamma')
    expect(buildSessionDigest(session({ cwd: '' })).project).toBe('')
  })

  it('lists at most eight tools ordered by count then name', () => {
    const toolCounts: Record<string, number> = {}
    for (let i = 0; i < 10; i += 1) toolCounts[`tool${i}`] = i + 1
    const digest = buildSessionDigest(session({ toolCounts }))
    expect(digest.text).toContain('tool9×10')
    expect(digest.text).toContain('tool2×3')
    expect(digest.text).not.toContain('tool1×2')
    expect(digest.text).toContain('工具：')
    expect(digest.text.split('工具：')[1]?.split('×').length).toBe(9)
  })

  it('caps every digest at 800 code points', () => {
    const huge = buildSessionDigest(
      session({
        userTexts: Array.from({ length: 10 }, () => '一'.repeat(200)),
        assistantTexts: Array.from({ length: 10 }, () => '二'.repeat(300)),
        todos: Array.from({ length: 8 }, () => ({ content: '三'.repeat(60), status: 'pending' })),
      }),
    )
    expect([...huge.text].length).toBe(800)
  })
})

describe('buildDigestBundle', () => {
  it('returns digests with total code-point length and no two-stage under limits', () => {
    const bundle = buildDigestBundle([session({ sessionId: 'a' }), session({ sessionId: 'b' })])
    expect(bundle.digests.map((d) => d.sessionId)).toEqual(['a', 'b'])
    expect(bundle.totalChars).toBe(bundle.digests.reduce((sum, d) => sum + [...d.text].length, 0))
    expect(bundle.needsTwoStage).toBe(false)
  })

  it('triggers two-stage when session count exceeds 32', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => session({ sessionId: `s${i}` }))
    expect(buildDigestBundle(many(32)).needsTwoStage).toBe(false)
    expect(buildDigestBundle(many(33)).needsTwoStage).toBe(true)
  })

  it('triggers two-stage when total length exceeds 16000 code points', () => {
    const longSessions = (count: number) =>
      Array.from({ length: count }, (_, i) => session({ sessionId: `l${i}`, assistantTexts: ['二'.repeat(800)] }))
    const bundle = buildDigestBundle(longSessions(21))
    expect(bundle.digests.every((d) => [...d.text].length === 800)).toBe(true)
    expect(bundle.totalChars).toBeGreaterThan(16000)
    expect(bundle.needsTwoStage).toBe(true)
  })

  it('honours a custom total limit and an empty session list', () => {
    expect(buildDigestBundle([session()], 10).needsTwoStage).toBe(true)
    expect(buildDigestBundle([session()], 1000).needsTwoStage).toBe(false)
    expect(buildDigestBundle([])).toEqual({ digests: [], totalChars: 0, needsTwoStage: false })
  })
})
