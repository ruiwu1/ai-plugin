# 项目开发部技能包 Installation Guide

This guide is for AI Agents. Follow each step exactly. Do NOT modify URLs or guess other paths.

包版本 `1.2.0`，内容指纹 `45e6d999d230b057`，共 6 个技能 / 20 个文件。

## 包里有什么

| 技能 | 名称 | 文件数 | 必装？ |
| --- | --- | --- | --- |
| `dept-pack-guide` | 部门技能包导航 | 1 | 必装 |
| `quectel-cli` | quectel-cli | 1 | 必装 |
| `kimi-webbridge` | kimi-webbridge | 1 | 必装 |
| `quectel-pms-query` | quectel-pms-query | 8 | 必装 |
| `qpms-worktime` | qpms-worktime | 2 | 必装 |
| `msgraph-delegated-setup` | msgraph-delegated-setup | 7 | 必装 |

## Step 1: 取包

```shell
curl -fsSL -o pack-1.2.0.json https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/pack-1.2.0.json
```

**CRITICAL: 必须校验拿到的不是错误响应。** 光看首字节是不是 `{` 不够——
鉴权失败返回的也是 JSON，一样以 `{` 开头（这一步很容易漏，漏了后面会以
"SyntaxError: Unexpected token" 的形式炸在莫名其妙的地方）：

```shell
node -e "const p=require('./pack-1.2.0.json'); if(!p.skills||!Array.isArray(p.skills)) throw new Error('不是技能包：'+JSON.stringify(p).slice(0,120)); console.log('ok',p.skills.length,'个技能')"
```

没有任何输出、或报错里出现 `status_code` / `Invalid Request` / `Forbidden`，
说明这个地址需要授权——**停下来告诉用户**，不要反复重试，也不要继续往下走。

## Step 2: 取安装器

```shell
curl -fsSL -o install.mjs https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/install.mjs
head -1 install.mjs    # 必须输出 #!/usr/bin/env node
```

首行不是 shebang（例如输出 `{"lang_id"`）说明拿到的是错误 JSON，同样停下来。
安装器**零依赖**（只用 Node 内置模块），不需要 `npm install`。需要 Node 20+。

## Step 3: 识别宿主并安装

先判断当前是什么 Agent，再选择持久化 skills 目录。**不得默认写到 `~/.claude/skills/`**：

| 宿主 | 推荐目录 |
| --- | --- |
| Hermes Agent | `$HERMES_HOME/skills`；未设置 `HERMES_HOME` 时用 `~/AppData/Local/hermes/skills`（Windows）或 `~/.hermes/skills`（Linux/macOS） |
| 飞书 Aily | 常见为 `~/.aily/workspace/skills`；安装前先确认该环境实际加载的 skills 目录 |
| Claude Code | `~/.claude/skills` |
| 其他 Agent | 使用该宿主文档规定的持久化 skills 目录；无法确认时先询问用户 |

把实际目录显式传给安装器：

```shell
node install.mjs install --source pack-1.2.0.json --dir "<当前宿主的持久化 skills 目录>"
```

不要装进临时工作目录或一次性沙箱；否则会话重建后技能和 `state.json` 会丢失。

**用户手动删掉过的技能不会被重新装回来**——这是预期行为，不要"帮"他恢复。

## Step 4: 授权体检

三条授权腿是三个独立身份源，合并不了，但入口只有一个：

```shell
node install.mjs doctor      # 体检：外部依赖 + 三条授权腿
node install.mjs auth        # 缺哪条补哪条；已就绪的会自动跳过
```

`auth` 会把三条腿的引导逐条打出来（已就绪的跳过）。其中：

- **Quectel SSO**（`quectel-cli`）——一条根凭据，覆盖 PMS 查询与工时填报。
  **CRITICAL: 不要裸跑 `quectel-cli login`**，它会阻塞挂死约 10 分钟。
  必须两阶段：`login --json` 拿设备码 → 用户在浏览器授权 → `login --poll <device_code>`。
  完整流程见 https://ai.phicotek.com/quectel-cli/docs/installation-guide.md
  **登录一次即可**（这条腿同时覆盖 PMS 查询与工时填报）；第二个技能再要求登录时，先 `quectel-cli status` 核对 `QUECTEL_CLI_HOME`（status 会打印实际查找的 Credentials 路径）——登过却报未登录通常是这里不一致，**不要重复登录**。
- **Microsoft 365**——个人邮箱，走微软设备码授权，与 Quectel 账号无关。
- **飞书**——本包内暂无技能直接依赖。部分 lark-cli build 未内置 `auth status`，doctor 报「无法自检」属正常，不是失败。

缺外部依赖（没装 quectel-cli / python 等）时：

```shell
node install.mjs deps        # 打印每个缺失依赖的确切安装命令
node install.mjs deps --fix  # 有通用安装命令的直接装
```

## Step 5: 验证

```shell
node install.mjs status
```

全部显示"最新"即安装完成。向用户汇报时**至少要说清**：装到哪个目录、装了几个技能、
哪几条授权腿还没就绪。

## 之后怎么更新

```shell
node install.mjs status      # 我旧了吗（按内容 sha256 判断，不看版本号）
node install.mjs upgrade     # 只更新真变了的技能
```

## 不要做的事

- **不要**逐个去装平台上的单技能——包里已经全了，重复装会覆盖。
- **不要**改包里的脚本逻辑（尤其是鉴权和幂等相关的部分）。
- **不要**把 token 写进回复、日志或落盘文件。
- **不要**在用户没明确要求时执行任何写操作（填工时、发邮件等）。

## 出问题时

| 现象 | 原因与做法 |
| --- | --- |
| 取包校验报 `Invalid Request` / `status_code` / `Forbidden` | 该地址需要授权。停下来告诉用户，别重试 |
| `install.mjs` 首行不是 shebang | 拿到的是错误 JSON 被存成了脚本 |
| `node install.mjs` 报 `SyntaxError: Unexpected token ':'` | 装的是错误 JSON，不是脚本。回到 Step 2 重取 |
| `deps` 说某依赖"没有通用安装命令" | 内网工具（如 quectel-cli），按部门公告装，别编一个跑不通的命令 |
| `doctor` 说某条腿未就绪 | 跑 `node install.mjs auth`，照它给的命令走 |
| `doctor` 报某条腿「无法自检」 | 该 build 没带这条自检命令（如部分 lark-cli 的 auth status）。不是失败，别去重装 |
| 登过却报未登录 / 换个技能又要鉴权 | 先 `quectel-cli status` 看 Credentials 路径，对比 `QUECTEL_CLI_HOME` 是否与登录时一致；不一致就 export 同一目录后重试，别重复登录 |
