---
team: "steward-doc-borrow"
task: "t11"
subject: "t11 03 报告第二轮可读性润色（术语就地解释）"
attempt: 1
kind: "work"
status: "completed"
assignee: "integration-designer"
updated: "2026-11-16T07:31:54.079Z"
---

# t11 · t11 03 报告第二轮可读性润色（术语就地解释）

Source: team `steward-doc-borrow`, task `t11`, attempt 1, kind `work`, status `completed`.

## Goal

只改 reports/steward-agentteams/03-integration-mapping.md，做第二轮「可读性润色」。

目标读者：没参加这次调研、也不写代码的人。读每一节，他要能说出这节在讲什么事，而不是只看到代号。

允许改：超过 50 字的长句拆成两句；书面词换口语；括号套括号理顺。

必须原样保留：所有数字、版本号、路径、`文件:行号` 引用、编号（M01–M19、FR-01..10、U-01..07、D1–D6、Q13–Q16、A/B/C、M1–M3、P0–P2）、表格每一行与列数、标题数量与层级、列表条目数量、代码块内容。不许加章节、表格、列表项。

这次的重点（上一轮只换了措辞，这轮要让人真看懂）：术语第一次出现时就地补一句人话，只补一次。至少覆盖：M01–M19（十九行「Steward 有这个机制，我们这边对应什么」的对照）、强制力 A/B/C/P 四类（脚本硬/结构约束/提示词自觉/插件自动）、人日（一个人干一天）、P0/P1/P2（优先级）、A/B/C 三个方案（轻量/完整/折中）、MVP（第一版）。表格里的缩写不用逐格解释，但正文第一次提到时要说清是什么。

禁止：AI 腔（一句话/结论先行/综上/总之/值得注意/换句话说）、空话、删掉技术细节。别碰别人的文件和 *.bak / *.bak2 备份，别新建文件。

自查：对照 `03-integration-mapping.md.bak2.20261116-152216` 比标题数、表格行数、列表项数、编号集合、`文件:行号` 集合，必须全等。改完标 completed 并说明改了哪几类地方。

## Delivered

03 报告第二轮可读性润色完成（仅改 reports/steward-agentteams/03-integration-mapping.md，47,794 B，sha256 39d2b657…）。共 3 类改动：① 21 处术语首次出现就地补人话（L15 人日、L20 attempt/attemptId 与 U 编号、L21 门禁与 CAS、L23 A/B/C 与 G 门禁、L24 docTier、L43 GAP 编号、L47 M01–M19 十九行对照、L48 强制力 A/B/C/P、L83 治理件、L89 frontmatter、L90 INDEX、L91 doc_check、L155 基线快照/幂等/sha256、L157 projection、L165 slot、L206 rc.5/v2、L208 TeamStateReader、L213 MVP、L221 FR、L231 P0/P1/P2、L456 fixture）；② 长句拆分 5 处（L15/L21/L89/L155/L231），括号套括号理顺（L20/L24/L43）；③ 清 AI 腔 11 处（真正×2、恰好、两条腿走路、范式、对齐×2、落地、维度×2、同构）。对照 bak2.20261116-152216：465 行 / 42 标题 / 156 表格行 / 47 列表项 / 31 处 文件:行号 / 877 管道符全等，标题级别+编号签名相等，3 个代码块逐字节相同，path:line 集合无增删，无禁止词与 AI 腔词残留。

## Evidence

- acceptance: 术语首次出现就地解释：M01–M19、强制力 A/B/C/P、人日、P0/P1/P2、A/B/C 三方案、MVP 全部覆盖且只补一次 — passed (21 行补解释，正文首次提及处分别为 L47（M01–M19 十九行）、L48（A/B/C/P 四类）、L15（人日）、L231（P0/P1/P2）、L23（A/B/C 轻量/完整/折中）、L213（MVP=第一版）)
- acceptance: 对照 03-integration-mapping.md.bak2.20261116-152216：标题数、表格行数、列表项数、编号集合、文件:行号 集合全等 — passed (cur/bak = 465/465 行、42/42 标题、156/156 表格行、47/47 列表项、31/31 文件:行号、877/877 管道符；heading 级别+编号签名相等；M01–M19/FR/U/D/Q/M1–M3/P0–P2/RN/GAP/G 编号集合无差异；代码块 3 段逐字节相同)
- acceptance: 只改目标文件，不新增章节/表格/列表项，不碰 *.bak/*.bak2 与他人文件 — passed (git status 仅 03-integration-mapping.md 变更；行数 465 未变；未新建文件；备份文件 mtime 未变)
- command: `python3 结构指纹比对（lines/headings/table/lists/path:line/pipes + heading sig + fences 逐字节 + path:line 集合）` — passed (exit 0)
- command: `grep AI 腔词表（值得注意/换句话说/本质上/不难看出/由此可见/综上/总之/真正/恰好/范式/对齐/落地/维度）` — passed (exit 0)

## Changed files

- `reports/steward-agentteams/03-integration-mapping.md`

## Open items

_None recorded._
