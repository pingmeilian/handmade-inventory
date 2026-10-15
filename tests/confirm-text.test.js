// tests/confirm-text.test.js —— 守卫：微信 showModal 按钮文字上限 4 个汉字
//
// 背景（2026-09-12 真机事故）：
//   清空数据的确认按钮文案写成了「生成备份并继续」（7 字），超出微信 showModal 的
//   confirmText ≤ 4 汉字 限制 → showModal 直接 fail；而 util.confirm 当年没写 fail 回调
//   → Promise 永不 resolve → 整个清空流程静默卡死，用户看到的是「点了没反应」。
//   连带影响：关于页、数据体检页两个入口同时失效（共用同一条流程）。
//
// 本测试 = 防回归守卫：
//   1) 全项目源码扫描：confirm(...) 的第 3 个参数必须是单个字符串字面量且 ≤ 4 字；
//      showModal 的 confirmText / cancelText 同样 ≤ 4 字
//   2) util.confirm 自身必须防超长（自动截断）+ 有 fail 兜底（绝不静默卡死）
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const fs = require('fs');
const path = require('path');

const util = require('../utils/util.js');

const CWD = path.join(__dirname, '..');

function walkJs(dir, out) {
  fs.readdirSync(dir).forEach(function (f) {
    if (f === 'node_modules' || f === '.git' || f === 'tests') return;
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (f.slice(-3) === '.js') out.push(p);
  });
  return out;
}

// 取第 n 个（0 基）字符串字面量；非纯字面量（拼接/变量）返回 null
function singleLiteral(arg) {
  const s = arg.trim();
  const q = s[0];
  if (q !== '\'' && q !== '"') return null;
  if (s[s.length - 1] !== q) return null;
  const inner = s.slice(1, -1);
  if (inner.indexOf(q) >= 0) return null;      // 有拼接
  if (inner.indexOf('+') >= 0) return null;    // 简单防拼接（内容里带 + 的正常文案不影响判定）
  return inner;
}

// 解析出所有 confirm(...) 调用的顶层参数列表
function extractConfirmArgs(src) {
  const out = [];
  const re = /(?:^|[^\w])(?:util\.)?confirm\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index);
    const args = [];
    let depth = 1, cur = '', quote = null;
    for (let j = open + 1; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        cur += c;
        if (c === '\\') { cur += src[++j] || ''; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '\'' || c === '"' || c === '`') { quote = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
      if (c === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
      cur += c;
    }
    args.push(cur);
    out.push({ args: args, index: m.index });
  }
  return out;
}

function lineOf(src, index) { return src.slice(0, index).split('\n').length; }

group('守卫 · 微信弹窗按钮文字 ≤ 4 字（真机事故防回归）');

test('全项目：confirm 第 3 个参数（按钮文字）不得超过 4 字', () => {
  const files = walkJs(CWD, []);
  const bad = [];
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    extractConfirmArgs(src).forEach(function (r) {
      const lit = singleLiteral(r.args[2] || '');
      if (lit != null && lit.length > 4) {
        bad.push(path.relative(CWD, f) + ':' + lineOf(src, r.index) + ' 「' + lit + '」=' + lit.length + '字');
      }
    });
  });
  ok(bad.length === 0, '超长按钮文字（微信会 fail 弹窗）：\n    ' + bad.join('\n    '));
});

test('全项目：showModal 的 confirmText / cancelText 不得超过 4 字', () => {
  const files = walkJs(CWD, []);
  const bad = [];
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /(confirmText|cancelText)\s*:\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[2].length > 4) {
        bad.push(path.relative(CWD, f) + ':' + lineOf(src, m.index) + ' ' + m[1] + '「' + m[2] + '」=' + m[2].length + '字');
      }
    }
  });
  ok(bad.length === 0, '超长弹窗按钮文字：\n    ' + bad.join('\n    '));
});

test('util.confirm 防御：传入超长按钮文字时自动截断到 4 字', async () => {
  stub.resetStorage();
  const p = util.confirm('标题', '内容', '生成备份并继续');  // 7 字
  await p;                                                   // 关键：必须能 resolve（不能卡死）
  const modal = stub.modals[stub.modals.length - 1];
  ok(modal, '应调用过 showModal');
  ok(modal.confirmText.length <= 4, 'confirmText 应被截断到 ≤4 字，实际「' + modal.confirmText + '」');
});

test('util.confirm 兜底：弹窗失败也必须 resolve(false)，绝不静默卡死', async () => {
  stub.resetStorage();
  stub.faults.modalFail = true;
  const r = await util.confirm('标题', '内容', '继续');
  equal(r, false, '弹窗失败 → 返回 false（调用方据此中止），而不是永远挂起');
});
