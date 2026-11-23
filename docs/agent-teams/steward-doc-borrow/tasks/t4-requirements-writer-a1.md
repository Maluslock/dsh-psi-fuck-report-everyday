---
team: "steward-doc-borrow"
task: "t4"
subject: "撰写最终需求报告"
attempt: 1
kind: "work"
status: "completed"
assignee: "requirements-writer"
updated: "2026-11-16T03:36:12.154Z"
---

# t4 · 撰写最终需求报告

Source: team `steward-doc-borrow`, task `t4`, attempt 1, kind `work`, status `completed`.

## Goal

读 BRIEF.md 与 01/02/03 三份文档，写成可直接评审排期的需求报告 reports/steward-agentteams/04-requirements-report.md。结构：背景与问题、目标与非目标、用户故事、功能需求（FR-01 起编号，每条含描述/触发点/产出物/优先级 P0-P2/验收标准）、非功能需求、数据与存储设计要点、与现有插件的兼容与迁移、分阶段落地计划（MVP→V1→V2）、风险与开放问题、工作量粗估。要求：结论与前两份分析一致，不得新增无证据机制；对「照搬」保持克制，明确哪些是 Steward 特有而应改造。claim 后同一回合做完并标 completed。

## Delivered

已交付最终需求报告 reports/steward-agentteams/04-requirements-report.md（886 行 / 63,625 B，全中文）。结构：结论先行 5 条 → §0 证据口径 → §1 背景与问题（P-01..P-08）→ §2 目标与非目标（G1–G5 / NG-01..NG-12 / C-01..C-08）→ §3 用户故事 US-01..US-10 → §4 功能需求 FR-01..FR-11（每条含描述/触发点/输入/产出物/明确不做/可测验收标准）+ FR↔GAP 矩阵 → §5 非功能需求 NFR-01..NFR-10 → §6 数据与存储设计（目录/命名/frontmatter 8 字段/5 节/INDEX/manifest/幂等键/容量/墓碑）→ §7 兼容与迁移（9 工具功能位零 schema 变更、三级读通道、存量回填、回滚）→ §8 分阶段 MVP→V1→V2（9.5/5.5/5.5 人日，出口标准命令级）→ §9 风险 R-01..R-12 + 开放问题 U-01..U-09 + 7 条决策 D-01..D-07 → §10 WBS 与 20.5 人日（18–24）→ 附录 A 追溯矩阵 / B 证据索引 / C 术语 / D 评审清单 8 问 / E 变更记录。

关键结论：借鉴核心是「证据→档案→索引→校验」四件套而非七阶段树；硬门禁不做（NG-03），改完成后自动落档 + doc_check + FINAL 列缺口；MVP 只做 FR-01/02/03。

对上游的三处增量（均带证据、非新机制）：① D-04 解决 03 内部矛盾——不设证据豁免阈值，无证据任务产「薄档」，否则 D4（索引=文件数）与 100% 覆盖冲突；② D-05 内容漂移用 -r2 新档 + superseded，保持记录不可变；③ U-07 部分回答：实读 team.json 确认 t3 有 changedPaths，t1/t3 有 acceptanceResults/commandsRun，t2 仅 output（真实薄档 fixture），evidence_note/verdict/findings 无键，故按「可选、缺则略」设计。工作量与 03 对账：MVP 9.5 vs A 8.5（+回归）、C 等价 15–16 落在 13–16 上沿、全量 20.5 vs 17–19（差 1.5–3.5 已逐项说明）。

## Evidence

- acceptance: 结构完整：背景与问题、目标与非目标、用户故事、功能需求、非功能需求、数据与存储设计要点、与现有插件的兼容与迁移、分阶段落地计划（MVP→V1→V2）、风险与开放问题、工作量粗估十节齐备 — passed (grep 章节标题逐一命中；报告 886 行，§1–§10 + 附录 A–E 全部存在)
- acceptance: 功能需求从 FR-01 起编号，每条含描述/触发点/产出物/优先级 P0-P2/验收标准 — passed (共 11 条 FR（FR-01..FR-11），每条含元数据表（描述/触发点/输入/产出物/明确不做）+ 验收标准 AC 表；§4.1 总表给出优先级与阶段)
- acceptance: 结论与 01/02/03 三份分析一致，不新增无证据机制 — passed (全部机制标注来源（03 §x / 01 §x / 02 GAP-x / 源码行号）；仅 7 条口径决策 D-01..D-07 显式标注为『本报告决策』并给理由；附录 A 追溯矩阵逐条对齐 03 的 M 编号与 GAP)
- acceptance: 对『照搬』保持克制，明确 Steward 特有项应改造 — passed (§2.4 列 NG-01..NG-12 逐条给证据与替代方案（对应 03 §4 的 11 项不照搬）；§6.3 明确 frontmatter 血缘是对 Steward 的反转（M06）；§4.1 每条 FR 标注来源)
- acceptance: 可直接评审排期：三阶段、WBS、人日、评审节点与决策请求齐备 — passed (§8 三阶段表含范围/人日/出口标准/决策门；§10 WBS W-01..W-14 共 20.5 人日（18–24）并与 03 对账；附录 D 给出 G0 评审 8 问；§9.2 给出 D-01..D-07 待拍板口径)
- command: `wc -l -c reports/steward-agentteams/04-requirements-report.md` — passed (exit 0)
- command: `grep -c '^#### FR-' reports/steward-agentteams/04-requirements-report.md` — passed (exit 0)
- command: `for k in 背景与问题 目标与非目标 用户故事 功能需求 非功能需求 数据与存储设计要点 兼容与迁移 分阶段落地计划 风险与开放问题 工作量粗估; do grep -c "$k"; done` — passed (exit 0)
- command: `python3 表格列数一致性检查（逐块比较 | 计数）` — passed (exit 0)
- command: `grep -n 'TODO|she-ji|待补|???|XXX' reports/steward-agentteams/04-requirements-report.md` — passed (exit 0)
- command: `git status --short` — passed (exit 0)

## Changed files

- `reports/steward-agentteams/04-requirements-report.md`

## Open items

_None recorded._
