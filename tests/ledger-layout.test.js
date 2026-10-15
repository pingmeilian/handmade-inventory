// tests/ledger-layout.test.js —— 累计总账页布局守卫（V132 立 / V133 修订）
//
// 用户需求（2026-10-10）明细页「太乱、不够简洁；说明文字太多；**A、B 两个口径要并排**
// （因为每一行要对照着看）；尽量不要有换行」。
//
// ⚠️ V133 真机反馈后的**两处反转**（保留说明，方便以后看懂为什么和初版相反）：
//   ① 初版把「合计」放在**卡标题行右侧** → 真机上金额一大就把标题挤成两行
//      （「A · 累计投」+「入」），A 卡内容被推低 ⇒ 两边行错位。用户要求：
//      **金额放到卡片最下边一行**。
//   ② 初版"留白不许改窄"（保持全局 32rpx）→ 用户看到真机后明确要求**两边再留窄一点**。
//      ⇒ 本页水平留白单独收到 24rpx。
//   所以 ⑤/⑦ 两条断言的**方向与初版相反**，别照着旧注释改错。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const wxStub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// 取某个 <view …> 元素（含嵌套）的完整片段：按 view 标签配平
function sliceView(src, startIdx) {
  const re = /<(\/?)view\b[^>]*?(\/?)>/g;
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(src))) {
    if (m[2] === '/') continue;              // 自闭和，不增不减
    if (m[1] === '/') { depth--; if (depth === 0) return src.slice(startIdx, m.index + m[0].length); }
    else depth++;
  }
  return src.slice(startIdx);
}

// 把一个选择器的**所有**规则块连起来（同一选择器可能分散在多处）
function cssBlocks(src, selector) {
  const out = [];
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/\./g, '\\.') + '\\s*\\{', 'g');
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('}', m.index);
    if (end > 0) out.push(src.slice(m.index, end + 1));
  }
  return out.join('\n');
}

const colsBox = () => {
  const w = stripHtml(read('pages/ledger/ledger.wxml'));
  const i = w.indexOf('<view class="cols"');
  return i < 0 ? '' : sliceView(w, i);
};

group('累计总账页布局（V132 立 / V133 修订）');

test('★ ① A、B 两张卡必须并排 —— 同一个容器里，才能逐行左右对照', () => {
  const box = colsBox();
  ok(!!box, '找不到并排容器（class 恰为 "cols"）—— 锚点漂了就更新这条守卫');
  ok(box.indexOf('A · 累计投入') > 0 && box.indexOf('B · 累计已耗') > 0,
    '★ A、B 两个标题必须在**同一个并排容器**内 —— 否则就是上下排列（用户明确要并排：每行要对照着看）');
  const inner = sliceView(box, box.indexOf('<view class="col">'));
  ok(inner.indexOf('B · 累计已耗') < 0, '★ B 卡不应该嵌在 A 卡内部（必须是同级兄弟）');

  const s = read('pages/ledger/ledger.wxss');
  ok(/display\s*:\s*flex/.test(cssBlocks(s, '.cols')), '.cols 必须是 flex 才能并排');
  ok(/flex\s*:\s*1/.test(cssBlocks(s, '.col')), '.col 必须 flex:1（两卡等宽，否则一窄一宽对不齐）');
});

test('★ ② A、B 行数必须相等（B 侧空位补齐）—— 否则两栏「合计」不在同一横线', () => {
  wxStub.resetStorage();
  store.ensureSeed();
  const page = loadPage('../pages/ledger/ledger.js');
  page.reload();

  const A = page.data.rowsA || [];
  const B = page.data.rowsB || [];
  ok(A.length > 0, 'rowsA 应有数据');
  equal(B.length, A.length,
    '★ A 有 ' + A.length + ' 行、B 有 ' + B.length + ' 行 —— 不等长则 B 侧合计上移、两栏错位' +
    '（B 的「维修 / 其它支出」无对应项，需占位补齐）');

  const phs = B.filter((r) => r.placeholder);
  equal(phs.length, A.length - 4, 'B 侧应补 ' + (A.length - 4) + ' 个占位行（A 6 行、B 4 行）');
  phs.forEach((r) => equal(String(r.valueText), '—',
    '★ 占位行必须显示「—」：显示 0.00 会让人以为 B 侧真有这笔'));
  phs.forEach((r) => ok(!!r.label, '占位行也要有行名（否则不知道哪一项在 B 侧没有）'));
});

test('★ ③ 名称、数值、口径标题都必须禁止折行（nowrap）+ 数值不被压缩', () => {
  const s = read('pages/ledger/ledger.wxss');
  ok(/white-space\s*:\s*nowrap/.test(cssBlocks(s, '.row-l')),
    '★ .row-l 必须有 white-space: nowrap —— 并排后每卡只剩半宽，不硬禁就会折行');
  ok(/white-space\s*:\s*nowrap/.test(cssBlocks(s, '.row-v')), '★ .row-v 必须有 white-space: nowrap');
  ok(/flex\s*:\s*none|flex-shrink\s*:\s*0/.test(cssBlocks(s, '.row-v')),
    '★ .row-v 必须 flex:none / flex-shrink:0 —— 否则数字被压到换行');
  ok(/white-space\s*:\s*nowrap/.test(cssBlocks(s, '.col-head')),
    '★ 口径标题（.col-head）自身也必须 nowrap —— V133 真机 bug 就是它被挤成两行');

  const oldWay = '.row-l { font-size: 24rpx; color: #111; }\n.col-head { font-size: 22rpx; }';
  ok(!/white-space\s*:\s*nowrap/.test(oldWay),
    '自检失败：没有 nowrap 的老写法没被检出 —— 这条守卫没有牙');
});

test('★ ④ 页面上不得再有任何说明文字（用户要求删光）', () => {
  const w = stripHtml(read('pages/ledger/ledger.wxml'));
  ['hero-note', 'sec-hint', 'row-hint', 'tips', 'tip'].forEach((c) => {
    ok(!new RegExp('class="[^"]*\\b' + c + '\\b').test(w),
      '★ WXML 里仍有说明元素：.' + c + ' —— 用户明确说「不要底部说明」「说明文字太多了」');
  });
  ['只统计', '一共掏了多少钱', '两种消费口径并列', '只算已交付的件数', '排单交付不会自动记成'].forEach((txt) => {
    ok(w.indexOf(txt) < 0, '★ WXML 里仍有说明文案：「' + txt + '」');
  });
  const js = stripJs(read('pages/ledger/ledger.js'));
  ok(js.indexOf('hint') < 0, '★ ledger.js 里不应再有 hint 字段（说明文字已删光）');
});

test('★ ⑤ 「合计」必须落在**卡片最下边一行**（V133 反转：不再放卡标题右侧）', () => {
  const box = colsBox();
  ok((box.match(/row-total/g) || []).length === 2,
    '★ 两张卡**各**要有一行「合计」（找到 ' + (box.match(/row-total/g) || []).length + ' 处）');

  // 每张卡内：合计行必须排在明细循环之后
  const aStart = box.indexOf('<view class="col">');
  const aBox = sliceView(box, aStart);
  ok(/rowsA/.test(aBox), 'A 卡内应有 rowsA 循环');
  ok(aBox.indexOf('row-total') > aBox.indexOf('rowsA'),
    '★ 「合计」必须排在明细行**之后** —— 用户要求放卡片最下边一行');
  const bStart = box.indexOf('<view class="col">', aStart + 5);
  const bBox = sliceView(box, bStart);
  ok(bBox.indexOf('row-total') > bBox.indexOf('rowsB'),
    '★ B 卡的「合计」同样要在明细行之后');
});

test('★ ⑨ 金额不得与口径标题同排 —— 本次真机 bug 的直接防线', () => {
  const box = colsBox();
  const heads = box.match(/<view class="col-head">[\s\S]*?<\/view>/g) || [];
  equal(heads.length, 2, '应恰好有两个口径标题行');
  heads.forEach((h) => {
    ok(h.indexOf('totalText') < 0 && h.indexOf('¥') < 0,
      '★ 口径标题行里不许出现金额（totalText / ¥）—— 金额一大就把标题挤成两行、' +
      '把整卡内容推低，两边行就错位了：' + h.slice(0, 90));
  });

  // 注入自检：老写法（标题 + 金额同排）必须能被判出来
  const oldSeg = '<view class="col-head"><text>A · 累计投入</text><text class="col-total">¥{{spendA.totalText}}</text></view>';
  const oldHead = oldSeg.match(/<view class="col-head">[\s\S]*?<\/view>/)[0];
  ok(oldHead.indexOf('totalText') >= 0,
    '自检失败：老写法（标题 + 金额同排）没被检出 —— 这条守卫没有牙');
});

test('★ ⑦ 本页左右留白必须与首页一致（V135 反转）—— 别被"双层 padding"偷偷撑宽', () => {
  const s = read('pages/ledger/ledger.wxss');

  // V135 根因：本页最外层是 `<view class="page-wrap">`（**没加 pin-page**）——
  // 全局 `.page-wrap` 自带 32rpx，又叠上 `.content-panel` 的留白 ⇒ 实际 32+24 = 56rpx，
  // 比首页（带页，只 32rpx）宽了近一倍。用户看得很准：「和首页的留白一样窄」。
  // ⇒ 修法是**去掉一层**（把 .page-wrap 的 padding 归零，与带页 `.pin-page` 同做法），
  //   而不是把 content-panel 的数值往小调。
  const pw = cssBlocks(s, '.page-wrap');
  ok(/padding\s*:\s*0/.test(pw),
    '★ .page-wrap 的 padding 必须归零 —— 全局它自带 32rpx，再叠 content-panel 就会变成 56rpx' +
    '（这正是 V134 及以前"明细页比首页宽一倍"的原因）');

  const cp = cssBlocks(s, '.content-panel');
  ok(/var\(--page-margin\)/.test(cp),
    '左右留白应取全局 --page-margin（与看板 / 我的等带页完全一致）');
  // ⚠️ 只禁止**再定义**这个变量（注释里提它的历史是允许的、也是好事 —— 后人能搜到）
  ok(!/(^|\n)\s*--ledger-margin\s*:/.test(s),
    '不再需要定义 --ledger-margin 变量 —— 上一版用它"绕过"叠加问题，现在直接去掉一层更干净');

  const g = read('app.wxss').match(/--page-margin\s*:\s*(\d+)rpx/);
  ok(!!g, 'app.wxss 里应能找到 --page-margin');
  ok(Number(g[1]) === 32, '全局 --page-margin 应为 32rpx（当前 ' + (g ? g[1] : '?') + 'rpx）');
});

test('⑥ 并排后的尺寸：行字号 22rpx、卡内留白 20rpx', () => {
  const s = read('pages/ledger/ledger.wxss');
  ok(/font-size\s*:\s*22rpx/.test(cssBlocks(s, '.row-l')), '.row-l 字号应为 22rpx');
  ok(/font-size\s*:\s*22rpx/.test(cssBlocks(s, '.row-v')), '.row-v 字号应为 22rpx');
  ok(/padding\s*:\s*20rpx/.test(cssBlocks(s, '.col')),
    '.col 卡内留白应为 20rpx（24 → 20，为并排省出宽度）');
});

test('⑧ 两条口径的标签语义成对（保证「对照着看」读得懂）', () => {
  wxStub.resetStorage();
  store.ensureSeed();
  const page = loadPage('../pages/ledger/ledger.js');
  page.reload();
  const A = page.data.rowsA, B = page.data.rowsB;
  equal(A[0].label, '物料采购', 'A 第 1 行应是「物料采购」');
  equal(B[0].label, '用掉的物料', 'B 第 1 行应是「用掉的物料」（与 A 同行构成"买了 vs 用掉"）');
  equal(A[2].label, '资产（机器）', 'A 第 3 行应是「资产（机器）」');
  equal(B[2].label, '资产折旧', 'B 第 3 行应是「资产折旧」（与 A 同行构成"原值 vs 折旧"）');
});
