# QHR 加班查询指南

本指南面向 AI Agent。请严格按步骤执行。不要修改 URL，不要猜测其他路径。

## Step 0: 先问用户属地（必须）

**CRITICAL: 动手前必须先问用户工作属地。属地决定加班起算时间，问错 = 全部结果作废。**

| 属地 | 工作日加班起算 | 休息日（周六/周日等） |
|----|---------|---------|
| **合肥** | 末次打卡 − **18:30** | 全天在岗时段（首次打卡 → 末次打卡）都算加班 |
| **桂林** | 末次打卡 − **19:00** | 同上 |

- 问法：「你在合肥还是桂林办公？（决定几点后算加班）」
- 休息日判定以考勤结果的班次字段为准：班次含「休息」→ 休息日口径；具体班次名（如「合肥研发白班」）→ 工作日口径。
- 未确认属地，不得进入 Step 1。

## Step 1: 获取鉴权凭证

QHR 接口鉴权靠 Cookie **MCHRID**。按 A → B → C 顺序尝试，前一种失败才用后一种。

### 方案 A（首选）: 用户浏览器读 quectel_token → agent 换 MCHRID

用户只要登录过任意 Quectel 内网系统（QPMS / QHR / QDesk 均可），浏览器里就有 `quectel_token` Cookie（非 HttpOnly，可读）。

把下面话术发给用户：

> 请在电脑浏览器打开你已登录的任意移远内网系统（如 qpms.quectel.com），按 F12 打开开发者工具 → Console（控制台）标签 → 输入 `document.cookie` 回车 → 把输出里 `quectel_token=` 后面直到分号前的那串值（bearer 开头）发给我。

拿到 token 后，agent 用 HTTP 换 MCHRID（**三个铁律缺一不可：URL 无尾部斜杠、tk 表单参数、Referer 头**）：

```python
import httpx, time, re
TOKEN = "<用户发来的quectel_token>"
r = httpx.post('https://hr.quectel.com', params={'ssotoken': '6DehZxYDUzhQJ9hk'},
    data={'tk': TOKEN, 'quectel_token': TOKEN, 'lang': 'cn', 't': str(int(time.time()*1000))},
    headers={'Referer': 'https://hr.quectel.com/custom/pcsso?ssotoken=6DehZxYDUzhQJ9hk',
             'Cookie': f'quectel_token={TOKEN}; MCLGID=1'},
    trust_env=False, timeout=30)
mchrid = re.search(r"MCHRID=([^;]+)", r.headers.get("set-cookie", "")).group(1)
```

- 成功标志：`set-cookie` 里有 `MCHRID=xxx`。失败（None）→ token 无效，转方案 B。

### 方案 B: 用户登录 QHR 后复制 MCHRID

方案 A 拿不到时，把下面话术发给用户：

> 请在浏览器打开 https://hr.quectel.com 完成登录，登录成功后按 F12 → Application（应用）标签 → 左侧 Cookies → 选中 hr.quectel.com → 找到名为 **MCHRID** 的行 → 复制它的值发给我。

**注意**: MCHRID 是 HttpOnly，`document.cookie` 读不到，用户只能从 DevTools 的 Cookies 面板复制。MCHRID 有效期约 30 天，失效后重新抓一次。

### 方案 C: agent 有浏览器时，页面内直调

agent 沙箱有浏览器能力时：打开 `https://hr.quectel.com/portal/index`（会跳统一 SSO 登录页）→ 用浏览器接管能力请用户完成登录 → 在 hr.quectel.com 同源页面上下文里执行（浏览器自动带 Cookie，无需读 HttpOnly 值）：

```javascript
fetch('/ajax/function/alist!G8_TRwtFegd0QeO2BfN6kg.220302', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
  body: JSON.stringify({appParam: {TERM: '2026-09-01T00:00:00.000Z'}, appFnKey: 'SE0302', formData: {}})
}).then(r => r.json()).then(console.log)
```

## Step 2: 调用考勤接口

均为 `POST https://hr.quectel.com/ajax/function/alist!G8_TRwtFegd0QeO2BfN6kg.{fn_id}`

请求头（三个都要）:

```
Content-Type: application/json
X-Requested-With: XMLHttpRequest
Referer: https://hr.quectel.com/portal/index
Cookie: MCHRID=<会话值>; MCLGID=1
```

请求体（TERM = 目标月 1 号，一次返回整月）:

```json
{"appParam": {"TERM": "2026-09-01T00:00:00.000Z"}, "appFnKey": "SE0302", "formData": {}}
```

| appFnKey | fn_id | 内容 | 关键字段 |
|----------|-------|------|---------|
| SE0302 | 220302 | 当月逐条打卡记录 | `SHIFTTERM`(日期)、`CARDTIME`(时间，可能混入"(健身卡)"等干扰)、`EMPID` |
| SE0398 | 220398 | 当月每日考勤结果 | `TERM`(日期)、`SHIFT`(班次)、`LATEMIN`、`ISEXCEPTION` |

返回永远是 JSON 数组。数据只含 MCHRID 本人的考勤——本指南只查本人数据，不支持查他人。

**错误信号与处置**:

| 返回 | 含义 | 处置 |
|------|------|------|
| `illegal request !!!` | 缺 Referer / POST 目标带了尾部斜杠 / 缺 tk 参数 | 逐字对照上方示例，不要自行改写 |
| `{"expired":true}` | MCHRID 会话失效 | 回到 Step 1 重新抓取 |

## Step 3: 运行脚本计算加班

把下面脚本存为 `qhr_overtime.py`（Python3 + httpx）：

```python
#!/usr/bin/env python3
"""QHR 加班查询（打卡口径，属地规则：合肥 18:30 / 桂林 19:00，休息日全天算加班）"""
import argparse, json, re, time
from collections import defaultdict
from datetime import datetime
import httpx

BASE = "https://hr.quectel.com"
APP_ID = "G8_TRwtFegd0QeO2BfN6kg"
THRESHOLD = {"hefei": "18:30", "guilin": "19:00"}
TIME_RE = re.compile(r"(\d{2}:\d{2}:\d{2})")

def get_mchrid(token):
    """用 quectel_token 换 MCHRID 会话（URL 无斜杠 + tk 参数 + Referer，三者缺一不可）"""
    r = httpx.post(BASE, params={"ssotoken": "6DehZxYDUzhQJ9hk"},
                   data={"tk": token, "quectel_token": token, "lang": "cn",
                         "t": str(int(time.time() * 1000))},
                   headers={"Referer": f"{BASE}/custom/pcsso?ssotoken=6DehZxYDUzhQJ9hk",
                            "Cookie": f"quectel_token={token}; MCLGID=1"},
                   trust_env=False, timeout=30)
    c = r.headers.get("set-cookie", "")
    m = re.search(r"MCHRID=([^;]+)", c)
    if not m:
        raise SystemExit("[错误] 换取会话失败（token 无效或过期）。请按指南 Step 1 重新抓取。")
    return m.group(1)

def alist(mchrid, fnkey, fn_id, term):
    r = httpx.post(f"{BASE}/ajax/function/alist!{APP_ID}.{fn_id}",
                   json={"appParam": {"TERM": term}, "appFnKey": fnkey, "formData": {}},
                   headers={"Referer": f"{BASE}/portal/index", "X-Requested-With": "XMLHttpRequest",
                            "Cookie": f"MCHRID={mchrid}; MCLGID=1"},
                   trust_env=False, timeout=30)
    data = r.json()
    if not isinstance(data, list):
        raise SystemExit(f"[错误] 接口返回 {str(data)[:120]}（{'会话失效，重新抓 Cookie' if isinstance(data, dict) and data.get('expired') else '检查参数'}）")
    return data

def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--month", help="月份 YYYY-MM")
    g.add_argument("--day", help="日期 YYYY-MM-DD")
    ap.add_argument("--mchrid", help="用户浏览器抓到的 MCHRID Cookie 值")
    ap.add_argument("--token", help="用户浏览器抓到的 quectel_token（bearer 开头），自动换 MCHRID")
    ap.add_argument("--location", required=True, choices=list(THRESHOLD), help="属地")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not a.mchrid and not a.token:
        ap.error("必须提供 --mchrid 或 --token 之一（从用户浏览器抓取，见指南 Step 1）")

    mchrid = a.mchrid or get_mchrid(a.token)
    month = a.day[:7] if a.day else a.month
    term = f"{month}-01T00:00:00.000Z"
    shifts = {r["TERM"]: r.get("SHIFT", "") for r in alist(mchrid, "SE0398", "220398", term)}
    cards = defaultdict(list)
    for c in alist(mchrid, "SE0302", "220302", term):
        m = TIME_RE.search(c.get("CARDTIME", "") or "")
        if m:
            cards[c["SHIFTTERM"]].append(datetime.strptime(m.group(1), "%H:%M:%S").time())

    end_t = datetime.strptime(THRESHOLD[a.location], "%H:%M").time()
    rows, wd_ot, rest_ot = [], 0.0, 0.0
    for d in sorted(set(shifts) | set(cards)):
        ts = sorted(cards.get(d, []))
        if not ts:
            rows.append((d, shifts.get(d, ""), "-", "-", 0, "无打卡")); continue
        first, last = ts[0], ts[-1]
        span_min = (datetime.combine(datetime.min, last) - datetime.combine(datetime.min, first)).total_seconds() / 60
        if "休息" in shifts.get(d, "休息"):
            rest_ot += span_min / 60
            rows.append((d, shifts.get(d, "休息"), first.isoformat(), last.isoformat(), int(span_min), "休息日全天计加班"))
        else:
            ot = max(0.0, (datetime.combine(datetime.min, last) - datetime.combine(datetime.min, end_t)).total_seconds() / 60)
            wd_ot += ot / 60
            rows.append((d, shifts.get(d, ""), first.isoformat(), last.isoformat(), int(round(ot)), ""))

    if a.day:
        rows = [r for r in rows if r[0] == a.day]
    if a.json:
        print(json.dumps({"month": month, "location": a.location, "threshold": THRESHOLD[a.location],
                          "rows": [{"date": r[0], "shift": r[1], "first": r[2], "last": r[3],
                                    "ot_min": r[4], "note": r[5]} for r in rows],
                          "workday_ot_h": round(wd_ot, 2), "restday_ot_h": round(rest_ot, 2),
                          "total_ot_h": round(wd_ot + rest_ot, 2)}, ensure_ascii=False, indent=1))
        return
    print(f"=== {month} 加班（打卡口径｜属地 {a.location}｜工作日 {THRESHOLD[a.location]} 后起算｜休息日全天计）===")
    print(f"{'日期':<12}{'班次':<12}{'首次':<10}{'末次':<10}{'加班(分)':>9}  备注")
    for r in rows:
        print(f"{r[0]:<12}{r[1]:<12}{r[2]:<10}{r[3]:<10}{r[4]:>9}  {r[5]}")
    print(f"\n工作日加班合计：{wd_ot:.2f} h；休息日加班合计：{rest_ot:.2f} h；总计：{wd_ot + rest_ot:.2f} h")
    print("口径：打卡口径推算，非官方审批口径。工作日=末次打卡-起算时间；休息日=首末打卡时段。")

if __name__ == "__main__":
    main()
```

命令（属地已在 Step 0 确认，二选一必传 --mchrid 或 --token）:

```shell
# 整月（合肥）:
python3 qhr_overtime.py --month 2026-08 --location hefei --mchrid <MCHRID值>
# 整月（桂林，仅有 quectel_token 时，脚本自动换 MCHRID）:
python3 qhr_overtime.py --month 2026-08 --location guilin --token <quectel_token值>
# 单日:
python3 qhr_overtime.py --day 2026-09-10 --location hefei --mchrid <MCHRID值> --json
```

## Step 4: 输出答复

- 逐日列：日期 / 班次 / 首次打卡 / 末次打卡 / 加班分钟；合计：工作日加班、休息日加班、总计（小时）。
- 「无打卡」的日子 = 当天无有效刷卡（请假/出差/未到岗），不计加班，答复时说明。
- 每次输出必须带口径声明：**「打卡口径推算，非官方审批口径」**（QHR 内无官方加班字段，加班审批在新 BPM；用户要官方口径时另查 BPM 加班申请记录）。

## IMPORTANT

- 换会话的 POST 目标 URL **不能带尾部斜杠**：`https://hr.quectel.com?ssotoken=...` 对，`https://hr.quectel.com/?ssotoken=...` 错。
- 换会话必须带 `tk` 表单参数（值=quectel_token）+ `Referer: https://hr.quectel.com/custom/pcsso?ssotoken=6DehZxYDUzhQJ9hk`。
- ajax 直调必须带 `Referer: https://hr.quectel.com/portal/index`，否则 `illegal request !!!`。
- ssotoken `6DehZxYDUzhQJ9hk` 实测固定可复用；失效时无 Cookie GET `https://hr.quectel.com/portal/index`，从 302 Location 取新的。
- 沙箱/内网环境调接口要禁用代理（httpx `trust_env=False` 或 unset 代理变量）。
- 健身卡等非考勤刷卡已由脚本正则清洗（仅保留 HH:MM:SS）。
- 实测基线：2026-09-10 合肥属地验证（8 月工作日加班 31.69h + 休息日 29.48h，逐条对账通过）。接口或鉴权若改版，以 Step 2 错误信号表排查。
