import { describe, expect, it } from 'vitest'
import { filterSections, isPersonalText } from '../src/host/report/scope'

describe('report scope filter', () => {
  it('detects personal devices and home network', () => {
    for (const text of [
      'NAS 省电评估',
      '配置 Tailscale 子网路由',
      '对比 NetBird 与 Headscale',
      '家庭断电导致宕机',
      '用 RustDesk 连家里电脑',
      '个人 VPN 出口',
      '个人网盘备份',
      '自己的服务器',
    ]) {
      expect(isPersonalText(text), text).toBe(true)
    }
  })

  it('keeps company work items', () => {
    for (const text of [
      '修复电力系统容器自愈',
      '完成打板程序 M1 接口',
      '整理 Ansible 仓库脚本',
      '核对 Redis 选库',
    ]) {
      expect(isPersonalText(text), text).toBe(false)
    }
  })

  it('removes only matching items and keeps empty sections', () => {
    const result = filterSections({
      done: ['修复登录', 'NAS 备份'],
      risks: ['家庭断电'],
      tomorrow: ['配置 Tailscale', '发版'],
    })
    expect(result).toEqual({
      done: ['修复登录'],
      risks: [],
      tomorrow: ['发版'],
    })
  })
})
