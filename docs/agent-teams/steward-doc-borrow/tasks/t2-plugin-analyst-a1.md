---
team: "steward-doc-borrow"
task: "t2"
subject: "解剖现有 AgentTeams 插件的扩展点与现状缺口"
attempt: 1
kind: "work"
status: "completed"
assignee: "plugin-analyst"
updated: "2026-11-16T03:25:56.159Z"
---

# t2 · 解剖现有 AgentTeams 插件的扩展点与现状缺口

Source: team `steward-doc-borrow`, task `t2`, attempt 1, kind `work`, status `completed`.

## Goal

先读 /home/user/DSH/插件创建/reports/steward-agentteams/BRIEF.md 第 3 节 B 部分与第 5 节。只读 /home/user/dsh-install/node_modules/@deepseek-ai/ 下 dsh-experimental-tool-agent-team、dsh-experimental-agent-team、dsh-experimental-client-ui-agent-team、dsh-experimental-agent-team-profile 四个包，可参考 /home/user/DSH/插件创建/.agent-teams/ 运行期状态样例。逐条回答 BRIEF 的 B 部 5 问：全部工具/服务/事件/存储结构与位置；任务/成员/attempt 生命周期中可挂文档生成的时点；现有持久化能否承载文档；客户端 UI 可扩展位置；哪些能进插件、哪些只能进技能或会话约定。产出写入 reports/steward-agentteams/02-agentteams-current.md，带 file:line 证据，明确「现状缺口」清单。claim 后同一回合做完并标 completed。

## Delivered

已交付 reports/steward-agentteams/02-agentteams-current.md（380 行，全中文，逐条带 file:line）。B 部 5 问全部作答：

Q8 工具/服务/事件/存储：源码基线 dsh-install 四包均为 0.2.1-rc.5（工具名 spawn_teammate/team_task_*）；但本会话实际是 agent_teams_* + attempt_id + verdict/acceptanceResults，且全量 @deepseek-ai/*.js grep `agent_teams_` 命中 0、四包 grep `.agent-teams` 命中 0 → 运行的是下一代 AgentTeams v2，v2 实现不在本沙箱，报告中该层只写运行期可观测事实、内部实现标未确认。rc.5：PKG_TOOL 9 工具（claim/complete 语义、CAS 见 PKG_TEAM:1278、complete 分支 PKG_TEAM:1322-1329）；服务 agentTeams（PKG_TEAM:1452，inject 见 1431-1437）；事件仅 team/member、team/task、team/message/{queued,delivered} 四类持久 Session 事件（PKG_PROJ:76-95），无 ctx.emit；存储 = Lead Session log（agentTeam projection stateVersion:4）+ v2 的 .agent-teams/{team.json,inbox/*.jsonl,archive}。

Q9 生命周期挂点：create/claim/complete/reopen/reassign/delete/spawn/provisioning-fail 均有 team/* 事件可事后观察；complete 无 hook、无中间件、无 emit → 「无文档不许完成」硬门禁只能包裹/替换 team_task_update，或退化为完成后异步补齐+告警。最可靠通道：session/event（DSH_SESSION:61）> onChanged（DSH_PROJ:166）> 自注册 projection。

Q10 持久化：够存指针、不够存正文。description 16384 @PKG_TEAM:1228、消息 65536B @:1597、projection 必须 plain JSON → 正文只能落 workspace（ctx.fs.writeText @DSH_FS:221，可用 fs/write-intent 做软校验）。

Q11 UI：现仅 conversation.session.header.actions 一个入口 + 弹层（PKG_UI:491-497、324-389），wire view 刻意排除 messages（PKG_PROJ:318）；可承载文档的是 sidebar.right.pane.tab(+.title)、sidebar.right.tab.document、tool.call.toolview（有 terminal/documentpreview 现成范式），需新增 projection key 或 RPC，全为纯插件工作。

Q12 边界：插件可做 工具/事件/投影/slot/fs/提示注入（先例：send_message 自动加前缀 PKG_TEAM:1593-1596）；文档树/命名/frontmatter 只能进技能；模型是否遵守只能靠会话约定。

另产出：GAP-01..GAP-12 现状缺口清单（含优先级建议）与 9 条可复用积木，供 03 映射、04 排期；§8 列 9 条未确认项。

## Evidence

_No structured evidence recorded._

## Changed files

_No changed files recorded._

## Open items

_None recorded._
