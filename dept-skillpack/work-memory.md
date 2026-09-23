# 项目开发部技能包 · 工作记忆

> 更新时间：2026-09-23
>
> 本地仓库：`D:\AI\deepseek\workspace\skill-platform`
>
> 妙搭应用：`app_17e9s6q40gg`
>
> 线上地址：`https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg`
>
> 公开安装文档：`https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/install.md`

## 1. 当前结论

- AI 可以直接读取安装文档，但必须使用**匿名静态地址**。
- `https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg/api/skillpack/install.md` 仅适合带飞书登录态的浏览器，不能作为 Agent 公共入口。
- 平台「复制一句话」和「看安装指南」已改为 GitHub raw 公共地址。
- 技能包当前为 `v1.2.0`，共 6 个技能、20 个文件。
- Quectel SSO 是 PMS 查询与工时填报的共同根凭据，登录一次即可。
- Kimi WebBridge 是可选兜底，不再是强依赖。
- 安装指南会先识别宿主，再显式选择持久化 skills 目录。

## 2. 本次故障

用户把以下话术交给飞书 Aily：

```text
帮我安装「项目开发部技能包」，并完成登录配置：
https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg/api/skillpack/install.md
```

Aily 的执行过程：

1. `fetch` 访问失败；
2. `curl` 取到飞书登录页；
3. 沙箱浏览器打开后跳到飞书登录页；
4. 本地浏览器模式不可用，又回退到沙箱；
5. 最终要求用户扫码登录，安装没有继续。

## 3. 根因与实测证据

### 3.1 `/api` 是浏览器会话入口

匿名请求：

```text
GET https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg/api/skillpack/install.md
→ HTTP 302
→ 飞书 OAuth 登录页
```

原因：妙搭应用的 `/api` 路由受飞书 SSO 保护。用户浏览器能打开，不代表 Agent 的 `fetch/curl` 能读取。

### 3.2 `/openapi` 也不是公共匿名入口

无 API Key 请求：

```text
GET https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg/openapi/skillpack/install.md
→ HTTP 403
→ Invalid Request: missing or invalid Authorization header
```

`/openapi` 适合受控客户端携带 API Key，不适合把密钥嵌入给全体同事复制的提示语。

### 3.3 `SKILLPACK_PUBLIC_BASE` 的真实作用

它只控制安装指南内部的 `install.mjs` 与 payload 地址，不会绕过 feishuapp 外层 SSO。因此即使它指向 GitHub raw，用户最先访问的 `/api/skillpack/install.md` 仍会被 302。

## 4. 已实施修复

### 平台源码

- `client/src/components/skill/PackPanel.tsx`
  - 「复制一句话」改为 GitHub raw 公共安装文档；
  - 「看安装指南」使用同一公共地址；
  - 「下载整合包」继续走登录态 `/api`，不受影响。
- `pack/render-guide.mjs`
- `server/modules/skillpack/install-guide.ts`
  - 增加宿主识别；
  - 禁止默认一律写入 `~/.claude/skills`；
  - 要求显式传 `--dir`。
- `pack/check-public-entry.mjs`
  - 匿名读取安装文档、安装器和 payload；
  - 校验 markdown 标题、installer shebang、payload `skills` 数组；
  - 检查平台页面不再拼受 SSO 保护的 `/api` 地址；
  - 检查远端指南包含 Hermes / Aily 的持久化目录。

### GitHub 公共镜像

- 安装指南提交：`5bf6f02`
- 工作记忆页面提交：`84db2ef`
- `install.md` 已与本地生成结果逐字节一致。

### 妙搭发布

- 运行时代码提交：`7e7961d46391b7c9a00502d2e8df8b03febc011c`
- release：`7688542759497960671`
- 状态：`finished`
- `error_logs = 0`

## 5. 正确安装话术

以后只使用：

```text
帮我安装「项目开发部技能包」，并完成登录配置：
https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/install.md
```

不要再使用 feishuapp `/api/skillpack/install.md` 作为 Agent 入口。

## 6. 宿主目录规则

| 宿主 | 持久化 skills 目录 |
| --- | --- |
| Hermes Agent | `$HERMES_HOME/skills`；未设置时 Windows 用 `~/AppData/Local/hermes/skills`，Linux/macOS 用 `~/.hermes/skills` |
| 飞书 Aily | 常见为 `~/.aily/workspace/skills`；安装前必须确认当前环境实际加载的 skills 目录 |
| Claude Code | `~/.claude/skills` |
| 其他 Agent | 使用该宿主文档规定的持久化目录；无法确认时询问用户 |

不得安装进临时工作区或一次性沙箱，否则会话重建后技能与状态文件会丢失。

## 7. 技能与授权关系

| 技能 | 作用 | 状态 | 授权腿 |
| --- | --- | --- | --- |
| `dept-pack-guide` | 导航、自检、自然语言路由 | 必装 | — |
| `quectel-cli` | Quectel 统一根凭据 | 必装 | Quectel SSO |
| `kimi-webbridge` | 无宿主浏览器能力时的兜底执行器 | 可选 | — |
| `quectel-pms-query` | 项目 / OC / 审批 / 流程查询 | 必装 | Quectel SSO |
| `qpms-worktime` | 工时查看、草稿与送审；token 直连优先 | 必装 | Quectel SSO |
| `msgraph-delegated-setup` | 个人 Outlook / M365 | 必装 | Microsoft 365 |

授权边界：

- Quectel SSO：同时覆盖 PMS 查询与工时填报。
- Microsoft 365：独立身份源，无法与 Quectel SSO 合并。
- 飞书开放能力：当前包内暂无技能直接依赖。
- 业务写操作（提交工时、发邮件等）仍需用户明确确认；完成安装与登录不等于授权业务写入。

## 8. 浏览器能力优先级

1. 子技能已有直连接口时不使用浏览器；
2. 宿主 Agent 自带浏览器工具；
3. CDP；
4. Kimi WebBridge 兜底。

不要默认建议同事安装 Kimi WebBridge。

## 9. 发布与回归流程

```bash
# 公开入口真实网络回归
node pack/check-public-entry.mjs --expect-guide-v2

# 服务端与 GitHub 模板一致性
node pack/check-templates.mjs --version 1.2.0

# 代码质量
npm run type:check
./node_modules/.bin/eslint . --quiet

# Windows 下脚手架 npm script 的 NODE_ENV 前缀不可直接运行，分别执行
export NODE_ENV=production
./node_modules/.bin/nest build
./node_modules/.bin/vite build --config vite.config.ts
```

发布顺序：

1. 只暂存本次相关文件，禁止 `git add -A`；
2. commit；
3. `git push origin sprint/default`；
4. `lark-cli apps +release-create --app-id app_17e9s6q40gg --branch sprint/default --as user`；
5. 轮询 `+release-get` 到 `finished`；
6. 核对 `commit_id` 与目标提交精确一致；
7. 匿名回读 GitHub raw；
8. 线上登录态检查市场复制内容。

## 10. 已知环境坑

- 工作区可能有其他会话的未提交改动。本次已知无关 WIP：
  - `migrations/0004_real_skills.sql`
  - `scripts/gen-skill-seed.mjs`
  不得混入本次提交。
- `npm run lint` 在当前 Windows 环境可能因 `spawn EINVAL` 失败；直接运行 `./node_modules/.bin/eslint . --quiet`。
- `npm run build:prod` 的 `NODE_ENV=production` 是 POSIX 前缀，Windows npm 通过 cmd 执行时会失败；分别执行 Nest 与 Vite 命令。
- `vision_analyze` 当前可能返回 401；截图文字可用本地 RapidOCR 兜底。

## 11. 工作记忆载体

- 本地 Markdown：`docs/项目开发部技能包-工作记忆.md`
- 本地可视化 HTML：`docs/项目开发部技能包-工作记忆.html`
- 公开 Markdown：`https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/work-memory.md`
- 公开 HTML：`https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/work-memory.html`
- 历史 Hermes 会话：`@session:default/20260922_192341_82772c`

后续接手时，先读本文件，再查 git / release / 线上接口确认可能变化的状态。