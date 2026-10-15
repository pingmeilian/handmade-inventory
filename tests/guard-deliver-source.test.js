// tests/guard-deliver-source.test.js —— 交付「货从哪来」的**结构守卫**（V149）
//
// 为什么还要源码守卫：行为测试盯的是"这四条路跑对了"，但**新增一条扣料路径**时
// 很容易忘了带来源/忘了要方案 —— 那种漏法行为测试抓不到（测试里根本没走那条新路径）。
// 所以这里盯"**结构上有没有可能漏**"：谁扣料、谁写销售、谁决定从哪块布上裁。
//
// 每条都带**注入法自检**：把老写法（V149 之前的做法）塞进去，必须能被这条规则抓出来。
// 否则守卫就是没牙的（V83 的教训）。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const STORE = 'utils/store.js';
const FLOW = 'utils/deliver-flow.js';
const DETAIL = 'pages/commission/detail.js';
const LIST = 'pages/commission/list.js';
const SHEET = 'components/deliver-sheet/deliver-sheet.js';

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}
// 取一个顶层函数的函数体（从锚点到下一个行首的 `}`）
function fnBody(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return j > i ? src.slice(i, j + 2) : src.slice(i);
}

group('交付 · 货从哪来（V149 结构守卫，每条都带注入法自检）');

test('① 默认「从物料出」—— 不带 opts 的老调用行为必须不变', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function assignCommission');
  ok(fn, '找不到 assignCommission —— 锚点漂了就更新这条');
  ok(/\?\s*'product'\s*:\s*'material'/.test(fn),
    '★ 默认值必须是 material：老调用（不带 opts）要维持原行为');
  // 注入自检：把默认改成 product，这条规则必须不通过
  const bad = fn.replace(/\?\s*'product'\s*:\s*'material'/, "? 'product' : 'product'");
  ok(!/\?\s*'product'\s*:\s*'material'/.test(bad), '自检失败：默认值被改掉却没被这条规则检出');
});

test('★ ② 两条路都必须复用 produceProduct / sellProduct —— 不许自己手写扣料', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function assignCommission');
  ok(fn.indexOf('produceProduct(') >= 0,
    '★ 「从物料出」要走 produceProduct（与本项目其它入口同一套账）');
  ok(fn.indexOf('sellProduct(') >= 0,
    '★ 出库要走 sellProduct（写销售记录的唯一口径；自己手写销售会让成本快照口径飘）');
  ok(fn.indexOf('drawBatchLots(') < 0, '★ 交付里不许自己取批次扣刀口布（那是老路径）');
  ok(fn.indexOf('consumeFabricArea(') < 0,
    '★ 交付里不许自己按面积刨布 —— V149 修掉的正是"系统替你决定从哪块布上裁"');
  // 注入自检：退回老写法（自己扣料），必须能被抓出来
  // ⚠️ 要用 split/join 全量替换 —— `replace(字符串)` 只替第一处，而 sellProduct 两条路各调一次，
  //   只替一处会让自检**假通过**（这次就这么被自己的守卫抓了一次）。
  const bad = fn.split('produceProduct(').join('consumeBom(').split('sellProduct(').join('markSold(');
  ok(bad.indexOf('produceProduct(') < 0 && bad.indexOf('sellProduct(') < 0,
    '自检失败：退回手写扣料却没被检出');
});

test('★ ③ 需要裁剪的面料行必须带用户方案，否则 NEEDCUT（绝不自动刨布）', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function assignCommission');
  ok(fn.indexOf('NEEDCUT') >= 0, '★ 要有 NEEDCUT 闸门');
  ok(fn.indexOf('needCut.length && !(opts && opts.perPiece)') >= 0,
    '★ 判据要落在「需要裁剪 && 没带方案」上 —— 宁可不交，也不替用户决定从哪块布上裁');
  ok(fn.indexOf('cutQueueFor(') >= 0,
    '用 cutQueueFor 判"要不要裁剪"（刀口布不算 —— V92 真机反馈定的口径）');
  // 注入自检：把闸门拿掉
  const bad = fn.replace("throw { code: 'NEEDCUT'", "report({ code: 'NEEDCUT'");
  ok(bad.indexOf("throw { code: 'NEEDCUT'") < 0, '自检失败：闸门被拿掉却没被检出');
});

test('★ ④ 交付的两个入口必须共用 deliver-flow —— 不许自己调 store.assignCommission', () => {
  [DETAIL, LIST].forEach((f) => {
    const js = stripComments(read(f));
    ok(js.indexOf("require('../../utils/deliver-flow.js')") >= 0, f + '：要引 deliver-flow');
    ok(js.indexOf('deliverFlow.deliver(') >= 0, f + '：要走 deliverFlow.deliver');
    ok(js.indexOf('assignCommission') < 0,
      '★ ' + f + '：不许直接调 store.assignCommission —— 两个入口各写一遍，口径迟早飘');
  });
  // 注入自检：老写法（页面直接调 store）
  const bad = "store.assignCommission(this.data.id, qty);";
  ok(bad.indexOf('assignCommission') >= 0, '自检失败：页面直连 store 却没被检出');
});

test('⑤ undoDeliver 必须按来源分支，且**保留**老记录的原逻辑', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function undoDeliver');
  ok(fn, '找不到 undoDeliver —— 锚点漂了就更新这条');
  ok(fn.indexOf('log.fromStock') >= 0, '要按交付记录里的来源走两条不同的反向路');
  ok(fn.indexOf('undoProduce(') >= 0, '「从物料出」要退产 —— 物料才会真的还回来');
  ok(fn.indexOf('else {') >= 0,
    '★ 老记录（没有 fromStock）必须走 else 分支 —— 不猜、不追溯（追溯＝替用户改历史账）');
  // 注入自检：把老记录分支删掉（只留新口径）
  const bad = fn.slice(0, fn.indexOf('} else {')) + '}';
  ok(bad.indexOf('else {') < 0, '自检失败：老记录分支被删却没被检出');
});

test('⑥ 交付记录必须存齐 fromStock / prodId / saleId / origins', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function assignCommission');
  ['fromStock: fromStock', 'prodId: prodId', 'saleId: saleId', 'origins: origins'].forEach((needle) => {
    ok(fn.indexOf(needle) >= 0, 'deliverLogs 里要写 ' + needle + '（撤销与对账都靠它）');
  });
});

test('★ ⑦ 交付弹窗：来源**不预选**（用户自己选），未选不给提交', () => {
  const js = stripComments(read(SHEET));
  // 判据：**任何一处**都不能把来源初始化为一个具体值 —— 初值和"每次打开复位"都必须是空串。
  // ⚠️ 不能用 indexOf 只查一处：这个文件里 `mode: ''` 出现在两个地方（data 初值 + observers 复位），
  //   只查一处会让"预选"注入**假通过**（这次就是这么被自己的守卫抓了一下）。
  ok(/mode:\s*''/.test(js), '★ data.mode 初值必须是空 —— 系统不替用户选');
  ok(!/mode:\s*'(product|material)'/.test(js),
    '★ 不许在任何地方把来源预选成具体值（含"每次打开复位成上次的选择"这种变体）');
  ok(js.indexOf("qty: String(this.data.remain), mode: ''") >= 0,
    '每次打开都要复位成"未选"，数量默认给剩余量（少点一次，但不替用户决定来源）');
  // ⚠️ 判据必须落在**分支体**上，不能只查 `if (!this.data.mode)` 存不存在 ——
  //   验牙时踩过：把分支体从 "提示 + return" 换成 "悄悄给个默认值"，`if (...)` 这串还在，
  //   守卫照样绿（假绿）。所以这里要求"空来源这个分支里**必须早退**"（不许往下走提交）。
  ok(/if\s*\(\s*!this\.data\.mode\s*\)\s*\{[^}]*return/.test(js),
    '★ 未选来源必须拦住（分支里要 return，不许悄悄替用户选一个再放行）');
  // 注入自检：把两处 mode 初值都改成预选 product
  const bad = js.split("mode: ''").join("mode: 'product'");
  ok(!/mode:\s*''/.test(bad) && /mode:\s*'(product|material)'/.test(bad),
    '自检失败：来源被预选却没被检出');
});

test('★ ⑧ 「从物料出」产生的流水要改成排单口径（来源「排单履约」+ 备注带客户）', () => {
  const fn = fnBody(stripComments(read(STORE)), 'function assignCommission');
  ok(fn.indexOf("f.source = 'commission'") >= 0,
    '★ 来源要改成 commission —— 不然在物料流水里显示「成品裁剪」，认不出是哪一单（V72 专门修过）');
  ok(fn.indexOf("'排单交付 · '") >= 0, '备注要写「排单交付 · 客户」');
  ok(fn.indexOf('if (mine.length) set(KEYS.FLOWS, allFlows)') >= 0,
    '改完要落盘（只改内存里的数组、不 set 等于没改）');
  // 注入自检：忘了落盘
  const bad = fn.replace('if (mine.length) set(KEYS.FLOWS, allFlows);', '');
  ok(bad.indexOf('set(KEYS.FLOWS, allFlows)') < 0, '自检失败：忘了落盘却没被检出');
});

test('★ ⑨ 流程层只做「问 + 带路」，扣料一律回 store 一处', () => {
  const js = stripComments(read(FLOW));
  ok(js.indexOf('store.assignCommission(') >= 0, '流程层要调 store.assignCommission');
  ok(js.indexOf('produceProduct(') < 0, '★ 流程层不许自己扣料（扣料口径只在 store 一处）');
  ok(js.indexOf('consumeBom(') < 0 && js.indexOf('consumeFabricArea(') < 0,
    '★ 更不许自己刨布');
  ok(js.indexOf('cutQueueFor(') >= 0, '要判断需不需要裁剪');
  ok(js.indexOf('/pages/cut-editor/cut-editor?mode=queue') >= 0,
    '要裁剪就进裁剪页 —— 那是全项目唯一的"选从哪块布上裁"的入口');
  ok(js.indexOf('perPiece: data.chosen') >= 0, '要把用户在裁剪页选的方案原样带进 store');
  // 注入自检：忘了带方案
  const bad = js.replace('{ fromStock: \'material\', perPiece: data.chosen }', "{ fromStock: 'material' }");
  ok(bad.indexOf('perPiece: data.chosen') < 0, '自检失败：方案没带进去却没被检出');
});

// ============ V152：弹窗文案必须极简 ============
//
// 用户真机反馈（2026-10-14）：「说明的字太多了，简短一点，极简，用户能看懂就行」。
// 原先每张卡一句 20+ 字的解释、底下还压着一行三态长提示 —— 典型的加法思维，读起来像说明书。
// 这条守卫把"极简"从**口味**变成**可判的红线**：不然下次加功能，又会顺手塞一句解释进去。
// （功能可以取舍，但"用户要读多少字"这件事，得有个人替他把关。）
const SHEET_WXML = 'components/deliver-sheet/deliver-sheet.wxml';

// 剥掉 wxml 注释 —— 注释里可以尽情解释，限制只针对**用户看得见的字**
function stripWxmlComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }
// 取某个 class 的 view 内层 HTML（非贪婪到它自己的收尾）
function viewInner(src, cls) {
  const m = src.match(new RegExp('<view class="' + cls + '">([\\s\\S]*?)</view>'));
  return m ? m[1] : '';
}
// 内层 HTML → 用户实际看到的文字（去标签 / 去插值 / 压空白）
function visibleText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
}

test('★ ⑩ 交付弹窗的说明必须极简（V152：用户说"说明的字太多了"）', () => {
  const MAX_SUB = 18;   // 每条说明的字数上限（含标点；现在最长的一条是 15 字）
  const wxml = stripWxmlComments(read(SHEET_WXML));

  // ① 底部那块"三态长提示"不许复活（原先三句分别 28 / 20 / 34 字 —— 实测，全是重复解释）
  ok(wxml.indexOf('ds-hint') < 0,
    '★ 不许再把底部提示块加回来 —— 该说的卡片副标题已经说完了，多一遍就是噪音');

  // ② 每张卡的说明压在一行内
  const subs = wxml.match(/<view class="ds-opt-sub">[\s\S]*?<\/view>/g) || [];
  equal(subs.length, 2, '两张卡各一行说明，实际 ' + subs.length + ' 行');
  subs.forEach(function (html, i) {
    const t = visibleText(html);
    ok(t.length > 0 && t.length <= MAX_SUB,
      '★ 第 ' + (i + 1) + ' 张卡的说明要短（≤' + MAX_SUB + ' 字），实际 ' + t.length + ' 字：' + t);
  });

  // ③ 展示文案里不许出现长破折号 —— 它在本项目里几乎总是"接着又要解释一句"的信号
  ok(wxml.indexOf('——') < 0, '★ 用户看得见的字里不许用「——」引长解释（要解释就写进注释）');

  // 注入自检：把 V149 的老文案塞回去，①②③ 都必须红
  const old1 = wxml.replace('库存直发，', '早做好的货 —— 只出库、写销售记录，');
  const t1 = visibleText(viewInner(old1, 'ds-opt-sub'));
  ok(t1.length > MAX_SUB, '自检失败：老的长说明没被检出（' + t1.length + ' 字）');
  ok(old1.indexOf('——') >= 0, '自检失败：长破折号没被检出');
  const old2 = wxml.replace('<view class="ds-ops">',
    '<view class="ds-hint">两条路的扣账方式不同 —— 请自己选一下，系统不替你决定</view>'
    + '<view class="ds-ops">');
  ok(old2.indexOf('ds-hint') >= 0, '自检失败：底部提示复活却没被检出');
});
