import { describe, expect, it } from 'vitest'
import { DAILY_SYSTEM, WEEKLY_SYSTEM } from '../src/host/report/prompts'

describe('report prompts scope guard', () => {
  for (const [name, prompt] of [['daily', DAILY_SYSTEM], ['weekly', WEEKLY_SYSTEM]] as const) {
    it(`${name} excludes personal devices and home network`, () => {
      expect(prompt).toContain('只写公司资产、公司项目、公司系统上的工作')
      expect(prompt).toContain('NAS')
      expect(prompt).toContain('Tailscale')
      expect(prompt).toContain('个人设备')
    })
  }

  it('weekly also re-checks each daily item', () => {
    expect(WEEKLY_SYSTEM).toContain('汇总时逐条判断')
  })
})
