import { describe, expect, it } from 'vitest'
import { healthPayload } from '../src/index'

describe('plugin shell', () => {
  it('exposes a stable health payload', () => {
    expect(healthPayload()).toEqual({ ok: true, plugin: 'dsh-psi-fuck-report-everyday' })
  })
})
