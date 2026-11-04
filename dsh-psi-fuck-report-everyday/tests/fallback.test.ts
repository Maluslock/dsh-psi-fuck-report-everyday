import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCollector } from '../src/host/sessions/collector'
import {
  FallbackSessionQuery,
  discoverSessionFiles,
  readSessionFile,
  readSessionHeader,
  scanWorkspaceCwds,
  splitZstdFrames,
} from '../src/host/sessions/fallback'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), '.t4-tmp-'))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const HEADER = { id: 's1', createdAt: new Date(2026, 10, 2, 8, 0).getTime(), cwd: '/repo/alpha' }
const USER_LINE = {
  type: 'user/message',
  seq: 0,
  time: new Date(2026, 10, 3, 9, 0).getTime(),
  data: { id: 'u1', role: 'user', source: 'user', content: [{ type: 'text', text: '修复登录失败' }] },
}

function sessionFrames(header: Record<string, unknown>, lines: Array<Record<string, unknown>>): Buffer {
  const headerLine = JSON.stringify({ type: 'session', version: 4, ...header })
  const body = [headerLine, ...lines.map((line) => JSON.stringify(line))].join('\n') + '\n'
  return zstdCompressSync(Buffer.from(body, 'utf8'))
}

async function writeSessionFile(
  root: string,
  workspace: string,
  session: string,
  payload: Buffer,
): Promise<string> {
  const dir = join(root, workspace, session)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl.zstd')
  await writeFile(file, payload)
  return file
}

describe('splitZstdFrames', () => {
  it('splits concatenated zstd frames and keeps each frame decompressable', () => {
    const first = zstdCompressSync(Buffer.from('{"a":1}\n'))
    const second = zstdCompressSync(Buffer.from('{"b":2}\n'))
    const frames = splitZstdFrames(Buffer.concat([first, second]))

    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => zstdDecompressSync(frame).toString('utf8'))).toEqual([
      '{"a":1}\n',
      '{"b":2}\n',
    ])
  })

  it('finds a frame after leading garbage and ignores an empty buffer', () => {
    const frame = zstdCompressSync(Buffer.from('hello'))
    expect(splitZstdFrames(Buffer.from(''))).toEqual([])

    const frames = splitZstdFrames(Buffer.concat([Buffer.from('junk-before-frame'), frame]))
    expect(frames).toHaveLength(1)
    expect(zstdDecompressSync(frames[0]!).toString('utf8')).toBe('hello')
  })

  it('rejects a truncated frame', () => {
    const frame = zstdCompressSync(Buffer.alloc(4096, 'x'))
    expect(() => splitZstdFrames(frame.subarray(0, 5))).toThrow(/E_TRUNCATED_FRAME/)
  })
})

describe('scanWorkspaceCwds', () => {
  it('returns cwds of sessions touched in the window and skips stale mtimes', async () => {
    const root = await tempDir()
    await writeSessionFile(root, 'w1', 's1', sessionFrames(HEADER, []))
    const stale = await writeSessionFile(
      root,
      'w2',
      's2',
      sessionFrames({ ...HEADER, id: 's2', cwd: '/repo/old' }, []),
    )
    const old = new Date('2026-10-01T00:00:00Z')
    await utimes(stale, old, old)

    const cwds = await scanWorkspaceCwds(root, Date.now() - 7 * 86_400_000)

    expect(cwds).toEqual(['/repo/alpha'])
  })
})

describe('readSessionFile', () => {
  it('reads a session header and its events from one file', async () => {
    const root = await tempDir()
    const file = await writeSessionFile(root, '--repo-alpha--', 'session-s1', sessionFrames(HEADER, [USER_LINE]))

    const parsed = await readSessionFile(file)
    expect(parsed.header).toMatchObject({ id: 's1', cwd: '/repo/alpha', delegationDepth: 0 })
    expect(parsed.header.createdAt).toBe(HEADER.createdAt)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({ type: 'user/message', time: USER_LINE.time })
    expect(parsed.events[0]?.seq).toBe(0)
  })

  it('joins a JSON line split across zstd frames', async () => {
    const root = await tempDir()
    const headerLine = JSON.stringify({ type: 'session', version: 4, ...HEADER })
    const eventLine = JSON.stringify({ ...USER_LINE, seq: 7 })
    const half = Math.floor(headerLine.length / 2)
    const payload = Buffer.concat([
      zstdCompressSync(Buffer.from(headerLine.slice(0, half))),
      zstdCompressSync(Buffer.from(`${headerLine.slice(half)}\n${eventLine}\n`)),
    ])
    const file = await writeSessionFile(root, 'ws', 'session-s2', payload)

    const parsed = await readSessionFile(file)
    expect(parsed.header.id).toBe('s1')
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.seq).toBe(7)
  })

  it('rejects a file without any zstd frame', async () => {
    const root = await tempDir()
    const file = await writeSessionFile(root, 'ws', 'session-empty', Buffer.alloc(0))

    await expect(readSessionFile(file)).rejects.toMatchObject({ code: 'E_COLLECT_FAILED' })
  })

  it('rejects a header-less body with valid zstd data', async () => {
    const root = await tempDir()
    const file = await writeSessionFile(
      root,
      'ws',
      'session-eventonly',
      zstdCompressSync(Buffer.from(`${JSON.stringify(USER_LINE)}\n`)),
    )

    await expect(readSessionFile(file)).rejects.toMatchObject({ code: 'E_COLLECT_FAILED' })
  })
})

describe('discoverSessionFiles', () => {
  it('collects non-empty session files and ignores everything else', async () => {
    const root = await tempDir()
    const first = await writeSessionFile(root, '--repo-alpha--', 'session-a', sessionFrames(HEADER, []))
    const second = await writeSessionFile(root, '--repo-beta--', 'session-b', sessionFrames(HEADER, []))
    await writeSessionFile(root, '--repo-alpha--', 'session-empty', Buffer.alloc(0))
    await writeFile(join(root, '--repo-alpha--', 'notes.txt'), 'not a session')

    const files = await discoverSessionFiles(root)
    expect(files.sort()).toEqual([first, second].sort())
  })

  it('returns an empty list for an empty root', async () => {
    const root = await tempDir()
    await expect(discoverSessionFiles(root)).resolves.toEqual([])
  })

  it('reports a missing sessions root as E_COLLECT_FAILED', async () => {
    const root = await tempDir()
    await expect(discoverSessionFiles(join(root, 'missing'))).rejects.toMatchObject({
      code: 'E_COLLECT_FAILED',
    })
  })
})

describe('FallbackSessionQuery', () => {
  it('lists and reads sessions while skipping corrupt files', async () => {
    const root = await tempDir()
    await writeSessionFile(root, 'ws-a', 'session-a', sessionFrames({ ...HEADER, id: 'a' }, [USER_LINE]))
    await writeSessionFile(root, 'ws-b', 'session-b', sessionFrames({ ...HEADER, id: 'b' }, []))
    await writeSessionFile(root, 'ws-c', 'session-broken', Buffer.from('definitely not zstd'))

    const query = new FallbackSessionQuery(root)
    const records = await query.listSessions()
    expect(records.map((record) => record.header.id).sort()).toEqual(['a', 'b'])

    const snapshot = await query.readSession('a')
    expect(snapshot.session.id).toBe('a')
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]?.type).toBe('user/message')

    await expect(query.readSession('missing')).rejects.toMatchObject({ code: 'E_COLLECT_FAILED' })
  })

  it('works behind SessionCollector for a real directory tree', async () => {
    const root = await tempDir()
    await writeSessionFile(root, '--repo-alpha--', 'session-s1', sessionFrames(HEADER, [USER_LINE]))

    const sessions = await new SessionCollector(new FallbackSessionQuery(root)).collect('2026-11-03', {
      projects: new Set(),
      sessions: new Set(),
    })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sessionId: 's1', cwd: '/repo/alpha', messages: 1 })
    expect(sessions[0]!.userTexts).toEqual(['修复登录失败'])
  })
})

describe('windowed fallback reads', () => {
  const dayStart = new Date(2026, 10, 3, 0, 0, 0, 0).getTime()
  const dayEnd = new Date(2026, 10, 3, 23, 59, 59, 999).getTime()
  const window = { start: dayStart, end: dayEnd }

  it('reads only events inside the requested window', async () => {
    const root = await tempDir()
    const file = await writeSessionFile(root, 'ws', 'session-window', sessionFrames(HEADER, [
      { ...USER_LINE, seq: 4, time: new Date(2026, 9, 31, 12, 0).getTime() },
      USER_LINE,
      { ...USER_LINE, seq: 9, time: new Date(2026, 10, 4, 1, 0).getTime() },
    ]))

    const all = await readSessionFile(file)
    expect(all.events).toHaveLength(3)

    const filtered = await readSessionFile(file, window)
    expect(filtered.events).toHaveLength(1)
    expect(filtered.events[0]?.time).toBe(USER_LINE.time)
    expect(filtered.header.id).toBe('s1')
  })

  it('reassembles multibyte characters split across frame boundaries', async () => {
    const root = await tempDir()
    const headerText = JSON.stringify({ type: 'session', version: 4, ...HEADER }) + '\n'
    const eventLine = JSON.stringify(USER_LINE) + '\n'
    const eventBytes = Buffer.from(eventLine, 'utf8')
    const cutAt = Buffer.byteLength(eventLine.slice(0, eventLine.indexOf('修复登录失败'))) + 1
    const payload = Buffer.concat([
      zstdCompressSync(Buffer.from(headerText, 'utf8')),
      zstdCompressSync(eventBytes.subarray(0, cutAt)),
      zstdCompressSync(eventBytes.subarray(cutAt)),
    ])
    const file = await writeSessionFile(root, 'ws', 'session-split', payload)

    const parsed = await readSessionFile(file)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.data).toMatchObject({
      content: [{ type: 'text', text: '修复登录失败' }],
    })
  })

  it('reads the session header from the first frame only', async () => {
    const root = await tempDir()
    const file = await writeSessionFile(root, 'ws', 'session-header', sessionFrames(HEADER, [
      USER_LINE,
      { ...USER_LINE, seq: 1, time: new Date(2026, 10, 4, 1, 0).getTime() },
    ]))

    const header = await readSessionHeader(file)
    expect(header).toMatchObject({ id: 's1', cwd: '/repo/alpha' })
    expect(header.createdAt).toBe(HEADER.createdAt)
  })

  it('lists only sessions modified at or after the window start', async () => {
    const root = await tempDir()
    await writeSessionFile(root, 'ws', 'session-active', sessionFrames({ ...HEADER, id: 'active' }, []))
    const stale = await writeSessionFile(root, 'ws', 'session-stale', sessionFrames({ ...HEADER, id: 'stale' }, []))
    await utimes(stale, new Date(2026, 9, 1), new Date(2026, 9, 1))

    const query = new FallbackSessionQuery(root)
    const all = await query.listSessions()
    expect(all.map((record) => record.header.id).sort()).toEqual(['active', 'stale'])

    const inWindow = await query.listSessionsInWindow(window)
    expect(inWindow.map((record) => record.header.id)).toEqual(['active'])
  })

  it('collects a day through the windowed path without leaking other days', async () => {
    const root = await tempDir()
    await writeSessionFile(root, '--repo-alpha--', 'session-s1', sessionFrames(HEADER, [
      USER_LINE,
      { ...USER_LINE, seq: 1, time: new Date(2026, 10, 4, 9, 0).getTime(), data: { content: [{ type: 'text', text: '明天的消息' }] } },
    ]))

    const sessions = await new SessionCollector(new FallbackSessionQuery(root)).collect('2026-11-03', {
      projects: new Set(),
      sessions: new Set(),
    })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.messages).toBe(1)
    expect(sessions[0]!.userTexts).toEqual(['修复登录失败'])
  })
})

describe('listSessionOptions', () => {
  it('reads only sessions written since the selected day', async () => {
    const root = await tempDir()
    await writeSessionFile(root, 'w1', 's1', sessionFrames(HEADER, [USER_LINE]))
    const stale = await writeSessionFile(
      root,
      'w2',
      's2',
      sessionFrames({ ...HEADER, id: 's2', cwd: '/repo/old' }, [USER_LINE]),
    )
    const old = new Date('2026-10-01T00:00:00Z')
    await utimes(stale, old, old)

    const collector = new SessionCollector(
      { listSessions: async () => [], readSession: async () => ({ session: HEADER, events: [] }) },
      root,
    )
    const sessions = await collector.listSessionOptions('2026-11-03')

    expect(sessions.map((session) => session.sessionId)).toEqual(['s1'])
    expect(sessions[0]!.title).toBe('修复登录失败')
    expect(sessions[0]!.firstTime).toBe(USER_LINE.time)
  })
})
