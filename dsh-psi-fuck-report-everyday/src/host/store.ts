import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { PluginError, isPluginError } from './errors.js'
import { dailyMarkdown, weeklyMarkdown } from './markdown.js'
import { DEFAULT_SETTINGS, mergeSettings } from './settings.js'
import type { DailyReport, Sections, Settings, WeeklyArchive, WeeklyReport } from './types.js'

/**
 * 把设置里的路径展开成当前平台的绝对路径：
 * - `~`、`~/x`、`~\x` 展开到用户目录；
 * - `$HOME`、`${HOME}`、`%USERPROFILE%`、`%HOME%` 展开到用户目录；
 * - 去掉 Windows「复制为路径」带上的成对引号；
 * - 相对路径按用户目录解析，避免依赖进程 cwd（Windows/macOS/Linux 行为一致）。
 */
export function expandHome(input: string): string {
  let path = String(input ?? '').trim()
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    path = path.slice(1, -1).trim()
  }
  if (!path) return path
  path = path
    .replace(/\$\{HOME\}/g, homedir())
    .replace(/\$HOME/g, homedir())
    .replace(/%USERPROFILE%/gi, homedir())
    .replace(/%HOME%/gi, homedir())
  if (path === '~') return normalize(homedir())
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return normalize(join(homedir(), path.slice(2)))
  }
  if (isAbsolute(path)) return normalize(path)
  return normalize(resolve(homedir(), path))
}

/** 先写同目录临时文件并 fsync，再 rename 覆盖目标，避免进程中断留下半截 JSON。 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const directory = dirname(filePath)
  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await mkdir(directory, { recursive: true })
    handle = await open(tempPath, 'w')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(tempPath, filePath)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(tempPath, { force: true }).catch(() => {})
    if (isPluginError(error)) throw error
    throw new PluginError('E_WRITE_FAILED', `写入文件失败：${filePath}`, error)
  }
}

export interface StoreOptions {
  dataDir: string
  outputDir: string
  writeMarkdown: boolean
  weeklyCommit: boolean
}

export interface WriteResult {
  json: string
  markdown?: string
}

/** HTTP 层可能缺字段，运行时统一校验，故 date/week 可选。 */
export interface DraftInput {
  kind: 'daily' | 'weekly'
  date?: string
  week?: string
  sections: Sections
}

const MAX_HISTORY = 5

function cloneSections(sections: Sections): Sections {
  const copy: Sections = {
    done: [...sections.done],
    risks: [...sections.risks],
  }
  if (sections.tomorrow) copy.tomorrow = [...sections.tomorrow]
  if (sections.next) copy.next = [...sections.next]
  return copy
}

function pushHistory(history: Sections[], previous: Sections): Sections[] {
  return [cloneSections(previous), ...history].slice(0, MAX_HISTORY)
}

async function readJson<T>(filePath: string): Promise<T | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new PluginError('E_WRITE_FAILED', `读取文件失败：${filePath}`, error)
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new PluginError('E_WRITE_FAILED', `报告文件不是合法 JSON：${filePath}`, error)
  }
}

export class ReportStore {
  private readonly options: StoreOptions

  constructor(options: StoreOptions) {
    this.options = { ...options }
  }

  dailyPath(date: string): string {
    return join(this.options.dataDir, 'daily', `${date}.json`)
  }

  weeklyPath(week: string): string {
    return join(this.options.dataDir, 'weekly', `${week}.json`)
  }

  readDaily(date: string): Promise<DailyReport | null> {
    return readJson<DailyReport>(this.dailyPath(date))
  }

  readWeekly(week: string): Promise<WeeklyReport | null> {
    return readJson<WeeklyReport>(this.weeklyPath(week))
  }

  async writeDaily(report: DailyReport, options: { replace?: boolean } = {}): Promise<WriteResult> {
    let next = report
    if (options.replace) {
      const previous = await this.readDaily(report.date)
      if (previous) {
        next = { ...report, history: pushHistory(previous.history ?? [], previous.sections) }
      }
    }
    const json = this.dailyPath(next.date)
    await atomicWrite(json, `${JSON.stringify(next, null, 2)}\n`)
    if (!this.options.writeMarkdown) return { json }

    const markdown = join(this.options.outputDir, `${next.date}.md`)
    await atomicWrite(markdown, dailyMarkdown(next))
    return { json, markdown }
  }

  async writeWeekly(report: WeeklyReport, options: { replace?: boolean } = {}): Promise<WriteResult> {
    let next = report
    if (options.replace) {
      const previous = await this.readWeekly(report.week)
      if (previous) {
        next = { ...report, history: pushHistory(previous.history ?? [], previous.sections) }
      }
    }
    const json = this.weeklyPath(next.week)
    await atomicWrite(json, `${JSON.stringify(next, null, 2)}\n`)
    if (!this.options.writeMarkdown) return { json }

    const markdown = join(this.options.outputDir, `${next.week}-周报.md`)
    await atomicWrite(markdown, weeklyMarkdown(next))
    return { json, markdown }
  }

  /**
   * 只回写归档状态：读取现有周报并原子写回，保留 sections/editedAt/history/days 等字段，
   * 不 push history，也不重写 Markdown（归档状态不参与 Markdown 渲染）。
   * 周报不存在时返回 false，供 /commit 在没有周报的周上安全跳过。
   */
  async setWeeklyArchive(week: string, archive: WeeklyArchive): Promise<boolean> {
    const report = await this.readWeekly(week)
    if (!report) return false
    await atomicWrite(this.weeklyPath(week), `${JSON.stringify({ ...report, archive }, null, 2)}\n`)
    return true
  }

  async saveDraft(input: DraftInput): Promise<{ json: string; markdown?: string }> {
    const editedAt = new Date().toISOString()
    if (input.kind === 'daily') {
      if (!input.date) throw new PluginError('E_BAD_REQUEST', '保存日报草稿需要 date')
      const report = await this.readDaily(input.date)
      if (!report) throw new PluginError('E_BAD_REQUEST', `日报不存在：${input.date}`)
      return this.writeDaily({ ...report, sections: cloneSections(input.sections), editedAt })
    }

    if (!input.week) throw new PluginError('E_BAD_REQUEST', '保存周报草稿需要 week')
    const report = await this.readWeekly(input.week)
    if (!report) throw new PluginError('E_BAD_REQUEST', `周报不存在：${input.week}`)
    return this.writeWeekly({ ...report, sections: cloneSections(input.sections), editedAt })
  }
}

/**
 * 同一 key 的生成/保存串行化：已有任务时直接抛 E_LOCKED，而不是排队等待。
 * 不同 key 互不阻塞。
 */
export class KeyedLock {
  private readonly active = new Set<string>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.active.has(key)) {
      throw new PluginError('E_LOCKED', `同类操作正在进行中：${key}`)
    }
    this.active.add(key)
    try {
      return await task()
    } finally {
      this.active.delete(key)
    }
  }
}

export class SettingsStore {
  private readonly dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  private get filePath(): string {
    return join(this.dataDir, 'settings.json')
  }

  async read(): Promise<Settings> {
    const stored = await readJson<Partial<Settings>>(this.filePath)
    if (!stored) return structuredClone(DEFAULT_SETTINGS)
    return mergeSettings(stored)
  }

  async write(settings: Settings): Promise<Settings> {
    const merged = mergeSettings(settings)
    await atomicWrite(this.filePath, `${JSON.stringify(merged, null, 2)}\n`)
    return merged
  }
}
