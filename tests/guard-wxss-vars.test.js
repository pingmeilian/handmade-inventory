// tests/guard-wxss-vars.test.js —— WXSS 里「引用了未定义 CSS 变量」的防回归守卫
//
// 背景（2026-09-14 开发长按预览时踩到）：我在新样式里写了
//   border-top: 1rpx dashed var(--color-border);
// 但项目里根本没有 --color-border（真名是 --color-divider）。
// 微信**不会报错**，这条 border 静默失效——界面上少一条虚线，
// 谁也不知道为什么。这类「CSS 变量名写错」是纯静默失败：
// 编辑器不提示、运行时无日志、只有肉眼比设计稿才能发现。
//
// 守卫生效范围：所有 .wxss 里 var(--xxx) 引用的变量，必须在 app.wxss 的 page 作用域里定义。
// （组件内联定义、:host 等场景本项目未使用，故不做豁免。）

const path = require('path');
const fs = require('fs');
const { test, group, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.wxss$/.test(f)) out.push(p);
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

// app.wxss 里声明的变量名
function definedVars() {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8'));
  const names = new Set();
  const re = /(--[\w-]+)\s*:/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

// 组件可以在 wxml 里把变量「注入」进来（style="--x:{{v}}"），这属于合法用法
function injectedVars() {
  const names = new Set();
  walkAll(ROOT, [])
    .filter((p) => /\.wxml$/.test(p))
    .forEach((p) => {
      const src = fs.readFileSync(p, 'utf8');
      const re = /(--[\w-]+)\s*:/g;
      let m;
      while ((m = re.exec(src))) names.add(m[1]);
    });
  return names;
}

function walkAll(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  });
  return out;
}

// 说明：曾有一份 LEGACY_ALLOW 白名单，临时放行旧版设计规范遗留的 token 名。
// 2026-09-14 已把这 16 处引用全部改回现行 token，白名单随之删除 ——
// 现在任何一种未定义的变量引用都会被拦下，没有例外。
const LEGACY_ALLOW = [];

group('WXSS 变量 · 源码扫描守卫');

test('所有 var(--x) 引用的变量都必须有来源（app.wxss / 同文件 / wxml 注入 / 自带兜底值）', () => {
  const defined = definedVars();
  const injected = injectedVars();
  const offenders = [];

  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    // 同文件内自己声明的变量也算已定义
    const local = new Set();
    let lm;
    const localRe = /(--[\w-]+)\s*:/g;
    while ((lm = localRe.exec(src))) local.add(lm[1]);

    // 只挑出 var(--x) 且**没有兜底值**的引用（var(--x, fallback) 属于优雅降级，放行）
    const re = /var\(\s*(--[\w-]+)\s*([,)])/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      if (m[2] === ',') continue;                       // 有兜底值 → 放行
      if (defined.has(name) || injected.has(name) || local.has(name)) continue;
      if (LEGACY_ALLOW.indexOf(name) >= 0) continue;     // 既有遗留，另行登记
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(rel + ':' + line + ' 引用了未定义的 ' + name);
    }
  });

  equal(
    offenders.length, 0,
    '以下样式引用了未定义的 CSS 变量（微信不报错，样式会静默失效）：\n' + offenders.join('\n')
  );
});

test('守卫自检：app.wxss 至少定义了主色，说明变量表被正确解析（防止守卫把文件读空而恒绿）', () => {
  const defined = definedVars();
  if (!defined.has('--color-primary')) {
    throw new Error('未能从 app.wxss 解析出 --color-primary —— 守卫可能失效了，请检查解析逻辑');
  }
});
