// tests/guard-clipboard.test.js —— 剪贴板写入的守卫：不许再出现"没有 fail 回调"的裸调用
//
// 根因记录（2026-09-14）：`wx.setClipboardData` 在真机上会失败（系统拒绝、隐私限制），
// 而项目里 4 处调用**全都没接 fail** → 失败时什么都不发生。
// 用户感知就是「点了没反应」（既没跳转、也没提示），和本次「前往原视频」报的现象一致。
//
// 所以把"复制"这件事收口到 util.copyText（空内容 / 失败 / 异常三条路径都有反馈），
// 并用这道守卫防止它被绕过。
const { test, group, ok, equal } = require('./harness.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git' || f === 'tests' || f === 'tools') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  });
  return out;
}

function srcFiles() {
  return walk(ROOT, []).filter((p) => /\.(js|wxml)$/.test(p));
}

// 剥掉注释再扫描：注释里出现"长按复制"不该算成页面对用户的提示
// （`[^:]` 是为了不误伤 URL 里的 `//`）
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

group('剪贴板守卫 · 防"没接 fail 的裸调用"复发');

test('★ 页面 / 组件里不许直接调 wx.setClipboardData（必须走 util.copyText）', () => {
  const offenders = [];
  srcFiles().forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel === 'utils/util.js') return;                 // 收口点自己当然可以调
    const src = fs.readFileSync(p, 'utf8');
    if (/wx\.setClipboardData\s*\(/.test(src)) offenders.push(rel);
  });
  equal(
    offenders.length, 0,
    '以下文件绕过了 util.copyText 直接写剪贴板（失败时会静默，用户"点了没反应"）：\n' + offenders.join('\n')
  );
});

test('★ util.copyText 必须同时接 success 与 fail（缺 fail = 静默失败）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/util.js'), 'utf8');
  const i = src.indexOf('function copyText');
  ok(i >= 0, 'util.js 里应有 copyText');
  const body = src.slice(i, i + 1400);
  ok(/setClipboardData/.test(body), 'copyText 应调用 setClipboardData');
  ok(/success\s*:/.test(body), 'copyText 必须接 success');
  ok(/\bfail\s*:/.test(body), 'copyText 必须接 fail（真机上它会失败）');
  ok(/try\s*\{/.test(body), 'copyText 还要 try/catch 兜住同步异常');
});

test('空内容也不能静默：copyText 对空文本要给提示并返回 false', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/util.js'), 'utf8');
  const body = src.slice(src.indexOf('function copyText'), src.indexOf('function copyText') + 1400);
  ok(/trim\(\)/.test(body), '应判断空内容');
  ok(/没有可复制的内容|emptyText/.test(body), '空内容要有提示文案');
});

test('守卫自检：扫描确实覆盖到了页面文件（防止把目录读空而恒绿）', () => {
  const files = srcFiles().map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));
  ok(files.indexOf('pages/want/detail.js') >= 0, '扫描结果里应包含页面文件');
  ok(files.length > 30, '扫描到的源码文件数过少，守卫可能失效：' + files.length);
});

test('★ 提示"长按复制"的页面，链接必须真的可长按（否则兜底是空头支票）', () => {
  // 可长按选择 = 有 user-select，或者本来就放在输入框里（input/textarea 原生支持长按选择）。
  // ⚠️ 必须先剥掉注释：否则"注释里提到长按"会被当成真的提示（实测 export.js 就这么被误报过）。
  const SELECTABLE = /user-select|<(input|textarea)\b|ph-input/;
  const offenders = [];
  srcFiles().filter((p) => /\.js$/.test(p)).forEach((p) => {
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    if (!/长按[^'"\n]*复制/.test(src)) return;              // 没让用户"长按复制"就不管
    const wxml = p.replace(/\.js$/, '.wxml');
    if (!fs.existsSync(wxml)) return;                      // 非页面（如 utils/util.js 的默认文案）
    if (!SELECTABLE.test(fs.readFileSync(wxml, 'utf8'))) {
      offenders.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  });
  equal(
    offenders.length, 0,
    '以下页面在失败提示里让用户"长按复制"，但页面里没有可选文本（用户照做会失败）：\n' + offenders.join('\n')
  );
});
