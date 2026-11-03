/* T11 独立验证（vitest 一次性运行，验证后删除）：setWeeklyArchive 持久化 + AC-11 提交范围 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { archiveWeek } from '../src/host/git-archive'
import { ReportStore } from '../src/host/store'

it('T11: setWeeklyArchive persists archive; commit only contains 工作日志 and is not pushed', async () => {
  const root = await mkdtemp(join(tmpdir(), 't11-verify-'))
  try {
    const repo = join(root, 'repo')
    const outputDir = join(repo, '工作日志')
    await mkdir(outputDir, { recursive: true })
    const git = (args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
    git(['init', '-q', '-b', 'main'])
    git(['config', 'user.name', 'T11'])
    git(['config', 'user.email', 't11@example.com'])
    git(['config', 'commit.gpgsign', 'false'])

    const store = new ReportStore({
      dataDir: join(root, 'data'),
      outputDir,
      writeMarkdown: true,
      weeklyCommit: true,
    })
    const week = '2026-W45'
    await store.writeWeekly({
      version: 1,
      week,
      generatedAt: '2026-11-06T17:00:00+08:00',
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      days: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
      missingDays: [],
      sections: { done: ['完成登录修复'], risks: ['无'], next: ['补充回归测试'] },
      editedAt: '2026-11-06T18:00:00+08:00',
      history: [{ done: ['更早的完成项'], risks: [] }],
    })

    // 工作日志文件 + 无关改动 other.txt（绝不能被带进提交）。
    await writeFile(join(outputDir, '2026-11-06.md'), '# 2026-11-06\n\n- 完成登录修复\n')
    await writeFile(join(repo, 'other.txt'), 'unrelated change\n')

    // 与 /commit 相同的调用序列：archiveWeek → setWeeklyArchive。
    const result = await archiveWeek({ repoRoot: repo, outputDir, week })
    expect(result.committed).toBe(true)
    const archive = { committed: true, hash: result.hash!, committedAt: new Date().toISOString() }
    expect(await store.setWeeklyArchive(week, archive)).toBe(true)

    // 重新读盘：archive 在，周报内容未被破坏。
    const stored = await store.readWeekly(week)
    expect(stored?.archive).toEqual(archive)
    expect(stored?.sections).toEqual({ done: ['完成登录修复'], risks: ['无'], next: ['补充回归测试'] })
    expect(stored?.editedAt).toBe('2026-11-06T18:00:00+08:00')
    expect(stored?.history).toEqual([{ done: ['更早的完成项'], risks: [] }])
    expect(stored?.days).toHaveLength(5)
    expect(stored?.missingDays).toEqual([])

    // AC-11：提交只含 工作日志/ 路径、信息带周号、不 push。
    const changed = execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'])
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replaceAll('"', ''))
      .map((line) =>
        line.replace(/\\(\d{3})/g, (_, code) =>
          String.fromCharCode(Number.parseInt(code, 8)),
        ),
      )
      .map((line) => Buffer.from(line, 'binary').toString('utf8'))
    expect(changed).toEqual(['工作日志/2026-11-06.md', '工作日志/2026-W45-周报.md'])
    expect(git(['log', '-1', '--format=%s'])).toBe('docs(工作日志): 2026-W45')
    // AC-11「不 push」：配一个 bare origin 后再次手动归档（无新改动 → no-change，
    // 语义上仍算已归档），remote 上必须始终没有任何 ref。
    const bare = join(root, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    git(['remote', 'add', 'origin', bare])
    const after = await archiveWeek({ repoRoot: repo, outputDir, week })
    expect(after).toEqual({ committed: false, reason: 'no-change' })
    expect(execFileSync('git', ['-C', bare, 'for-each-ref'], { encoding: 'utf8' }).trim()).toBe('')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
