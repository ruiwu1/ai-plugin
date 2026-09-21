# dept-skillpack — 项目开发部技能包

一次装好部门常用的几个 Agent 技能，共用一套授权入口。

## 给同事：三条命令

```bash
# 1) 取包（无需登录，raw 直链）
curl -fsSL -o /tmp/dept-pack.json \
  https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/pack-1.1.0.json

# 2) 装（把 install.mjs 也下下来，或者直接用仓库里这份）
curl -fsSL -o install.mjs \
  https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/install.mjs
node install.mjs install --source /tmp/dept-pack.json

# 3) 体检：外部依赖 + 三条授权腿
node install.mjs doctor
```

只想下一个人手一份的压缩包：本目录的 `dept-skillpack-1.1.0-d336972688cad089.zip`（解压即用，自带安装器）。

## 包里有什么

| 技能 | 管什么 | 必装？ |
| --- | --- | --- |
| `dept-pack-guide` | 导航：该用哪个技能、授权怎么弄 | 是 |
| `quectel-cli` | 统一鉴权入口 + PMS/QPMS/工单/会议查询 | 是 |
| `quectel-pms-query` | 查 QPMS 项目 / 产品 / OC / 审批 / 流程卡在谁 | 是 |
| `qpms-worktime` | 填 / 补 / 提交 QPMS 工时 | 是 |
| `msgraph-delegated-setup` | 个人 Outlook / Microsoft 365 邮箱与日历 | 是 |
| `kimi-webbridge` | 浏览器执行器的一种 | **可选** |

## 授权

三条腿是**三个独立身份源**，合并不了，但入口只有一个：

- **Quectel SSO**（一条根凭据，覆盖 PMS 查询与工时填报）
- **Microsoft 365**（个人邮箱）
- **飞书**

`node install.mjs auth` 按顺序走完，已经就绪的直接跳过。

浏览器能力是**探测制**：quectel-cli 的 token 是根凭据，浏览器只是执行器。
优先用你自己 agent 的浏览器工具，都没有才需要 Kimi WebBridge。

## 版本与更新

判断"是不是最新的"用**内容指纹**，不是版本号。这里的 `d336972688cad089` 要与 `manifest.json` 里的
`fingerprint` 一致；不一致说明这个目录是旧的。

```bash
node install.mjs status    # 我旧了吗
node install.mjs upgrade   # 只更新真变了的技能
```
