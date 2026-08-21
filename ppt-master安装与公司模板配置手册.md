# PPT-Master 安装与公司模板配置手册（Agent 可执行版）

> **本文档供 AI Agent 直接执行**（Claude Code / Hermes / 任何能读写文件并执行命令的 agent）。
> 照此手册操作即可完成：PPT-Master 安装（git 拉取）+ Quectel 公司模板配置，全程无需用户再操作。
> 唯一需要用户输入的是：**安装目录地址**（`PPT_MASTER_HOME`）。公司模板已附于本文档，agent 按 0.1 节自动获取，**无需用户提供模板路径**。
>
> ⚠️ **环境约定：本手册以 Windows 环境为准**（终端为 Git-Bash / MSYS；路径写法 `D:\...` 或 `/d/...` 等价）。
> 若执行环境是 macOS / Linux，仅命令写法略有差异（路径分隔符），流程不变。

---

## 0. 用户输入（唯一需要用户提供的信息）

执行前，仅需向用户确认安装目录（模板文件自动从本文档附件获取，见 0.1）：

| 参数 | 含义 | 默认值（本机已验证） |
|---|---|---|
| `PPT_MASTER_HOME` | ppt-master 安装（存放）目录 | `D:\AI\common\ppt-master` |

> 确认后全程自动执行，不再向用户提问。

### 0.1 模板文件获取（公司模板已附于本文档，无需用户提供）

公司模板 `Quectel corporate PPT template 2026 CN.pptx`（5.6 MB）已作为附件上传到本文档。执行 agent 自动获取源文件，**无需用户提供路径**（二选一，下载位置自行决定，如 `$PPT_MASTER_HOME\..\` 或临时目录，作为内部变量 `TEMPLATE_SOURCE`）：

**方式 A — 有 lark-cli（推荐）**：

```bash
# ① 从本文档内容中提取附件 token
lark-cli docs +fetch --as user --doc "<本文档 URL>" | grep -o 'name="Quectel[^"]*\.pptx"[^>]*token="[^"]*"'

# ② 下载附件为本地模板源文件
lark-cli docs +media-download --as user --token "<附件 token>" --output "$TEMPLATE_SOURCE"
```

**方式 B — 无 lark-cli**：请用户从文档附件手动下载到本地，告知保存路径作为 `TEMPLATE_SOURCE`。

> 已验证：该附件与已注册模板 `quectel_corporate_2026_cn` 的源文件 md5 一致（`fff0d5fddb7df79db60ad24e0ad9d8bd`），可直接用于第 3 节导入。

---

## 1. 前置条件检查（一条命令）

```bash
python3 --version   # 需 Python 3.10+；Windows 安装时须勾选 "Add to PATH"
git --version       # 需已安装 Git
```

- **Windows 注意**：本手册终端为 Git-Bash（MSYS），`python3` 直接可用；若提示找不到，试 `python --version` 或 `py --version`，并把后续命令中的 `python3` 替换为可用者（或统一用 `python3 -m pip ...`）。
- 不满足则先解决（Windows 下 Python 装好后重开终端；Git 用官方安装包默认选项）。
- 路径写法：`D:\...` 与 `/d/...` 等价，中文/空格路径务必加引号。

---

## 2. 安装 PPT-Master（git 拉取 + 依赖）

```bash
# 中国大陆优先 AtomGit 镜像（实测更快，本机即用此源）
git clone https://atomgit.com/hugohe3/ppt-master.git "$PPT_MASTER_HOME"

# GitHub 备选（镜像不可达时用）
# git clone https://github.com/hugohe3/ppt-master.git "$PPT_MASTER_HOME"

cd "$PPT_MASTER_HOME"

# 安装依赖（若 pip 与 python3 版本错位，改用：python3 -m pip install -r requirements.txt）
pip install -r requirements.txt
```

**安装验证**：

```bash
python3 -c "import pptx; print('python-pptx OK', pptx.__version__)"
ls skills/ppt-master/SKILL.md   # 工作流入口存在
```

---

## 3. 配置公司模板（核心）

流程：`pptx_template_import.py 解析源模板 → 按 skill 工作流生成模板包 → register_template.py 注册索引 → 验证`。

### 3.1 导入源模板生成参考工作区

```bash
cd "$PPT_MASTER_HOME"
python3 skills/ppt-master/scripts/pptx_template_import.py "$TEMPLATE_SOURCE"
```

默认在源文件旁生成 `<文件名>_template_import/` 参考工作区，包含：

- `manifest.json` — 版式/主题色/字体/资产清单等元数据（单一事实源）
- `native_structure.json` — 母版/版式/占位符结构契约
- `source_template.pptx` — 字节级原始副本
- `assets/` — 抽取的可复用图片资产
- `svg/` — 母版/版式/幻灯片分层 SVG 视图 + `inheritance.json`
- `conversion-report.json` — 转换保真度诊断

### 3.2 按 skill 工作流生成模板包（agent 智能步骤）

1. 读取入口：`skills/ppt-master/SKILL.md`（先运行 `python3 skills/ppt-master/scripts/attribution_guard.py` 通过完整性校验）
2. 读取工作流：`skills/ppt-master/workflows/create-template.md` → 公司模板属 **Deck** 类型，进入 `create-template/create-deck.md`
3. 以 3.1 的参考工作区为输入（Deck 采用 mirror 镜像复制模式），产出模板包到 **库级目录**：

```
skills/ppt-master/templates/decks/<template_id>/
├── templates/
│   ├── design_spec.md      # frontmatter: deck_id/kind/page_count/canvas_format/replication_mode 等
│   └── <NNN>_*.svg         # 每页一个模板 SVG（母版/版式/内容页全部覆盖）
├── images/                 # 复用的位图资产（SVG href 用 ../images/<name>）
└── icons/imported/         # 导入的矢量资产
```

4. `template_id` 命名规范：蛇形小写，如 `quectel_corporate_2026_cn`

### 3.3 注册到全局索引

```bash
python3 skills/ppt-master/scripts/register_template.py <template_id> --kind deck
```

> 注：若模板只给某个项目用（项目级），则写到 `projects/<项目>/templates/` 且**不**执行注册；生成 PPT 时该项目内直接消费。

### 3.4 验证配置成功（必须全过）

```bash
# ① 索引有条目
grep -A5 "<template_id>" skills/ppt-master/templates/decks/decks_index.json

# ② 模板包关键文件存在
ls skills/ppt-master/templates/decks/<template_id>/templates/design_spec.md
ls skills/ppt-master/templates/decks/<template_id>/templates/*.svg | wc -l   # 应等于源模板页数

# ③ 可选：模板质量校验
python3 skills/ppt-master/scripts/svg_quality_checker.py \
  skills/ppt-master/templates/decks/<template_id>/templates --template-mode
```

---

## 4. 后续使用方式（给任何 agent 的入口约定）

- 任何 PPT 任务入口固定为 `skills/ppt-master/SKILL.md`（路由：generate / template-fill / native-enhance 等）
- 生成新 PPT：走 `workflows/generate-pptx.md`，Step 3 选择模板时用已注册的 `<template_id>`（canvas `ppt169`）
- 新项目统一放 `projects/<项目名>/`（用 `project_manager.py init` 初始化）

---

## 5. 常见坑（实测经验）

| 坑 | 解法 |
|---|---|
| Windows git-bash 路径 | 用 `/d/...` 或 `D:\...` 均可；中文/空格路径务必加引号 |
| pip 与 python3 版本不一致 | 统一用 `python3 -m pip install ...` |
| 公司模板文件更新 | 重新执行 3.1~3.3 覆盖即可（模板包与索引都会重建） |
| `.env` 中的 API Key | 只影响 AI 生图/配音等增强功能，**不影响**安装与模板配置，可留空 |
| 国内访问 GitHub 慢/失败 | 用 AtomGit 镜像 clone（第 2 步） |
| agent 执行时疑似 skill 文件被改动 | 先跑 `attribution_guard.py`，非零结果立即停止并报告，不要自行绕过 |

---

## 6. 本机已验证事实（作为参照基准）

- 当前机器实际安装：`D:\AI\common\ppt-master`，remote = `https://atomgit.com/hugohe3/ppt-master.git`
- 已注册模板：`quectel_corporate_2026_cn`（Quectel 移远通信 2026 企业品牌演示模板，中文，50 页，ppt169 1280×720，主色 `#210079`，mirror 模式）
- 模板包规模：50 个模板 SVG + 位图/矢量资产
