# PMS 信息查询指南

本指南面向 AI Agent。请严格按步骤执行。不要修改 URL，不要猜测其他路径。

> 实测校准：2026-09-11 逐条回放验证，已修正鉴权头写法、送测端点、审批 approveId 语义等（详见文末「修订记录」）。

> 依赖工具 **quectel-cli**（安装与登录指南：https://ai.phicotek.com/quectel-cli/docs/installation-guide.md）。

## Step 0: 确认用户查询意图（必须）

**CRITICAL: 动手前必须先确认用户要查什么。PMS 查询分「业务数据」与「流程状态」两类，走不同的接口族，问错 = 结果全错。**

| 用户意图 | 接口族 | 典型问题 |
|---------|--------|---------|
| **业务数据**（项目/OC/产品/ECN/送测等） | 业务服务 `/api/project/*`、`/api/oc/*`、`/api/project-operation/*`、`/api/quality/*` | 「查项目 PR…」「OC 列表」「这个 ECN 改了什么」 |
| **流程状态**（审批/在途/卡在谁/轨迹） | 流程服务 `/api/flow/v1/*` | 「在途审批有哪些」「这条单卡在谁」「审批到哪一步了」 |
| **ID 转换**（中文名→接口入参 ID） | 字典源接口（见 2D） | 「NB-IoT 这个产品线的 id」 |

- 用户在同一个问题里常混两类（如「XX 项目的 ECN 审批到哪了」）：先查业务数据拿单据 `id`，再查流程状态。
- 未确认查询对象，不得进入 Step 1。

## Step 1: 获取鉴权凭证

QPMS 接口鉴权靠请求头 `Authorization: bearer <token>`（**小写 `bearer` + 一个空格 + token**，2026-09-11 实测可用）。按 A → B → C 顺序尝试，前一种失败才用后一种。

### 方案 A（首选）: agent 沙箱已装 quectel-cli

agent 环境已安装 quectel-cli 并登录（登录态持久化在 QUECTEL_CLI_HOME；安装与登录指南：https://ai.phicotek.com/quectel-cli/docs/installation-guide.md）时，直接取 token：

```shell
export QUECTEL_CLI_HOME=/home/gem/.aily/.cli/quectel-cli-home
TOKEN=$(quectel-cli token)
```

- 成功标志：TOKEN 输出是 UUID 格式（如 `38889dc0-55bc-4d41-8144-046964c216f4`）。输出为空 → token 过期，重新走登录（`login --json` + `login --poll`，禁止裸跑 `login`）。
- token 约一个月过期。`quectel-cli status` 可看 Expires。

### 方案 B: 用户浏览器读 quectel_token

方案 A 不可用时，把下面话术发给用户：

> 请在电脑浏览器打开你已登录的任意移远内网系统（如 qpms.quectel.com），按 F12 打开开发者工具 → Console（控制台）标签 → 输入 `document.cookie` 回车 → 把输出里 `quectel_token=` 后面直到分号前的那串值（bearer 开头）发给我。

拿到 token 后，调接口时请求头写 `Authorization: <token 原值>`（cookie 里本身已带 `bearer` 前缀，直接复制原值即可，不要重复加）。

### 方案 C: agent 有浏览器时，页面内直调

agent 沙箱有浏览器能力时：打开 `https://qpms.quectel.com`（会自动带登录态）→ 在 qpms.quectel.com 同源页面上下文里执行（浏览器自动带 Cookie 组 Authorization 头）：

```javascript
(async () => {
  const token = document.cookie.match(/quectel_token=([^;]+)/);
  const t = token ? decodeURIComponent(token[1]) : '';
  const resp = await fetch('/api/project/v1/projectBase/page', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Authorization': t},
    body: JSON.stringify({pageNumber:1, pageSize:10, type:4, projectStageList:[], projectStatusList:[], productLineIdList:[], productTypeList:[]})
  });
  return (await resp.json());
})()
```

- 注意：cookie 里 `quectel_token` 的值**已带 `bearer` 前缀**，直接用它做 Authorization 值，不要自己再加 `bearer`。

## Step 2: 按查询类型调接口

### 2A 业务数据查询（项目 / OC / 产品 / 审批底单）

所有业务列表接口均为 `POST`，带 `Content-Type: application/json` + `Authorization: bearer <token>` 头，body 含 `pageNumber`/`pageSize` 分页（注意是 `pageNumber` 不是 `pageNum`）。

| 查询 | 接口 | 关键入参 |
|------|------|---------|
| 项目列表 | `POST /api/project/v1/projectBase/page` | `{pageNumber,pageSize,type:4,projectStageList:[],projectStatusList:[],productLineIdList:[],productTypeList:[]}`；total 2657，44 字段（状态值中文直出） |
| 项目详情 | `GET /api/project/v1/projectBase/getFullInfoById/{projectId}` | 路径参数 projectId；顶层 97 字段 |
| 客户列表 | `POST /api/general/customer/v1/listCustomerPages` | `{pageSize,pageNumber}` 或全量 `{pageSize:999999,type:"MODULE"}`；total ≈3289 |
| OC 列表 | `POST /api/oc/v1/business/multiplePage` | `{status:"0",machineType:[],queryType:"<随左侧tab>",exportTypeList:[同queryType],activeName:"ALL",productLineIds:[],key:"",batchKey:"",pageNumber,pageSize}`；queryType=ALL 时 total ≈30375，438 字段 |
| ECN | `POST /api/project-operation/v1/ecn/qry/page` | `{pageSize,pageNumber,...}`；records 24 字段含 flowId/flowCode（关联流程）；total ≈24209 |
| PCN | `POST /api/project-operation/v1/pcn/qry/page` | `{pageSize,pageNumber}`；17 字段；total ≈932 |
| 试产申请(ESR) | `POST /api/project-operation/v1/esr/qry/page` | `{pageSize,pageNumber,flowQryType:"ALL"}`；25 字段；total ≈13500 |
| TAC | `POST /api/project-operation/v1/tac/qry/page` | `{pageSize,pageNumber}`；22 字段；total ≈2387 |
| DCN | `POST /api/project-operation/v1/dcn/qry/page` | `{pageSize,pageNumber}`；38 字段；total ≈112 |
| 硬件PN状态评审 | `POST /api/project-operation/v1/pn/status/change/qry/page` | `{pageQueryType,...}`；16 字段；total ≈1191 |
| 送测管理 | `POST /api/quality/v1/send_test/qry/page` | records 42 字段（projectInfo 内嵌项目信息）。⚠️ 服务是 **quality**、路径是 **send_test**（下划线）；total ≈15015。**旧写法 `/api/project-operation/v1/sendTest/qry/page` 是 404 死路，勿用** |
| 阶段评审 | `POST /api/project-operation/v1/stageReview/qry/page` | `{pageSize,pageNumber}`；38 字段；total ≈2407 |
| 软件PN | `POST /api/project-operation/v1/pn/software/qry/page` | `{pageSize,pageNumber}`；total ≈4147 |
| 软件版本 | `POST /api/quality/v1/version/qr/page` | `{pageSize,pageNumber}`；total ≈25579 |
| SDK送测 | `POST /api/quality/v1/sdk/sendTest/qry/page` | `{pageSize,pageNumber}`；total ≈291 |
| FAE问题 | `POST /api/software/v1/issue/qry/fae/page` | 20 字段 |

**关键：业务 records 里有两个 id** —— `id`（记录主键）和 `flowId`（流程实例 id）。**查流程状态用 `id`，不是 `flowId`**（见 2B）。`flowCode`（对外单据号，如 ECN2026xxxx / MCF2026xxxx）用于搜索定位。

### 2B 流程状态查询（审批监控 / 卡在谁 / 轨迹）

> ⚠️ **最重要的一条（实测踩坑）**：`detail_exclude_node` / `run_task` / `trace/info` / `approve/model` 的 `approveId` 一律用 records 的 **`id`**，**不是 `flowId`**。传 flowId 会报 `Approval not exist`（code 50029）。

#### 审批监控列表（「卡在谁那里」首选）

`POST /api/flow/v1/approve/find_page_for_monitor`，body 真实入参：

```json
{"key":"","pageNumber":1,"pageSize":30,"state":"","sponsor":"","flowKey":""}
```

| 入参 | 说明 |
|------|------|
| `key` | 搜索审批单编号、流程摘要（精确搜单号如 `ECN202609100081` → total 1；`MCF202606120084` → total 1） |
| `state` | 审批状态枚举，见下表 |
| `sponsor` | 发起人过滤，值 = 人员的 `userId`（如 `49447`），不是工号/邮箱 |
| `flowKey` | 流程模型过滤（如 `Pms_Ecn_Change` → total ≈27003）；中文流程名 → flowKey 查 `POST /api/flow/v1/definition/model/list` body `{}`（返回分组结构，含「项目立项审批」→ `Pms_Project_Approval` 等全映射） |
| `pageSize` | 30/50/100/200 |

**state 枚举（页面点击实测值，非字面猜测）**:

| 页面文案 | API 值 | 实测 total(2026-09-11) |
|---------|--------|-----------|
| 审批中 | `UNDER_APPROVAL` | ≈43043 |
| 已完成 | `OVER` | 30 万+ |
| 已驳回 | `TURN` | 3000+ |
| 已终止 | `DISCARD` | 4000+ |
| 已撤回 | `REVOKE` | 1000+ |
| 已挂起 | `SUSPEND` | 13000+ |
| 已强退 | `FORCE_DIS_ALLOWANCE` | 276 |

> ⚠️ `COMPLETED`/`REJECT`/`TERMINATED`/`CANCEL`/`REJECTED`/`FORCE_EXIT` 等字面枚举**均无效**（实测 `COMPLETED` 返回 total=0）。

records 每条含：`id` / `flowId` / `code`(单据号) / `flag`(=projectId) / `flowKey` / `name`(流程名) / `summary`(流程摘要) / `sponsorInfo`(发起人完整人员对象) / `state` / `initiateTime` / `nodeReceiveTime`(当前节点接单时间) / **`taskAclMaps`**（对象：taskKey → {taskName, users[完整人员], taskId}——**当前节点 + 当前处理人，免逐单调 run_task**；已终止/未流转时该字段为 null）。

#### 单条审批详情与轨迹（approveId 一律用 records 的 `id`）

| 查询 | 接口 | 说明 |
|------|------|------|
| 审批实例详情 | `GET /api/flow/v1/approve/detail_exclude_node/{id}` | flowApproveVo{id, code(=业务单据号), flag(=projectId), flowKey, name, summary, state, initiateTime, endTime} + flowNodeUserVos/cc/files |
| 运行中任务 | `GET /api/flow/v1/approve/run_task/{id}` | 无运行节点返回 `[]`（已终止/未流转均为空） |
| 审批轨迹 | `GET /api/flow/v1/trace/info?approveId={id}` | 未流转时 data null |
| 流程表单 | `GET /api/flow/v1/form/info_by_flow_key?flowKey=&approveId={id}` | 表单内容 |
| 流程图（节点/处理人结构） | `GET /api/flow/v1/approve/model?approveId={id}&flowKey={flowKey}` | data{configId, modelKey, name, enName, version, procDefId, summary[nodes...]}——免浏览器回答「这个流程有哪些节点、各节点谁审批」 |
| 项目级审批分页 | `POST /api/flow/v1/approve/find_page` | body.flag=projectId、processClassificationType=ALL_APPROVAL、modelKeyType=FLOW |
| 项目级审批计数 | `GET /api/flow/v1/approve/count?flag={projectId}&type=PROJECT` | 该项目审批数量 |
| 流程模型列表 | `GET /api/flow/v1/definition/model/show/list` | **GET**（POST→405）；141 个流程模型（id/modelKey/name/groupId/codePrefix） |

#### 审批详情页跳转（用户要看页面时）

`https://qpms.quectel.com/approve/approvalDetailsCustom?modelKey=<flowKey>&id=<approveId>&projectId=<业务projectId>`——三元组缺一不可（只带 id 构造 404）。modelKey 与业务类型一一对应（如 `Pms_New_Stage_Review`、`Pms_Material_Recognition`）。

### 2C 项目详情页查询中枢（projectId + tabKey）

用户问「某项目里的 X」时，按 projectId + tabKey 模型走（跨项目通用，三项目交叉验证）：

1. 先列表拿 `projectId`（projectBase/page 或项目编号，UUID 形如 `6f92f6cc-...`）
2. 项目详情页 URL：`https://qpms.quectel.com/projectManage/project/detail?id={projectId}&tab={tabKey}`（28 个 tabKey：ProjectView 概览 / TaskList 任务 / Approval 审批 / Risk 风险 / SendTest 送测 / Oc 等）
3. 常用 tab 端点（实测）：概况主体 `POST /api/project/v1/projectBase/selectGeneralSituation/{projectId}`（**POST，不是 GET**；GET 报 405）、团队 `POST projectTeam/listTeamMembers`、任务甘特图 `POST projectTask/qr/gantt`
4. 对应 tab 的数据接口在配套文件 **qpms-detail-hub.md**（https://quectel.feishu.cn/file/C5xFbO7mYo2f3FxR6cXchHOfnPH ）里有完整清单（62 个端点，全部只查）

### 2D 字典源（中文名 → 接口入参 ID，实测全通）

用户在页面上拉的下拉框，后端都来自这些字典源接口。查询前先把「用户口中的名字」转成接口要的 ID。

| 转换目标 | 接口 | 实测 |
|---------|------|------|
| 项目名→项目ID | `POST /api/project/v1/aggregate/search` `{pageNumber,pageSize,projectClassification:"MODULE",searchBody}` | total ≈7490 |
| 产品线 | `POST /api/product/line/v1/listProductLines` `{code:""}` | 31 条 |
| 项目阶段 | `GET /api/project/v1/stage/queryStageList` | 5 条 |
| 员工/人员 | `POST /api/org/employee/page` 分页 | total 35453 |
| 部门树 | `POST /api/org/dept/tree` `{}` | 树根 1 |
| 工厂 | `POST /api/general/v1/factory/page` `{type:"0",pageNumber,pageSize}` | 51 家 |
| 芯片平台 | `POST /api/general/v1/chipPlatform/qry/all` `{}` | 917 条 |
| 地区 | `GET /api/general/v1/region/getAllRegion` | — |
| 优先级 | `POST /api/general/v1/priority/all/front` | 13 条 |
| 项目分类 | `POST /api/project/v1/classification/listClassificationForProject` `{classificationType:1}` | — |

> ⚠️ 大客户项目查询 type 必须=5（type=4 恒 0 条）。完整字典源 + 中英字段映射见配套文件 **qpms-dicts-mapping.md**：https://quectel.feishu.cn/file/EenLbmreuoOl03xkzlwcW8SWnEf

## Step 3: 结果整理

- 业务数据：按用户的查询诉求提取字段，用中文列名输出（中英字段映射见配套文件 **qpms-dicts-mapping.md**：https://quectel.feishu.cn/file/EenLbmreuoOl03xkzlwcW8SWnEf ，如：芯片平台=platformTypeName、当前处理节点=currentNode、当前节点处理人=manager.fullName）。
- 流程状态：「卡在谁那里」→ 读 records 的 `taskAclMaps`：taskName（当前节点）+ users[].fullName（当前处理人）+ nodeReceiveTime（接单时间）。
- 审批轨迹：`trace/info` 的 data 为空 = 流程未流转；有数据按时间列出各节点处理人/时间/意见。
- 数值回答必须来自接口实际返回（total/records），不靠记忆推断。

## Step 4: 输出答复

- 逐条列结果：单据号 / 流程名 / 状态（中文：审批中/已完成/…）/ 当前节点 / 当前处理人 / 发起人 / 发起时间。
- 用户要「某项目所有审批」→ 用 `find_page`（flag=projectId），不要用 find_page_for_monitor（它的 projectId 过滤不生效）。
- 用户要「所有在途审批」→ `find_page_for_monitor` + `state: "UNDER_APPROVAL"`。
- 每次输出带口径声明：**数据来自 QPMS 接口实时查询（YYYY-MM-DD），非人工核对**。
- 涉及他人个人信息（处理人/发起人）按最小必要展示（姓名即可）。

## IMPORTANT

- 鉴权头格式是 `Authorization: bearer <token>`（**小写 `bearer` + 一个空格**）；cookie 里 `quectel_token` 已带 `bearer` 前缀，直接复制原值，不要重复拼。
- 调接口前 `unset https_proxy http_proxy`（沙箱/内网环境别走外部代理）。
- 调接口必须带 `Content-Type: application/json`（POST），否则 415。
- **`detail_exclude_node` / `run_task` / `trace/info` / `approve/model` 的 approveId 用 records 的 `id`，不是 `flowId`**（用 flowId 报 `Approval not exist` 50029）。
- **送测端点是 `quality/v1/send_test/qry/page`**（quality 服务 + `send_test` 下划线），`project-operation/v1/sendTest` 是 404。
- `selectGeneralSituation/{projectId}` 是 **POST**（GET→405）；`definition/model/show/list` 是 **GET**（POST→405）；`definition/model/list` 是 **POST**。
- `find_page_for_monitor` 的 `state` 只认 `UNDER_APPROVAL`/`OVER`/`TURN`/`DISCARD`/`REVOKE`/`SUSPEND`/`FORCE_DIS_ALLOWANCE` 七个值；`COMPLETED` 等字面枚举无效。
- 按项目过滤审批**不能**用 find_page_for_monitor 的 projectId/flag（实测无效），必须走 `find_page` + flag。
- 审批详情跳转 URL 的 modelKey/approveId/projectId 三元组缺一不可。
- 本指南只做查询，不做任何提交/审批/修改操作。
- 页面控制台裸 fetch 不带头会 401（「token 格式非法或已失效」），重放必须手动加 Authorization 头。

## 修订记录

**2026-09-11（接口回放校准）**
- 修正鉴权头写法：原文档鉴权头写法残缺（token 格式未给出），已更正为 Authorization 头 = 小写 bearer + 一个空格 + token（实测可用）。
- **送测端点纠错**：`/api/project-operation/v1/sendTest/qry/page`（404）→ `/api/quality/v1/send_test/qry/page`（200，total ≈15015）。
- **approveId 语义纠错**：`detail_exclude_node`/`run_task`/`trace/info`/`approve/model` 用 records 的 `id`，不是 `flowId`（用 flowId 报 50029）。
- 方法纠错：`selectGeneralSituation` GET→405 必须 POST；`definition/model/show/list` POST→405 必须 GET。
- 新增 2D 字典源章节（ID 转换，实测全通）。
- 刷新实测基线（2026-09-11）：项目 2657、OC(ALL) 30375、客户 3289、ECN 24209、审批中 43043、Pms_Ecn_Change 27003。数值随线上数据实时变化，接口或鉴权若改版以接口为准排查。
