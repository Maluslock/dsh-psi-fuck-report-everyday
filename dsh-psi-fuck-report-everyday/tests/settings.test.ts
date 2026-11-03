import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  dateExclusion,
  mergeSettings,
  pruneExcludedByDate,
  validateSettings,
} from '../src/host/settings'

describe('settings model', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      reminderTime: '17:30',
      weeklyDay: 5,
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      outputDir: '~/笔记/工作日志',
      writeMarkdown: true,
      weeklyCommit: true,
      excludedProjects: [],
      excludedSessions: [],
      excludedByDate: {},
      cleanupEnabled: false,
    })
  })

  it('falls back to defaults for missing or non-object input', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  it('deep merges model and excludedByDate', () => {
    expect(mergeSettings({ model: { provider: 'custom' } }).model).toEqual({
      provider: 'custom',
      model: 'deepseek-flash',
    })
    const merged = mergeSettings({
      model: { provider: 'custom', model: 'custom-model' },
      excludedByDate: {
        '2026-11-03': { projects: ['p1', 2, 'p2'], sessions: ['s1', false] },
        '2026-1-1': { projects: ['bad-key'], sessions: [] },
        '2026-13-01': { projects: ['bad-month'], sessions: [] },
        '2026-11-04': 'not-an-object',
      },
    })
    expect(merged.model).toEqual({ provider: 'custom', model: 'custom-model' })
    expect(merged.excludedByDate).toEqual({
      '2026-11-03': { projects: ['p1', 'p2'], sessions: ['s1'] },
    })
  })

  it('falls back on invalid reminderTime and weeklyDay', () => {
    expect(mergeSettings({ reminderTime: '25:00' }).reminderTime).toBe('17:30')
    expect(mergeSettings({ reminderTime: '9:5' }).reminderTime).toBe('17:30')
    expect(mergeSettings({ reminderTime: '08:05' }).reminderTime).toBe('08:05')

    expect(mergeSettings({ weeklyDay: 1 }).weeklyDay).toBe(1)
    expect(mergeSettings({ weeklyDay: 7 }).weeklyDay).toBe(7)
    expect(mergeSettings({ weeklyDay: 0 }).weeklyDay).toBe(5)
    expect(mergeSettings({ weeklyDay: 8 }).weeklyDay).toBe(5)
    expect(mergeSettings({ weeklyDay: 3.5 }).weeklyDay).toBe(5)
    expect(mergeSettings({ weeklyDay: '5' }).weeklyDay).toBe(5)
  })

  it('falls back on invalid outputDir, dataDir and booleans', () => {
    expect(mergeSettings({ outputDir: '   ' }).outputDir).toBe('~/笔记/工作日志')
    expect(mergeSettings({ outputDir: ' /tmp/out ' }).outputDir).toBe('/tmp/out')
    expect(mergeSettings({ dataDir: '' }).dataDir).toBeUndefined()
    expect(mergeSettings({ dataDir: '/tmp/eod' }).dataDir).toBe('/tmp/eod')
    expect(mergeSettings({ writeMarkdown: 'yes' }).writeMarkdown).toBe(true)
    expect(mergeSettings({ weeklyCommit: 0 }).weeklyCommit).toBe(true)
    expect(mergeSettings({ cleanupEnabled: true }).cleanupEnabled).toBe(true)
  })

  it('forces version 1 and filters excluded arrays', () => {
    const merged = mergeSettings({
      version: 9,
      excludedProjects: ['a', 1, 'b'],
      excludedSessions: ['s', null],
    })
    expect(merged.version).toBe(1)
    expect(merged.excludedProjects).toEqual(['a', 'b'])
    expect(merged.excludedSessions).toEqual(['s'])
    expect(mergeSettings({ excludedProjects: 'a' }).excludedProjects).toEqual([])
  })

  it('validates all documented fields', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([])
    const invalid = {
      ...DEFAULT_SETTINGS,
      reminderTime: '24:00',
      weeklyDay: 8,
      model: { provider: '', model: '' },
      outputDir: '',
      excludedProjects: ['ok', 1] as unknown as string[],
    }
    expect(validateSettings(invalid)).toEqual(['reminderTime', 'weeklyDay', 'model', 'outputDir', 'excluded'])
    expect(validateSettings({
      ...DEFAULT_SETTINGS,
      excludedByDate: { '2026-1-1': { projects: [], sessions: [] } },
    })).toContain('excluded')
  })

  it('prunes exclusions older than seven days', () => {
    const now = new Date(2026, 10, 3, 12, 0)
    const settings = mergeSettings({
      excludedByDate: {
        '2026-11-03': { projects: ['today'], sessions: [] },
        '2026-10-28': { projects: ['week-ago'], sessions: [] },
        '2026-10-27': { projects: ['seven-days-ago'], sessions: [] },
        '2026-10-26': { projects: ['eight-days-ago'], sessions: [] },
      },
    })
    const pruned = pruneExcludedByDate(settings, now)
    expect(Object.keys(pruned.excludedByDate).sort()).toEqual(['2026-10-27', '2026-10-28', '2026-11-03'])
    expect(settings.excludedByDate['2026-10-26']).toBeDefined()
  })

  it('reads per-date exclusions with empty fallbacks', () => {
    const settings = mergeSettings({
      excludedByDate: { '2026-11-03': { projects: ['p'], sessions: ['s'] } },
    })
    expect(dateExclusion(settings, '2026-11-03')).toEqual({ projects: ['p'], sessions: ['s'] })
    expect(dateExclusion(settings, '2026-11-04')).toEqual({ projects: [], sessions: [] })
    const day = dateExclusion(settings, '2026-11-03')
    day.projects.push('mutated')
    expect(dateExclusion(settings, '2026-11-03').projects).toEqual(['p'])
  })
})
