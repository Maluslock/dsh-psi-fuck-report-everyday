---
team: "steward-doc-borrow"
task: "t9"
subject: "t9 01 报告第二轮可读性润色（术语就地解释）"
attempt: 1
kind: "work"
status: "completed"
assignee: "steward-analyst"
updated: "2026-11-16T07:27:30.275Z"
---

# t9 · t9 01 报告第二轮可读性润色（术语就地解释）

Source: team `steward-doc-borrow`, task `t9`, attempt 1, kind `work`, status `completed`.

## Goal

只改 reports/steward-agentteams/01-steward-mechanisms.md，做第二轮「可读性润色」。

目标读者：没参加这次调研、也不写代码的人。读每一节，他要能说出这节在讲什么事，而不是只看到代号。

允许改：超过 50 字的长句拆成两句；书面词换口语；括号套括号理顺；把「即/该/其/上述/据此/从而」换掉。

必须原样保留：所有数字、版本号、路径、`文件:行号` 引用、编号（FR-/GAP-/NFR-/M-/U-/D-/R-/C-/NG-/G-/Q-/T-）、表格每一行与列数、标题数量与层级、列表条目数量、代码块内容。不许加章节、表格、列表项。

这次的重点（上一轮只换了措辞，这轮要让人真看懂）：术语第一次出现时就地补一句人话，只补一次。至少覆盖 T0–T3（四层文档各是什么）、三类分治（活文档/记录/基线）、G1–G11（十一条检查规则）、frontmatter（文件开头那段固定字段）、基线/快照/门禁/幂等/血缘。正文里如果只剩代号、读者看不出在说什么，就在代号后面补半句说明，例如 `docs-gate.mjs:219`（检查脚本里算体积那一段）。

禁止：AI 腔（一句话/结论先行/综上/总之/值得注意/换句话说）、空话、删掉技术细节。别碰别人的文件和 *.bak / *.bak2 备份，别新建文件。

自查：对照 `01-steward-mechanisms.md.bak2.20261116-152216` 比标题数、表格行数、列表项数、编号集合、`文件:行号` 集合，必须全等。改完标 completed 并说明改了哪几类地方。

## Delivered

t9 完成：第二轮可读性润色（术语就地解释）已落到 reports/steward-agentteams/01-steward-mechanisms.md（430 行 / 54,629 B / sha256 前缀 3c664af53df7ee3e）。改的是四类地方，不是换措辞：

1) 术语第一次出现补人话（只补一次）：T0–T3 四层各自是什么（常驻红线/每轮必读摘要/一次 run 的过程稿/七阶段正式文档）；三类分治（活文档原地改、记录文档只增不改、基线文档留快照）；G1–G11 明确写成「脚本自动查的十一条规则」并在 §6 逐条给出人话检查项；frontmatter 说成「文件开头那段固定字段」；基线（大改定稿要留的对比基准）、快照（把某一版冻成只读副本）、门禁（脚本把的一道关）、幂等（重复跑会不会把文件写坏）、血缘（这份文档是哪次任务写出来的）、棘轮（只许收紧不许放松的基准）、工件总线（一次 run 的中间产物都写成文件堆在一个目录）、SSOT/AC/DAG/hub 均在首次出现处解释了。
2) 长句拆短：§5.3 幂等判据、§6.3 负面事实段、§8.3 三条事实、§9 四行、附录 B 七行答案全部改成两句以上的完整句。
3) 书面/文言词替换：即/该/其/上述/据此/从而/反之、落盘、兜底等换成口语（「落在根目录就是违规」「对不上就报 error」「依赖就是 DAG」「白名单里没有这个键」「同一个错误犯 2 次就停」）。
4) 修掉原文两处硬伤：§7.1 错字「pp 派 agent」；§2.1 末尾双冒号长句改成两句。

结构不变量对照 01-steward-mechanisms.md.bak2.20261116-152216 全等：标题 39/39 且层级序列相同、表格行 190/190 且每行竖线数序列相同、列表项 42/42、编号集合相同、`文件:行号` 集合 132/132 完全相同（未新增引用）、代码块逐行相同、数字 token 多重集相同；banned 词（一句话/结论先行/综上/总之/值得注意/换句话说/不难看出/由此可见/简言之）0 命中。未碰 02/03/04、BRIEF 与任何 .bak/.bak2，未新建文件。

## Evidence

- acceptance: 只改 reports/steward-agentteams/01-steward-mechanisms.md，未触碰他人文件与 .bak/.bak2 备份，未新建文件 — passed (本轮所有写操作均指向该单文件（python 定点替换，assert count==1）；02/03/04 与 BRIEF 的 mtime 仍为他人 15:24 版本；ls 显示目录内无新增文件)
- acceptance: 术语首次出现处就地解释，覆盖 T0–T3、三类分治、G1–G11、frontmatter、基线/快照/门禁/幂等/血缘 — passed (§1 第 23 行四层逐句解释；§2.1 表 48-51 行；§2.3 表头 103 行「幂等性」；§3.1 表头 92 行；§4 第 143 行「用两行 --- 夹住」；§6.1 第 240-250 行 11 条人话检查项；§6.3 第 273 行 hook 释义；§7.1 第 281 行工件总线释义；§5.1 第 187 行 SSOT 释义；另 AC 第 88 行、DAG 第 289 行)
- acceptance: 结构不变量与 bak2 全等：标题数/层级、表格行数与列数、列表项数、编号集合、文件:行号 集合、代码块、数字 token — passed (脚本比对：headings 39=39 且层级序列相等；tablerows 190=190 且每行 '|' 计数序列相等；listitems 42=42；ids 集合相等；cites 132=132 完全相等；code 逐行相等；digits Counter 相等)
- acceptance: 无 AI 腔与空话，未删除技术细节 — passed (grep -nE '一句话|结论先行|综上|总之|值得注意|换句话说|不难看出|由此可见|简言之' → 无命中；表格与证据列全部保留，正文事实条目未删)
- command: `python3 不变量比对脚本（对照 01-steward-mechanisms.md.bak2.20261116-152216 比 headings/tablerows/listitems/ids/cites/code/digits）` — passed (exit 0)
- command: `grep -nE '一句话|结论先行|综上|总之|值得注意|换句话说|不难看出|由此可见|简言之' 01-steward-mechanisms.md` — passed (exit 1)
- command: `sha256sum / wc -c 01-steward-mechanisms.md` — passed (exit 0)

## Changed files

- `reports/steward-agentteams/01-steward-mechanisms.md`

## Open items

_None recorded._
