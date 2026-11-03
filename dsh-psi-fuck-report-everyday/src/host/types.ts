export interface ModelRef {
  provider: string
  model: string
}

export interface Sections {
  done: string[]
  risks: string[]
  tomorrow?: string[]
  next?: string[]
}

export interface SourceMeta {
  sessionId: string
  cwd: string
  title: string
  messages: number
}

export interface Coverage {
  sessions: number
  messages: number
  truncated: boolean
  groups: number
}

export interface DailyReport {
  version: 1
  date: string
  generatedAt: string
  model: ModelRef
  sources: SourceMeta[]
  coverage: Coverage
  sections: Sections
  editedAt: string | null
  history: Sections[]
}

export interface WeeklyArchive {
  committed: boolean
  hash?: string
  reason?: string
  committedAt: string
}

export interface WeeklyReport {
  version: 1
  week: string
  generatedAt: string
  model: ModelRef
  days: string[]
  missingDays: string[]
  sections: Sections
  editedAt: string | null
  history: Sections[]
  /** 最近一次本地归档结果；未归档或旧文件没有该字段时为 undefined。 */
  archive?: WeeklyArchive
}

export interface Settings {
  version: 1
  reminderTime: string
  weeklyDay: number
  model: ModelRef
  outputDir: string
  dataDir?: string
  writeMarkdown: boolean
  weeklyCommit: boolean
  excludedProjects: string[]
  excludedSessions: string[]
  excludedByDate: Record<string, { projects: string[]; sessions: string[] }>
  cleanupEnabled: boolean
}

export interface CollectedSession {
  sessionId: string
  cwd: string
  title: string
  firstTime: number
  lastTime: number
  userTexts: string[]
  assistantTexts: string[]
  toolCounts: Record<string, number>
  todos: Array<{ content: string; status: string }>
  messages: number
}

export interface SessionDigest {
  sessionId: string
  project: string
  text: string
  messages: number
}

export interface Exclusion {
  projects: Set<string>
  sessions: Set<string>
}
