import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPluginError, type PluginError } from '../src/host/errors'
import { copyText, dailyMarkdown, weeklyMarkdown } from '../src/host/markdown'
import { DEFAULT_SETTINGS } from '../src/host/settings'
import { KeyedLock, ReportStore, SettingsStore, atomicWrite, expandHome } from '../src/host/store'
import type { DailyReport, Sections, WeeklyReport } from '../src/host/types'

const created: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `eod-${prefix}-`))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function sections(overrides: Partial<Sections> = {}): Sections {
  return { done: ['修复登录'], risks: ['无'], tomorrow: ['写测试'], ...overrides }
}

function daily(date = '2026-11-03', values: Sections = sections()): DailyReport {
  return {
    version: 1,
    date,
    generatedAt: '2026-11-03T17:31:02+08:00',
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    sources: [{ sessionId: 's1', cwd: '/home/user/x', title: 'x', messages: 4 }],
    coverage: { sessions: 1, messages: 4, truncated: false, groups: 1 },
    sections: values,
    editedAt: null,
    history: [],
  }
}

function weekly(values: Sections = { done: ['本周完成项'], risks: ['无'], next: ['下周计划项'] }): WeeklyReport {
  return {
    version: 1,
    week: '2026-W45',
    generatedAt: '2026-11-06T17:32:10+08:00',
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    days: ['2026-11-02', '2026-11-03'],
    missingDays: ['2026-11-04'],
    sections: values,
    editedAt: null,
    history: [],
  }
}

async function makeStore(options: { writeMarkdown?: boolean } = {}) {
  const dataDir = await tempDir('data')
  const outputDir = await tempDir('out')
  const store = new ReportStore({
    dataDir,
    outputDir,
    writeMarkdown: options.writeMarkdown ?? true,
    weeklyCommit: true,
  })
  return { store, dataDir, outputDir }
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('ReportStore', () => {
  it('writes and reads a daily report plus matching markdown', async () => {
    const { store, dataDir, outputDir } = await makeStore()
    const report = daily()

    const written = await store.writeDaily(report)

    expect(written.json).toBe(join(dataDir, 'daily', '2026-11-03.json'))
    expect(written.markdown).toBe(join(outputDir, '2026-11-03.md'))
    expect(existsSync(written.json)).toBe(true)
    expect(await store.readDaily('2026-11-03')).toEqual(report)
    expect(await store.readDaily('2026-11-04')).toBeNull()

    const markdown = await readFile(join(outputDir, '2026-11-03.md'), 'utf8')
    expect(markdown).toContain('# 2026-11-03 日报')
    expect(markdown).toContain('## 今日完成')
    expect(markdown).toContain('- 修复登录')
    expect(markdown).toContain('## 问题与风险')
    expect(markdown).toContain('- 无')
    expect(markdown).toContain('## 明日计划')
    expect(markdown).toContain('- 写测试')

    expect(await readdir(dirname(written.json))).toEqual(['2026-11-03.json'])
    expect((await readdir(outputDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('stores the previous version in history when replacing', async () => {
    const { store } = await makeStore()
    const first = daily()
    await store.writeDaily(first)

    const second = daily('2026-11-03', { done: ['新的完成项'], risks: ['无'], tomorrow: [] })
    await store.writeDaily(second, { replace: true })

    const stored = await store.readDaily('2026-11-03')
    expect(stored).not.toBeNull()
    expect(stored!.sections).toEqual(second.sections)
    expect(stored!.history).toHaveLength(1)
    expect(stored!.history[0]).toEqual(first.sections)
  })

  it('caps report history at five versions', async () => {
    const { store } = await makeStore()
    await store.writeDaily(daily('2026-11-03', { done: ['v0'], risks: [] }))
    for (let i = 1; i <= 6; i += 1) {
      await store.writeDaily(daily('2026-11-03', { done: [`v${i}`], risks: [] }), { replace: true })
    }

    const stored = await store.readDaily('2026-11-03')
    expect(stored).not.toBeNull()
    expect(stored!.sections.done).toEqual(['v6'])
    expect(stored!.history).toHaveLength(5)
    // history[0] 是最近一次被替换掉的版本
    expect(stored!.history.map((item) => item.done)).toEqual([
      ['v5'], ['v4'], ['v3'], ['v2'], ['v1'],
    ])
  })

  it('saves a draft without touching history and refreshes markdown', async () => {
    const { store, outputDir } = await makeStore()
    await store.writeDaily(daily())

    const edited: Sections = { done: ['改过'], risks: ['无'], tomorrow: ['明天'] }
    await store.saveDraft({ kind: 'daily', date: '2026-11-03', sections: edited })

    const stored = await store.readDaily('2026-11-03')
    expect(stored).not.toBeNull()
    expect(stored!.sections).toEqual(edited)
    expect(stored!.editedAt).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(stored!.editedAt!))).toBe(false)
    expect(stored!.history).toEqual([])
    expect(await readFile(join(outputDir, '2026-11-03.md'), 'utf8')).toContain('- 改过')
  })

  it('rejects drafts for reports that were never generated', async () => {
    const { store } = await makeStore()

    const dailyError = await captureError(() => store.saveDraft({ kind: 'daily', date: '2026-11-03', sections: sections() }))
    expect(isPluginError(dailyError)).toBe(true)
    expect((dailyError as PluginError).code).toBe('E_BAD_REQUEST')

    const missingDate = await captureError(() => store.saveDraft({ kind: 'daily', sections: sections() }))
    expect(isPluginError(missingDate)).toBe(true)
    expect((missingDate as PluginError).code).toBe('E_BAD_REQUEST')

    const weeklyError = await captureError(() => store.saveDraft({ kind: 'weekly', week: '2026-W45', sections: sections() }))
    expect(isPluginError(weeklyError)).toBe(true)
    expect((weeklyError as PluginError).code).toBe('E_BAD_REQUEST')
  })

  it('keeps json only when markdown output is disabled', async () => {
    const { store, outputDir } = await makeStore({ writeMarkdown: false })

    const written = await store.writeDaily(daily())

    expect(written.markdown).toBeUndefined()
    expect(await readdir(outputDir)).toEqual([])
    expect(await store.readDaily('2026-11-03')).not.toBeNull()
  })

  it('writes weekly reports with a 周报 markdown file', async () => {
    const { store, dataDir, outputDir } = await makeStore()
    const report = weekly()

    const written = await store.writeWeekly(report)

    expect(written.json).toBe(join(dataDir, 'weekly', '2026-W45.json'))
    expect(written.markdown).toBe(join(outputDir, '2026-W45-周报.md'))
    expect(await store.readWeekly('2026-W45')).toEqual(report)
    expect(await store.readWeekly('2026-W46')).toBeNull()

    const markdown = await readFile(join(outputDir, '2026-W45-周报.md'), 'utf8')
    expect(markdown).toContain('# 2026-W45 周报')
    expect(markdown).toContain('## 本周完成')
    expect(markdown).toContain('- 本周完成项')
    expect(markdown).toContain('## 下周计划')
    expect(markdown).toContain('- 下周计划项')
  })

  it('saves weekly drafts and rejects unknown weeks', async () => {
    const { store } = await makeStore()
    await store.writeWeekly(weekly())

    const edited: Sections = { done: ['改过'], risks: ['无'], next: [] }
    await store.saveDraft({ kind: 'weekly', week: '2026-W45', sections: edited })

    const stored = await store.readWeekly('2026-W45')
    expect(stored!.sections).toEqual(edited)
    expect(stored!.editedAt).toEqual(expect.any(String))

    const error = await captureError(() => store.saveDraft({ kind: 'weekly', sections: edited }))
    expect(isPluginError(error)).toBe(true)
    expect((error as PluginError).code).toBe('E_BAD_REQUEST')
  })

  it('reports corrupted report files as plugin errors', async () => {
    const { store, dataDir } = await makeStore()
    await mkdir(join(dataDir, 'daily'), { recursive: true })
    await writeFile(join(dataDir, 'daily', '2026-11-03.json'), '{ not json')

    const error = await captureError(() => store.readDaily('2026-11-03'))
    expect(isPluginError(error)).toBe(true)
    expect((error as PluginError).code).toBe('E_WRITE_FAILED')
  })
})

describe('atomicWrite', () => {
  it('creates parent directories, replaces content and leaves no temp files', async () => {
    const dir = await tempDir('atomic')
    const file = join(dir, 'nested', 'report.json')

    await atomicWrite(file, 'first')
    await atomicWrite(file, 'second')

    expect(await readFile(file, 'utf8')).toBe('second')
    expect(await readdir(join(dir, 'nested'))).toEqual(['report.json'])
  })
})

describe('KeyedLock', () => {
  it('rejects a concurrent run for the same key with E_LOCKED', async () => {
    const lock = new KeyedLock()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = lock.run('daily:2026-11-03', async () => {
      await gate
      return 'first'
    })
    const error = await captureError(() => lock.run('daily:2026-11-03', async () => 'second'))

    expect(isPluginError(error)).toBe(true)
    expect((error as PluginError).code).toBe('E_LOCKED')

    release()
    await expect(first).resolves.toBe('first')
    await expect(lock.run('daily:2026-11-03', async () => 'again')).resolves.toBe('again')
  })

  it('allows different keys to run concurrently', async () => {
    const lock = new KeyedLock()
    const [a, b] = await Promise.all([
      lock.run('daily:2026-11-03', async () => 'a'),
      lock.run('weekly:2026-W45', async () => 'b'),
    ])
    expect([a, b]).toEqual(['a', 'b'])
  })
})

describe('SettingsStore', () => {
  it('reads defaults and round-trips written settings', async () => {
    const dataDir = await tempDir('settings')
    const store = new SettingsStore(dataDir)

    expect(await store.read()).toEqual(DEFAULT_SETTINGS)

    const next = { ...DEFAULT_SETTINGS, reminderTime: '18:05', writeMarkdown: false, outputDir: '/tmp/worklog' }
    await store.write(next)

    expect(await store.read()).toMatchObject({ reminderTime: '18:05', writeMarkdown: false, outputDir: '/tmp/worklog' })
    const raw = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')) as { version?: number }
    expect(raw.version).toBe(1)
  })

  it('merges partial or invalid settings with defaults', async () => {
    const dataDir = await tempDir('settings-bad')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ reminderTime: '25:00', model: { provider: 'custom' } }))

    const settings = await new SettingsStore(dataDir).read()
    expect(settings.reminderTime).toBe('17:30')
    expect(settings.model).toEqual({ provider: 'custom', model: 'deepseek-flash' })
  })
})

describe('expandHome', () => {
  it('expands tilde paths only at the start', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/笔记/工作日志')).toBe(join(homedir(), '笔记/工作日志'))
    expect(expandHome('/absolute/path')).toBe('/absolute/path')
    expect(expandHome('relative/path')).toBe('relative/path')
    expect(expandHome('~/trailing/')).toBe(join(homedir(), 'trailing/'))
  })
})

describe('markdown renderers', () => {
  it('renders copy text with stable labels and ordered lists', () => {
    expect(copyText({ done: ['a', 'b'], risks: ['风险'], tomorrow: ['c'] }, 'daily'))
      .toBe('今日完成\n1. a\n2. b\n问题与风险\n1. 风险\n明日计划\n1. c')
    expect(copyText({ done: ['d'], risks: [], next: ['e'] }, 'weekly'))
      .toBe('本周完成\n1. d\n问题与风险\n下周计划\n1. e')
    expect(copyText({ done: [], risks: [] }, 'daily')).toBe('今日完成\n问题与风险\n明日计划')
  })

  it('keeps empty section headings without placeholder bullets', () => {
    const markdown = dailyMarkdown({ date: '2026-11-03', sections: { done: [], risks: [], tomorrow: [] } })
    expect(markdown).toContain('# 2026-11-03 日报')
    expect(markdown).toContain('## 今日完成')
    expect(markdown).toContain('## 问题与风险')
    expect(markdown).toContain('## 明日计划')
    expect(markdown).not.toMatch(/^- /m)
    expect(markdown.trimEnd().endsWith('## 明日计划')).toBe(true)

    const weekly = weeklyMarkdown({ week: '2026-W45', sections: { done: [], risks: [] } })
    expect(weekly).toContain('# 2026-W45 周报')
    expect(weekly).toContain('## 本周完成')
    expect(weekly).toContain('## 下周计划')
    expect(weekly.trimEnd().endsWith('## 下周计划')).toBe(true)
    expect(weekly).not.toMatch(/^- /m)
  })
})
