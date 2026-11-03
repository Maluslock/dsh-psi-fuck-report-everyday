import { describe, expect, it } from 'vitest'
import { isPluginError, PluginError } from '../src/host/errors'
import {
  dayWindow,
  isoWeek,
  isWeekday,
  localDateKey,
  pad2,
  parseDateKey,
  weekDates,
  weekStart,
} from '../src/host/time'

function expectBadDate(run: () => unknown): void {
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  expect(isPluginError(error)).toBe(true)
  expect((error as PluginError).code).toBe('E_BAD_DATE')
}

describe('time helpers', () => {
  it('formats a local date key', () => {
    expect(localDateKey(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03')
    expect(localDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    expect(pad2(7)).toBe('07')
    expect(pad2(12)).toBe('12')
  })

  it('parses valid date keys and rejects invalid ones', () => {
    expect(parseDateKey('2026-11-03')).toEqual({ y: 2026, m: 11, d: 3 })
    expectBadDate(() => parseDateKey('2026-1-1'))
    expectBadDate(() => parseDateKey('2026-02-30'))
    expectBadDate(() => parseDateKey('2026-13-01'))
    expectBadDate(() => parseDateKey('not-a-date'))
  })

  it('clamps today to now and uses the full day for past dates', () => {
    const now = new Date(2026, 10, 3, 17, 30)
    const today = dayWindow('2026-11-03', now)
    expect(today.start).toBe(new Date(2026, 10, 3, 0, 0, 0, 0).getTime())
    expect(today.end).toBe(now.getTime())

    const past = dayWindow('2026-11-02', now)
    const end = new Date(past.end)
    expect(new Date(past.start).getHours()).toBe(0)
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
    expect(end.getSeconds()).toBe(59)
    expect(end.getMilliseconds()).toBe(999)
  })

  it('computes ISO weeks across year boundaries', () => {
    expect(isoWeek('2026-11-03')).toBe('2026-W45')
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
    expect(isoWeek('2025-12-29')).toBe('2026-W01')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
  })

  it('computes Monday week starts', () => {
    expect(weekStart('2026-11-03')).toBe('2026-11-02')
    expect(weekStart('2026-11-02')).toBe('2026-11-02')
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
    expectBadDate(() => weekStart('2026-11-31'))
  })

  it('lists the seven dates of an ISO week', () => {
    const dates = weekDates('2026-W45')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-11-02')
    expect(dates[6]).toBe('2026-11-08')
    expect(isoWeek(dates[3]!)).toBe('2026-W45')
    expectBadDate(() => weekDates('2026-W1'))
    expectBadDate(() => weekDates('2025-W53'))
  })

  it('detects weekdays', () => {
    expect(isWeekday('2026-11-02')).toBe(true)
    expect(isWeekday('2026-11-03')).toBe(true)
    expect(isWeekday('2026-11-06')).toBe(true)
    expect(isWeekday('2026-11-07')).toBe(false)
    expect(isWeekday('2026-11-08')).toBe(false)
    expectBadDate(() => isWeekday('2026-11-00'))
  })
})
