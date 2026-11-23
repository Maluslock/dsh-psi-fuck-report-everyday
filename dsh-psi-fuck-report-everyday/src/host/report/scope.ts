import type { DailyReport, Sections } from '../types.js'

/**
 * 工作范围硬过滤：提示词只能降低概率，这里对模型输出再做一次确定性拦截。
 * 宁可少写一条，也不让个人设备、家庭网络相关内容进入公司日报/周报。
 */
const PERSONAL_PATTERNS: readonly RegExp[] = [
  /(^|[^A-Za-z0-9])NAS([^A-Za-z0-9]|$)/i,
  /群晖|Synology/i,
  /软路由|OpenWrt|iKuai|爱快/i,
  /Tailscale|Headscale|NetBird|ZeroTier|OpenVPN/i,
  /(^|[^A-Za-z0-9])frp([^A-Za-z0-9]|$)/i,
  /RustDesk/i,
  /(^|[^A-Za-z0-9])VPN([^A-Za-z0-9]|$)/i,
  /家庭|家里|家用|个人设备|私人设备|自用设备|个人电脑|个人手机/,
  /家庭宽带|家用宽带/,
  /个人(账号|账户|订阅|邮箱|网盘|存储|服务器|网络)|私人(账号|账户|订阅|网盘)/,
  /自己的?(设备|电脑|手机|服务器|网络)|自购|自费/,
]

export function isPersonalText(text: string): boolean {
  return PERSONAL_PATTERNS.some((pattern) => pattern.test(text))
}

function keepWorkItems(items: string[] | undefined): string[] | undefined {
  if (items === undefined) return undefined
  return items.filter((item) => !isPersonalText(item))
}

/** 过滤三节中的个人内容；空数组保留，交给上层决定如何展示。 */
export function filterSections(sections: Sections): Sections {
  const filtered: Sections = {
    done: keepWorkItems(sections.done) ?? [],
    risks: keepWorkItems(sections.risks) ?? [],
  }
  const tomorrow = keepWorkItems(sections.tomorrow)
  if (tomorrow !== undefined) filtered.tomorrow = tomorrow
  const next = keepWorkItems(sections.next)
  if (next !== undefined) filtered.next = next
  return filtered
}

/** 周报汇总前先过滤日报，避免个人内容被二次放大。 */
export function filterDailies(dailies: DailyReport[]): DailyReport[] {
  return dailies.map((daily) => ({
    ...daily,
    sections: filterSections(daily.sections),
  }))
}
