import type { Sections } from './types.js'

function ordered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

function unordered(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

/**
 * 复制用的纯文本：固定标签 + 有序列表，无 Markdown 标记。
 * 空节保留标签，其下不输出条目（也不留空行）。
 */
export function copyText(sections: Sections, kind: 'daily' | 'weekly'): string {
  const labels = kind === 'daily'
    ? { done: '今日完成', risks: '问题与风险', third: '明日计划' }
    : { done: '本周完成', risks: '问题与风险', third: '下周计划' }
  const third = kind === 'daily' ? sections.tomorrow ?? [] : sections.next ?? []
  return [
    labels.done,
    ordered(sections.done),
    labels.risks,
    ordered(sections.risks),
    labels.third,
    ordered(third),
  ].filter((block) => block !== '').join('\n')
}

function markdownSection(title: string, items: string[]): string {
  const bullets = unordered(items)
  return bullets ? `## ${title}\n${bullets}` : `## ${title}`
}

/** 日报 Markdown：标题 + 无序列表，空节保留标题。 */
export function dailyMarkdown(report: { date: string; sections: Sections }): string {
  const sections = report.sections
  return [
    `# ${report.date} 日报`,
    markdownSection('今日完成', sections.done),
    markdownSection('问题与风险', sections.risks),
    markdownSection('明日计划', sections.tomorrow ?? []),
  ].join('\n\n').concat('\n')
}

/** 周报 Markdown：标题 + 无序列表，空节保留标题。 */
export function weeklyMarkdown(report: { week: string; sections: Sections }): string {
  const sections = report.sections
  return [
    `# ${report.week} 周报`,
    markdownSection('本周完成', sections.done),
    markdownSection('问题与风险', sections.risks),
    markdownSection('下周计划', sections.next ?? []),
  ].join('\n\n').concat('\n')
}
