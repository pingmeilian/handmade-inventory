// tests/guard-demo-entry.test.js —— 「开发期演示数据入口泄漏到生产」的防回归守卫
//
// 背景（2026-09-14 上线前全面检查发现）：pages/settings/checkup.wxml 里有一个
// 「开发 · 填充演示数据」按钮（bindtap="fillDemo"），而 checkup 页有**常驻菜单入口**
// （我的 → 数据体检，见 pages/mine/mine.wxml），所以它对用户 100% 可达 —— 一点就追加
// 约 200 条演示数据（张女士/李先生…），**污染真实账目**，且按钮上的"开发"字样审核可见。
// 开发者自己在 checkup.js 里留了「⚠️ 开发期工具：上架前移除此按钮」，但没执行。
//
// 本守卫把这条纪律**变成机器可查**（只靠注释提醒等于没有提醒）：
//   ① 生产目录的 .wxml 里不得出现 fillDemo 绑定；
//   ② 生产目录的 .js 里不得引用 demo 模块（services/ 或 tools/ 下的都算）；
//   ③ services/demo.js 不得存在 —— 演示数据生成器必须待在开发区（tools/），
//      靠 packOptions.ignore 排除在代码包之外。
//
// 验收方式（注入法，证明守卫"有牙"）：
//   把 <view bindtap="fillDemo"> 放回任意生产 wxml → ①② 立刻变红。

const path = require('path');
const fs = require('fs');
const { test, group, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

// 开发区 / 非代码包目录：这些地方允许出现 demo 相关字样
const NOT_IN_PACKAGE = ['tests/', 'tools/', 'docs/', '.git/', '.workbuddy/'];

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function inPackage(r) {
  return !NOT_IN_PACKAGE.some((skip) => r.indexOf(skip) === 0);
}

// wxml 注释是 <!-- -->，与 js 的 // 不同，必须分开剥 ——
// 否则「删掉按钮、把绑定留在注释里」会被误判成"还在"，守卫就失去了意义。
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function stripWxmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

group('开发期演示数据入口 · 源码扫描守卫');

test('生产 .wxml 不得出现 fillDemo 绑定（开发按钮必须已移除）', () => {
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    if (!/\.wxml$/.test(p)) return;
    const r = rel(p);
    if (!inPackage(r)) return;
    const code = stripWxmlComments(fs.readFileSync(p, 'utf8'));
    if (/bindtap\s*=\s*["']fillDemo["']/.test(code)) offenders.push(r);
  });
  equal(
    offenders.length, 0,
    '以下页面仍有「填充演示数据」开发按钮（用户可达 → 会灌入假数据）：\n' + offenders.join('\n')
  );
});

test('生产 .js 不得引用 demo 模块（services/demo 或 tools/demo）', () => {
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    if (!/\.js$/.test(p)) return;
    const r = rel(p);
    if (!inPackage(r)) return;
    const code = stripJsComments(fs.readFileSync(p, 'utf8'));
    if (/require\s*\(\s*['"][^'"]*\bdemo\.js['"]\s*\)/.test(code)) offenders.push(r + '  (require demo.js)');
    if (/\bdemo\.fillDemoData\s*\(/.test(code)) offenders.push(r + '  (调用 demo.fillDemoData)');
  });
  equal(
    offenders.length, 0,
    '以下生产文件仍引用演示数据生成器（会被打进代码包）：\n' + offenders.join('\n')
  );
});

test('services/demo.js 不得存在 —— 演示数据生成器应待在开发区 tools/', () => {
  const p = path.join(ROOT, 'services', 'demo.js');
  equal(
    fs.existsSync(p), false,
    'services/demo.js 存在 —— 它会被打进小程序代码包；请移到 tools/（并确保 packOptions.ignore 排除 tools/）'
  );
});
