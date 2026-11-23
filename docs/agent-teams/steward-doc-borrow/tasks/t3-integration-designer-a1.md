---
team: "steward-doc-borrow"
task: "t3"
subject: "设计借鉴映射与集成方案选项"
attempt: 1
kind: "work"
status: "completed"
assignee: "integration-designer"
updated: "2026-11-16T03:31:02.948Z"
---

# t3 · 设计借鉴映射与集成方案选项

Source: team `steward-doc-borrow`, task `t3`, attempt 1, kind `work`, status `completed`.

## Goal

先读 BRIEF.md 第 3 节 C 部分，再读 01-steward-mechanisms.md 与 02-agentteams-current.md。逐条回答 C 部 4 问：给出机制→落点映射表（Steward 机制 / 我们的对象 / 触发点 / 产出物 / 强制力）；至少 2 个方案选项（轻量任务档案 vs 完整文档治理流水线），各含范围、成本、风险、对现有 9 个 agent_teams_* 工具的兼容性影响；给出最小可用闭环 MVP（3–5 个功能）；列出不建议照搬的部分与理由。产出写入 reports/steward-agentteams/03-integration-mapping.md。claim 后同一回合做完并标 completed。

## Delivered

交付 reports/steward-agentteams/03-integration-mapping.md（465 行 / 45,220 B / sha256 eabaf3b9…），BRIEF §3 C 的 Q13–Q16 全部作答，结论可被 04 直接编号引用。

C 部四问结论：
- Q13 映射表：先钉死我们这一侧的对象（Team/Task/Attempt/Evidence/Message/Workspace，全部带运行期证据），再给 19 行映射（M01–M19），五列 = Steward 机制 / 我们的对象 / 触发点 / 产出物 / 强制力，另加「取舍」列（照搬/改造/放弃/反转）。判定：可全自动的只有 5 条投影类（M06/M09/M12/M15/M19）；必须留人的是拆册/归类/决策三类；应放弃的是树、全量门禁、全量工件总线、独立状态机。
- Q14 三方案：A 轻量任务档案（8.5 人日，对 9 工具零改动）；B 完整治理流水线（28–34 人日，需包裹 update_task 的硬门禁，高风险）；C = A + 快照/三份团队记录/只读 UI tab（13–16 人日，推荐）。§2.5 逐工具（9 个功能位，含 v2 14 名的映射）给出兼容性影响：A/C 零 schema 变更，B 动 3 处，其中「包裹 update_task」是唯一高风险改动。§2.6 处理了 rc.5/v2 版本错位：设计只依赖运行期可观测事实。
- Q15 MVP：3 个人视角验收（能查任务/能查证据/能查文档归属）+ 5 个 FR（FR-01 doc_sync 档案合成 P0、FR-02 INDEX 双向索引 P0、FR-03 doc_check D1–D6 P0、FR-04 FINAL.md 收尾摘要 P1、FR-05 只读文档 tab P1），含档案 frontmatter/5 节模板与 D1–D6 规则表、退出码 0/1/2（对齐 docs-gate.mjs:23-27）。P0 ≈ 6.5–8 人日。
- Q16 不建议照搬 11 项：七阶段树、全量版本树、05-record 靠自觉（反转）、docTier 四档、硬门禁包裹 update_task、G1–G11 全量、三宿主构建器、24 套模板全量、联动表+命名守卫+归档轮转、tmp 全量工件总线、docsRead 只写不校验（反转），逐条给证据与替代。

两条修正性结论（对 01/02 的增量）：
1) 对 01：Steward 的两处软肋（05-record 靠人写、门禁触发靠人跑）在我们这里可用「证据→档案」自动投影绕过——因为 v2 任务对象天生带 acceptanceResults/commandsRun/output/attempt。
2) 对 02：v2 不持久化 team/task、team/member 事件（本轮实测 0 命中），故「session/event 里 team/*」不可依赖；主通道改为读团队状态（三级降级：agentTeams 服务 → status 工具 → team.json 只读），tool/call 仅作同会话即时触发。

另产出：§5 8 条设计风险 + 7 条未确认（U-01..U-07）；§6 FR 草案 10 条（FR-01..FR-10，P0/P1/P2）、GAP-01..12 覆盖矩阵、M1/M2/M3 三里程碑排期；§7 五条可复核命令与实测结论。

## Evidence

- acceptance: Q13 机制→落点映射表，含 Steward 机制/我们的对象/触发点/产出物/强制力五列 — passed (§1.2 表 M01–M19 共 19 行，五列齐全并附「取舍」列；§1.1 先给出被映射侧对象及其运行期证据；§1.3 给出自动/留人/放弃的三分判断)
- acceptance: Q14 ≥2 方案选项，各含范围、成本、风险、对现有 9 个 agent_teams_* 工具的兼容性影响 — passed (§2.1 方案 A（范围 in/out、8.5 人日分项、4 条风险表、零改动）；§2.2 方案 B（28–34 人日、5 条风险表、含唯一高风险改动）；§2.3 方案 C（13–16 人日，推荐）；§2.5 逐 9 个功能位给出 A/B/C 三列影响；§2.6 版本错位处理)
- acceptance: Q15 最小可用闭环 MVP（3–5 个功能） — passed (§3.1 三条人视角验收定义；§3.2 FR-01..FR-05 五个功能（P0×3、P1×2），每个含触发/输入/产出/可测验收标准/成本；§3.3 数据流双通道；§3.4 档案模板；§3.5 D1–D6 规则表与退出码)
- acceptance: Q16 明确不建议照搬的部分及理由 — passed (§4 共 11 项，逐条给 Steward 证据、理由、替代方案；含三宿主构建器、24 套模板全量、docTier 分级复杂度三项 BRIEF 点名项)
- acceptance: 写作与证据要求：全中文、每条结论带 路径:行号、区分事实与推断、FR 编号+验收标准+优先级 — passed (§0.1 取信口径（引用/【本轮实测】/【推断】）；全文引用 steward 与 dsh-install 的 路径:行号；§5.2 未确认 7 条；§6.1 FR-01..FR-10 带优先级与验收要点)
- acceptance: 只写 reports/steward-agentteams/ 下文件，不修改 steward 仓库/插件源码 — passed (仅新增 reports/steward-agentteams/03-integration-mapping.md；.work/steward 与 dsh-install 全程只读)
- command: `zstd -dc <captain session log> | grep -c '"team/task"\|"team/member"'` — passed (exit 1)
- command: `zstd -dc <member session 96b1ba2c> | python3 -c '...打印 update_task 的 arguments 键...'` — passed (exit 0)
- command: `python3 - <<'EOF' 表格列一致性检查 EOF（对 03 全文）` — passed (exit 0)
- command: `wc -l -c 03-integration-mapping.md && sha256sum 03-integration-mapping.md` — passed (exit 0)
- command: `sed -n '11,27p;82p;519,524p' .work/steward/dsh/scripts/docs-gate.mjs 与 docs-governance/SKILL.md:20-28 抽查` — passed (exit 0)

## Changed files

- `reports/steward-agentteams/03-integration-mapping.md`

## Open items

_None recorded._
