import type { Context } from '@deepseek-ai/cordis'
// 仅加载 Context.llm 的类型扩展；运行期没有副作用（type-only import 会被擦除）。
import type {} from '@deepseek-ai/dsh-llm'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ApiDeps, StoreLike } from './host/http/api.js'
import { registerHttpApi } from './host/http/server.js'
import { FallbackSessionQuery } from './host/sessions/fallback.js'
import { SessionCollector, type SessionQueryLike } from './host/sessions/collector.js'
import { KeyedLock, ReportStore, SettingsStore, expandHome } from './host/store.js'
import type { DailyReport, WeeklyReport } from './host/types.js'

export const name = 'dsh-psi-fuck-report-everyday'
export const inject = ['webServer', 'llm']

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * 设置里的 dataDir / outputDir 可以在运行期改，所以每次读写都按当前设置
 * 新建 ReportStore，而不是启动时固化路径。
 */
class DynamicStore implements StoreLike {
  constructor(
    private readonly settings: SettingsStore,
    private readonly fallbackDataDir: string,
  ) {}

  private async current(): Promise<ReportStore> {
    const settings = await this.settings.read()
    return new ReportStore({
      dataDir: settings.dataDir ? expandHome(settings.dataDir) : this.fallbackDataDir,
      outputDir: expandHome(settings.outputDir),
      writeMarkdown: settings.writeMarkdown,
      weeklyCommit: settings.weeklyCommit,
    })
  }

  async readDaily(date: string): Promise<DailyReport | null> {
    return (await this.current()).readDaily(date)
  }

  async readWeekly(week: string): Promise<WeeklyReport | null> {
    return (await this.current()).readWeekly(week)
  }

  async writeDaily(
    report: DailyReport,
    opts?: { replace?: boolean },
  ): Promise<{ json: string; markdown?: string }> {
    return (await this.current()).writeDaily(report, opts)
  }

  async writeWeekly(
    report: WeeklyReport,
    opts?: { replace?: boolean },
  ): Promise<{ json: string; markdown?: string }> {
    return (await this.current()).writeWeekly(report, opts)
  }

  async saveDraft(input: Parameters<StoreLike['saveDraft']>[0]): Promise<unknown> {
    return (await this.current()).saveDraft(input)
  }
}

export function healthPayload() {
  return { ok: true, plugin: name } as const
}

export function apply(ctx: Context): void {
  const dataDir = join(dshHome(), 'profiles', 'web', 'plugin-data', name)
  const settings = new SettingsStore(dataDir)
  // sessionQuery 是可选服务：用 ctx.get 读取不触发 inject 校验；没有宿主服务时回退到直接读文件。
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  const sessionsRoot = join(dshHome(), 'sessions')
  const collector = new SessionCollector(
    sessionQuery ?? new FallbackSessionQuery(sessionsRoot),
    sessionsRoot,
  )
  const deps: ApiDeps = {
    settings,
    store: new DynamicStore(settings, dataDir),
    collector,
    llm: ctx.llm,
    lock: new KeyedLock(),
  }
  registerHttpApi(ctx, deps)
}
