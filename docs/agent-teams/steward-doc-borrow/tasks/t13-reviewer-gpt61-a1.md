---
team: "steward-doc-borrow"
task: "t13"
subject: "独立评审：AgentTeams 任务档案与成员时间线实现"
attempt: 1
kind: "work"
status: "failed"
verdict: "needs_revision"
assignee: "reviewer-gpt61"
updated: "2026-11-17T09:06:31.233Z"
---

# t13 · 独立评审：AgentTeams 任务档案与成员时间线实现

Source: team `steward-doc-borrow`, task `t13`, attempt 1, kind `work`, status `failed`.

## Goal

独立评审任务：评审 AgentTeams 插件的「任务档案 / 成员时间线 / 分层文档 / doc_check」实现，对照需求报告与 Steward 机制给出结论。

材料（全部只读，不要修改）：
- 代码：/home/user/DSH/插件创建/.work/nat（分支 feat/task-archive，HEAD c90eaa1）。重点文件：src/archive.ts（档案渲染、writeTaskArchive、renderMemberTimeline、checkTeamArchives、writeTeamSummarySafely）、src/tools.ts（agent_teams_doc_check 工具、update_task 落档钩子、agent_teams_delete 写 SUMMARY.md）、src/snapshot.ts（summarizeOutput）、src/client/ActivityPanel.tsx（成员时间线 <details>）、scripts/archive-tdd.mjs（测试）。
- 需求：/home/user/DSH/插件创建/reports/steward-agentteams/04-requirements-report.md（FR-01/02/03/05/06、NFR、D-01..D-07）与 03-integration-mapping.md（方案 C、M1/M2/M3）。
- 已有产物：/home/user/DSH/插件创建/docs/agent-teams/steward-doc-borrow/（INDEX.md、members/4、tasks/12）。

用户原始目标（m00810）：插件层加事件钩子、别改核心代码；点开每个成员面板能看到该成员干过什么、交付了什么，一条时间线拉下来，不用翻会话记录；相关文档按分层排好；一切有迹可循，方便 review。

请回答：
1) 是否达成上述目标？逐条判定，缺哪条明确说。
2) 档案内容是否正确、可复核：证据是否来自任务对象、失败任务是否也产档、重试是否新开文件、幂等是否成立、有没有编造或丢字段。
3) doc_check 是否覆盖了它声称的检查（文件存在、五节、INDEX 行、成员时间线）；误报/漏报风险在哪。
4) SUMMARY.md 与团队删除路径是否安全（删除失败、并发、覆盖）。
5) 测试是否足以支撑这些声明；列出缺失的关键用例。
6) 风险与边界：大团队性能、隐私（output 摘要落盘）、跨平台路径、档案与 team.json 不一致时的行为。
7) 与 Steward 的差距：哪些已同、哪些更强、哪些仍缺（尤其 05-record 式变更记录、版本快照）。

输出：写 /home/user/DSH/插件创建/reports/steward-agentteams/06-评审报告-gpt61.md（全中文，事实与判断分开，findings 带严重度与 file:line）。最后给 verdict：pass 或 needs_revision，并列出必须修的问题（若有）。不要修改代码或既有文档。

## Delivered

已新增全中文独立评审报告 reports/steward-agentteams/06-评审报告-gpt61.md（257 行），逐项回答七类问题并区分事实/判断，10 项带 file:line 的发现。结论 needs_revision：基础归档与成员列表可用，但证据保真、完整成员历史、全终态覆盖、严格幂等、doc_check 可靠性和跨代/路径一致性存在实质缺口。原 c90eaa1 的第二 attempt 排序崩溃已复现；评审期间观察到共享工作区局部修复，新增回归后8/8通过且类型检查通过，报告明确区分原基线与未提交修复。

## Evidence

- command: `node --test scripts/archive-tdd.mjs && pnpm typecheck（指定提交初始工作区）` — passed (exit 0): 7/7 测试及后端/客户端类型检查通过；测试并未覆盖重试排序。
- command: `临时目录源模块边界探针：重复写、证据保留、a1/a2、弱检查、成员名、摘要错误、50任务` — passed (exit 0): 复现mTime变化、证据丢失、第二attempt抛错并留下半成品、空内容检查成功、中文成员碰撞；50短任务写293ms/check9ms。
- command: `临时目录同team-id跨代与非终态成员探针` — passed (exit 0): 新INDEX混入旧任务且包含不存在的待执行成员档案，doc_check仍ok。
- command: `node --test scripts/archive-tdd.mjs && pnpm typecheck（评审期间局部修复工作区）` — passed (exit 0): 新增a1/a2回归后8/8通过；后端/客户端类型检查通过，任务bash-2ac14bc29dbe4d1c最终exit0。
- command: `报告结构和本地引用验证` — passed (exit 0): 257行、10个发现、17个本地文件引用存在、一个H1、最终needs_revision。
- finding F-01 [blocker] at .work/nat/src/archive.ts:136: 原指定提交将JSON数值attempt当字符串，第二attempt排序抛left.attempt.localeCompare is not a function，且任务/成员文件已写导致INDEX缺项。评审期间观察到局部修复与回归通过。 → fix: 冻结字符串化修复到交付基线，补a1/a2/a10排序与打包一致性验证。
- finding F-02 [high] at .work/nat/src/archive.ts:74: 命令evidence、补充证据、finding定位及评审来源字段丢失；终态补充更新直接返回而不落档。 → fix: 保留完整结构化证据与来源，终态补充追加不可变记录或生成新修订。
- finding F-03 [high] at .work/nat/src/members.ts:334: 运行期成员失败及团队停止取消绕过常规工具落档钩子，无重建欠账机制。 → fix: 在插件层统一覆盖终态生命周期，补失败/取消归档与幂等修复入口。
- finding F-04 [high] at .work/nat/src/client/ActivityPanel.tsx:791: 所谓成员时间线仅展示当前归属任务最新状态，转派和重试丢失历史，无档案查看动作。 → fix: 按不可变attempt或事件构建成员历史并链接完整交付档案，或明确降级范围并同步验收。
- finding F-05 [high] at .work/nat/src/archive.ts:246: 同输入仍重写mtime与成员时间戳；同attempt内容变化覆盖旧档；任务/成员/索引非原子分步写。 → fix: 规范化内容哈希、未变跳过写、变化新修订与supersedes、派生文件原子替换和恢复标记。
- finding F-06 [high] at .work/nat/src/archive.ts:331: 实际doc_check五空标题、任意索引路径文字和空成员文件均通过；不查来源、全成员、旧attempt、孤儿、hash和预算。 → fix: 统一实际工具检查器与测试，补规则级诊断、内容非空、索引一一对应、来源/成员/历史/hash校验，并明确分期范围。
- finding F-07 [medium] at .work/nat/src/tools.ts:2588: SUMMARY在状态归档迁移前写入且错误被吞，同名团队文档目录跨代复用混入旧档并覆盖摘要。 → fix: 代际隔离、可恢复提交状态、文档警告暴露、摘要与迁移失败用例。
- finding F-08 [medium] at .work/nat/src/archive.ts:40: Unicode成员名归一成相同task.md，合法成员档案覆盖；Windows检查使用反斜杠与INDEX正斜杠不一致。 → fix: 稳定唯一文件名，分离POSIX链接与文件系统路径，补Unicode/大小写/保留名/长路径测试。
- finding F-09 [medium] at .work/nat/src/archive.ts:56: 英文模板和简化frontmatter偏离草案中文/八字段契约，缺决策节，Markdown表格及截断边界未处理。 → fix: 冻结模板/schema与范围取舍，补中文模板、决策来源、稳健Markdown转义和明确省略。
- finding F-10 [medium] at .work/nat/scripts/archive-tdd.mjs:97: 负例测非工具入口检查器，缺真实失败/补充/删除/幂等测试，档案测试未纳入verify/prepublish链。 → fix: 接入发布验证并补关键工具链和故障负例。

## Changed files

- `reports/steward-agentteams/06-评审报告-gpt61.md`

## Open items

- F-01 [blocker]: 原指定提交将JSON数值attempt当字符串，第二attempt排序抛left.attempt.localeCompare is not a function，且任务/成员文件已写导致INDEX缺项。评审期间观察到局部修复与回归通过。 → 冻结字符串化修复到交付基线，补a1/a2/a10排序与打包一致性验证。
- F-02 [high]: 命令evidence、补充证据、finding定位及评审来源字段丢失；终态补充更新直接返回而不落档。 → 保留完整结构化证据与来源，终态补充追加不可变记录或生成新修订。
- F-03 [high]: 运行期成员失败及团队停止取消绕过常规工具落档钩子，无重建欠账机制。 → 在插件层统一覆盖终态生命周期，补失败/取消归档与幂等修复入口。
- F-04 [high]: 所谓成员时间线仅展示当前归属任务最新状态，转派和重试丢失历史，无档案查看动作。 → 按不可变attempt或事件构建成员历史并链接完整交付档案，或明确降级范围并同步验收。
- F-05 [high]: 同输入仍重写mtime与成员时间戳；同attempt内容变化覆盖旧档；任务/成员/索引非原子分步写。 → 规范化内容哈希、未变跳过写、变化新修订与supersedes、派生文件原子替换和恢复标记。
- F-06 [high]: 实际doc_check五空标题、任意索引路径文字和空成员文件均通过；不查来源、全成员、旧attempt、孤儿、hash和预算。 → 统一实际工具检查器与测试，补规则级诊断、内容非空、索引一一对应、来源/成员/历史/hash校验，并明确分期范围。
- F-07 [medium]: SUMMARY在状态归档迁移前写入且错误被吞，同名团队文档目录跨代复用混入旧档并覆盖摘要。 → 代际隔离、可恢复提交状态、文档警告暴露、摘要与迁移失败用例。
- F-08 [medium]: Unicode成员名归一成相同task.md，合法成员档案覆盖；Windows检查使用反斜杠与INDEX正斜杠不一致。 → 稳定唯一文件名，分离POSIX链接与文件系统路径，补Unicode/大小写/保留名/长路径测试。
- F-09 [medium]: 英文模板和简化frontmatter偏离草案中文/八字段契约，缺决策节，Markdown表格及截断边界未处理。 → 冻结模板/schema与范围取舍，补中文模板、决策来源、稳健Markdown转义和明确省略。
- F-10 [medium]: 负例测非工具入口检查器，缺真实失败/补充/删除/幂等测试，档案测试未纳入verify/prepublish链。 → 接入发布验证并补关键工具链和故障负例。
