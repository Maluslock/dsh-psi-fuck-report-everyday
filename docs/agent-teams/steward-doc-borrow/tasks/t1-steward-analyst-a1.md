---
team: "steward-doc-borrow"
task: "t1"
subject: "解剖 Steward 的文档自动化与可追溯机制"
attempt: 1
kind: "work"
status: "completed"
assignee: "steward-analyst"
updated: "2026-11-16T03:23:06.781Z"
---

# t1 · 解剖 Steward 的文档自动化与可追溯机制

Source: team `steward-doc-borrow`, task `t1`, attempt 1, kind `work`, status `completed`.

## Goal

先读 /home/user/DSH/插件创建/reports/steward-agentteams/BRIEF.md 第 3 节 A 部分与第 5 节。只读 /home/user/DSH/插件创建/.work/steward（含 git 历史与 CHANGELOG）。重点：docTier=3 七阶段文档树、docs-governance 三类文档分治与体积预算、frontmatter 溯源契约、history 快照与双向溯源、G1–G11 门禁逐条、doc-snapshot 九步幂等、tmp/steward/<run> 工件总线与 steward_board 共享任务板的对应、任务完成时哪些文档自动触发。必须逐条回答 BRIEF 的 A 部 7 问，并分清「技能/提示词约束」与「脚本强制」两类强制力。产出写入 reports/steward-agentteams/01-steward-mechanisms.md，每个结论带 路径:行号 证据。claim 后同一回合做完并标 completed。

## Delivered

交付 reports/steward-agentteams/01-steward-mechanisms.md（428 行 / 51,281 B / sha256 a42d1e9d…）。BRIEF §3-A 的 7 问逐条回答，全部结论带 steward 仓库内 路径:行号（相对 .work/steward），并标注事实/推断。

核心结论（供 02/03 直接引用）：
1) 七阶段树 = docs/01-需求…07-治理 + docs/README.md，T0–T3 四层分层（T0 AGENTS≤100 行、T1 docs/project 六件≤120 行、T2 tmp/steward/<run>、T3 单册≤400/hub≤150）；需求 pm 写、架构/契约 architect 写、页面 architect+frontend、测试 qa、治理 Lead 收尾+reviewer；②/③ 起建 07-治理，不是⑦才建（docs/SKILL.md:27,31；doc-pipeline/README.md:11-14,89-113；docs-governance/SKILL.md:226-241）。
2) 三类分治判据 = 生长方式（原地改/只增不改/冻结快照），判不准从严；预算 100/120/150/120/400/150 行，存量 --baseline-write 后只减不增；拆册按业务域不按时间，hub≤150 + 分册≤400，七步动作（docs-governance/SKILL.md:20-28,32-39,44-60；docs-gate.mjs:82,219,904,912）。
3) frontmatter 只有 7 字段 read/scope/budget/status/version/baseline/superseded-by —— **不含 run-id/task-id/parent 血缘**；溯源实际靠「修订表 + history/README + manifest sha256 + 05-record 文档更新清单 + 03-plan.json 的 docsRead」（docs-governance/SKILL.md:64-88,176-182,191-195；doc-snapshot.mjs:41-45）。
4) 快照仅基线冻结时写，九步含 manifest sha256；幂等=「现版 version 已等于 --next 且 manifest 哈希一致」→skip 退出 0 且不改文件；快照不可变由 G8 哈希拦（doc-snapshot.mjs:8-24,135-139；docs-gate.mjs:417-469,983）。
5) G1–G11 逐条给出检查项/级别/实现行/文案；error/warning 两级，退出码 0/1/2，除 fix 与 --baseline-write 外无自动修复。
6) tmp/steward/<run>/ 是文件面，steward_board 是它的投影：工作单 description 带报告路径（reports/tN-role.md）、writeScopes=files+newFiles、blockedBy=dependsOn+G1；G1 未完成→工作单 claim 不上（index.js:333-338,385-404,585-616）。
7) 强制力分野：脚本硬门禁 = docs-gate/doc-snapshot/doc-check/doc-init/guard-naming/validate-plan/run-state/verify；结构强制 = 板上的 blockedBy/writeScopes + 计划里的 docsRead；纯提示词 = 三类判据、拆册时机、05-record、docsRead 进 prompt、终审核对。

三条最关键的负面事实（决定可移植性）：
- docs-gate/doc-snapshot 在宿主侧**零自动化**：dsh/index.js 只注册 steward_board / steward_dispatch / /steward-roster / skills（:622,:724,:744-757,:764-780），grep docs-gate dsh/*.js 0 命中，dsh/ 无 hooks 目录 → 门禁是「脚本硬、触发软」。
- 05-record.md 是整条反向溯源唯一入口，但全仓库 .mjs 对它**零引用**（写漏不红）。
- docsRead 是唯一把文档血缘写进任务计划的字段，但只由 G11 在 docTier=3 且有人跑 check 时校验；validate-plan.mjs 的错误码清单里没有它（validate-plan.mjs:8-20）。

另有 6 项「未确认/偏差」单列在报告 §9（git 只有 1 个 commit 无法复盘演进；「19 类模板」实际 32 个文件；PRD/FRD 质量据 ROADMAP-STATUS.md:167 自评「待首个 docTier=3 项目检验」；docsGovernance 不在 validate-config known 名单 :44 只告警等）。未修改 steward 仓库、dsh-install 或插件源码任一文件。

## Evidence

- acceptance: BRIEF A 部 7 问逐条回答（并给出七阶段树每阶段谁写/何时/写哪个文件） — passed (01-steward-mechanisms.md §2(Q1)/§3(Q2)/§4(Q3)/§5(Q4)/§6(Q5)/§7(Q6)/§8(Q7) + 附录 B 七问速查表)
- acceptance: 每个结论带 路径:行号 证据，且路径可直接打开 — passed (全文 170 行表格单元格含证据列；附录 A 按文件汇总行号；抽查修正了 6 处行号偏移（pipeline README 91-96→94-96/97-101/105-107、docs-governance 33-38→34-39、140-144→144、189-193→176-182、216-218→215、docs-gate 26-27→23-27）)
- acceptance: 分清「技能/提示词约束」与「脚本强制」两类强制力 — passed (§8.1 三层判定（A 脚本硬门禁 / B 结构强制 / C 技能约束）+ §8.2 16 行逐条对照表（含 05-record 零脚本引用、docsRead 仅 G11 校验、docs-gate 无宿主 hook 三条事实）)
- acceptance: 事实与推断分离、未查到写「未确认」、不修改受保护仓库 — passed (§0 证据分级声明；§4.3 与 §7.3 显式标「推断」；§9 列 6 项未确认/偏差；本轮仅写入 reports/steward-agentteams/01-steward-mechanisms.md)
- command: `git -C .work/steward log --oneline / git tag` — passed (exit 0)
- command: `awk 逐段核对 docs-governance/SKILL.md 20-28/32-39/136-146/176-196/205-225/243-264 与 doc-pipeline/README.md 7-18/88-118` — passed (exit 0)
- command: `grep -rn "05-record" --include=*.mjs .work/steward` — passed (exit 1)
- command: `grep -n "docs-gate\|doc-snapshot\|docTier" .work/steward/dsh/index.js .work/steward/dsh/client.js` — passed (exit 1)
- command: `sha256sum reports/steward-agentteams/01-steward-mechanisms.md` — passed (exit 0)

## Changed files

_No changed files recorded._

## Open items

_None recorded._
