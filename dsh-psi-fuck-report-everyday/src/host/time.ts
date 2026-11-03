import { PluginError } from './errors.js'

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function assertRealDate(y: number, m: number, d: number, raw: string): void {
  const probe = new Date(y, m - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    throw new PluginError('E_BAD_DATE', `非法日期：${raw}`)
  }
}

export function parseDateKey(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new PluginError('E_BAD_DATE', `非法日期：${date}`)
  const y = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  assertRealDate(y, month, day, date)
  return { y, m: month, d: day }
}

export function dayWindow(date: string, now: Date = new Date()): { start: number; end: number } {
  const { y, m, d } = parseDateKey(date)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  return { start, end: localDateKey(now) === date ? Math.min(now.getTime(), endOfDay) : endOfDay }
}

export function isoWeek(date: string): string {
  const { y, m, d } = parseDateKey(date)
  const t = new Date(Date.UTC(y, m - 1, d))
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const fday = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3)
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / 604800000)
  return `${t.getUTCFullYear()}-W${pad2(week)}`
}

export function weekStart(date: string): string {
  const { y, m, d } = parseDateKey(date)
  const t = new Date(y, m - 1, d)
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return localDateKey(t)
}

export function weekDates(week: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(week)
  if (!m) throw new PluginError('E_BAD_DATE', `非法周：${week}`)
  const year = Number(m[1])
  const weekNo = Number(m[2])
  if (weekNo < 1 || weekNo > 53) throw new PluginError('E_BAD_DATE', `非法周：${week}`)
  const jan4 = new Date(year, 0, 4)
  const monday = new Date(jan4)
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (weekNo - 1) * 7)
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return localDateKey(d)
  })
  if (isoWeek(dates[0]!) !== `${year}-W${pad2(weekNo)}`) {
    throw new PluginError('E_BAD_DATE', `非法周：${week}`)
  }
  return dates
}

export function isWeekday(date: string): boolean {
  const { y, m, d } = parseDateKey(date)
  const day = new Date(y, m - 1, d).getDay()
  return day >= 1 && day <= 5
}
