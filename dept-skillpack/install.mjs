#!/usr/bin/env node
/**
 * install.mjs —— 技能包客户端：装一次，之后只管 upgrade
 *
 *   node install.mjs install  [--source <url|file|dir>] [--dir <skillsRoot>]
 *   node install.mjs status
 *   node install.mjs upgrade  [--source ...]
 *   node install.mjs doctor
 *   node install.mjs auth     [--only <legId>]
 *
 * 设计取舍（对齐 lark-cli / quectel-cli 的实测做法）：
 *   - 清单里每个技能带 sha256 → 「变没变」是内容比对，不是版本号比对；
 *     作者忘改版本号也不会漏更新，改了版本号但内容没变也不会白下载。
 *   - 状态文件记「当初装了哪些」→ 用户手动删掉的技能不会被 upgrade 复活
 *     （lark-cli 的 skills-state.json 里叫 skipped_deleted_skills）。
 *   - 先写临时目录再原子换目录 → 升级中途失败不会留下半个技能。
 *   - 只依赖 Node 内置模块：同事机器上不需要 npm install。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'status';
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const flag = (name) => args.includes(`--${name}`);

const DEFAULT_MANIFEST = 'https://scnrhostplnc.feishuapp.com/app/app_17e9s6q40gg/openapi/skillpack/payload';

/**
 * 默认取包位置，按「先本地后远端」：
 *
 *   1. **和本脚本同目录的 pack-*.json** —— 从整合包 zip 里跑的情况。
 *      包里本来就带着投递体，没有任何理由再去网上拿一次；
 *      而且平台整站在飞书 SSO 后面，机器裸 fetch 会 403。
 *   2. 平台 /openapi 地址 —— 直接用脚本（没带投递体）时才走这条，需要 API Key。
 */
function defaultSource() {
  try {
    const sibling = fs
      .readdirSync(HERE)
      .filter((f) => /^pack-.*\.json$/.test(f))
      .sort()
      .pop();
    if (sibling) return path.join(HERE, sibling);
  } catch {
    // 读不到同目录就当没有
  }
  return DEFAULT_MANIFEST;
}

const SOURCE = arg('source', process.env.SKILLPACK_SOURCE || defaultSource());
/** 平台开放接口的 API Key；平台整站在飞书 SSO 后面，机器取包只能走 /openapi + Key */
const API_KEY = arg('key', process.env.SKILLPACK_API_KEY || '');
const API_KEY_HEADER = arg('key-header', process.env.SKILLPACK_API_KEY_HEADER || '');
function detectSkillsRoot() {
  if (process.env.HERMES_HOME) return path.join(process.env.HERMES_HOME, 'skills');
  if (process.env.AILY_WORKSPACE) return path.join(process.env.AILY_WORKSPACE, 'skills');
  const ailyWorkspace = path.join(os.homedir(), '.aily', 'workspace');
  if (fs.existsSync(ailyWorkspace)) return path.join(ailyWorkspace, 'skills');
  return path.join(os.homedir(), '.claude', 'skills');
}

const SKILLS_ROOT = path.resolve(
  (arg('dir', process.env.SKILLPACK_SKILLS_ROOT || detectSkillsRoot())).replace(/^~(?=[\\/]|$)/, os.homedir()),
);
const HOME = path.resolve(
  (arg('home', process.env.SKILLPACK_HOME || path.join(os.homedir(), '.skillpack'))).replace(/^~(?=[\\/]|$)/, os.homedir()),
);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

// ---------------------------------------------------------------- 载荷获取

/**
 * 平台的对外开放接口（/openapi/**）走网关的 API Key 鉴权。
 *
 * 头名没有权威文档，所以**不猜**：给一组候选逐个试，用通了的那个，并把结果打印出来。
 * 首选 `Authorization: Bearer`——生产环境不带 key 访问 /openapi 时，
 * 网关返回的是 `missing or invalid Authorization header`（实测 2026-09-21），
 * 这句话本身就把头名指出来了。
 */
const KEY_HEADER_CANDIDATES = [
  { name: 'Authorization', value: (k) => `Bearer ${k}` },
  { name: 'X-Api-Key', value: (k) => k },
  { name: 'X-API-Key', value: (k) => k },
  { name: 'api-key', value: (k) => k },
  { name: 'X-Openapi-Key', value: (k) => k },
];

async function fetchWithKey(url, key, explicitHeader) {
  if (!key) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    return { res, header: null };
  }
  if (explicitHeader) {
    const res = await fetch(url, { headers: { accept: 'application/json', [explicitHeader]: key } });
    return { res, header: explicitHeader };
  }
  let last = null;
  for (const cand of KEY_HEADER_CANDIDATES) {
    const headers = { accept: 'application/json', [cand.name]: cand.value(key) };
    const res = await fetch(url, { headers });
    last = res;
    if (res.ok) {
      console.log(`  ${C.dim(`API Key 生效（请求头 ${cand.name}）`)}`);
      return { res, header: cand.name };
    }
    // 401/403 说明这个头名不对，继续试；其它状态码说明已经过了网关，直接用
    if (res.status !== 401 && res.status !== 403) return { res, header: cand.name };
  }
  console.log(
    `  ${C.warn(`候选请求头都没通过：${KEY_HEADER_CANDIDATES.map((c) => c.name).join(', ')}（用 --key-header 指定正确的那个）`)}`,
  );
  return { res: last, header: null };
}

async function loadPack(source, key, keyHeader) {
  const local = source.startsWith('http://') || source.startsWith('https://') ? null : path.resolve(source.replace(/^~(?=[\\/]|$)/, os.homedir()));
  if (local) {
    const stat = fs.statSync(local, { throwIfNoEntry: false });
    if (!stat) throw new Error(`找不到：${local}`);
    const file = stat.isDirectory() ? findPayloadInDir(local) : local;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const { res } = await fetchWithKey(source, key, keyHeader);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `${source} → HTTP ${res.status}${body ? ` ${body.slice(0, 120)}` : ''}` +
        (res.status === 302 || res.status === 401 || res.status === 403
          ? '\n  提示：/api 路由在飞书 SSO 后面，机器取不到；请用 /openapi/skillpack/payload 并带 API Key（--key / SKILLPACK_API_KEY）。'
          : ''),
    );
  }
  return await res.json();
}

function findPayloadInDir(dir) {
  const hit = fs.readdirSync(dir).filter((f) => /^pack-.*\.json$/.test(f)).sort().pop();
  if (!hit) throw new Error(`${dir} 里没有 pack-*.json`);
  return path.join(dir, hit);
}

// ---------------------------------------------------------------- 本地状态

const stateFile = () => path.join(HOME, 'state.json');

function readState() {
  const f = stateFile();
  if (!fs.existsSync(f)) return { packs: {} };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function writeState(state) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 目录内容指纹 —— 必须与 build.mjs 的 walk+hash 完全同序同法，
 * 否则「刚装完就报本地有改动」。
 *
 * 关键：用相对路径的默认字符串排序（码位序），**不要**用 localeCompare
 * ——后者是语言相关的，'references' 会排到 'SKILL.md' 前面。
 */
function shaOf(dir) {
  const h = crypto.createHash('sha256');
  if (!fs.existsSync(dir)) return null;
  const walk = (d, base = d) => {
    const out = [];
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) out.push(...walk(abs, base));
      else if (ent.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
    return out;
  };
  for (const rel of walk(dir).sort()) {
    h.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel), 'utf8')).update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- 安装动作

function writeSkill(root, skill, { force = false } = {}) {
  const dest = path.join(root, skill.code);
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of skill.files) {
    const abs = path.join(tmp, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }
  if (fs.existsSync(dest)) {
    const bak = `${dest}.bak-${Date.now()}`;
    fs.renameSync(dest, bak);
    try {
      fs.rmSync(bak, { recursive: true, force: true });
    } catch {
      // 备份删不掉不影响使用，下次 upgrade 会再清
    }
  }
  fs.renameSync(tmp, dest);
  void force;
}

/**
 * 「用户手动删掉的技能」= 上一次记录在安装集里、但目录已经不在本地了。
 * install / upgrade 都不复活它们（对齐 lark-cli 的 skipped_deleted_skills 语义）：
 * 同事删掉不需要的技能是个正当决定，不该被下一次升级悄悄推翻。
 */
function userRemoved(rec) {
  const root = rec?.skillsRoot || SKILLS_ROOT;
  const gone = new Set();
  for (const code of rec?.skills ?? []) {
    if (!fs.existsSync(path.join(root, code))) gone.add(code);
  }
  return gone;
}

function cmdInstall(pack) {
  fs.mkdirSync(SKILLS_ROOT, { recursive: true });
  const state = readState();
  const prev = state.packs[pack.pack.id];
  const fresh = !prev;
  if (fresh) {
    // 沙箱重建后状态文件会丢、技能目录却还在。提示一下，避免同事以为「莫名其妙重装了一遍」。
    const present = pack.skills.filter((s) => fs.existsSync(path.join(SKILLS_ROOT, s.code))).length;
    if (present > 0) {
      console.log(`  ${C.dim(`提示：${SKILLS_ROOT} 下已有 ${present} 个本包技能，但没有安装状态文件（沙箱重建后常见）。本次按首次安装处理，会刷新这些技能。`)}`);
    }
  }
  const known = new Set(prev?.skills ?? []);
  const gone = userRemoved(prev);
  let n = 0;
  const installed = new Set();
  for (const skill of pack.skills) {
    if (gone.has(skill.code)) {
      console.log(`  ${C.dim('跳过')} ${skill.code} ${C.dim('（你删过它，不复活）')}`);
      installed.add(skill.code);
      continue;
    }
    if (!fresh && !known.has(skill.code)) {
      console.log(`  ${C.dim('跳过')} ${skill.code} ${C.dim('（不在你的安装集里）')}`);
      continue;
    }
    writeSkill(SKILLS_ROOT, skill);
    installed.add(skill.code);
    n++;
    console.log(`  ${C.ok('✓')} ${skill.code}`);
  }
  state.packs[pack.pack.id] = {
    version: pack.pack.version,
    installedAt: prev?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    skillsRoot: SKILLS_ROOT,
    skills: [...installed],
    skippedDeleted: [...gone],
    hashes: Object.fromEntries(pack.skills.filter((s) => installed.has(s.code)).map((s) => [s.code, s.sha256])),
  };
  writeState(state);
  console.log(`\n${C.b(pack.pack.name)} v${pack.pack.version} → ${SKILLS_ROOT}`);
  console.log(`装了 ${n} 个技能。下一步：${C.b('node install.mjs doctor')} 做一次授权体检。`);
}

function cmdStatus(pack) {
  const state = readState();
  const rec = state.packs?.[pack.pack.id];
  if (!rec) {
    console.log(`${C.warn('未安装')} ${pack.pack.name}（远端 v${pack.pack.version}）`);
    console.log(`安装：${C.b('node install.mjs install')}`);
    return;
  }
  console.log(`${C.b(pack.pack.name)}  本地 v${rec.version}  远端 v${pack.pack.version}`);
  console.log('');
  let stale = 0;
  let gone = 0;
  for (const skill of pack.skills) {
    const dir = path.join(rec.skillsRoot || SKILLS_ROOT, skill.code);
    const localSha = shaOf(dir);
    const recorded = rec.hashes?.[skill.code];
    let tag;
    if (localSha === null) {
      tag = C.dim('未安装');
      gone++;
    } else if (localSha === skill.sha256) {
      tag = C.ok('最新');
    } else if (localSha === recorded) {
      tag = C.warn('可更新');
      stale++;
    } else {
      tag = C.warn('本地有改动');
      stale++;
    }
    console.log(`  ${skill.code.padEnd(26)} ${String(skill.sha256).padEnd(18)} ${tag}`);
  }
  console.log('');
  if (stale === 0 && gone === 0) console.log(C.ok('全部是最新的。'));
  else {
    if (stale) console.log(`${stale} 个技能可更新。执行：${C.b('node install.mjs upgrade')}`);
    if (gone) console.log(C.dim(`${gone} 个技能本地没有（可能被你删过），upgrade 不会自动装回来。`));
  }
}

function cmdUpgrade(pack) {
  const state = readState();
  const rec = state.packs?.[pack.pack.id];
  if (!rec) {
    console.log(`${C.warn('还没装过')}，先跑 install。`);
    process.exitCode = 1;
    return;
  }
  const root = rec.skillsRoot || SKILLS_ROOT;
  const gone = userRemoved(rec);
  let n = 0;
  for (const skill of pack.skills) {
    if (gone.has(skill.code)) {
      console.log(`  ${C.dim('跳过')} ${skill.code} ${C.dim('（你删过它，不复活）')}`);
      continue;
    }
    if (!rec.skills.includes(skill.code)) {
      console.log(`  ${C.dim('跳过')} ${skill.code} ${C.dim('（不在你的安装集里）')}`);
      continue;
    }
    const localSha = shaOf(path.join(root, skill.code));
    if (localSha === skill.sha256) {
      console.log(`  ${C.dim('=')} ${skill.code}`);
      continue;
    }
    if (localSha !== null && localSha !== rec.hashes?.[skill.code]) {
      console.log(`  ${C.warn('!')} ${skill.code} ${C.warn('本地被改过，仍按远端覆盖')}`);
    } else {
      console.log(`  ${C.ok('↑')} ${skill.code}`);
    }
    writeSkill(root, skill);
    rec.hashes[skill.code] = skill.sha256;
    n++;
  }
  rec.version = pack.pack.version;
  rec.upgradedAt = new Date().toISOString();
  rec.skippedDeleted = [...gone];
  writeState(state);
  console.log(`\n更新了 ${n} 个技能 → v${pack.pack.version}`);
}

// ---------------------------------------------------------------- 体检 / 授权

/**
 * 依赖的安装方法。
 *
 * 为什么是「装」而不是「打包带过来」：lark-cli 是 npm 壳 + postinstall 下载的
 * 平台原生二进制（~49MB），三平台就是 ~150MB，而且它每周发版——塞进包里今天打的
 * 明天就过期，还会和它自己的 `lark-cli update` 打架。所以包里只放**怎么装**，
 * 不放二进制。
 */
const DEP_RECIPES = {
  'quectel-cli': {
    check: 'quectel-cli --version',
    cmd: null, // 内网安装包，没有通用命令——如实告知，别编一个跑不通的
    hint: '内部安装包 / 内网 npm 源，按部门公告安装；装完用 `quectel-cli status` 确认',
  },
  'lark-cli': {
    check: 'lark-cli --version',
    cmd: 'npm install -g @larksuite/cli@latest',
    alt: 'npx @larksuite/cli@latest install',
    hint: 'npm 全局装；postinstall 会下载平台原生二进制并校验 checksums',
  },
  python: {
    check: 'python --version',
    cmd: null,
    hint: '装 Python 3.10+ 后补包：pip install msal cryptography requests',
  },
  node: {
    check: 'node --version',
    cmd: null,
    hint: '装 Node.js 20+（https://nodejs.org）',
  },
};

/** Windows 上 bin 可能是 .cmd/.ps1，只能过 shell；拼成整串以免 DEP0190 */
function shellRun(bin, argv) {
  const quoted = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const line = [bin, ...argv].map(quoted).join(' ');
  return spawnSync(line, { encoding: 'utf8', shell: true });
}

/** 跑一条命令并把输出透传（给 deps --fix 用） */
function shellRunLive(line) {
  return spawnSync(line, { stdio: 'inherit', shell: true });
}

function binOk(bin) {
  const r = shellRun(bin, ['--version']);
  return !(r.error && r.error.code === 'ENOENT') && r.status === 0;
}

function runCheck(leg) {
  if (!leg.check) return { ok: null, detail: '无自检命令' };
  const r = shellRun(leg.check.bin, leg.check.args ?? []);
  if (r.error && r.error.code === 'ENOENT') return { ok: false, detail: `没装 ${leg.check.bin}` };
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  // 「命令存在、但这个 build 没带该子命令」不等于「未就绪」：
  // 实测部分 lark-cli 发布 build 会报 "command not included in this build"，
  // 这类情况如实标记为「无法自检」，不要制造假警报。
  if (/command not included|not included in this build|unknown command|unrecognized (sub)?command|is not a .*command|命令不存在|没有此命令/i.test(out)) {
    return { ok: null, detail: '无法自检（该版本没有此命令，跳过）' };
  }
  if (r.status !== 0) {
    // 自检失败时优先给一句人能看懂的话，别把 Python traceback 甩到脸上
    return { ok: false, detail: leg.check.failHint || out.split('\n')[0] || `退出码 ${r.status}` };
  }
  if (leg.check.expect && !out.includes(leg.check.expect)) {
    return { ok: false, detail: leg.check.failHint || out.split('\n')[0] || `输出里没有 ${leg.check.expect}` };
  }
  return { ok: true, detail: out.split('\n')[0] || 'ok' };
}

/** 包内每个技能的依赖声明 → 展开成一份「谁需要它」的说明 */
function requiredBins(pack) {
  const map = new Map();
  for (const s of pack.skills) {
    for (const b of s.requires?.bins ?? []) {
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(s.code);
    }
  }
  return map;
}

function cmdDoctor(pack) {
  console.log(`${C.b('依赖体检')}\n`);
  const bins = requiredBins(pack);
  const missing = [];
  for (const bin of [...bins.keys()].sort()) {
    const ok = binOk(bin);
    const recipe = DEP_RECIPES[bin];
    const ver = ok ? `${shellRun(bin, ['--version']).stdout ?? ''}`.trim().split('\n')[0].slice(0, 50) : '';
    console.log(`  ${ok ? C.ok('✓') : C.bad('✗')} ${bin.padEnd(14)} ${C.dim(ok ? ver : '未安装')}  ${C.dim(`← ${bins.get(bin).join(', ')}`)}`);
    if (!ok) missing.push({ bin, recipe });
  }
  console.log(`\n${C.b('授权腿体检')}\n`);
  let missingLegs = 0;
  let uncheckedLegs = 0;
  for (const leg of pack.auth) {
    const { ok, detail } = runCheck(leg);
    if (ok === false) missingLegs++;      // 「无法自检」（ok=null）不计入未就绪
    if (ok === null) uncheckedLegs++;
    const tag = ok === true ? C.ok('已就绪') : ok === false ? (leg.required ? C.bad('未就绪') : C.warn('未就绪')) : C.dim('无法自检');
    console.log(`  ${tag}  ${leg.label.padEnd(24)} ${C.dim(detail ?? '')}`);
    console.log(`        ${C.dim(`覆盖：${(leg.covers ?? []).join(', ') || '—'}`)}`);
    if (leg.id === 'quectel-sso' && ok === false) {
      console.log(`        ${C.warn('提示')} 登过却报未登录？先核对 ${C.b('QUECTEL_CLI_HOME')} 是否与登录时一致（\`quectel-cli status\` 会打印实际查找的 Credentials 路径）；一条凭据覆盖 PMS 查询与工时填报，别重复登录。`);
    }
  }
  console.log('');
  if (missing.length) {
    console.log(`${C.bad(`${missing.length} 个外部依赖没装`)}：${missing.map((m) => m.bin).join(', ')}`);
    console.log(`执行 ${C.b('node install.mjs deps')} 看安装方法，或 ${C.b('node install.mjs deps --fix')} 直接装。`);
  }
  if (missingLegs === 0 && missing.length === 0) {
    console.log(C.ok(`全部就绪。${uncheckedLegs ? `（其中 ${uncheckedLegs} 条腿无法自检，见上方说明）` : ''}`));
  } else if (missingLegs) console.log(`${missingLegs} 条授权腿未就绪。执行：${C.b('node install.mjs auth')}`);
}

/**
 * deps —— 把缺的外部依赖装上。
 *
 * 默认只**打印**要跑什么；`--fix` 才真的执行。CLI 是系统级安装，
 * 不该在一次「看看我缺什么」的调用里悄悄发生。
 */
function cmdDeps(pack) {
  const fix = flag('fix');
  const bins = requiredBins(pack);
  const missing = [...bins.keys()].filter((b) => !binOk(b)).sort();

  if (!missing.length) {
    console.log(C.ok('外部依赖都齐了。'));
    return;
  }

  console.log(`${C.b('缺这些外部依赖')}\n`);
  let ran = 0;
  let manual = 0;
  for (const bin of missing) {
    const r = DEP_RECIPES[bin];
    console.log(`  ${C.b(bin)} ${C.dim(`← ${bins.get(bin).join(', ')}`)}`);
    if (!r) {
      console.log(`    ${C.warn('没有内置安装方法')}，请按部门公告安装`);
      manual++;
    } else if (!r.cmd) {
      console.log(`    ${C.warn('没有通用安装命令')}：${r.hint}`);
      manual++;
    } else if (!fix) {
      console.log(`    ${C.b(r.cmd)}`);
      if (r.alt) console.log(`    ${C.dim(`备选：${r.alt}`)}`);
      console.log(`    ${C.dim(r.hint)}`);
    } else {
      console.log(`    $ ${r.cmd}`);
      const res = shellRunLive(r.cmd);
      if (res.status === 0 && binOk(bin)) {
        console.log(`    ${C.ok('✓ 装好了')}`);
        ran++;
      } else {
        console.log(`    ${C.bad('✗ 没成功')}${r.alt ? `，试试备选：${r.alt}` : '，请手动装'}`);
        manual++;
      }
    }
    console.log('');
  }

  if (!fix) {
    console.log(`加 ${C.b('--fix')} 直接执行上面能自动执行的；装完再跑一次 ${C.b('node install.mjs doctor')}。`);
  } else {
    console.log(`自动装了 ${ran} 个，另有 ${manual} 个需要手动处理。装完再跑一次 ${C.b('node install.mjs doctor')}。`);
  }
  // 需要人工处理的存在时不算失败——它只是「这里帮不上忙」，不是命令出错
}

function cmdAuth(pack) {
  const only = arg('only', null);
  for (const leg of pack.auth) {
    if (only && leg.id !== only) continue;
    const { ok, detail } = runCheck(leg);
    if (ok === true) {
      console.log(`\n${C.ok('✓')} ${leg.label} ${C.dim('已就绪，跳过')}`);
      continue;
    }
    console.log(`\n${C.b('▶')} ${leg.label} ${C.dim(`(${detail ?? ''})`)}`);
    console.log(`  这条腿管这些技能：${(leg.covers ?? []).join(', ') || '—'}`);
    for (const line of leg.hint ?? []) console.log(`    ${C.b(line)}`);
    if (leg.note) console.log(`  ${C.warn('注意')} ${leg.note}`);
    if (leg.required) console.log(`  ${C.dim('这条腿是必装的：不走完，包里的技能查不到数据。')}`);
    else console.log(`  ${C.dim('可选：不需要这条腿的能力可以跳过。')}`);
  }
  console.log(`\n走完后再跑一次 ${C.b('node install.mjs doctor')} 确认。`);
}

// ---------------------------------------------------------------- 入口

const usage = `${C.b('技能包')}

  node install.mjs install [--source <url|file|dir>] [--key <apiKey>] [--key-header <name>] [--dir <skillsRoot>]
  node install.mjs status  [--source ...] [--key ...]
  node install.mjs upgrade [--source ...] [--key ...]
  node install.mjs doctor
  node install.mjs auth [--only <legId>]
  node install.mjs deps [--fix]

取包位置（不给 --source 时）：优先用**和本脚本同目录**的 pack-*.json（整合包里的那份），
没有才去平台 /openapi 取（需要 SKILLPACK_API_KEY）。
环境变量：SKILLPACK_HOME / SKILLPACK_SKILLS_ROOT / SKILLPACK_SOURCE / SKILLPACK_API_KEY / SKILLPACK_API_KEY_HEADER
默认技能目录：${SKILLS_ROOT}`;

try {
  if (cmd === 'help' || flag('help')) {
    console.log(usage);
    process.exit(0);
  }
  const pack = await loadPack(SOURCE, API_KEY, API_KEY_HEADER);
  if (!pack.skills) throw new Error('载荷不是技能包（缺 skills 字段）');
  switch (cmd) {
    case 'install':
      cmdInstall(pack);
      break;
    case 'status':
      cmdStatus(pack);
      break;
    case 'upgrade':
      cmdUpgrade(pack);
      break;
    case 'doctor':
      cmdDoctor(pack);
      break;
    case 'auth':
      cmdAuth(pack);
      break;
    case 'deps':
      cmdDeps(pack);
      break;
    default:
      console.log(usage);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`${C.bad('失败')} ${err.message}`);
  process.exitCode = 1;
}
void execFileSync;
