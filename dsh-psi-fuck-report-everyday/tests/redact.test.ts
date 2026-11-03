import { describe, expect, it } from 'vitest'
import { redact } from '../src/host/redact'

describe('redact', () => {
  it('masks token shapes with a fixed placeholder marker', () => {
    expect(redact('key sk-abcdefgh12345678 end')).toBe('key sk-*** end')
    expect(redact('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456')).toBe('ghp_***')
    expect(redact('id AKIAIOSFODNN7EXAMPLE done')).toBe('id AKIA*** done')
    expect(redact('slack xoxb-1234-5678-abcdef')).toBe('slack xox***')
    expect(redact('token xoxp-1-2-3-abcdef')).toBe('token xox***')
  })

  it('keeps the key name and masks only the value', () => {
    expect(redact('password=abc123')).toBe('password=***')
    expect(redact('密码：xyz')).toBe('密码：***')
    expect(redact('token: abc def')).toBe('token: *** def')
    expect(redact('PASSWORD = hunter2')).toBe('PASSWORD = ***')
    expect(redact('api_key: k-1')).toBe('api_key: ***')
    expect(redact('api-key=k-2')).toBe('api-key=***')
    expect(redact('passwd: hunter2')).toBe('passwd: ***')
    expect(redact('pwd=hunter2')).toBe('pwd=***')
    expect(redact('secret: hunter2')).toBe('secret: ***')
    expect(redact('密钥：s3cr3t')).toBe('密钥：***')
    expect(redact('口令＝s3cr3t')).toBe('口令＝***')
  })

  it('masks URL credentials but keeps host and path', () => {
    expect(redact('https://alice:secret@example.com/path')).toBe('https://***:***@example.com/path')
    expect(redact('见 http://bob:hunter2@host.local/x?y=1')).toBe('见 http://***:***@host.local/x?y=1')
  })

  it('leaves ordinary prose untouched', () => {
    const plain = '今天修复了登录问题，随后补齐了回归用例，明天继续做接口联调。'
    expect(redact(plain)).toBe(plain)
    expect(redact('分支 sk-abc 未达阈值，无需遮蔽')).toBe('分支 sk-abc 未达阈值，无需遮蔽')
    expect(redact('disk-storage 与 task-runner 都是普通词')).toBe('disk-storage 与 task-runner 都是普通词')
  })

  it('masks every occurrence and stays idempotent', () => {
    const dirty = [
      'sk-abcdefgh12345678',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWX',
      'AKIAIOSFODNN7EXAMPLE',
      'xoxp-111-222-333',
      'password=hunter2',
      'https://alice:secret@example.com/x',
    ].join(' ')
    const clean = redact(dirty)
    for (const secret of ['abcdefgh12345678', 'ABCDEFGHIJKLMNOPQRSTUVWX', 'IOSFODNN7EXAMPLE', 'hunter2', 'alice:secret']) {
      expect(clean).not.toContain(secret)
    }
    expect(clean).toContain('password=***')
    expect(redact(clean)).toBe(clean)
  })

  it('returns empty input unchanged', () => {
    expect(redact('')).toBe('')
  })
})
