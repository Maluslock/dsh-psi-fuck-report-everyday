import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { PluginError } from '../errors.js'
import type {
  SessionEventLike,
  SessionHeaderLike,
  SessionQueryLike,
  SessionRecordLike,
  SessionSnapshotLike,
  SessionWindow,
  WindowedSessionQuery,
} from './collector.js'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const SESSION_FILE_NAME = 'session.v4.jsonl.zstd'
/** 会话头所在的第一帧很小（百字节级）；先读这么多字节就够解析头部。 */
const HEADER_PROBE_BYTES = 8192

function collectError(message: string, detail?: unknown): PluginError {
  return new PluginError('E_COLLECT_FAILED', message, detail)
}

/**
 * 按 zstd 帧结构切分多个连续帧。
 *
 * Node 的 `zstdDecompressSync` 只解第一帧，而 DSH 真实会话文件是多帧追加的，
 * 所以必须先按帧边界切开再逐帧解压。
 */
export function splitZstdFrames(buffer: Buffer): Buffer[] {
  const frames: Buffer[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    if (!buffer.subarray(offset, offset + 4).equals(ZSTD_MAGIC)) {
      const next = buffer.indexOf(ZSTD_MAGIC, offset + 1)
      if (next < 0) break
      offset = next
      continue
    }
    const start = offset
    offset += 4
    const descriptor = buffer[offset] ?? 0
    offset += 1
    const fcsFlag = descriptor >> 6
    const singleSegment = (descriptor >> 5) & 1
    const checksum = (descriptor >> 2) & 1
    const dictFlag = descriptor & 3
    if (!singleSegment) offset += 1
    offset += dictFlag === 3 ? 4 : dictFlag
    const fcsSize = [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag] ?? 0
    offset += fcsSize
    for (;;) {
      if (offset + 3 > buffer.length) throw new Error('E_TRUNCATED_FRAME')
      const header =
        (buffer[offset] ?? 0) | ((buffer[offset + 1] ?? 0) << 8) | ((buffer[offset + 2] ?? 0) << 16)
      offset += 3
      const last = header & 1
      const type = (header >> 1) & 3
      const size = header >>> 3
      offset += type === 1 ? 1 : size
      if (last) break
    }
    if (checksum) offset += 4
    if (offset > buffer.length) throw new Error('E_TRUNCATED_FRAME')
    frames.push(buffer.subarray(start, offset))
  }
  return frames
}

function buildHeader(parsed: Record<string, unknown>): SessionHeaderLike {
  return {
    id: String(parsed.id),
    createdAt: Number(parsed.createdAt),
    cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
    parentSession: typeof parsed.parentSession === 'string' ? parsed.parentSession : undefined,
    delegationDepth: typeof parsed.delegationDepth === 'number' ? parsed.delegationDepth : 0,
  }
}

function parseEvent(parsed: Record<string, unknown>, seq: number): SessionEventLike | undefined {
  if (typeof parsed.type !== 'string' || typeof parsed.time !== 'number') return undefined
  return {
    type: parsed.type,
    seq: typeof parsed.seq === 'number' ? parsed.seq : seq,
    time: parsed.time,
    data: parsed.data,
  }
}

function inWindow(time: number, window?: SessionWindow): boolean {
  if (!window) return true
  return time >= window.start && time <= window.end
}

async function readFirstFrame(filePath: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const probe = Buffer.alloc(HEADER_PROBE_BYTES)
    const { bytesRead } = await handle.read(probe, 0, HEADER_PROBE_BYTES, 0)
    if (bytesRead > 0) {
      try {
        const frames = splitZstdFrames(probe.subarray(0, bytesRead))
        if (frames.length > 0) return frames[0]!
      } catch {
        // 头部帧跨过探测长度，退回整文件读取
      }
    }
  } finally {
    await handle?.close()
  }
  const frames = splitZstdFrames(await readFile(filePath))
  if (frames.length === 0) throw collectError(`E_COLLECT_FAILED: no zstd frame in ${filePath}`)
  return frames[0]!
}

/** 只解析会话头；用于列出会话时避免读入整份（可能很大的）会话文件。 */
export async function readSessionHeader(filePath: string): Promise<SessionHeaderLike> {
  let frame: Buffer
  try {
    frame = await readFirstFrame(filePath)
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: cannot read session header ${filePath}`, error)
  }
  let text: string
  try {
    text = zstdDecompressSync(frame).toString('utf8')
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: cannot decompress session header ${filePath}`, error)
  }
  const firstLine = text.split('\n').find((line) => line.trim())
  if (!firstLine) throw collectError(`E_COLLECT_FAILED: missing session header in ${filePath}`)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(firstLine.trim()) as Record<string, unknown>
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: invalid session header in ${filePath}`, error)
  }
  if (parsed.type !== 'session') {
    throw collectError(`E_COLLECT_FAILED: missing session header in ${filePath}`)
  }
  return buildHeader(parsed)
}

/**
 * 解析单个 `session.v4.jsonl.zstd` 文件，返回会话头与事件。
 *
 * 传入 `window` 时只保留窗口内事件，逐帧解压、按行解析，避免把整份
 * 大文件的所有事件同时留在内存里。
 */
export async function readSessionFile(
  filePath: string,
  window?: SessionWindow,
): Promise<{ header: SessionHeaderLike; events: SessionEventLike[] }> {
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: cannot read session file ${filePath}`, error)
  }

  let frames: Buffer[]
  try {
    frames = splitZstdFrames(buffer)
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: broken zstd frame in ${filePath}`, error)
  }
  if (frames.length === 0) throw collectError(`E_COLLECT_FAILED: no zstd frame in ${filePath}`)

  const events: SessionEventLike[] = []
  let header: SessionHeaderLike | undefined
  let seq = 0

  const consumeLine = (rawLine: string): void => {
    const line = rawLine.trim()
    if (!line) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch (error) {
      throw collectError(`E_COLLECT_FAILED: invalid json line in ${filePath}`, error)
    }
    if (parsed.type === 'session') {
      header = buildHeader(parsed)
      return
    }
    const event = parseEvent(parsed, seq)
    if (!event) return
    seq += 1
    if (inWindow(event.time, window)) events.push(event)
  }

  // 按字节切行：帧边界可能落在多字节字符中间，先拼成 Buffer 再转字符串。
  let carry: Buffer = Buffer.alloc(0)
  for (const frame of frames) {
    let chunk: Buffer
    try {
      chunk = Buffer.concat([carry, zstdDecompressSync(frame)])
    } catch (error) {
      throw collectError(`E_COLLECT_FAILED: cannot decompress ${filePath}`, error)
    }
    let start = 0
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue
      consumeLine(chunk.subarray(start, index).toString('utf8'))
      start = index + 1
    }
    carry = chunk.subarray(start)
  }
  consumeLine(carry.toString('utf8'))

  if (!header) throw collectError(`E_COLLECT_FAILED: missing session header in ${filePath}`)
  return { header, events }
}

export interface SessionFileEntry {
  file: string
  size: number
  mtimeMs: number
}

/** 列出 `<root>/<workspace>/<session>/session.v4.jsonl.zstd` 中非空的会话文件。 */
export async function discoverSessionEntries(root: string): Promise<SessionFileEntry[]> {
  const found: SessionFileEntry[] = []
  let workspaces: string[]
  try {
    workspaces = await readdir(root)
  } catch (error) {
    throw collectError(`E_COLLECT_FAILED: sessions root missing: ${root}`, error)
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(root, workspace)
    let sessions: string[]
    try {
      sessions = await readdir(workspaceDir)
    } catch {
      continue
    }
    for (const session of sessions) {
      const file = join(workspaceDir, session, SESSION_FILE_NAME)
      try {
        const info = await stat(file)
        if (info.isFile() && info.size > 0) {
          found.push({ file, size: info.size, mtimeMs: info.mtimeMs })
        }
      } catch {
        // 不是会话目录（或没有会话文件），忽略
      }
    }
  }
  return found
}

export async function discoverSessionFiles(root: string): Promise<string[]> {
  return (await discoverSessionEntries(root)).map((entry) => entry.file)
}

/**
 * 直接用 `~/.dsh/sessions` 目录实现的 SessionQueryLike。
 *
 * - 列会话只读每个文件的第一帧（会话头），不读整份文件；
 * - `listSessionsInWindow` 先按文件 mtime 剪枝：最后写入早于窗口起点的文件
 *   不可能包含窗口内事件，直接跳过；
 * - `readSessionInWindow` 只保留窗口内事件，避免一天日报读入整库。
 *
 * 仅在宿主没有 `ctx.sessionQuery` 时作为回退使用；损坏的会话文件会被跳过。
 */
export class FallbackSessionQuery implements WindowedSessionQuery {
  private readonly idToFile = new Map<string, string>()

  constructor(private readonly root: string) {}

  private async listFrom(entries: readonly SessionFileEntry[]): Promise<readonly SessionRecordLike[]> {
    const records: SessionRecordLike[] = []
    for (const entry of entries) {
      try {
        const header = await readSessionHeader(entry.file)
        this.idToFile.set(header.id, entry.file)
        records.push({ header })
      } catch {
        // 损坏的会话文件不影响其余会话
      }
    }
    return records
  }

  async listSessions(): Promise<readonly SessionRecordLike[]> {
    return this.listFrom(await discoverSessionEntries(this.root))
  }

  async listSessionsInWindow(window: SessionWindow): Promise<readonly SessionRecordLike[]> {
    const entries = (await discoverSessionEntries(this.root)).filter(
      (entry) => entry.mtimeMs >= window.start,
    )
    return this.listFrom(entries)
  }

  private async fileFor(id: string): Promise<string> {
    const cached = this.idToFile.get(id)
    if (cached) return cached
    const entries = await discoverSessionEntries(this.root)
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const entry of entries) {
      try {
        const header = await readSessionHeader(entry.file)
        this.idToFile.set(header.id, entry.file)
        if (header.id === id) return entry.file
      } catch {
        // 跳过损坏文件
      }
    }
    throw collectError(`E_COLLECT_FAILED: session ${id} not found`)
  }

  async readSession(id: string): Promise<SessionSnapshotLike> {
    const file = await this.fileFor(id)
    const { header, events } = await readSessionFile(file)
    return { session: header, events }
  }

  async readSessionInWindow(id: string, window: SessionWindow): Promise<SessionSnapshotLike> {
    const file = await this.fileFor(id)
    const { header, events } = await readSessionFile(file, window)
    return { session: header, events }
  }
}
