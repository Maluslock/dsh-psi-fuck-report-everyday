'use strict'
/**
 * 客户端纯逻辑测试：用最小 ModuleLoader 模拟页面加载环境。
 * 只允许 require('react')（shell 种子模块），任何其他依赖都应视为越权。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

let client = null

globalThis.window = {
  __ModuleLoader__: {
    load: function (descriptor) {
      client = descriptor.factory(function (name) {
        if (name === 'react') {
          return {
            createElement: function () {
              return null
            },
            useState: function () {},
            useEffect: function () {},
          }
        }
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

require('../client/index.js')

assert.ok(client, '客户端模块应通过 __ModuleLoader__.load 注册')

const {
  nextReminder,
  dailyToDraft,
  weeklyToDraft,
  localDateKey,
  parseDateKey,
  parseRemindAt,
  isoWeek,
  weekDates,
  recentDates,
  formatHHmm,
  isWeeklyDay,
  copyDailyText,
  copyWeeklyText,
  settingsToForm,
  formToSettings,
  formToSections,
  shortHash,
  archiveReason,
  archiveFromState,
  archiveText,
  MAX_SNOOZE,
} = client.__test

function reminderState(overrides) {
  return Object.assign(
    { remindAt: '17:30', lastFired: null, snoozeUntil: null, dismissedDate: null },
    overrides || {},
  )
}

// ---------------------------------------------------------------------------
// 提醒状态机
// ---------------------------------------------------------------------------

test('到点触发一次，当天不重复', function () {
  const state = reminderState()
  const at = new Date('2026-11-03T17:30:10+08:00')
  const first = nextReminder(state, at)
  assert.equal(first.fire, true)
  assert.equal(first.reason, 'due')
  const after = nextReminder(Object.assign({}, state, { lastFired: '2026-11-03' }), new Date('2026-11-03T17:31:00+08:00'))
  assert.equal(after.fire, false)
  assert.equal(after.reason, 'fired')
})

test('稍后 10 分钟生效', function () {
  const state = reminderState({ snoozeUntil: Date.parse('2026-11-03T17:40:00+08:00') })
  const waiting = nextReminder(state, new Date('2026-11-03T17:35:00+08:00'))
  assert.equal(waiting.fire, false)
  assert.equal(waiting.reason, 'snoozed')
  const due = nextReminder(state, new Date('2026-11-03T17:40:01+08:00'))
  assert.equal(due.fire, true)
  assert.equal(due.reason, 'snooze-due')
})

test('今天不写则当天不再提醒', function () {
  const state = reminderState({ dismissedDate: '2026-11-03' })
  const result = nextReminder(state, new Date('2026-11-03T18:00:00+08:00'))
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'dismissed')
})

test('今天已生成日报则不提醒', function () {
  const result = nextReminder(
    reminderState({ hasDailyToday: true }),
    new Date('2026-11-03T18:00:00+08:00'),
  )
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'generated')
})

test('首次触发后再稍后，到点仍会重新提醒（lastFired 不压住稍后）', function () {
  // 第一次 17:30 触发并记下 lastFired，然后用户点「10 分钟后」：snooze 会清 lastFired。
  const fired = reminderState({ lastFired: '2026-11-03' })
  assert.equal(nextReminder(fired, new Date('2026-11-03T17:31:00+08:00')).fire, false)
  const snoozed = reminderState({ lastFired: null, snoozeUntil: Date.parse('2026-11-03T17:41:00+08:00') })
  assert.equal(nextReminder(snoozed, new Date('2026-11-03T17:41:01+08:00')).fire, true)
})

test('稍后最多 3 次，之后按今天不写处理', function () {
  const waiting = reminderState({
    snoozeUntil: Date.parse('2026-11-03T17:41:00+08:00'),
    snoozeCount: MAX_SNOOZE - 1,
  })
  const third = nextReminder(waiting, new Date('2026-11-03T17:41:01+08:00'))
  assert.equal(third.fire, true)
  assert.equal(third.snoozeCount, MAX_SNOOZE - 1)

  // 第 3 次「稍后」到点仍要提醒；再点「稍后」由 store 拦下并视为今天不写。
  const last = reminderState({
    snoozeUntil: Date.parse('2026-11-03T17:51:00+08:00'),
    snoozeCount: MAX_SNOOZE,
  })
  const thirdReminder = nextReminder(last, new Date('2026-11-03T17:51:01+08:00'))
  assert.equal(thirdReminder.fire, true)
  assert.equal(thirdReminder.reason, 'snooze-due')

  const exhausted = reminderState({
    snoozeUntil: Date.parse('2026-11-03T18:01:00+08:00'),
    snoozeCount: MAX_SNOOZE + 1,
  })
  const result = nextReminder(exhausted, new Date('2026-11-03T18:01:01+08:00'))
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'snooze-exhausted')
})

test('未到点不提醒，正好到点则提醒', function () {
  assert.equal(nextReminder(reminderState(), new Date('2026-11-03T17:29:59+08:00')).reason, 'early')
  assert.equal(nextReminder(reminderState(), new Date('2026-11-03T17:30:00+08:00')).fire, true)
})

test('提醒时间为空或非法时回退到 17:30', function () {
  const target = parseRemindAt('bad', new Date('2026-11-03T09:00:00+08:00'))
  assert.equal(target.getHours(), 17)
  assert.equal(target.getMinutes(), 30)
  assert.equal(nextReminder(reminderState({ remindAt: 'bad' }), new Date('2026-11-03T17:31:00+08:00')).fire, true)
  assert.equal(nextReminder(reminderState({ remindAt: '8:05' }), new Date('2026-11-03T08:06:00+08:00')).fire, true)
})

// ---------------------------------------------------------------------------
// 草稿与复制
// ---------------------------------------------------------------------------

test('日报转草稿保留三节', function () {
  assert.deepEqual(dailyToDraft({ sections: { done: ['a'], risks: [], tomorrow: ['b'] } }), {
    done: ['a'],
    risks: [],
    tomorrow: ['b'],
  })
  assert.deepEqual(dailyToDraft({}), { done: [], risks: [], tomorrow: [] })
  assert.deepEqual(dailyToDraft({ sections: { done: ['a', 3, null], risks: 'x' } }), {
    done: ['a'],
    risks: [],
    tomorrow: [],
  })
})

test('周报转草稿使用 next 键', function () {
  assert.deepEqual(weeklyToDraft({ sections: { done: ['a'], risks: ['r'], next: ['n'] } }), {
    done: ['a'],
    risks: ['r'],
    next: ['n'],
  })
})

test('文本域按行拆分，忽略空行与首尾空白', function () {
  assert.deepEqual(linesOfForm('  a \n\n b\n'), ['a', 'b'])
  function linesOfForm(text) {
    return formToSections({ done: text, risks: '', tomorrow: '' }, 'daily').done
  }
  assert.deepEqual(formToSections({ done: 'a', risks: 'r', next: 'n' }, 'weekly'), {
    done: ['a'],
    risks: ['r'],
    next: ['n'],
  })
  assert.deepEqual(formToSections({ done: '', risks: '', tomorrow: '' }, 'daily'), {
    done: [],
    risks: [],
    tomorrow: [],
  })
})

test('复制格式为纯文本编号，固定标签，空节保留标签', function () {
  const text = copyDailyText({ done: ['修登录', '写文档'], risks: [], tomorrow: ['联调'] })
  assert.equal(text, '今日完成\n1. 修登录\n2. 写文档\n问题与风险\n明日计划\n1. 联调')
  assert.ok(!text.includes('##'))
  assert.equal(copyWeeklyText({ done: ['a'], risks: [], next: [] }), '本周完成\n1. a\n问题与风险\n下周计划')
})

// ---------------------------------------------------------------------------
// 日期与设置
// ---------------------------------------------------------------------------

test('本地日期键与解析', function () {
  assert.equal(localDateKey(new Date('2026-11-03T00:00:00+08:00')), '2026-11-03')
  assert.equal(localDateKey(new Date('2026-11-03T23:59:59+08:00')), '2026-11-03')
  assert.equal(parseDateKey('2026-11-03').getDate(), 3)
  assert.equal(parseDateKey('2026-02-30'), null)
  assert.equal(parseDateKey('2026-1-3'), null)
  assert.equal(parseDateKey(''), null)
})

test('ISO 周号与工作日列表', function () {
  assert.equal(isoWeek(new Date('2026-11-03T10:00:00+08:00')), '2026-W45')
  assert.equal(isoWeek(new Date('2026-11-01T10:00:00+08:00')), '2026-W44')
  assert.deepEqual(weekDates(new Date('2026-11-03T10:00:00+08:00')), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
  ])
  assert.deepEqual(recentDates(new Date('2026-11-03T10:00:00+08:00'), 3), ['2026-11-03', '2026-11-02', '2026-11-01'])
  assert.equal(formatHHmm('2026-11-03T17:30:10+08:00'), '17:30')
  assert.equal(formatHHmm('nope'), '')
})

test('周报日按设置判断，默认周五', function () {
  assert.equal(isWeeklyDay(new Date('2026-11-06T10:00:00+08:00'), null), true)
  assert.equal(isWeeklyDay(new Date('2026-11-03T10:00:00+08:00'), null), false)
  assert.equal(isWeeklyDay(new Date('2026-11-03T10:00:00+08:00'), { weeklyDay: 2 }), true)
  assert.equal(isWeeklyDay(new Date('2026-11-06T10:00:00+08:00'), { weeklyDay: 99 }), true)
})

test('设置与表单互转保留未在表单里的字段', function () {
  const base = {
    version: 1,
    reminderTime: '17:30',
    weeklyDay: 5,
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    outputDir: '~/笔记/工作日志',
    writeMarkdown: true,
    weeklyCommit: true,
    cleanupEnabled: false,
    excludedProjects: ['/a'],
    excludedSessions: ['s1'],
    excludedByDate: { '2026-11-02': { projects: ['/b'], sessions: [] } },
    dataDir: '/tmp/data',
  }
  const form = settingsToForm(base)
  assert.equal(form.model, 'deepseek-official/deepseek-flash')
  assert.equal(form.excludedProjects, '/a')
  assert.equal(form.excludedSessions, 's1')
  assert.equal(form.weeklyDay, '5')

  const next = formToSettings(
    Object.assign({}, form, {
      reminderTime: '18:05',
      weeklyDay: '3',
      model: 'workbuddy/glm-5.3',
      outputDir: '/tmp/logs',
      writeMarkdown: false,
      excludedProjects: '/a\n/c',
      excludedSessions: '',
    }),
    base,
  )
  assert.equal(next.reminderTime, '18:05')
  assert.equal(next.weeklyDay, 3)
  assert.deepEqual(next.model, { provider: 'workbuddy', model: 'glm-5.3' })
  assert.equal(next.outputDir, '/tmp/logs')
  assert.equal(next.writeMarkdown, false)
  assert.deepEqual(next.excludedProjects, ['/a', '/c'])
  assert.deepEqual(next.excludedSessions, [])
  assert.deepEqual(next.excludedByDate, base.excludedByDate)
  assert.equal(next.dataDir, '/tmp/data')
})

test('归档原因与短 hash', function () {
  assert.equal(shortHash('abcdef1234567'), 'abcdef1')
  assert.equal(shortHash(''), '')
  assert.equal(archiveReason('no-git'), '目录不在 Git 仓库')
  assert.equal(archiveReason('no-change'), '没有变更')
  assert.equal(archiveReason('merge'), '存在合并冲突，需手动处理')
  assert.equal(archiveReason('whatever'), 'whatever')
})

test('本周页从 /state.archive 恢复归档状态并生成文案', function () {
  const committed = {
    committed: true,
    hash: 'abcdef1234567',
    committedAt: '2026-11-06T18:05:00+08:00',
  }
  // 顶层 archive 优先；旧宿主只有 weekly.archive 时也能恢复。
  assert.deepEqual(
    archiveFromState({ archive: committed, weekly: { archive: { committed: false, reason: 'no-git' } } }),
    committed,
  )
  assert.equal(archiveText(archiveFromState({ archive: committed, weekly: null })), '已本地提交 abcdef1')
  assert.equal(
    archiveText(archiveFromState({ weekly: { archive: { committed: false, reason: 'no-git' } } })),
    '未提交（目录不在 Git 仓库）',
  )
  assert.equal(archiveText(archiveFromState({ weekly: null })), '未提交')
  assert.equal(archiveText(archiveFromState(null)), '未提交')
  // no-change 按「已归档」处理，但没有新 hash。
  assert.equal(archiveText({ committed: true, reason: 'no-change' }), '已本地提交')
})

// ---------------------------------------------------------------------------
// 注册表：apply 必须走 slots.inject 并注册四个入口
// ---------------------------------------------------------------------------

test('apply 注册侧栏、主面板、设置分区与提醒横幅', function () {
  const registrations = []
  const injections = []
  const ctx = {
    slots: {
      inject: function (name, callback) {
        injections.push(name)
        callback()
      },
      register: function (options, component) {
        registrations.push({ options: options, component: component })
        return { dispose: function () {} }
      },
    },
  }

  client.apply(ctx)

  assert.deepEqual(injections, ['sidebar.panellist', 'main', 'settings.section', 'shell.overlay'])

  const sidebar = registrations.find(function (item) {
    return item.options.name === 'sidebar.panellist'
  })
  assert.equal(sidebar.options.id, 'dsh-psi-fuck-report-everyday')
  assert.equal(sidebar.options.label(), '下班日报')
  assert.equal(typeof sidebar.component, 'function')

  const main = registrations.find(function (item) {
    return item.options.name === 'main'
  })
  assert.equal(main.options.key, 'dsh-psi-fuck-report-everyday')

  const settings = registrations.find(function (item) {
    return item.options.name === 'settings.section'
  })
  assert.equal(settings.options.id, 'dsh-psi-fuck-report-everyday')
  assert.equal(settings.options.label(), '下班日报')

  const overlay = registrations.find(function (item) {
    return item.options.name === 'shell.overlay'
  })
  assert.equal(overlay.options.id, 'dsh-psi-fuck-report-everyday-reminder')
  assert.deepEqual(client.inject, ['slots'])
})
