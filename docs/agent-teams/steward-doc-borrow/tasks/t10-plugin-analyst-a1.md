---
team: "steward-doc-borrow"
task: "t10"
subject: "t10 02 报告第二轮可读性润色（术语就地解释）"
attempt: 1
kind: "work"
status: "completed"
assignee: "plugin-analyst"
updated: "2026-11-16T07:24:51.766Z"
---

# t10 · t10 02 报告第二轮可读性润色（术语就地解释）

Source: team `steward-doc-borrow`, task `t10`, attempt 1, kind `work`, status `completed`.

## Goal

只改 reports/steward-agentteams/02-agentteams-current.md，做第二轮「可读性润色」。

目标读者：没参加这次调研、也不写代码的人。读每一节，他要能说出这节在讲什么事，而不是只看到代号。

允许改：超过 50 字的长句拆成两句；书面词换口语；括号套括号理顺。

必须原样保留：所有数字、版本号、路径、`文件:行号` 引用、编号（GAP-/Q-/PKG_ 相关）、表格每一行与列数、标题数量与层级、列表条目数量、代码块内容。不许加章节、表格、列表项。

这次的重点（上一轮只换了措辞，这轮要让人真看懂）：术语第一次出现时就地补一句人话，只补一次。至少覆盖：rc.5 与 v2（两代插件的版本关系）、PKG_TOOL / PKG_TEAM / PKG_PROJ / PKG_UI（插件源码的四个文件：工具层/任务层/投影层/界面层）、projection（给界面看的一份精简副本）、wire view（发给浏览器的数据结构）、attempt（第几次尝试）、verdict（评审结论）、CAS（带版本号的更新，版本对不上就拒绝）、slot（界面上可挂东西的位置）。正文里只剩代号时，在代号后补半句说明。

禁止：AI 腔（一句话/结论先行/综上/总之/值得注意/换句话说）、空话、删掉技术细节。别碰别人的文件和 *.bak / *.bak2 备份，别新建文件。

自查：对照 `02-agentteams-current.md.bak2.20261116-152216` 比标题数、表格行数、列表项数、编号集合、`文件:行号` 集合，必须全等。改完标 completed 并说明改了哪几类地方。

## Delivered

第二轮可读性润色完成，只改 reports/steward-agentteams/02-agentteams-current.md（380 行不变），共改 30 行。

一、术语就地解释（每个只在第一次出现处补一句，之后不重复）
- rc.5 与 v2（:3）：rc.5 = 仓库里能读到的上一代插件源码（0.2.1-rc.5）；v2 = 本会话实际在跑的新一代，源码不在仓库里，只能从运行状态观察。
- 四个 PKG_*（:5）：PKG_TOOL 工具层、PKG_TEAM 任务与成员层、PKG_PROJ 投影层、PKG_UI 界面层，PKG_PROFILE 是装配文件。
- projection（:25）：把会话事件折叠成一份给界面看的精简副本。
- slot（:28）：界面上可以挂东西的固定位置，如会话头部、右侧栏。
- 配套顺手补的：workspace（工作区目录）、description（任务说明字段）、skill、persona（成员的角色设定）、frontmatter（文件开头那段元数据）、append/flush/middleware/ctx.emit、bundle（打包产物）、roster（成员名册）、schema（字段定义）、checkpoint（存档点）、waterfall（监听者依次过手，谁先给结果按谁的）、snapshot（当时那一刻的完整记录）、RPC（远程调用，浏览器另开接口向宿主取数）、宿主=跑插件的那一侧、fork=复制一份源码自己维护。
- attempt（:172）：第几次尝试，改派一次加一；attemptId = 这次尝试的编号；reassigning = 是否正在改派。
- verdict（:108）：评审结论，通过还是打回；同处补了 acceptanceResults/commandsRun/evidence_note/changedPaths 各半句。
- CAS（:342 单元格内）：带版本号的更新，版本对不上就拒绝。
- wire view（:166）：发给浏览器的那份结构，只读、字段比宿主侧少。
- stale（:216）、Q8 与 BRIEF 的关系（:49 标题内注明「对应 BRIEF B 部第 8 问」）。

二、长句拆分：:26、:43、:45、:108、:121、:204、:287、:378–380 等改成两句或加逗号断开；「所有 Team 变更…再 flush（事实，…）」这类括号里塞整句的，改成「…；事实见 `PKG_TEAM:156-160`。」

三、括号套括号理顺：:44（bundle 那处改成独立句）、:121、:153（去掉多余后括号）；全文逐行检查（与）必须配平。

四、书面腔换口语：「消费」「承载」「判定」等改成「用」「放」「看能不能」；`:121` 的英文注释改成「注释原话是…」。

自查（对照 02-agentteams-current.md.bak2.20261116-152216，全部相等）：行数 380、标题 32（层级序列一致）、表格行 139、列表项 52、代码块 2、`文件:行号` 引用 9 处且集合一致、GAP-/Q- 编号集合一致、每行 `|` 数零变化、数字令牌无丢失（16384×5、65536×4 不变；只新增「rc.5」与「第 8 问」两处版本/题号复述）、括号逐行配平、无「一句话/结论先行/综上/总之/值得注意/换句话说」等词。未碰 *.bak / *.bak2、未新建文件。

## Evidence

_No structured evidence recorded._

## Changed files

_No changed files recorded._

## Open items

_None recorded._
