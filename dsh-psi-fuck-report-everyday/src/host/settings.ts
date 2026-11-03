import type { ModelRef, Settings } from './types.js'
import { localDateKey, parseDateKey } from './time.js'

export const DEFAULT_SETTINGS: Settings = {
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
}

const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function filterStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isDateKey(value: string): boolean {
  try {
    parseDateKey(value)
    return true
  } catch {
    return false
  }
}

function sanitizeExcludedByDate(value: unknown): Record<string, { projects: string[]; sessions: string[] }> {
  const result: Record<string, { projects: string[]; sessions: string[] }> = {}
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(value)) {
    if (!isDateKey(key) || !isRecord(entry)) continue
    result[key] = {
      projects: filterStrings(entry.projects),
      sessions: filterStrings(entry.sessions),
    }
  }
  return result
}

export function mergeSettings(raw: unknown): Settings {
  const input = isRecord(raw) ? raw : {}
  const rawModel = isRecord(input.model) ? input.model : {}
  const model: ModelRef = {
    provider: nonEmptyString(rawModel.provider) ?? DEFAULT_SETTINGS.model.provider,
    model: nonEmptyString(rawModel.model) ?? DEFAULT_SETTINGS.model.model,
  }
  const dataDir = nonEmptyString(input.dataDir)
  return {
    version: 1,
    reminderTime: typeof input.reminderTime === 'string' && REMINDER_TIME_RE.test(input.reminderTime)
      ? input.reminderTime
      : DEFAULT_SETTINGS.reminderTime,
    weeklyDay: typeof input.weeklyDay === 'number' && Number.isInteger(input.weeklyDay) && input.weeklyDay >= 1 && input.weeklyDay <= 7
      ? input.weeklyDay
      : DEFAULT_SETTINGS.weeklyDay,
    model,
    outputDir: nonEmptyString(input.outputDir) ?? DEFAULT_SETTINGS.outputDir,
    ...(dataDir ? { dataDir } : {}),
    writeMarkdown: typeof input.writeMarkdown === 'boolean' ? input.writeMarkdown : DEFAULT_SETTINGS.writeMarkdown,
    weeklyCommit: typeof input.weeklyCommit === 'boolean' ? input.weeklyCommit : DEFAULT_SETTINGS.weeklyCommit,
    excludedProjects: filterStrings(input.excludedProjects),
    excludedSessions: filterStrings(input.excludedSessions),
    excludedByDate: sanitizeExcludedByDate(input.excludedByDate),
    cleanupEnabled: typeof input.cleanupEnabled === 'boolean' ? input.cleanupEnabled : DEFAULT_SETTINGS.cleanupEnabled,
  }
}

export function validateSettings(settings: Settings): string[] {
  const errors: string[] = []
  if (typeof settings.reminderTime !== 'string' || !REMINDER_TIME_RE.test(settings.reminderTime)) {
    errors.push('reminderTime')
  }
  if (!Number.isInteger(settings.weeklyDay) || settings.weeklyDay < 1 || settings.weeklyDay > 7) {
    errors.push('weeklyDay')
  }
  const model = settings.model as Partial<ModelRef> | undefined
  if (!model || !nonEmptyString(model.provider) || !nonEmptyString(model.model)) {
    errors.push('model')
  }
  if (typeof settings.outputDir !== 'string' || !settings.outputDir.trim()) {
    errors.push('outputDir')
  }
  if (!isValidExcluded(settings)) {
    errors.push('excluded')
  }
  return errors
}

function isValidExcluded(settings: Settings): boolean {
  if (!isStringArray(settings.excludedProjects) || !isStringArray(settings.excludedSessions)) return false
  if (!isRecord(settings.excludedByDate)) return false
  return Object.entries(settings.excludedByDate).every(([key, entry]) => (
    isDateKey(key) && isRecord(entry) && isStringArray(entry.projects) && isStringArray(entry.sessions)
  ))
}

export function pruneExcludedByDate(settings: Settings, now: Date = new Date()): Settings {
  const cutoff = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7))
  const entries = Object.entries(settings.excludedByDate ?? {})
    .filter(([key]) => key >= cutoff)
    .map(([key, entry]): [string, { projects: string[]; sessions: string[] }] => (
      [key, { projects: [...entry.projects], sessions: [...entry.sessions] }]
    ))
  return { ...settings, excludedByDate: Object.fromEntries(entries) }
}

export function dateExclusion(settings: Settings, date: string): { projects: string[]; sessions: string[] } {
  const entry = settings.excludedByDate?.[date]
  return {
    projects: entry ? [...entry.projects] : [],
    sessions: entry ? [...entry.sessions] : [],
  }
}
