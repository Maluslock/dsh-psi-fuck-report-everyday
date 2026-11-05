'use strict'
/**
 * dsh-psi-fuck-report-everyday 客户端（手写 CJS，由 Web 端 ModuleLoader 加载）。
 *
 * 约束与取舍：
 * - 页面侧 ModuleLoader 只保证 shell 种子模块（react 等），所以全部辅助函数内联，
 *   不 require 任何第三方包，也不引用相对路径。
 * - 面板、侧栏入口、设置分区、全局提醒横幅都通过 slots 注册；数据只走宿主 HTTP，
 *   客户端不接触文件系统与 Git。
 * - 提醒只在页面打开时轮询（30 秒一次），稍后 / 今天不写按本地日期记在 localStorage；
 *   页面关闭即无提醒，设置页会写明这一点。
 */
;(function () {
  var ID = 'dsh-psi-fuck-report-everyday'
  var API = '/api/dsh-psi-fuck-report-everyday'
  var STORAGE_KEY = 'dsh-eod-reminder'
  /** 「10 分钟后」最多重复 3 次，之后按「今天不写」处理。 */
  var MAX_SNOOZE = 3
  var SNOOZE_MS = 10 * 60 * 1000
  var POLL_MS = 30 * 1000

  window.__ModuleLoader__.load({
    id: ID,
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect

      // -------------------------------------------------------------------
      // 纯函数：时间、提醒状态与草稿转换（node --test 可直接覆盖）
      // -------------------------------------------------------------------

      var WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

      function pad2(value) {
        return value < 10 ? '0' + value : String(value)
      }

      /** 本地时区的 YYYY-MM-DD；提醒与日期选择都以本地日期为准。 */
      function localDateKey(date) {
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
      }

      function parseDateKey(key) {
        if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
        var parts = key.split('-')
        var year = Number(parts[0])
        var month = Number(parts[1])
        var day = Number(parts[2])
        var date = new Date(year, month - 1, day)
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
        return date
      }

      /** 解析 HH:mm；非法值回退到 17:30，保证提醒不会因为坏设置而消失。 */
      function parseRemindAt(remindAt, now) {
        var match = /^(\d{1,2}):(\d{2})$/.exec(String(remindAt == null ? '' : remindAt).trim())
        var hours = 17
        var minutes = 30
        if (match) {
          var hh = Number(match[1])
          var mm = Number(match[2])
          if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
            hours = hh
            minutes = mm
          }
        }
        var base = now instanceof Date ? now : new Date()
        return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0)
      }

      /**
       * 提醒状态机。顺序有意固定为：
       * 今天不写 → 今天已生成 → 稍后等待/稍后到点 → 已触发 → 未到点。
       * 稍后到点必须先于「已触发」判断，否则第一次触发后写下的 lastFired
       * 会把后续的稍后重提醒永久压住。
       */
      function nextReminder(state, now) {
        var current = now instanceof Date ? now : new Date(now)
        var today = localDateKey(current)
        var input = state || {}
        if (input.dismissedDate === today) return { fire: false, reason: 'dismissed' }
        if (input.hasDailyToday === true) return { fire: false, reason: 'generated' }
        var snoozeCount = Number(input.snoozeCount) || 0
        var snoozeUntil = Number(input.snoozeUntil) || 0
        if (snoozeUntil > 0) {
          if (current.getTime() < snoozeUntil) return { fire: false, reason: 'snoozed', snoozeCount: snoozeCount }
          if (snoozeCount > MAX_SNOOZE) return { fire: false, reason: 'snooze-exhausted', snoozeCount: snoozeCount }
          return { fire: true, reason: 'snooze-due', snoozeCount: snoozeCount }
        }
        if (input.lastFired === today) return { fire: false, reason: 'fired' }
        var target = parseRemindAt(input.remindAt, current)
        if (current.getTime() < target.getTime()) return { fire: false, reason: 'early' }
        return { fire: true, reason: 'due' }
      }

      function sectionList(value) {
        if (!Array.isArray(value)) return []
        return value.filter(function (item) {
          return typeof item === 'string'
        })
      }

      function dailyToDraft(report) {
        var sections = report && report.sections ? report.sections : {}
        return {
          done: sectionList(sections.done),
          risks: sectionList(sections.risks),
          tomorrow: sectionList(sections.tomorrow),
        }
      }

      function weeklyToDraft(report) {
        var sections = report && report.sections ? report.sections : {}
        return {
          done: sectionList(sections.done),
          risks: sectionList(sections.risks),
          next: sectionList(sections.next),
        }
      }

      /** 文本域每行一条，忽略空行与首尾空白。 */
      function linesOf(text) {
        return String(text == null ? '' : text)
          .split('\n')
          .map(function (line) {
            return line.trim()
          })
          .filter(function (line) {
            return line.length > 0
          })
      }

      /** 表单三节 <-> 接口 sections；周报第三节键名是 next。 */
      function formToSections(form, kind) {
        var value = form || {}
        var sections = { done: linesOf(value.done), risks: linesOf(value.risks) }
        if (kind === 'weekly') sections.next = linesOf(value.next)
        else sections.tomorrow = linesOf(value.tomorrow)
        return sections
      }

      /** ISO 周号，例如 2026-11-03 -> 2026-W45；与宿主 isoWeek 一致。 */
      function isoWeek(date) {
        var current = new Date(date.getFullYear(), date.getMonth(), date.getDate())
        var weekday = (current.getDay() + 6) % 7
        current.setDate(current.getDate() - weekday + 3)
        var firstThursday = new Date(current.getFullYear(), 0, 4)
        var firstWeekday = (firstThursday.getDay() + 6) % 7
        firstThursday.setDate(firstThursday.getDate() - firstWeekday + 3)
        var week = 1 + Math.round((current.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
        return current.getFullYear() + '-W' + pad2(week)
      }

      /** 本周周一至周五（周报只覆盖工作日）。 */
      function weekDates(date) {
        var current = new Date(date.getFullYear(), date.getMonth(), date.getDate())
        var weekday = (current.getDay() + 6) % 7
        current.setDate(current.getDate() - weekday)
        var list = []
        for (var index = 0; index < 5; index += 1) {
          list.push(localDateKey(current))
          current.setDate(current.getDate() + 1)
        }
        return list
      }

      /** 日期选择器：今天起往前 count 天，新在前。 */
      function recentDates(now, count) {
        var total = count || 7
        var cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        var list = []
        for (var index = 0; index < total; index += 1) {
          list.push(localDateKey(cursor))
          cursor.setDate(cursor.getDate() - 1)
        }
        return list
      }

      function dateOptionLabel(key) {
        var date = parseDateKey(key)
        if (!date) return key
        return key.slice(5) + ' ' + WEEKDAYS[(date.getDay() + 6) % 7]
      }

      function formatHHmm(value) {
        var date = value instanceof Date ? value : new Date(value)
        if (isNaN(date.getTime())) return ''
        return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      }

      function isoWeekday(date) {
        return ((date.getDay() + 6) % 7) + 1
      }

      /** 周报日：设置里的 1–7，默认周五。 */
      function isWeeklyDay(date, settings) {
        var configured = settings ? Number(settings.weeklyDay) : 5
        var target = configured >= 1 && configured <= 7 ? configured : 5
        return isoWeekday(date) === target
      }

      function numbered(items) {
        return sectionList(items).map(function (item, index) {
          return index + 1 + '. ' + item
        })
      }

      function joinSections(labels, groups) {
        var lines = []
        for (var index = 0; index < labels.length; index += 1) {
          lines.push(labels[index])
          lines = lines.concat(numbered(groups[index]))
        }
        return lines.join('\n')
      }

      /** 复制格式：纯文本、固定标签、无 Markdown 标记。 */
      function copyDailyText(sections) {
        var value = sections || {}
        return joinSections(['今日完成', '问题与风险', '明日计划'], [value.done, value.risks, value.tomorrow])
      }

      function copyWeeklyText(sections) {
        var value = sections || {}
        return joinSections(['本周完成', '问题与风险', '下周计划'], [value.done, value.risks, value.next])
      }

      function settingsToForm(settings) {
        var value = settings || {}
        var model = value.model || {}
        return {
          reminderTime: value.reminderTime || '17:30',
          weeklyDay: String(value.weeklyDay || 5),
          model: String(model.provider || '') + '/' + String(model.model || ''),
          outputDir: value.outputDir || '',
          writeMarkdown: value.writeMarkdown !== false,
          weeklyCommit: value.weeklyCommit !== false,
          cleanupEnabled: value.cleanupEnabled === true,
          excludedProjects: sectionList(value.excludedProjects).join('\n'),
          excludedSessions: sectionList(value.excludedSessions).join('\n'),
        }
      }

      /** 以原设置为底合并表单，保留 excludedByDate / dataDir 等未在表单里的字段。 */
      function formToSettings(form, base) {
        var value = form || {}
        var combined = String(value.model || '').trim()
        var slash = combined.indexOf('/')
        var provider = slash >= 0 ? combined.slice(0, slash).trim() : combined
        var model = slash >= 0 ? combined.slice(slash + 1).trim() : ''
        return Object.assign({}, base || {}, {
          reminderTime: String(value.reminderTime || '').trim() || '17:30',
          weeklyDay: Number(value.weeklyDay) || 5,
          model: { provider: provider, model: model },
          outputDir: String(value.outputDir || '').trim(),
          writeMarkdown: Boolean(value.writeMarkdown),
          weeklyCommit: Boolean(value.weeklyCommit),
          cleanupEnabled: Boolean(value.cleanupEnabled),
          excludedProjects: linesOf(value.excludedProjects),
          excludedSessions: linesOf(value.excludedSessions),
        })
      }

      var IS_WINDOWS = typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform || '')

      function joinDisplayPath(dir, name) {
        var base = String(dir || '').trim()
        if (!base) return name
        var sep = base.indexOf('\\') >= 0 && base.indexOf('/') < 0 ? '\\' : '/'
        return base.replace(/[\\/]+$/, '') + sep + name
      }

      function shortHash(hash) {
        return String(hash || '').slice(0, 7)
      }

      function archiveReason(reason) {
        var map = {
          'no-git': '目录不在 Git 仓库',
          'outside-repo': '目录不在 Git 仓库',
          'no-change': '没有变更',
          'no-identity': 'Git 缺少提交身份',
          merge: '存在合并冲突，需手动处理',
          rebase: '存在变基冲突，需手动处理',
          'rebase-apply': '存在变基冲突，需手动处理',
          'cherry-pick': '存在拣选冲突，需手动处理',
        }
        return map[reason] || String(reason || '未知原因')
      }

      /** /state 顶层 archive 优先；旧宿主或旧周报文件没有时退回 weekly.archive。 */
      function archiveFromState(state) {
        if (!state || typeof state !== 'object') return null
        if (state.archive && typeof state.archive === 'object') return state.archive
        if (state.weekly && typeof state.weekly === 'object'
          && state.weekly.archive && typeof state.weekly.archive === 'object') {
          return state.weekly.archive
        }
        return null
      }

      function archiveText(archive) {
        if (!archive) return '未提交'
        if (archive.committed) {
          var hash = shortHash(archive.hash)
          return hash ? '已本地提交 ' + hash : '已本地提交'
        }
        return '未提交（' + archiveReason(archive.reason) + '）'
      }

      // -------------------------------------------------------------------
      // HTTP：所有数据都来自宿主接口
      // -------------------------------------------------------------------

      function request(path, init) {
        var options = Object.assign({ method: 'GET' }, init || {})
        var headers = Object.assign({ accept: 'application/json' }, options.headers || {})
        if (options.body !== undefined && typeof options.body !== 'string') {
          headers['content-type'] = 'application/json'
          options.body = JSON.stringify(options.body)
        }
        options.headers = headers
        return fetch(API + path, options).then(function (response) {
          return response.text().then(function (text) {
            var payload = null
            if (text) {
              try {
                payload = JSON.parse(text)
              } catch (error) {
                payload = null
              }
            }
            if (response.ok) return payload
            var message = payload && payload.error && payload.error.message
              ? payload.error.message
              : text || 'HTTP ' + response.status
            var failure = new Error(message)
            failure.code = payload && payload.error ? payload.error.code : ''
            failure.status = response.status
            throw failure
          })
        })
      }

      function requestText(path) {
        return fetch(API + path, { headers: { accept: 'text/markdown' } }).then(function (response) {
          return response.text().then(function (text) {
            if (response.ok) return text
            var payload = null
            try {
              payload = JSON.parse(text)
            } catch (error) {
              payload = null
            }
            var message = payload && payload.error && payload.error.message
              ? payload.error.message
              : text || 'HTTP ' + response.status
            var failure = new Error(message)
            failure.code = payload && payload.error ? payload.error.code : ''
            failure.status = response.status
            throw failure
          })
        })
      }

      function copyToClipboard(text) {
        var clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
        if (clipboard && typeof clipboard.writeText === 'function') return clipboard.writeText(text)
        return new Promise(function (resolve, reject) {
          try {
            var area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', 'readonly')
            area.style.position = 'fixed'
            area.style.top = '-1000px'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            var copied = document.execCommand('copy')
            document.body.removeChild(area)
            if (copied) resolve()
            else reject(new Error('浏览器拒绝写入剪贴板'))
          } catch (error) {
            reject(error)
          }
        })
      }

      function downloadText(filename, text) {
        var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
        var url = URL.createObjectURL(blob)
        var anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        setTimeout(function () {
          URL.revokeObjectURL(url)
        }, 1000)
      }

      // -------------------------------------------------------------------
      // 提醒状态仓库：横幅、侧栏红点、面板共用同一份轮询
      // -------------------------------------------------------------------

      var store = null

      function readReminderRecord() {
        try {
          var raw = window.localStorage.getItem(STORAGE_KEY)
          var parsed = raw ? JSON.parse(raw) : null
          return parsed && typeof parsed === 'object' ? parsed : null
        } catch (error) {
          return null
        }
      }

      function writeReminderRecord(record) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
        } catch (error) {
          /* 隐私模式下 localStorage 不可写时退化为仅本页内存状态 */
        }
      }

      function createStore() {
        var snapshot = {
          loaded: false,
          loading: false,
          error: '',
          revision: 0,
          state: null,
          banner: false,
          dot: false,
          remindAt: '17:30',
          today: localDateKey(new Date()),
          overlayAvailable: false,
        }
        var listeners = []
        var timer = null
        var subscribers = 0
        var inflight = null
        var lastRefreshAt = 0

        function emit(patch) {
          if (patch) snapshot = Object.assign({}, snapshot, patch)
          listeners.slice().forEach(function (listener) {
            try {
              listener(snapshot)
            } catch (error) {
              /* 单个订阅者异常不影响其他组件 */
            }
          })
        }

        function subscribe(listener) {
          listeners.push(listener)
          return function () {
            var index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          }
        }

        function todayKey() {
          return localDateKey(new Date())
        }

        function recordForToday() {
          var today = todayKey()
          var record = readReminderRecord()
          if (!record || record.date !== today) {
            record = { date: today, lastFired: null, snoozeUntil: 0, snoozeCount: 0, dismissed: false }
            writeReminderRecord(record)
          }
          return record
        }

        function evaluate() {
          var state = snapshot.state
          if (!state || !state.settings) return
          var today = todayKey()
          var record = recordForToday()
          var result = nextReminder({
            remindAt: state.settings.reminderTime,
            lastFired: record.lastFired,
            snoozeUntil: record.snoozeUntil,
            snoozeCount: record.snoozeCount,
            dismissedDate: record.dismissed ? today : null,
            hasDailyToday: Boolean(state.daily),
          }, new Date())
          if (result.fire) {
            record.lastFired = today
            record.snoozeUntil = 0
            writeReminderRecord(record)
            emit({ banner: true, dot: true, remindAt: state.settings.reminderTime || '17:30', today: today })
            return
          }
          if (result.reason === 'snooze-exhausted') {
            record.dismissed = true
            record.snoozeUntil = 0
            writeReminderRecord(record)
          }
          // 提醒条一旦到点就保持可见，直到生成、稍后或「今天不写」把它收掉；
          // 只靠 30 秒轮询的这一次 emit 会让横幅只闪 30 秒。
          var bannerVisible =
            result.reason === 'due' || result.reason === 'snooze-due' || result.reason === 'fired'
          emit({
            banner: bannerVisible,
            dot: bannerVisible || result.reason === 'snoozed',
            remindAt: state.settings.reminderTime || '17:30',
            today: today,
          })
        }

        function refresh() {
          if (inflight) return inflight
          emit({ loading: true })
          var promise = request('/state').then(function (state) {
            lastRefreshAt = Date.now()
            emit({
              state: state,
              loaded: true,
              loading: false,
              error: '',
              revision: snapshot.revision + 1,
              remindAt: (state.settings && state.settings.reminderTime) || '17:30',
            })
            evaluate()
            return state
          }).catch(function (error) {
            emit({ loading: false, error: error && error.message ? error.message : String(error) })
          }).then(function (value) {
            inflight = null
            return value
          })
          inflight = promise
          return promise
        }

        function start() {
          subscribers += 1
          if (subscribers === 1) {
            timer = setInterval(function () {
              refresh()
            }, POLL_MS)
          }
          if (!snapshot.loading && Date.now() - lastRefreshAt > 5000) refresh()
        }

        function stop() {
          subscribers = Math.max(0, subscribers - 1)
          if (subscribers === 0 && timer !== null) {
            clearInterval(timer)
            timer = null
          }
        }

        function snooze() {
          var record = recordForToday()
          if ((Number(record.snoozeCount) || 0) >= MAX_SNOOZE) {
            dismiss()
            return
          }
          record.snoozeCount = (Number(record.snoozeCount) || 0) + 1
          record.snoozeUntil = Date.now() + SNOOZE_MS
          // 清掉 lastFired，否则稍后到点时会被「今天已触发」挡回去。
          record.lastFired = null
          writeReminderRecord(record)
          emit({ banner: false, dot: true })
        }

        function dismiss() {
          var record = recordForToday()
          record.dismissed = true
          record.snoozeUntil = 0
          writeReminderRecord(record)
          emit({ banner: false, dot: false })
        }

        return {
          getSnapshot: function () {
            return snapshot
          },
          subscribe: subscribe,
          refresh: refresh,
          start: start,
          stop: stop,
          snooze: snooze,
          dismiss: dismiss,
          setOverlayAvailable: function (value) {
            if (snapshot.overlayAvailable === Boolean(value)) return
            emit({ overlayAvailable: Boolean(value) })
          },
        }
      }

      function getStore() {
        if (!store) store = createStore()
        return store
      }

      function useEodStore() {
        var pair = useState(getStore().getSnapshot())
        var snapshot = pair[0]
        var setSnapshot = pair[1]
        var current = getStore()
        useEffect(function () {
          current.start()
          var unsubscribe = current.subscribe(setSnapshot)
          setSnapshot(current.getSnapshot())
          return function () {
            unsubscribe()
            current.stop()
          }
        }, [])
        return [snapshot, current]
      }

      /** 生成中按 采集 → 提炼 → 成稿 推进的进度文案。 */
      function useStagedProgress(active, stages) {
        var pair = useState(0)
        var index = pair[0]
        var setIndex = pair[1]
        useEffect(function () {
          if (!active) {
            setIndex(0)
            return
          }
          var timer = setInterval(function () {
            setIndex(function (previous) {
              return Math.min(previous + 1, stages.length - 1)
            })
          }, 3000)
          return function () {
            clearInterval(timer)
          }
        }, [active])
        return stages[Math.min(index, stages.length - 1)]
      }

      var GENERATE_STAGES = ['采集会话…', '提炼日报…', '生成成稿…']
      var WEEK_STAGES = ['汇总日报…', '撰写周报…', '归档写入…']

      // -------------------------------------------------------------------
      // 样式：只用内联样式与半透明灰，亮/暗主题下都不刺眼
      // -------------------------------------------------------------------

      var LINE = 'rgba(127, 127, 127, 0.28)'
      var SOFT = 'rgba(127, 127, 127, 0.10)'
      var MUTED = 'rgba(127, 127, 127, 0.95)'
      var DANGER = '#e5484d'
      var OK = '#2f9e44'

      var STYLES = {
        page: {
          padding: '20px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: '100%',
          boxSizing: 'border-box',
          fontSize: 13,
          lineHeight: 1.6,
        },
        head: { display: 'flex', flexDirection: 'column', gap: 8 },
        title: { margin: 0, fontSize: 16, fontWeight: 600 },
        tabs: { display: 'flex', gap: 4, borderBottom: '1px solid ' + LINE },
        tab: {
          padding: '5px 12px',
          border: 'none',
          borderBottom: '2px solid transparent',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 13,
        },
        tabActive: { borderBottomColor: '#3b82f6', color: '#3b82f6', fontWeight: 600 },
        row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        stack: { display: 'flex', flexDirection: 'column', gap: 10 },
        card: {
          border: '1px solid ' + LINE,
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        },
        label: { color: MUTED, minWidth: 64 },
        field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 },
        input: {
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid ' + LINE,
          background: 'transparent',
          color: 'inherit',
          fontSize: 13,
          fontFamily: 'inherit',
        },
        textarea: {
          width: '100%',
          minHeight: 92,
          padding: 8,
          borderRadius: 6,
          border: '1px solid ' + LINE,
          background: 'transparent',
          color: 'inherit',
          fontSize: 13,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          resize: 'vertical',
        },
        button: {
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid ' + LINE,
          background: SOFT,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 13,
        },
        buttonPrimary: {
          padding: '4px 12px',
          borderRadius: 6,
          border: '1px solid #3b82f6',
          background: '#3b82f6',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 13,
        },
        hint: { color: MUTED, fontSize: 12 },
        notice: { color: OK, fontSize: 12 },
        error: { color: DANGER, fontSize: 12, whiteSpace: 'pre-wrap' },
        statusOk: { color: OK, fontWeight: 600 },
        statusIdle: { color: MUTED },
        code: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          wordBreak: 'break-all',
        },
        drawer: {
          border: '1px solid ' + LINE,
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 340,
          overflowY: 'auto',
        },
        groupTitle: { fontWeight: 600, fontSize: 12 },
        sessionRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
        overlay: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          padding: '12px 16px',
          pointerEvents: 'none',
          zIndex: 9000,
        },
        banner: {
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          maxWidth: 860,
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid ' + LINE,
          background: 'rgba(35, 38, 45, 0.94)',
          color: '#f5f6f8',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
          fontSize: 13,
        },
        bannerText: { marginRight: 4 },
        reminderCard: {
          border: '1px solid ' + LINE,
          borderLeft: '3px solid #3b82f6',
          borderRadius: 8,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: SOFT,
        },
      }

      // -------------------------------------------------------------------
      // 基础组件
      // -------------------------------------------------------------------

      function Field(props) {
        return h('label', { style: STYLES.field },
          h('span', { style: STYLES.label }, props.label),
          h('input', {
            style: STYLES.input,
            type: props.type || 'text',
            value: props.value,
            placeholder: props.placeholder || '',
            onChange: function (event) {
              props.onChange(event.target.value)
            },
          }),
          props.hint ? h('span', { style: STYLES.hint }, props.hint) : null)
      }

      function Check(props) {
        return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', {
            type: 'checkbox',
            checked: Boolean(props.checked),
            onChange: function (event) {
              props.onChange(event.target.checked)
            },
          }),
          h('span', null, props.label),
          props.hint ? h('span', { style: STYLES.hint }, props.hint) : null)
      }

      function SectionField(props) {
        return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('span', { style: { fontWeight: 600 } }, props.label),
          h('textarea', {
            style: STYLES.textarea,
            value: props.value,
            placeholder: props.placeholder || '每行一条',
            onChange: function (event) {
              props.onChange(event.target.value)
            },
          }))
      }

      function ReminderActions(props) {
        var store = props.store
        var snap = props.snap
        var settings = snap.state && snap.state.settings
        var withWeekly = isWeeklyDay(new Date(), settings)
        var busyPair = useState(false)
        var busy = busyPair[0]
        var setBusy = busyPair[1]
        var errorPair = useState('')
        var error = errorPair[0]
        var setError = errorPair[1]

        function generate() {
          if (busy) return
          setBusy(true)
          setError('')
          request('/generate', {
            method: 'POST',
            body: { date: localDateKey(new Date()), withWeekly: withWeekly },
          }).then(function () {
            setBusy(false)
            store.refresh()
          }).catch(function (failure) {
            setBusy(false)
            setError(failure.message)
          })
        }

        return h('div', { style: STYLES.row },
          h('button', {
            type: 'button',
            style: STYLES.buttonPrimary,
            disabled: busy,
            onClick: generate,
          }, busy ? '生成中…' : withWeekly ? '生成日报 + 周报' : '生成日报'),
          h('button', {
            type: 'button',
            style: STYLES.button,
            disabled: busy,
            onClick: function () {
              store.snooze()
            },
          }, '10 分钟后'),
          h('button', {
            type: 'button',
            style: STYLES.button,
            disabled: busy,
            onClick: function () {
              store.dismiss()
            },
          }, '今天不写'),
          error ? h('span', { style: STYLES.error }, error) : null)
      }

      /** 页面内全局提醒条：注册在 shell.overlay 上，页面打开期间始终存在。 */
      function ReminderBanner() {
        var pair = useEodStore()
        var snap = pair[0]
        var store = pair[1]
        useEffect(function () {
          store.setOverlayAvailable(true)
          return function () {
            store.setOverlayAvailable(false)
          }
        }, [])
        if (!snap.banner) return null
        return h('div', { style: STYLES.overlay },
          h('div', { style: STYLES.banner, role: 'status' },
            h('span', { style: STYLES.bannerText }, String(snap.remindAt || '17:30') + ' 了，今天的日报还没生成'),
            h(ReminderActions, { store: store, snap: snap })))
      }

      /** 侧栏入口图标：未生成且到点后显示红点。 */
      function SidebarIcon(props) {
        var pair = useEodStore()
        var snap = pair[0]
        var size = props && props.size ? props.size : 18
        return h('span', {
          style: {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            fontSize: Math.round(size * 0.85),
            lineHeight: 1,
          },
        },
          '📝',
          snap.dot
            ? h('span', {
              'data-eod-dot': '1',
              style: {
                position: 'absolute',
                top: -1,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: DANGER,
              },
            })
            : null)
      }

      // -------------------------------------------------------------------
      // 今日页
      // -------------------------------------------------------------------

      function SourcesDrawer(props) {
        var date = props.date
        var viewPair = useState({ data: null, loading: true, error: '' })
        var view = viewPair[0]
        var setView = viewPair[1]
        var excludedPair = useState({})
        var excluded = excludedPair[0]
        var setExcluded = excludedPair[1]
        var applyPair = useState({ busy: false, notice: '', error: '' })
        var applying = applyPair[0]
        var setApplying = applyPair[1]

        useEffect(function () {
          var cancelled = false
          setView({ data: null, loading: true, error: '' })
          request('/sources?date=' + encodeURIComponent(date)).then(function (data) {
            if (!cancelled) setView({ data: data, loading: false, error: '' })
          }).catch(function (failure) {
            if (!cancelled) setView({ data: null, loading: false, error: failure.message })
          })
          return function () {
            cancelled = true
          }
        }, [date])

        function toggle(session) {
          setExcluded(function (previous) {
            var next = Object.assign({}, previous)
            if (next[session.sessionId]) delete next[session.sessionId]
            else next[session.sessionId] = true
            return next
          })
        }

        function apply() {
          var ids = Object.keys(excluded)
          if (!ids.length) {
            setApplying({ busy: false, notice: '没有需要排除的会话', error: '' })
            return
          }
          setApplying({ busy: true, notice: '', error: '' })
          request('/exclude', { method: 'POST', body: { date: date, sessions: ids } }).then(function () {
            setApplying({ busy: false, notice: '已排除 ' + ids.length + ' 个会话，重新生成以生效', error: '' })
            setExcluded({})
          }).catch(function (failure) {
            setApplying({ busy: false, notice: '', error: failure.message })
          })
        }

        var data = view.data
        var pending = Object.keys(excluded).length
        return h('div', { style: STYLES.drawer },
          h('div', { style: STYLES.row },
            h('strong', null, '来源会话'),
            data ? h('span', { style: STYLES.hint }, '覆盖 ' + data.coverage.sessions + ' 个会话 / ' + data.coverage.messages + ' 条消息') : null,
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              style: STYLES.button,
              disabled: applying.busy || pending === 0,
              onClick: apply,
            }, applying.busy ? '应用中…' : '应用排除' + (pending ? '（' + pending + '）' : '')),
            h('button', {
              type: 'button',
              style: STYLES.button,
              onClick: props.onClose,
            }, '收起')),
          view.loading ? h('div', { style: STYLES.hint }, '正在扫描当天会话…') : null,
          view.error ? h('div', { style: STYLES.error }, view.error) : null,
          data && data.groups.length === 0
            ? h('div', { style: STYLES.hint }, '今天没有可汇总的会话')
            : null,
          data
            ? data.groups.map(function (group) {
              return h('div', { key: group.project || group.cwd || 'group', style: STYLES.card },
                h('div', { style: STYLES.groupTitle }, group.project || group.cwd || '未命名项目'),
                group.sessions.map(function (session) {
                  var removed = Boolean(excluded[session.sessionId])
                  var locked = session.selected === false
                  return h('label', { key: session.sessionId, style: STYLES.sessionRow },
                    h('input', {
                      type: 'checkbox',
                      checked: !locked && !removed,
                      disabled: locked,
                      title: locked ? '已在排除列表，如需恢复请到设置页清理' : '',
                      onChange: function () {
                        toggle(session)
                      },
                    }),
                    h('span', { style: { flex: 1, wordBreak: 'break-all' } }, session.title || session.sessionId),
                    h('span', { style: STYLES.hint }, (formatHHmm(session.time) || '') + ' · ' + session.messages + ' 条消息'))
                }))
            })
            : null,
          pending ? h('div', { style: STYLES.hint }, '勾选变更后点「应用排除」，重新生成以生效') : null,
          applying.notice ? h('div', { style: STYLES.notice }, applying.notice) : null,
          applying.error ? h('div', { style: STYLES.error }, applying.error) : null)
      }

      function DailyTab(props) {
        var store = props.store
        var snap = props.snap
        var date = props.date
        var todayKeyOfStore = snap.state ? snap.state.date : ''
        var todayReport = snap.state && snap.state.date === date ? snap.state.daily : null
        var todayStamp = todayReport
          ? String(todayReport.date) + '|' + String(todayReport.generatedAt) + '|' + String(todayReport.editedAt)
          : 'today-empty'

        var viewPair = useState({ date: null, daily: null, loading: false, error: '' })
        var view = viewPair[0]
        var setView = viewPair[1]
        var reloadPair = useState(0)
        var reload = reloadPair[0]
        var bumpReload = reloadPair[1]

        useEffect(function () {
          if (!date) return
          if (todayKeyOfStore === date) {
            setView({ date: date, daily: todayReport, loading: false, error: '' })
            return
          }
          var cancelled = false
          setView({ date: date, daily: null, loading: true, error: '' })
          request('/state?date=' + encodeURIComponent(date)).then(function (data) {
            if (!cancelled) setView({ date: date, daily: data.daily, loading: false, error: '' })
          }).catch(function (failure) {
            if (!cancelled) setView({ date: date, daily: null, loading: false, error: failure.message })
          })
          return function () {
            cancelled = true
          }
        }, [date, todayKeyOfStore, todayStamp, reload])

        var report = view.date === date ? view.daily : null
        var reportStamp = report
          ? String(report.date) + '|' + String(report.generatedAt) + '|' + String(report.editedAt)
          : 'empty:' + date
        var formPair = useState({ done: '', risks: '', tomorrow: '' })
        var form = formPair[0]
        var setForm = formPair[1]
        var busyPair = useState('')
        var busy = busyPair[0]
        var setBusy = busyPair[1]
        var noticePair = useState('')
        var notice = noticePair[0]
        var setNotice = noticePair[1]
        var errorPair = useState('')
        var error = errorPair[0]
        var setError = errorPair[1]
        var emptyPair = useState(false)
        var empty = emptyPair[0]
        var setEmpty = emptyPair[1]
        var sourcesPair = useState(false)
        var sourcesOpen = sourcesPair[0]
        var setSourcesOpen = sourcesPair[1]
        var stage = useStagedProgress(busy === 'generate', GENERATE_STAGES)

        useEffect(function () {
          var draft = dailyToDraft(report)
          setForm({ done: draft.done.join('\n'), risks: draft.risks.join('\n'), tomorrow: draft.tomorrow.join('\n') })
          setEmpty(false)
        }, [reportStamp])

        function afterWrite() {
          if (todayKeyOfStore === date) store.refresh()
          else bumpReload(function (value) {
            return value + 1
          })
        }

        function generate() {
          if (busy) return
          setBusy('generate')
          setError('')
          setNotice('')
          setEmpty(false)
          request('/generate', { method: 'POST', body: { date: date } }).then(function (data) {
            setBusy('')
            setNotice('已生成 ' + (formatHHmm(data.daily && data.daily.generatedAt) || '') + '，写入 ' + ((data.paths && data.paths.markdown) || (data.paths && data.paths.json) || '报告目录'))
            afterWrite()
          }).catch(function (failure) {
            setBusy('')
            if (failure.code === 'E_NO_SESSIONS') setEmpty(true)
            else setError(failure.message)
          })
        }

        function save() {
          if (busy) return
          setBusy('save')
          setError('')
          setNotice('')
          request('/draft', {
            method: 'PUT',
            body: { kind: 'daily', date: date, sections: formToSections(form, 'daily') },
          }).then(function () {
            setBusy('')
            setNotice('草稿已保存')
            afterWrite()
          }).catch(function (failure) {
            setBusy('')
            setError(failure.message)
          })
        }

        function copy() {
          var text = copyDailyText(formToSections(form, 'daily'))
          copyToClipboard(text).then(function () {
            setNotice('已复制到剪贴板（纯文本）')
          }).catch(function (failure) {
            setError('复制失败：' + failure.message)
          })
        }

        function download() {
          requestText('/download?kind=daily&date=' + encodeURIComponent(date)).then(function (text) {
            downloadText('日报-' + date + '.md', text)
            setNotice('已开始下载 ' + date + '.md')
          }).catch(function (failure) {
            setError(failure.message)
          })
        }

        var settings = snap.state && snap.state.settings
        var writeMarkdown = !settings || settings.writeMarkdown !== false
        var targetPath = !snap.state
          ? ''
          : writeMarkdown
            ? joinDisplayPath(snap.state.outputDir, date + '.md')
            : '仅保存 JSON（未开启写 Markdown）'
        var status = report
          ? '已生成 ' + (formatHHmm(report.generatedAt) || '—')
          : view.loading ? '读取中…' : '未生成'

        return h('div', { style: STYLES.stack },
          h('div', { style: STYLES.row },
            h('span', { style: STYLES.label }, '日期'),
            h('select', {
              style: STYLES.input,
              value: date,
              onChange: function (event) {
                props.onDate(event.target.value)
              },
            }, recentDates(new Date()).map(function (key) {
              return h('option', { key: key, value: key }, dateOptionLabel(key))
            })),
            h('span', { style: report ? STYLES.statusOk : STYLES.statusIdle }, status),
            h('button', {
              type: 'button',
              style: STYLES.buttonPrimary,
              disabled: busy !== '',
              onClick: generate,
            }, busy === 'generate' ? '生成中：' + stage : '生成日报'),
            h('button', {
              type: 'button',
              style: STYLES.button,
              disabled: !report || busy !== '',
              onClick: copy,
            }, '复制'),
            h('button', {
              type: 'button',
              style: STYLES.button,
              disabled: !report || busy !== '',
              onClick: download,
            }, '下载 .md')),
          targetPath ? h('div', { style: STYLES.code }, targetPath) : null,
          notice ? h('div', { style: STYLES.notice }, notice) : null,
          error ? h('div', { style: STYLES.error }, error) : null,
          snap.banner && !snap.overlayAvailable
            ? h('div', { style: STYLES.reminderCard },
              h('strong', null, String(snap.remindAt || '17:30') + ' 了，今天的日报还没生成'),
              h(ReminderActions, { store: store, snap: snap }))
            : null,
          empty
            ? h('div', { style: STYLES.card },
              h('strong', null, '今天没有可汇总的会话'),
              h('span', { style: STYLES.hint }, '仍可以在下面手写三节内容并先复制出去；保存草稿需要先生成日报。'))
            : null,
          report
            ? h('div', { style: STYLES.hint },
              '覆盖 ' + report.coverage.sessions + ' 个会话 / ' + report.coverage.messages + ' 条消息' +
              (report.coverage.truncated ? '（两段式生成）' : '') +
              ' · 模型 ' + ((report.model && report.model.provider) || '') + '/' + ((report.model && report.model.model) || ''))
            : null,
          h('div', { style: STYLES.card },
            h(SectionField, {
              label: '今日完成',
              value: form.done,
              placeholder: '每行一条，例如：修复登录超时',
              onChange: function (value) {
                setForm(Object.assign({}, form, { done: value }))
              },
            }),
            h(SectionField, {
              label: '问题与风险',
              value: form.risks,
              placeholder: '每行一条，没有可留空',
              onChange: function (value) {
                setForm(Object.assign({}, form, { risks: value }))
              },
            }),
            h(SectionField, {
              label: '明日计划',
              value: form.tomorrow,
              placeholder: '每行一条，没有可留空',
              onChange: function (value) {
                setForm(Object.assign({}, form, { tomorrow: value }))
              },
            }),
            h('div', { style: STYLES.row },
              h('button', {
                type: 'button',
                style: STYLES.buttonPrimary,
                disabled: !report || busy !== '',
                onClick: save,
              }, busy === 'save' ? '保存中…' : '保存草稿'),
              h('button', {
                type: 'button',
                style: STYLES.button,
                disabled: busy !== '',
                onClick: function () {
                  setSourcesOpen(!sourcesOpen)
                },
              }, sourcesOpen ? '收起来源' : '查看来源'),
              h('span', { style: STYLES.hint }, report ? '编辑后保存会更新日报 JSON，Markdown 需要重新生成' : '当天还没有日报：先生成后才能保存草稿，现在可以先手写并复制'))),
          sourcesOpen ? h(SourcesDrawer, { date: date, onClose: function () { setSourcesOpen(false) } }) : null)
      }

      // -------------------------------------------------------------------
      // 本周页
      // -------------------------------------------------------------------

      function WeekTab(props) {
        var store = props.store
        var snap = props.snap
        var today = snap.state ? snap.state.date : localDateKey(new Date())
        var week = snap.state ? snap.state.week : isoWeek(new Date())
        var weekly = snap.state ? snap.state.weekly : null
        var dates = weekDates(parseDateKey(today) || new Date())
        var statusPair = useState(null)
        var statuses = statusPair[0]
        var setStatuses = statusPair[1]
        var weeklyStamp = weekly
          ? String(weekly.week) + '|' + String(weekly.generatedAt) + '|' + String(weekly.editedAt)
          : 'weekly-empty'
        var formPair = useState({ done: '', risks: '', next: '' })
        var form = formPair[0]
        var setForm = formPair[1]
        var busyPair = useState('')
        var busy = busyPair[0]
        var setBusy = busyPair[1]
        var noticePair = useState('')
        var notice = noticePair[0]
        var setNotice = noticePair[1]
        var errorPair = useState('')
        var error = errorPair[0]
        var setError = errorPair[1]
        var archivePair = useState(function () { return archiveFromState(snap.state) })
        var archive = archivePair[0]
        var setArchive = archivePair[1]
        var stage = useStagedProgress(busy === 'week', WEEK_STAGES)

        // 刷新或宿主状态更新后，用 /state 的归档状态重新初始化本周页。
        useEffect(function () {
          setArchive(archiveFromState(snap.state))
        }, [snap.revision])

        useEffect(function () {
          var cancelled = false
          setStatuses(null)
          Promise.all(dates.map(function (date) {
            return request('/state?date=' + encodeURIComponent(date)).then(function (data) {
              return { date: date, daily: data.daily }
            }).catch(function () {
              return { date: date, daily: null }
            })
          })).then(function (list) {
            if (!cancelled) setStatuses(list)
          })
          return function () {
            cancelled = true
          }
        }, [week, weeklyStamp])

        useEffect(function () {
          var draft = weeklyToDraft(weekly)
          setForm({ done: draft.done.join('\n'), risks: draft.risks.join('\n'), next: draft.next.join('\n') })
        }, [weeklyStamp])

        function generate() {
          if (busy) return
          setBusy('week')
          setError('')
          setNotice('')
          request('/generate-week', { method: 'POST', body: { week: week } }).then(function (data) {
            setBusy('')
            setArchive(archiveFromState(data))
            var missing = data.weekly && data.weekly.missingDays ? data.weekly.missingDays.length : 0
            setNotice('周报已生成' + (missing ? '，缺 ' + missing + ' 天日报' : '') + '，写入 ' + ((data.paths && data.paths.markdown) || (data.paths && data.paths.json) || '报告目录'))
            store.refresh()
          }).catch(function (failure) {
            setBusy('')
            setError(failure.message)
          })
        }

        function save() {
          if (busy) return
          setBusy('save')
          setError('')
          setNotice('')
          request('/draft', {
            method: 'PUT',
            body: { kind: 'weekly', week: week, sections: formToSections(form, 'weekly') },
          }).then(function () {
            setBusy('')
            setNotice('周报草稿已保存')
            store.refresh()
          }).catch(function (failure) {
            setBusy('')
            setError(failure.message)
          })
        }

        function copy() {
          copyToClipboard(copyWeeklyText(formToSections(form, 'weekly'))).then(function () {
            setNotice('已复制到剪贴板（纯文本）')
          }).catch(function (failure) {
            setError('复制失败：' + failure.message)
          })
        }

        function download() {
          requestText('/download?kind=weekly&week=' + encodeURIComponent(week)).then(function (text) {
            downloadText('周报-' + week + '.md', text)
            setNotice('已开始下载 ' + week + '-周报.md')
          }).catch(function (failure) {
            setError(failure.message)
          })
        }

        function commit() {
          if (busy) return
          setBusy('commit')
          setError('')
          setNotice('')
          request('/commit', { method: 'POST', body: { week: week } }).then(function (data) {
            setBusy('')
            var nextArchive = archiveFromState(data)
            setArchive(nextArchive)
            setNotice(archiveText(nextArchive))
            // 让 /state 也带上刚回写的 archive，其它订阅者（今日页/横幅）同步刷新。
            store.refresh()
          }).catch(function (failure) {
            setBusy('')
            setError(failure.message)
          })
        }

        var missing = weekly && weekly.missingDays ? weekly.missingDays : []

        return h('div', { style: STYLES.stack },
          h('div', { style: STYLES.row },
            h('strong', null, week + ' 周报'),
            h('span', { style: STYLES.hint }, '周一至周五，仅汇总已生成的日报'),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              style: STYLES.buttonPrimary,
              disabled: busy !== '',
              onClick: generate,
            }, busy === 'week' ? '生成中：' + stage : '生成本周周报')),
          h('div', { style: STYLES.card },
            h('div', { style: STYLES.groupTitle }, '工作日状态'),
            statuses === null
              ? h('div', { style: STYLES.hint }, '读取中…')
              : statuses.map(function (item) {
                return h('div', { key: item.date, style: STYLES.row },
                  h('span', { style: { width: 92 } }, dateOptionLabel(item.date)),
                  item.daily
                    ? h('span', { style: STYLES.statusOk }, '已生成 ' + (formatHHmm(item.daily.generatedAt) || '—'))
                    : h('button', {
                      type: 'button',
                      style: Object.assign({}, STYLES.button, { padding: '0 6px' }),
                      onClick: function () {
                        props.onOpenDate(item.date)
                      },
                    }, '未生成'),
                  h('span', { style: STYLES.hint }, item.daily ? '编辑请到今日页选该日期' : '点击跳到该日生成'))
              }),
            missing.length ? h('div', { style: STYLES.hint }, '缺失 ' + missing.length + ' 天：' + missing.join('、')) : null),
          notice ? h('div', { style: STYLES.notice }, notice) : null,
          error ? h('div', { style: STYLES.error }, error) : null,
          weekly
            ? h('div', { style: STYLES.card },
              h('div', { style: STYLES.hint },
                '覆盖 ' + (weekly.days ? weekly.days.length : 0) + ' 天 · 缺 ' + missing.length + ' 天 · 生成于 ' + (formatHHmm(weekly.generatedAt) || '—')),
              h(SectionField, {
                label: '本周完成',
                value: form.done,
                onChange: function (value) {
                  setForm(Object.assign({}, form, { done: value }))
                },
              }),
              h(SectionField, {
                label: '问题与风险',
                value: form.risks,
                onChange: function (value) {
                  setForm(Object.assign({}, form, { risks: value }))
                },
              }),
              h(SectionField, {
                label: '下周计划',
                value: form.next,
                onChange: function (value) {
                  setForm(Object.assign({}, form, { next: value }))
                },
              }),
              h('div', { style: STYLES.row },
                h('button', {
                  type: 'button',
                  style: STYLES.buttonPrimary,
                  disabled: busy !== '',
                  onClick: save,
                }, busy === 'save' ? '保存中…' : '保存草稿'),
                h('button', {
                  type: 'button',
                  style: STYLES.button,
                  disabled: busy !== '',
                  onClick: copy,
                }, '复制'),
                h('button', {
                  type: 'button',
                  style: STYLES.button,
                  disabled: busy !== '',
                  onClick: download,
                }, '下载 .md')))
            : h('div', { style: STYLES.card },
              h('div', { style: STYLES.hint }, '本周还没有周报。生成后会写入 Markdown，并按设置决定是否本地提交。')),
          h('div', { style: STYLES.card },
            h('div', { style: STYLES.row },
              h('span', { style: STYLES.label }, '归档'),
              h('span', { style: archive && archive.committed ? STYLES.statusOk : STYLES.statusIdle }, archiveText(archive)),
              h('span', { style: { flex: 1 } }),
              h('button', {
                type: 'button',
                style: STYLES.button,
                disabled: busy !== '',
                onClick: commit,
              }, busy === 'commit' ? '提交中…' : '本地提交')),
            h('div', { style: STYLES.hint }, '只提交工作日志目录，不推送远端；目录不在 Git 仓库时会跳过。')))
      }

      // -------------------------------------------------------------------
      // 设置页
      // -------------------------------------------------------------------

      function SettingsTab(props) {
        var store = props.store
        var snap = props.snap
        var settings = snap.state ? snap.state.settings : null
        var resolvedOutputDir = snap.state ? snap.state.outputDirResolved : ''
        var formPair = useState(null)
        var form = formPair[0]
        var setForm = formPair[1]
        var busyPair = useState('')
        var busy = busyPair[0]
        var setBusy = busyPair[1]
        var noticePair = useState('')
        var notice = noticePair[0]
        var setNotice = noticePair[1]
        var errorPair = useState('')
        var error = errorPair[0]
        var setError = errorPair[1]
        var discoveredPair = useState([])
        var discovered = discoveredPair[0]
        var setDiscovered = discoveredPair[1]
        var scanPair = useState({ busy: false, notice: '', error: '' })
        var scanning = scanPair[0]
        var setScanning = scanPair[1]
        var sessionOptionsPair = useState({
          date: localDateKey(new Date()),
          sessions: null,
          loading: false,
          error: '',
        })
        var sessionOptions = sessionOptionsPair[0]
        var setSessionOptions = sessionOptionsPair[1]

        useEffect(function () {
          if (form === null && settings) setForm(settingsToForm(settings))
        }, [settings, form])

        if (!settings || form === null) {
          return h('div', { style: STYLES.hint }, snap.loading ? '正在读取设置…' : '设置尚未加载')
        }

        var cwdOptions = []
        var dailySources = snap.state && snap.state.daily ? snap.state.daily.sources : null
        if (Array.isArray(dailySources)) {
          dailySources.forEach(function (item) {
            if (item && typeof item.cwd === 'string' && item.cwd) cwdOptions.push(item.cwd)
          })
        }
        discovered.concat(linesOf(form.excludedProjects)).forEach(function (cwd) {
          if (cwd && cwdOptions.indexOf(cwd) < 0) cwdOptions.push(cwd)
        })

        var excludedIds = linesOf(form.excludedSessions)
        var loadedIds = {}
        if (Array.isArray(sessionOptions.sessions)) {
          sessionOptions.sessions.forEach(function (item) {
            if (item && item.id) loadedIds[item.id] = true
          })
        }
        var orphanExcluded = excludedIds.filter(function (id) {
          return !loadedIds[id]
        })

        function toggleCwd(cwd) {
          var current = linesOf(form.excludedProjects)
          var index = current.indexOf(cwd)
          if (index >= 0) current.splice(index, 1)
          else current.push(cwd)
          update({ excludedProjects: current.join('\n') })
        }

        function scanCwds() {
          if (scanning.busy) return
          setScanning({ busy: true, notice: '', error: '' })
          var timer = null
          var timeout = new Promise(function (resolve, reject) {
            timer = setTimeout(function () {
              reject(new Error('扫描超时，请手动填写或稍后重试'))
            }, 15000)
          })
          Promise.race([request('/workspaces?days=7'), timeout]).then(function (data) {
            if (timer) clearTimeout(timer)
            var found = (data && Array.isArray(data.cwds) ? data.cwds : []).filter(function (cwd) {
              return typeof cwd === 'string' && cwd.length > 0
            })
            setDiscovered(function (previous) {
              var merged = previous.slice()
              found.forEach(function (cwd) {
                if (merged.indexOf(cwd) < 0) merged.push(cwd)
              })
              return merged
            })
            setScanning({
              busy: false,
              notice: found.length ? '找到 ' + found.length + ' 个工作区' : '最近 7 天没有扫描到工作区',
              error: '',
            })
          }, function (failure) {
            if (timer) clearTimeout(timer)
            setScanning({ busy: false, notice: '', error: failure.message })
          })
        }

        function loadSessions() {
          if (sessionOptions.loading || !sessionOptions.date) return
          var requestedDate = sessionOptions.date
          setSessionOptions(Object.assign({}, sessionOptions, { loading: true, error: '' }))
          var timer = null
          var timeout = new Promise(function (resolve, reject) {
            timer = setTimeout(function () {
              reject(new Error('加载超时，请稍后重试'))
            }, 30000)
          })
          Promise.race([
            request('/session-options?date=' + encodeURIComponent(requestedDate)),
            timeout,
          ]).then(function (data) {
            if (timer) clearTimeout(timer)
            setSessionOptions({
              date: requestedDate,
              sessions: Array.isArray(data.sessions) ? data.sessions : [],
              loading: false,
              error: '',
            })
          }, function (failure) {
            if (timer) clearTimeout(timer)
            setSessionOptions({ date: requestedDate, sessions: null, loading: false, error: failure.message })
          })
        }

        function toggleSession(id) {
          var current = linesOf(form.excludedSessions)
          var index = current.indexOf(id)
          if (index >= 0) current.splice(index, 1)
          else current.push(id)
          update({ excludedSessions: current.join('\n') })
        }

        function update(patch) {
          setForm(Object.assign({}, form, patch))
        }

        function save(event) {
          if (event && event.preventDefault) event.preventDefault()
          if (busy) return
          setBusy('save')
          setError('')
          setNotice('')
          request('/settings', { method: 'PUT', body: formToSettings(form, settings) }).then(function (data) {
            setBusy('')
            setNotice('设置已保存')
            setForm(settingsToForm(data.settings))
            store.refresh()
          }).catch(function (failure) {
            setBusy('')
            setError(failure.message)
          })
        }

        return h('form', { style: STYLES.stack, onSubmit: save },
          h('div', { style: STYLES.card },
            h('div', { style: STYLES.row },
              h(Field, {
                label: '提醒时间',
                type: 'time',
                value: form.reminderTime,
                hint: 'HH:mm，仅在页面打开时生效',
                onChange: function (value) {
                  update({ reminderTime: value })
                },
              }),
              h('label', { style: STYLES.field },
                h('span', { style: STYLES.label }, '周报星期'),
                h('select', {
                  style: STYLES.input,
                  value: form.weeklyDay,
                  onChange: function (event) {
                    update({ weeklyDay: event.target.value })
                  },
                }, ['1', '2', '3', '4', '5', '6', '7'].map(function (day) {
                  return h('option', { key: day, value: day }, WEEKDAYS[Number(day) - 1])
                })))),
            h(Field, {
              label: '模型',
              value: form.model,
              placeholder: 'deepseek-official/deepseek-flash',
              hint: 'provider/model 两段，用 / 分隔',
              onChange: function (value) {
                update({ model: value })
              },
            }),
            h(Field, {
              label: '输出目录',
              value: form.outputDir,
              placeholder: IS_WINDOWS ? 'C:\\Users\\你\\日报' : '~/日报',
              hint: '支持 ~、$HOME、%USERPROFILE% 与绝对路径；相对路径按用户目录解析'
                + (resolvedOutputDir && form && settings && form.outputDir === settings.outputDir
                  ? ' · 实际：' + resolvedOutputDir
                  : ''),
              onChange: function (value) {
                update({ outputDir: value })
              },
            }),
            h('div', { style: STYLES.row },
              h(Check, {
                label: '写 Markdown',
                checked: form.writeMarkdown,
                hint: '关闭后只存 JSON',
                onChange: function (value) {
                  update({ writeMarkdown: value })
                },
              }),
              h(Check, {
                label: '周报后本地提交',
                checked: form.weeklyCommit,
                hint: '只 commit 不 push',
                onChange: function (value) {
                  update({ weeklyCommit: value })
                },
              }),
              h(Check, {
                label: '数据清理',
                checked: form.cleanupEnabled,
                hint: '启动时清理 365 天前的报告',
                onChange: function (value) {
                  update({ cleanupEnabled: value })
                },
              }))),
          h('div', { style: STYLES.card },
            h('div', { style: STYLES.row },
              h('span', { style: { fontWeight: 600 } }, '排除的工作区（多选）'),
              h('button', {
                type: 'button',
                style: STYLES.button,
                disabled: scanning.busy,
                onClick: scanCwds,
              }, scanning.busy ? '扫描中…' : '扫描最近 7 天'),
              scanning.notice ? h('span', { style: STYLES.notice }, scanning.notice) : null,
              scanning.error ? h('span', { style: STYLES.error }, scanning.error) : null),
            h('div', { style: STYLES.hint }, '勾选后保存即可排除；选项来自今日日报来源与手动维护列表。'),
            cwdOptions.length
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, cwdOptions.map(function (cwd) {
                return h('label', { key: cwd, style: STYLES.sessionRow },
                  h('input', {
                    type: 'checkbox',
                    checked: linesOf(form.excludedProjects).indexOf(cwd) >= 0,
                    onChange: function () {
                      toggleCwd(cwd)
                    },
                  }),
                  h('span', { style: { wordBreak: 'break-all' } }, cwd))
              }))
              : h('div', { style: STYLES.hint }, '还没有可选工作区，可点「扫描最近 7 天」或直接手填。'),
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('span', { style: { fontWeight: 600 } }, '手动维护（每行一个 cwd）'),
              h('textarea', {
                style: Object.assign({}, STYLES.textarea, { minHeight: 64 }),
                value: form.excludedProjects,
                placeholder: '每行一个 cwd，例如 /home/user/comic',
                onChange: function (event) {
                  update({ excludedProjects: event.target.value })
                },
              }),
              h('span', { style: STYLES.hint }, '这些工作区的会话不会进入日报；采集时按前缀匹配。')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: STYLES.row },
                h('span', { style: { fontWeight: 600 } }, '排除的会话'),
                h('input', {
                  type: 'date',
                  style: Object.assign({}, STYLES.input, { width: 160 }),
                  value: sessionOptions.date,
                  disabled: sessionOptions.loading,
                  onChange: function (event) {
                    setSessionOptions({
                      date: event.target.value,
                      sessions: null,
                      loading: false,
                      error: '',
                    })
                  },
                }),
                h('button', {
                  type: 'button',
                  style: STYLES.button,
                  disabled: sessionOptions.loading || !sessionOptions.date,
                  onClick: loadSessions,
                }, sessionOptions.loading ? '加载中…' : '加载当天会话')),
              h('span', { style: STYLES.hint }, '按标题和时间勾选，勾上即排除，取消即恢复；不用填写 Session ID。'),
              sessionOptions.error ? h('span', { style: STYLES.error }, sessionOptions.error) : null,
              sessionOptions.sessions === null
                ? h('span', { style: STYLES.hint }, '选好日期后点「加载当天会话」。')
                : (sessionOptions.sessions.length === 0
                  ? h('span', { style: STYLES.hint }, '这一天没有可选的会话。')
                  : h('div', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      maxHeight: 220,
                      overflowY: 'auto',
                    },
                  }, sessionOptions.sessions.map(function (session) {
                    var checked = linesOf(form.excludedSessions).indexOf(session.id) >= 0
                    var project = String(session.cwd || '').split('/').filter(Boolean).pop() || session.cwd || ''
                    return h('label', { key: session.id, style: STYLES.sessionRow },
                      h('input', {
                        type: 'checkbox',
                        checked: checked,
                        onChange: function () {
                          toggleSession(session.id)
                        },
                      }),
                      h('span', { style: { flex: 1, wordBreak: 'break-all' } },
                        session.title || '(无标题会话)'),
                      h('span', { style: STYLES.hint },
                        formatHHmm(session.firstTime || 0) + ' · ' + session.messages + ' 条 · ' + project))
                  }))),
              orphanExcluded.length && sessionOptions.sessions !== null
                ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                  h('span', { style: STYLES.hint }, '其他已排除：'),
                  orphanExcluded.map(function (id) {
                    return h('button', {
                      key: id,
                      type: 'button',
                      style: Object.assign({}, STYLES.button, { padding: '2px 6px', fontSize: 12 }),
                      title: id,
                      onClick: function () {
                        toggleSession(id)
                      },
                    }, id.slice(0, 10) + '… 移除')
                  }))
                : null)),
          h('div', { style: STYLES.row },
            h('button', {
              type: 'submit',
              style: STYLES.buttonPrimary,
              disabled: busy !== '',
            }, busy === 'save' ? '保存中…' : '保存设置'),
            notice ? h('span', { style: STYLES.notice }, notice) : null,
            error ? h('span', { style: STYLES.error }, error) : null),
          h('div', { style: STYLES.hint }, '提醒只在页面打开时生效：关闭页面后不会再检查提醒时间，也不会弹系统通知。'),
          h('div', { style: STYLES.hint }, '设置保存在宿主 settings.json，保存后立即生效，不需要重启。'))
      }

      function SettingsSection() {
        var pair = useEodStore()
        return h('div', { style: { maxWidth: 760 } }, h(SettingsTab, { store: pair[1], snap: pair[0] }))
      }

      // -------------------------------------------------------------------
      // 主面板与注册
      // -------------------------------------------------------------------

      var TABS = [
        { id: 'today', label: '今日' },
        { id: 'week', label: '本周' },
        { id: 'settings', label: '设置' },
      ]

      function Panel() {
        var pair = useEodStore()
        var snap = pair[0]
        var store = pair[1]
        var tabPair = useState('today')
        var tab = tabPair[0]
        var setTab = tabPair[1]
        var datePair = useState(null)
        var pickedDate = datePair[0]
        var setPickedDate = datePair[1]
        var today = snap.state ? snap.state.date : localDateKey(new Date())
        var date = pickedDate || today

        function openDate(next) {
          setPickedDate(next)
          setTab('today')
        }

        return h('div', { style: STYLES.page },
          h('div', { style: STYLES.head },
            h('h2', { style: STYLES.title }, '下班日报'),
            h('div', { style: STYLES.hint }, '把当天会话整理成日报并留在本地；周报只汇总工作日已生成的日报。'),
            h('div', { style: STYLES.tabs }, TABS.map(function (item) {
              return h('button', {
                key: item.id,
                type: 'button',
                style: item.id === tab ? Object.assign({}, STYLES.tab, STYLES.tabActive) : STYLES.tab,
                onClick: function () {
                  setTab(item.id)
                },
              }, item.label)
            }))),
          snap.error ? h('div', { style: STYLES.error }, '宿主接口错误：' + snap.error) : null,
          tab === 'today'
            ? h(DailyTab, { store: store, snap: snap, date: date, onDate: setPickedDate })
            : tab === 'week'
              ? h(WeekTab, { store: store, snap: snap, onOpenDate: openDate })
              : h(SettingsTab, { store: store, snap: snap }))
      }

      exports.name = ID + '-client'
      // 客户端只依赖 slots 服务；数据与文案都在本文件内自带。
      exports.inject = ['slots']

      exports.apply = function (ctx) {
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: ID,
            order: 4,
            label: function () {
              return '下班日报'
            },
          }, SidebarIcon)
        })
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: ID }, Panel)
        })
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: ID,
            order: 40,
            label: function () {
              return '下班日报'
            },
          }, SettingsSection)
        })
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({ name: 'shell.overlay', id: ID + '-reminder' }, ReminderBanner)
        })
      }

      module.exports.__test = {
        nextReminder: nextReminder,
        dailyToDraft: dailyToDraft,
        weeklyToDraft: weeklyToDraft,
        localDateKey: localDateKey,
        parseDateKey: parseDateKey,
        parseRemindAt: parseRemindAt,
        isoWeek: isoWeek,
        weekDates: weekDates,
        recentDates: recentDates,
        dateOptionLabel: dateOptionLabel,
        formatHHmm: formatHHmm,
        isWeeklyDay: isWeeklyDay,
        copyDailyText: copyDailyText,
        copyWeeklyText: copyWeeklyText,
        settingsToForm: settingsToForm,
        formToSettings: formToSettings,
        formToSections: formToSections,
        archiveReason: archiveReason,
        archiveFromState: archiveFromState,
        archiveText: archiveText,
        shortHash: shortHash,
        MAX_SNOOZE: MAX_SNOOZE,
      }

      return module.exports
    },
  })
})()
