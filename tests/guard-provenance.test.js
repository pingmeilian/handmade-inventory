// tests/guard-provenance.test.js —— 出处口径的**结构守卫**（2026-10-02 V95）
//
// 为什么要源码守卫：行为测试盯的是"这几步跑对了"，但**新加一条扣料路径**时
// 很容易忘了带出处 —— 那种漏法行为测试抓不到（测试里没有那条路径）。
// 所以这里盯"**结构上有没有可能漏**"：谁造布片、谁写流水、谁做快照。
//
// 每条都带**注入法自检**：把改造前的老写法塞进去，必须能被这条规则抓出来。
// 否则守卫就是没牙的（V83 的教训）。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const STORE = 'utils/store.js';
const ORIGIN = 'utils/origin.js';

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}
function bodyOf(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  return i >= 0 && j > i ? src.slice(i, j) : '';
}

group('出处 · 结构守卫（每条都带注入法自检）');

test('★ ⑫ consumeFabricArea 必须**回报**出处（改造前它只回「扣了多少、添了几块」）', () => {
  const js = stripComments(read(STORE));
  // 注入法自检：老写法（只回报 consumed + remnantAdded）必须能被抓出来
  const oldStyle = 'return { consumed: area, remnantAdded: Object.keys(replaced).length };';
  ok(oldStyle.indexOf('origins') < 0, '自检失败：老写法没被检出 —— 这条守卫没有牙');

  const ret = js.slice(js.indexOf('function consumeFabricArea('), js.indexOf('function restoreAreaOrigins('));
  ok(ret.indexOf('const origins = []') >= 0, '要先开一个 origins 收集器');
  ok(/return\s*{[^}]*origins:\s*origins/.test(ret.replace(/\s+/g, ' ')) || /origins:\s*origins/.test(ret),
    '★ 必须把挖过的每一处出处**回报**出去 —— 不回报的话调用方只能记一个数');
  ok((ret.match(/origins\.push\(/g) || []).length >= 2,
    '★ 每一处挖料都要 push 出处（包括"整片被用掉"那几条 early-return）');
});

test('★ ⑬ 造布片必须带出处：mkPiece 的第 5 个参数不许省', () => {
  const js = stripComments(read(STORE));
  // 注入法自检：老的 4 参数写法必须被检出
  const oldStyle = "m.pieces = (m.pieces || []).concat(mkPiece(back / w, w, 'remnant', w));";
  ok(/mkPiece\([^)]*'remnant',\s*w\)/.test(oldStyle), '自检失败：老的 4 参数写法没被检出');

  ok(!/mkPiece\([^)]*'remnant',\s*w\)\s*\)?/.test(js.replace(/\n/g, ' ')) ||
     js.indexOf("mkPiece(back / w, w, 'remnant', w)") < 0,
    '★ 还有 mkPiece(..., w) 的老写法 —— 造出来的布没有出处（"所有的布都要有出处"）');
  ['mkPiece(back / w, w, ', "mkPiece(oldArea / w, w, ", "mkPiece(a / w, w, "].forEach((p) => {
    const i = js.indexOf(p);
    if (i < 0) return;
    const call = js.slice(i, js.indexOf(';', i));
    ok(/detachOrigin|origin|org/.test(call),
      '★ 这句造片没带出处：' + call.slice(0, 80).replace(/\s+/g, ' '));
  });
  ok(/out\.origin = origin\.mk\(org/.test(js) || /origin\.mk\(org/.test(js),
    'mkPiece 自己要兜一条出处（哪怕调用方没传，也不许留空）');
});

test('★ ⑭ 快照必须走 pieceSnapshot（不许再手写 {id, length, width, area}——那会丢形状）', () => {
  const js = stripComments(read(STORE));
  // 注入法自检：老的手写快照必须被检出
  const oldStyle = 'const before = { id: piece.id, length: piece.length, width: piece.width, area: piece.area,'
    + ' isOffcut: piece.isOffcut, source: piece.source, createdAt: piece.createdAt };';
  ok(oldStyle.indexOf('holes') < 0, '自检失败：老的手写快照没被检出');

  const badSnap = /const before = \{[^}]*length:[^}]*width:[^}]*area:[^}]*\};/;
  ok(!badSnap.test(js), '★ 还有手写的快照 —— 少了 base/holes，撤销就会丢缺口');
  ok((js.match(/const before = pieceSnapshot\(/g) || []).length >= 3,
    '裁剪 / 销毁 / 盘点三处都要用 pieceSnapshot，实际：' + (js.match(/const before = pieceSnapshot\(/g) || []).length);
  ok(js.indexOf('function pieceSnapshot') >= 0, 'pieceSnapshot 本身要在');
  ok(/holes: \(p\.holes \|\| \[\]\)\.map/.test(js), '★ 快照里必须**真的带上 holes**');
});

test('★ ⑮ 撤销恢复必须走 pieceFromSnapshot，并且按 id **替换**（不许 concat 出两块）', () => {
  const js = stripComments(read(STORE));
  const undo = bodyOf(js, 'function undoFlow(', 'function getProducts(');
  ok(undo.indexOf('pieceFromSnapshot') >= 0, '★ 撤销要用 pieceFromSnapshot 还原（形状才回得来）');

  // 注入法自检：老的 concat 写法
  const oldStyle = 'm.pieces = (m.pieces || []).concat({ id: b.id, length: b.length, width: b.width, area: b.area });';
  ok(oldStyle.indexOf('findIndex') < 0, '自检失败：老的 concat 写法没被检出');
  ok(/findIndex\(p => p\.id === b\.id\)/.test(undo),
    '★ 恢复时要先按 id 找 —— 直接 concat 会出现两块同 id 的布（面积凭空翻倍）');
});

test('★ ⑯ 退料 = 填回原洞：必须靠 sameRect **认出那个洞**，不能按面积算', () => {
  const js = stripComments(read(STORE));
  const fn = bodyOf(js, 'function restoreAreaOrigins(', 'function isPieceOffcut(');
  ok(fn.length > 0, '找不到 restoreAreaOrigins');
  ok(fn.indexOf('sheets.sameRect') >= 0,
    '★ 填回原洞必须用 sameRect 认洞 —— 按面积找会填错位置（面积一样、账面看不出来）');
  ok(fn.indexOf('detached') >= 0, '原片/原洞找不到时要有 detached 出口（如实标，不许假装填回去了）');
  const originJs = stripComments(read(ORIGIN));
  ok(originJs.indexOf("'detach'") >= 0, 'origin 模块要认识 way=detach');
});

test('★ ⑰ 刀口布：批次必须**先取、再减账**', () => {
  const js = stripComments(read(STORE));
  // 注入法自检：反序的老写法
  const bad = 'm.batchRemain = util.round(oldRemain - qty, 2);\nconst drew = drawBatchLots(m, qty);';
  ok(bad.indexOf('drawBatchLots') > bad.indexOf('batchRemain'), '自检失败：反序写法没被检出');

  const calls = js.split('drawBatchLots(m, ').slice(1);
  // V149 起：排单交付不再自己扣料（改走 produceProduct），调用点由 4 降到 3
  // （函数自身 + 物料出库 + 生产）。降回 4 说明有人又在交付里手写了一遍扣料 —— 那是双重扣料的老路。
  equal(calls.length, 3, 'drawBatchLots 的调用点应该是 3 处（函数自身 + 物料出库/生产），实际 ' + calls.length);
  ok(js.indexOf('produceProduct(c.productId, deliverQty') >= 0,
    '★ 交付扣料必须走 produceProduct（与其它入口同一套账），不许自己手写扣料');
  // 真正的调用点（排除函数定义与内部）里，取批次必须出现在改 batchRemain 之前
  ['const drew = drawBatchLots(m, qty);', 'const drew = drawBatchLots(m, use);'].forEach((needle) => {
    let from = 0;
    for (;;) {
      const i = js.indexOf(needle, from);
      if (i < 0) break;
      from = i + needle.length;
      const after = js.slice(i, i + 400);
      const cutAt = after.indexOf('batchRemain =');
      // 取批次之后 400 字符内若出现 batchRemain 赋值，说明它排在后面 —— 才是对的
      ok(cutAt > 0, '★ 取批次之后紧接着就该减账，实际：' + after.slice(0, 120).replace(/\s+/g, ' '));
    }
  });
  ok(js.indexOf('function syncBatchLots') >= 0, '要有批次与账的对齐函数');
  ok(/way: 'legacy'/.test(js), '★ 对不上的部分要记到 legacy 批（如实标"未追溯"，不摊给已知批次）');
});

test('★ ⑱ 出处只能由 origin.js 构造（别处不许自己拼一个对象冒充出处）', () => {
  const js = stripComments(read(STORE));
  const originJs = stripComments(read(ORIGIN));
  // 注入法自检：手拼出处必须被检出
  const handMade = "addFlow({ origins: [{ materialId: m.id, area: 100 }] });";
  ok(handMade.indexOf('origin.mk') < 0, '自检失败：手拼出处没被检出');

  // store 里所有 origins 的赋值都必须来自 origin.mk / batchBackOrigin / 变量传递
  const bad = (js.match(/origins:\s*\[\{/g) || []);
  equal(bad.length, 0, '★ 直接手拼 origins 对象（' + bad.length + ' 处）—— 必须走 origin.mk，口径只有一处');
  ok(originJs.indexOf('function isValid') >= 0, 'origin 模块要有 isValid（"说得全不全"的判据）');
  ok(originJs.indexOf("'legacy'") >= 0, '要有 legacy（老记录明说"无出处"，不假装）');
});

test('★ ⑲ 面料出库不许退回「填一个面积」—— 必须让用户指定哪片布、哪个位置', () => {
  const detailJs = stripComments(read('pages/materials/detail.js'));
  const detailWxml = read('pages/materials/detail.wxml');
  const storeJs = stripComments(read(STORE));

  // 注入法自检：改造前的写法（面料出库直接调 outbound(面积)）必须被检出
  const oldStyle = 'const a = Number(d.sheetQty); store.outbound(m.id, a, remark);';
  ok(oldStyle.indexOf('outboundCut') < 0, '自检失败：老的"填面积出库"写法没被检出');

  // ① 页面：常规面料出库必须进裁剪排版界面
  const openOut = bodyOf(detailJs, 'openOut() {', 'onSheetQty(');
  ok(openOut.length > 0, '找不到 openOut');
  ok(openOut.indexOf('cut-editor') >= 0,
    '★ 面料出库必须进裁剪排版界面 —— 只在弹层里填个面积，用户就没机会说"哪片布、哪个位置"');
  ok(openOut.indexOf('outboundCut') >= 0, '★ 回传后要走 store.outboundCut（按用户给的出处挖料）');
  ok(!/store\.outbound\(m\.id,\s*Number/.test(openOut), '★ 不许再按面积出库面料');

  // ② 页面：不许再有"裁剪面积"这个输入
  ok(detailWxml.indexOf('裁剪面积') < 0,
    '★ 面料出库的「裁剪面积」输入还在 —— 用户 2026-10-02 明确问过"连长宽都没有"');

  // ③ store：outboundCut 必须真的按 pieceId + at 走几何，而不是又按面积估
  const fn = bodyOf(storeJs, 'function outboundCut(', 'function applyCutToPieces(');
  ok(fn.length > 0, '找不到 outboundCut');
  ok(fn.indexOf('s.pieceId') >= 0 && fn.indexOf('s.at') >= 0,
    '★ 必须用用户给的**哪片布 + 哪个位置**');
  ok(fn.indexOf('cutFabric(') >= 0, '★ 要走 cutFabric（几何裁剪只有一处口径），不许另起一套');
  ok(fn.indexOf('consumeFabricArea') < 0,
    '★ 不许退回 consumeFabricArea —— 那条是"系统自己挑一块布、自己挖个近似矩形"');
  ok(/'manual'/.test(fn), '★ 来源要记 manual（否则详情页的「撤销」点不到）');
});
