import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveWeek } from '../src/host/git-archive'

const created: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `eod-${prefix}-`))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function git(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  }).trim()
}

async function initRepo(): Promise<string> {
  const repo = await tempDir('repo')
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  return repo
}

async function seedRepo(): Promise<{ repo: string; logDir: string }> {
  const repo = await initRepo()
  git(repo, ['config', 'user.name', 'EOD Test'])
  git(repo, ['config', 'user.email', 'eod@example.com'])
  await writeFile(join(repo, 'other.txt'), 'baseline\n')
  git(repo, ['add', '--', 'other.txt'])
  git(repo, ['commit', '-q', '-m', 'chore: baseline', '--', 'other.txt'])
  const logDir = join(repo, '工作日志')
  await mkdir(logDir, { recursive: true })
  return { repo, logDir }
}

async function writeWeekly(logDir: string, week = '2026-W45'): Promise<string> {
  const file = join(logDir, `${week}-周报.md`)
  await writeFile(file, `# ${week} 周报\n\n## 本周完成\n- 测试\n`)
  return file
}

describe('archiveWeek', () => {
  it('commits only 工作日志 paths and keeps other local changes out', async () => {
    const { repo, logDir } = await seedRepo()
    await writeWeekly(logDir)
    await writeFile(join(repo, 'other.txt'), 'baseline\nlocal edit\n')

    const result = await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' })

    expect(result.committed).toBe(true)
    expect(result.hash).toEqual(expect.any(String))
    expect(result.hash).toBe(git(repo, ['rev-parse', '--short', 'HEAD']))

    const files = git(repo, ['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean)
    expect(files).toEqual(['工作日志/2026-W45-周报.md'])
    expect(git(repo, ['log', '-1', '--format=%s'])).toBe('docs(工作日志): 2026-W45')
    expect(git(repo, ['status', '--porcelain', '--', 'other.txt'])).not.toBe('')
  })

  it('reports no-change when the weekly log is already committed', async () => {
    const { repo, logDir } = await seedRepo()
    await writeWeekly(logDir)

    expect((await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' })).committed).toBe(true)
    expect(await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'no-change' })
  })

  it('returns no-git outside a work tree', async () => {
    const dir = await tempDir('plain')
    await mkdir(join(dir, '工作日志'), { recursive: true })
    await writeFile(join(dir, '工作日志', '2026-W45-周报.md'), '# week\n')

    expect(await archiveWeek({ repoRoot: dir, outputDir: join(dir, '工作日志'), week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'no-git' })
  })

  it('skips while a merge, rebase or cherry-pick is in progress', async () => {
    const { repo, logDir } = await seedRepo()
    await writeWeekly(logDir)
    const head = git(repo, ['rev-parse', 'HEAD'])

    await writeFile(join(repo, '.git', 'MERGE_HEAD'), `${head}\n`)
    expect(await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'merge' })
    await rm(join(repo, '.git', 'MERGE_HEAD'))

    await mkdir(join(repo, '.git', 'rebase-merge'))
    expect(await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'rebase' })
    await rm(join(repo, '.git', 'rebase-merge'), { recursive: true })

    await writeFile(join(repo, '.git', 'CHERRY_PICK_HEAD'), `${head}\n`)
    expect(await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'cherry-pick' })
    await rm(join(repo, '.git', 'CHERRY_PICK_HEAD'))

    expect((await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' })).committed).toBe(true)
  })

  it('returns outside-repo for a log directory outside the repository', async () => {
    const { repo } = await seedRepo()
    const outside = await tempDir('outside')

    expect(await archiveWeek({ repoRoot: repo, outputDir: outside, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'outside-repo' })
    expect(await archiveWeek({ repoRoot: repo, outputDir: repo, week: '2026-W45' }))
      .toEqual({ committed: false, reason: 'outside-repo' })
  })

  it('skips when the repository has no commit identity', async () => {
    const repo = await initRepo()
    const logDir = join(repo, '工作日志')
    await mkdir(logDir, { recursive: true })
    await writeWeekly(logDir)
    const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

    expect(await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45', env }))
      .toEqual({ committed: false, reason: 'no-identity' })
  })

  it('never pushes to the configured remote', async () => {
    const bare = await tempDir('bare')
    git(bare, ['init', '-q', '--bare', '-b', 'main'])
    const { repo, logDir } = await seedRepo()
    git(repo, ['remote', 'add', 'origin', bare])
    await writeWeekly(logDir)

    const result = await archiveWeek({ repoRoot: repo, outputDir: logDir, week: '2026-W45' })

    expect(result.committed).toBe(true)
    expect(git(bare, ['for-each-ref'])).toBe('')
  })
})
