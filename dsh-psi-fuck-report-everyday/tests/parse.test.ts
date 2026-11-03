import { describe, expect, it } from 'vitest'
import {
  DAILY_LIMITS,
  GROUP_LIMITS,
  WEEKLY_LIMITS,
  parsePoints,
  parseSections,
  stripFence,
} from '../src/host/report/parse'

describe('stripFence', () => {
  it('removes ```json fences and surrounding whitespace', () => {
    expect(stripFence('\n```json\n{"done":[]}\n```\n')).toBe('{"done":[]}')
    expect(stripFence('```\n{"done":[]}\n```')).toBe('{"done":[]}')
    expect(stripFence('  {"done":[]}  ')).toBe('{"done":[]}')
  })
})

describe('parseSections', () => {
  it('parses fenced JSON and trims item whitespace', () => {
    const raw = '```json\n{"done":["  修复登录  "],"risks":[],"tomorrow":["  写测试"]}\n```'
    expect(parseSections(raw, 'daily', DAILY_LIMITS)).toEqual({
      done: ['修复登录'],
      risks: [],
      tomorrow: ['写测试'],
    })
  })

  it('drops empty items and clips each section to its limit', () => {
    const raw = JSON.stringify({ done: ['', '   ', 'a', 'b', 'c', 'd'], risks: ['  '], tomorrow: [] })
    const parsed = parseSections(raw, 'daily', DAILY_LIMITS)
    expect(parsed.done).toEqual(['a', 'b', 'c'])
    expect(parsed.risks).toEqual([])
  })

  it('truncates oversized items to 40 code points without splitting surrogate pairs', () => {
    const emoji = '😀'.repeat(80)
    const parsed = parseSections(JSON.stringify({ done: [emoji], risks: [], tomorrow: [] }), 'daily', DAILY_LIMITS)
    expect([...parsed.done[0]!]).toHaveLength(40)
    expect(parsed.done[0]).toBe('😀'.repeat(40))
  })

  it('rejects non-array or missing sections', () => {
    expect(() => parseSections('{"done":"nope","risks":[]}', 'daily', DAILY_LIMITS)).toThrow()
    expect(() => parseSections('{"risks":[]}', 'daily', DAILY_LIMITS)).toThrow()
    expect(() => parseSections('{"done":[],"risks":{}}', 'daily', DAILY_LIMITS)).toThrow()
    expect(() => parseSections('not json', 'daily', DAILY_LIMITS)).toThrow()
  })

  it('filters path-like and file-name items while keeping normal ones', () => {
    const raw = JSON.stringify({
      done: ['修复 /home/user/app/src/index.ts 的编译错误', '修复登录', '更新 notes.md', '打开 C:\\work\\app\\main.ts 调试'],
      risks: [],
      tomorrow: [],
    })
    expect(parseSections(raw, 'daily', DAILY_LIMITS).done).toEqual(['修复登录'])
  })

  it('maps weekly sections to next and treats a missing next as empty', () => {
    const parsed = parseSections('{"done":["本周完成"],"risks":["无"]}', 'weekly', WEEKLY_LIMITS)
    expect(parsed).toEqual({ done: ['本周完成'], risks: ['无'], next: [] })
  })

  it('clips weekly items to 50 code points and four entries', () => {
    const item = '周'.repeat(80)
    const raw = JSON.stringify({ done: [item, 'b', 'c', 'd', 'e'], risks: [], next: [] })
    const parsed = parseSections(raw, 'weekly', WEEKLY_LIMITS)
    expect(parsed.done).toHaveLength(4)
    expect([...parsed.done[0]!]).toHaveLength(50)
  })
})

describe('parsePoints', () => {
  it('parses group points from fenced JSON and caps at five', () => {
    const raw = '```json\n{"points":["产出 A","问题 B","下一步 C"]}\n```'
    expect(parsePoints(raw)).toEqual(['产出 A', '问题 B', '下一步 C'])

    const many = JSON.stringify({ points: ['1', '2', '3', '4', '5', '6'] })
    expect(parsePoints(many)).toHaveLength(GROUP_LIMITS.perSection)
  })

  it('rejects a non-array points field', () => {
    expect(() => parsePoints('{"points":"x"}')).toThrow()
    expect(() => parsePoints('{"points":[]}')).not.toThrow()
  })
})
