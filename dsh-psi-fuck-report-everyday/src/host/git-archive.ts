import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { PluginError } from './errors.js'

const runGit = promisify(execFile)

export type ArchiveReason =
  | 'no-git'
  | 'outside-repo'
  | 'merge'
  | 'rebase'
  | 'cherry-pick'
  | 'no-identity'
  | 'no-change'

export interface ArchiveInput {
  /** 工作日志目录所属仓库的根目录（由调用方用 git rev-parse --show-toplevel 得到）。 */
  repoRoot: string
  /** 工作日志输出目录；只归档该目录内的文件。 */
  outputDir: string
  /** ISO 周号，如 2026-W45。 */
  week: string
  /** 仅供测试注入（隔离全局 git 配置）；生产不传。 */
  env?: NodeJS.ProcessEnv
}

export interface ArchiveResult {
  committed: boolean
  hash?: string
  reason?: ArchiveReason
}

const SKIP_MARKERS: ReadonlyArray<{ marker: string; reason: ArchiveReason }> = [
  { marker: 'MERGE_HEAD', reason: 'merge' },
  { marker: 'rebase-merge', reason: 'rebase' },
  { marker: 'rebase-apply', reason: 'rebase' },
  { marker: 'CHERRY_PICK_HEAD', reason: 'cherry-pick' },
]

async function git(repoRoot: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await runGit('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  return String(stdout).trim()
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function failure(error: unknown): PluginError {
  const stderr = (error as { stderr?: string }).stderr
  return new PluginError('E_GIT_FAILED', '本地 Git 归档失败', stderr ?? error)
}

async function hasCommitIdentity(repoRoot: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  for (const key of ['user.name', 'user.email']) {
    try {
      const value = await git(repoRoot, ['config', '--get', key], env)
      if (!value) return false
    } catch {
      return false
    }
  }
  return true
}

async function isOperationInProgress(repoRoot: string, env?: NodeJS.ProcessEnv): Promise<ArchiveReason | null> {
  for (const { marker, reason } of SKIP_MARKERS) {
    let markerPath: string
    try {
      markerPath = await git(repoRoot, ['rev-parse', '--git-path', marker], env)
    } catch {
      continue
    }
    if (markerPath && existsSync(resolve(repoRoot, markerPath))) return reason
  }
  return null
}

/**
 * 把工作日志目录（相对仓库根）加入暂存并提交一个本地 commit，不 push。
 * 索引操作只带 pathspec，不会把其他改动带进提交。
 * merge / rebase / cherry-pick 进行中、无 git、目录在仓库外、无提交身份、无变化时
 * 返回对应 reason 而不抛错；真正的 git 执行失败抛 E_GIT_FAILED。
 */
export async function archiveWeek(input: ArchiveInput): Promise<ArchiveResult> {
  const env = input.env

  let root: string
  try {
    root = await git(input.repoRoot, ['rev-parse', '--show-toplevel'], env)
  } catch {
    return { committed: false, reason: 'no-git' }
  }
  if (!root) return { committed: false, reason: 'no-git' }

  const target = toPosix(relative(root, resolve(input.outputDir)))
  if (!target || target === '.' || isAbsolute(target) || target === '..' || target.startsWith('../')) {
    return { committed: false, reason: 'outside-repo' }
  }

  const inProgress = await isOperationInProgress(root, env)
  if (inProgress) return { committed: false, reason: inProgress }

  if (!(await hasCommitIdentity(root, env))) {
    return { committed: false, reason: 'no-identity' }
  }

  let status: string
  try {
    status = await git(root, ['status', '--porcelain', '--', target], env)
  } catch (error) {
    throw failure(error)
  }
  if (!status) return { committed: false, reason: 'no-change' }

  try {
    await git(root, ['add', '--', target], env)
    await git(root, ['commit', '-m', `docs(工作日志): ${input.week}`, '--', target], env)
    const hash = await git(root, ['rev-parse', '--short', 'HEAD'], env)
    return { committed: true, hash }
  } catch (error) {
    throw failure(error)
  }
}
