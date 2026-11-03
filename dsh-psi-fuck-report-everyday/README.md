# dsh-psi-fuck-report-everyday

DSH「下班日报」插件：每天自动汇总当日会话生成三节日报（今日完成 / 风险与阻塞 / 明日计划），周五自动汇总周内日报生成本周周报，并把 Markdown 写入你的工作日志目录。

- 日报/周报每节 0–3 条、每条 ≤40 字，第一人称、可直接粘贴。
- 所有送入模型的会话摘要先经本地脱敏（密钥、token、键值对、URL 内嵌凭证），路径/文件名/命令片段按规则整条丢弃。
- 周报生成后可自动在本地 Git 仓库提交工作日志（不 push）。

## 安装

```bash
dsh plugin --profile web add file:$PWD/dsh-psi-fuck-report-everyday
```

也可以不经过插件市场，直接把目录链接进 profile（适合本地联调，插件目录需先 `pnpm install && pnpm build`）：

```bash
bash dsh-psi-fuck-report-everyday/scripts/install.sh            # 默认 ~/.dsh/profiles/web
bash dsh-psi-fuck-report-everyday/scripts/install.sh <profile>  # 指定其他 profile
```

安装完成后重启 DSH Web（或刷新页面），左侧栏出现 📝「下班日报」入口；首次打开默认显示今天。

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `reminderTime` | `17:30` | 每天提醒生成日报的时间（HH:MM，页面打开时才会弹提醒条） |
| `outputDir` | `~/笔记/工作日志` | 日报/周报 Markdown 输出目录，也是周报自动提交的范围 |
| `model` | `deepseek-official/deepseek-flash` | 汇总用模型 |
| `writeMarkdown` | `true` | 是否在 `outputDir` 写 Markdown（JSON 数据始终落盘） |
| `weeklyCommit` | `true` | 周报生成后是否自动做本地 Git 提交 |
| `weeklyDay` | `5` | 周几提示生成周报（5=周五） |
| 排除日期 | 无 | 在面板里把某天排除出会话汇总与周报统计 |

数据位置：`~/.dsh/profiles/web/plugin-data/dsh-psi-fuck-report-everyday/`（`daily/`、`weekly/`、`settings.json`）。

## 已知限制

- 页面关闭时不会出现提醒条（提醒依赖页面打开）。
- 只汇总已落盘的日报：周报生成前先要有对应日期的日报 JSON。
- 不会自动提交到任何公司系统；周报只做本地 Git 提交，不 push。
- 输出目录不在 Git 仓库内时，归档报告 `no-git`，Markdown/JSON 不受影响。
- 手动「本地提交」在合并/变基/拣选进行中、或未配置 `user.name`/`user.email` 时会跳过并说明原因。

## 归档状态

周报归档结果（提交 hash / 未提交原因 / 时间）会写进周报 JSON，客户端从 `GET /state` 读取——刷新页面或切换周后，「本周」页仍显示真实的「已本地提交 \<短 hash\>」或「未提交（原因）」，`no-change` 按「已归档」展示。旧周报文件没有该字段时按「未提交」显示。

## 回滚

```bash
dsh plugin --profile web remove dsh-psi-fuck-report-everyday
```

用 `scripts/install.sh` 安装的，可用备份恢复（备份文件带时间戳 `*.bak-eod-<stamp>`）：

```bash
bash scripts/rollback.sh <stamp> [profile]
```

## 验收对照表（spec 12.5 AC-1…AC-11）

| AC | 验收项 | 证据 |
| --- | --- | --- |
| AC-1 | 三节日报限长（完成/风险 1–3 条、明日计划 0–3 条，每条 ≤40 字） | `tests/integration.test.ts`（逐条码点断言）+ `tests/parse.test.ts` |
| AC-2 | 复制文本与面板内容一致、纯文本格式 | `tests/store.test.ts:306`（copyText 纯文本格式）+ `client/index.js:348`（剪贴板写入）+ GUI 冒烟 |
| AC-3 | Markdown 与当前草稿一致 | `tests/integration.test.ts`（draft 后 download === 文件内容）+ `tests/http.test.ts` |
| AC-4 | 请求体不出现 fixture 密钥 | `tests/integration.test.ts`（捕获模型调用，断言无 `sk-abc…` 且含 `sk-***`）+ `tests/redact.test.ts` |
| AC-5 | 子代理会话不重复计入 | `tests/collector.test.ts` + `tests/integration.test.ts`（coverage 2 会话 3 消息） |
| AC-6 | LLM 失败不覆盖旧稿 | `tests/integration.test.ts`（失败后草稿/Markdown 原样）+ `tests/http.test.ts:253` |
| AC-7 | 提醒在设定时间 ±30 秒内出现 | `client/client.test.js`（nextReminder 状态机，18 用例）+ GUI 冒烟 |
| AC-8 | 周五 5 天日报生成周报、缺天进 missingDays | `tests/integration.test.ts` + `tests/http.test.ts:375` |
| AC-9 | 40 会话触发两段式且 ≤5 次模型调用 | `tests/generate.test.ts:83`（calls=5）+ `tests/digest.test.ts` |
| AC-10 | 安装/卸载后 DSH Web 正常 | `scripts/install.sh` / `scripts/rollback.sh`（bash -n 通过，备份/恢复带 stamp）+ 安装后重启记录 |
| AC-11 | 本地提交只含工作日志路径、不 push；无 Git 时报告成功 | `tests/git-archive.test.ts:53`（路径/信息/不 push）+ `tests/integration.test.ts`（no-git 归档仍 200）+ T11 复验 `tests/t11-verify.test.ts`（提交只含 `工作日志/`、bare origin 无 ref、archive 回写不破坏周报） |

全量验证：`pnpm test`（14 文件 139 用例）、`pnpm typecheck`、`pnpm test:client`（19 用例）、`pnpm build` 全部通过（T11 复验 2026-11-03，见 tests/t11-verify.test.ts）。
