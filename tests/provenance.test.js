// tests/provenance.test.js —— 「每一笔面积都要有形状和出处」（2026-10-02 V95）
//
// 用户立的规矩（原话）：
//   「有面积肯定就有形状，我需要的是不管用不用到几何，哪怕面积只算一个数字，
//     都要关联到它的形状和来自哪片布的哪个位置。所有的布不管在哪里都要这样要求，
//     这样才能从头到尾所有的流程能追溯」。
//
// 这个文件**不盯源码、只盯行为** —— 真的把每一步跑一遍，看落下来的流水/布片里
// 到底有没有"形状 + 哪片布 + 哪个位置"。理由见 V78/V83 的教训：源码守卫全绿、
// 真机照样错，跨层的东西必须真跑。
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');
const origin = require('../utils/origin.js');
const stub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');

const store = F.store;
const util = F.util;

function lastFlow() {
  const fs = store.getFlows();
  return fs[fs.length - 1];
}
function pieceOf(mid, pid) {
  const m = store.getMaterial(mid);
  return (m.pieces || []).find(p => p.id === pid);
}
// 所有面料流水（按面积 / 按批）—— 用来做"一个都不许漏"的扫地检查
function fabricFlows() {
  return store.getFlows().filter(f => f.priceMode === 'byArea' || f.priceMode === 'byBatch');
}

group('出处 · 裁剪与面积扣料都要说得出来');

test('★ ① 裁剪：流水必须说全「形状 / 哪片布 / 哪个位置」', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  const r = store.cutFabric(m.id, pid, 40, 30, '裁一件', false);
  const f = lastFlow();
  ok(f.origins && f.origins.length === 1, '裁剪流水必须带 origins，实际：' + JSON.stringify(f.origins));
  const o = f.origins[0];
  ok(origin.isValid(o), '出处必须说全三件事，实际：' + JSON.stringify(o));
  equal(o.pieceId, pid, '要说得出是**哪片布**');
  near(o.rect.x, r.at.x, 0.01, '要说得出**布上的位置** x');
  near(o.rect.y, r.at.y, 0.01, '位置 y');
  near(o.rect.length, 40, 0.01, '形状：长');
  near(o.rect.width, 30, 0.01, '形状：宽');
  near(o.area, 1200, 0.01, '面积');
  equal(o.way, 'cut', '是"按形状裁"，不是按面积估的');
});

test('★ ② 按面积出库：这是改造前**只记一个数**的地方，现在也必须带出处', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.outbound(m.id, 3000, '手工出库');
  const f = lastFlow();
  ok(f.origins && f.origins.length, '按面积出库也要说出处，实际：' + JSON.stringify(f.origins));
  const o = f.origins[0];
  ok(origin.isValid(o), '要说全，实际：' + JSON.stringify(o));
  equal(o.pieceId, pid, '要说得出动了哪片布');
  equal(o.way, 'area', '如实标"按面积扣"（不是假装按形状裁的）');
  const sh = store.pieceShape(pieceOf(m.id, pid));
  ok(sh.holes.some(h => origin.sameRect(h, o.rect)),
    '★ 出处里那个矩形，必须是布上**真实存在的那个洞**（对不上就是编的）');
});

test('★ ③ 一块布上挖两个洞：出处要分别指向**两个不同的位置**', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.cutFabric(m.id, pid, 40, 30, '第一刀', false);
  store.cutFabric(m.id, pid, 40, 30, '第二刀', false);
  const fs = fabricFlows();
  const a = fs[fs.length - 2].origins[0], b = fs[fs.length - 1].origins[0];
  ok(!origin.sameRect(a.rect, b.rect), '两刀在不同位置 —— 出处必须能分辨');
  equal(pieceOf(m.id, pid).holes.length, 2, '布上真的有两个洞');
});

test('★ ④ 退料 = 填回原洞（不是另造一片）—— 用户 2026-10-02 拍板', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.outbound(m.id, 3000, '出库');
  equal(pieceOf(m.id, pid).holes.length, 1, '先挖了 1 个洞');
  const fid = lastFlow().id;

  store.undoFlow(fid);

  const pieces = store.getMaterial(m.id).pieces;
  equal(pieces.length, 1, '★ 不许另造一片 —— 退料要把料填回**原来那片布**');
  equal(pieces[0].holes.length, 0, '★ 那个洞被填回去了');
  near(pieces[0].area, 200 * 150, 0.01, '面积回到原值（退的是**当初挖的那一块**）');
});

group('出处 · 撤销不许丢形状（2026-10-01 审计查实的真 bug）');

test('★ ⑤ 撤销裁剪：缺口不许凭空消失，也不许出现两块同 id 的布', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.cutFabric(m.id, pid, 40, 30, '第一刀', false);
  store.cutFabric(m.id, pid, 40, 30, '第二刀', false);
  equal(pieceOf(m.id, pid).holes.length, 2, '两个洞');

  store.undoFlow(lastFlow().id);      // 撤销第二刀

  const pieces = store.getMaterial(m.id).pieces;
  equal(pieces.length, 1, '★ 同 id 不许出现两块（面积会凭空翻倍）');
  equal(pieces[0].holes.length, 1, '★ 只剩第一刀那个洞 —— 缺口不许凭空消失');
  near(pieces[0].area, 200 * 150 - 1200, 0.01, '面积回到"只裁过一刀"');
});

test('★ ⑥ 撤销销毁带缺口的碎料：形状要原样回来', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.cutFabric(m.id, pid, 40, 30, '先裁一刀', false);
  const beforeHoles = pieceOf(m.id, pid).holes.length;
  const beforeArea = pieceOf(m.id, pid).area;
  store.destroyPiece(m.id, pid, '销毁');
  equal(store.getMaterial(m.id).pieces.length, 0, '销毁后片没了');

  store.undoFlow(lastFlow().id);

  const back = store.getMaterial(m.id).pieces[0];
  ok(back, '撤销后片要回来');
  equal(back.holes.length, beforeHoles, '★ 那个缺口要还在（V94 会变成完整矩形）');
  near(back.area, beforeArea, 0.01, '面积也要一模一样');
});

group('出处 · 刀口布（按批估量，出处是"哪几批"）');

test('★ ⑦ 刀口布扣料：要说得出是从**哪几批**里出的（FIFO）', () => {
  F.reset();
  const m = F.batchFabricMaterial({ batchRemain: 0, batchUnit: 'kg', batchUnitPrice: 5 });
  F.seedMaterials([m]);

  store.inbound(m.id, 2, 10, '第一批');     // 2kg
  store.inbound(m.id, 3, 18, '第二批');     // 3kg

  store.outbound(m.id, 1.5, '出库');
  const o1 = lastFlow().origins[0];
  ok(origin.isValid(o1), '刀口布也要有出处，实际：' + JSON.stringify(o1));
  equal(o1.way, 'batch');
  equal(o1.lots.length, 1, '1.5kg 全在第一批（2kg）里 —— 先入先出');
  near(o1.lots[0].qty, 1.5, 0.01);

  store.outbound(m.id, 1.0, '再出库');
  const o2 = lastFlow().origins[0];
  equal(o2.lots.length, 2, '★ 跨批时必须说清"从哪几批里各出多少"');
  near(o2.lots[0].qty, 0.5, 0.01, '第一批剩下 0.5');
  near(o2.lots[1].qty, 0.5, 0.01, '第二批出 0.5');
});

test('★ ⑧ 批次明细之和必须**等于账上剩余**（对不上就有"来历不明的量"）', () => {
  F.reset();
  const m = F.batchFabricMaterial({ batchRemain: 0, batchUnit: 'kg', batchUnitPrice: 5 });
  F.seedMaterials([m]);
  store.inbound(m.id, 2, 10, '第一批');
  store.inbound(m.id, 3, 18, '第二批');
  store.outbound(m.id, 1.5, '出库');

  const db = store.getMaterial(m.id);
  const sum = util.round((db.batchLots || []).reduce((s, l) => s + (Number(l.remain) || 0), 0), 2);
  near(sum, db.batchRemain, 0.01, '★ 批次明细之和 = batchRemain（对不上说明出处记歪了）');
});

group('出处 · 生产记录与"一块布都不许没出处"');

test('★ ⑨ 生产记录要存下「这批动了哪些布的哪些位置」（退产/追溯才有得查）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const p = F.product({
    name: '布包',
    bom: [{
      materialId: m.id, materialName: m.name, isFabric: true,
      length: 40, width: 30, area: 1200, stockMode: 'piece'
    }]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);

  const pr = store.getProduct(p.id).productions[0];
  ok(pr.origins && pr.origins.length, '★ 生产记录必须带 origins，实际：' + JSON.stringify(pr.origins));
  equal(pr.origins.length, 2, '做了 2 件 → 记下 2 处（每件一刀）');
  pr.origins.forEach((o) => {
    ok(origin.isValid(o), '存下来的每一处都要是**完整**出处：' + JSON.stringify(o));
  });
});

test('★ ⑩ 扫地检查：凡是面料流水，**一条都不许没有出处**', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.cutFabric(m.id, pid, 40, 30, '裁', false);
  store.outbound(m.id, 500, '出库');
  store.stocktakePiece(m.id, pid, 150, 150, '盘库');
  store.destroyPiece(m.id, pid, '销毁');

  const bad = fabricFlows().filter(f => !(f.origins && f.origins.length && f.origins.every(origin.isValid)));
  equal(bad.length, 0,
    '★ 有 ' + bad.length + ' 条面料流水说不出处：' + JSON.stringify(bad.map(f => f.remark || f.source)));
});

test('★ ⑪ 每一块布都要有 origin 字段（「所有的布不管在哪里都要这样要求」）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [] });
  F.seedMaterials([m]);
  store.inbound(m.id, 0, { length: 200, width: 150, total: 30 }, '入库');
  const pc = store.getMaterial(m.id).pieces[0];
  ok(pc.origin, '入库造的布要有 origin（不许留空 —— 留空就事后谁也说不清）');
  ok(pc.origin.note || pc.origin.way, '至少要说清它是怎么来的');

  // 退料造出来的片（兜底那条路）也必须带 origin，并**如实标明是脱片**
  store.outbound(m.id, 1000, '出库');
  const fid = lastFlow().id;
  store.undoFlow(fid);
  store.getMaterial(m.id).pieces.forEach((p) => {
    ok(p.origin, '布片 ' + p.id + ' 缺 origin');
  });
});

group('面料出库 · 必须由用户指定「哪片布 + 哪个位置」');

// 用户 2026-10-02 真机质问：
//   「物料出库为什么只有个面积？不是说有关面料的都要关联几何形状吗
//     只有个面积怎么扣？连长宽都没有」
// 改造前：只填一个 cm²，然后**系统自己挑一块布**（挑最小能装下的）、**自己挖一个近似矩形**。
// 那不是"扣不了"，是"扣在哪由系统替你决定" —— 正好违反「哪片布 + 哪个位置」。

test('★ ⑫ 出库按**用户摆的位置**挖：出处必须是他选的那片布、那个位置', () => {
  F.reset();
  // 造两块布：小的（80×150）能被 40×30 装下，大的（200×150）也能
  // —— 系统"紧配优先"会挑**小的**那块
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150], [80, 150]] });
  F.seedMaterials([m]);
  const db0 = store.getMaterial(m.id);
  const big = db0.pieces[0].id, small = db0.pieces[1].id;

  store.outboundCut(m.id, [
    { materialId: m.id, pieceId: big, length: 40, width: 30, rotate: false, at: { x: 100, y: 60 } }
  ], '出库');

  const f = lastFlow();
  ok(f.origins && f.origins.length === 1, '出库流水必须带出处');
  const o = f.origins[0];
  ok(origin.isValid(o), '出处要说全，实际：' + JSON.stringify(o));

  equal(o.pieceId, big, '★ 动的必须是**用户选的那片布**（不是系统"紧配"挑的小块）');
  near(o.rect.x, 100, 0.01, '★ 位置就是**用户摆的那个位置**');
  near(o.rect.y, 60, 0.01);
  near(o.rect.length, 40, 0.01, '形状：长来自用户填的长（不再是一个面积）');
  near(o.rect.width, 30, 0.01);

  equal((pieceOf(m.id, small).holes || []).length, 0, '★ 用户没选的那块布，一点没动');
  ok(pieceOf(m.id, big).holes.length === 1, '用户选的那块布上，真的多了一个洞');
});

test('★ ⑬ 转动过的片：位置与形状都要按**摆下去的样子**记', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.outboundCut(m.id, [
    { materialId: m.id, pieceId: pid, length: 120, width: 40, rotate: true, at: { x: 20, y: 20 } }
  ], '出库');

  const o = lastFlow().origins[0];
  near(o.rect.length, 40, 0.01, '★ 转了 90° ⇒ 布上占的是 40×120（竖着）');
  near(o.rect.width, 120, 0.01);
  near(o.rect.x, 20, 0.01);
  near(o.rect.y, 20, 0.01);
});

test('★ ⑭ 出库撤销 = 填回原洞（不是另造一片），且来源可撤销', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.outboundCut(m.id, [
    { materialId: m.id, pieceId: pid, length: 40, width: 30, rotate: false, at: { x: 100, y: 60 } }
  ], '出库');
  const f = lastFlow();
  equal(f.source, 'manual', '★ 来源必须是 manual（否则详情页的「撤销」点不到）');
  equal(pieceOf(m.id, pid).holes.length, 1, '先挖了 1 个洞');

  store.undoFlow(f.id);

  const pieces = store.getMaterial(m.id).pieces;
  equal(pieces.length, 1, '★ 不许另造一片 —— 出库撤销是"填回原洞"');
  equal(pieces[0].holes.length, 0, '★ 洞被填回去了');
  near(pieces[0].area, 200 * 150, 0.01, '面积回到原值');
});

test('★ ⑮ 出库大小按**用户填的长宽**算，不是让他填一个面积', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pid = store.getMaterial(m.id).pieces[0].id;

  store.outboundCut(m.id, [
    { materialId: m.id, pieceId: pid, length: 37, width: 21, rotate: false, at: { x: 0, y: 0 } }
  ], '出库');
  const f = lastFlow();
  near(f.qty, 777, 0.01, '★ 面积是 37×21=777 算出来的（用户只需要说长和宽）');
});

group('面料出库 · 页面入口（真的把页面跑起来）');

test('★ ⑯ 点「出库」：常规面料必须进裁剪排版界面（不是弹一个"填面积"的框）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const page = loadPage('../pages/materials/detail.js');
  page.onLoad({ id: m.id });
  stub.toasts.length = 0;

  page.openOut();

  equal(page.data.showSheet, false,
    '★ 常规面料不该再弹"填面积"的层 —— 那一层让用户根本没机会说"哪片布、哪个位置"');
  const urls = stub.navs('navigateTo').map(x => String(x.url));
  ok(urls.some(u => u.indexOf('cut-editor') >= 0),
    '★ 必须进裁剪排版界面（选哪片布 + 摆在哪），实际跳转：' + urls.join(' / '));
});

test('★ ⑰ 辅料 / 刀口布不受影响：仍走原来的弹层（它们没有形状可言）', () => {
  F.reset();
  const zip = F.simpleMaterial({ name: '黑色拉链', unit: '个' });
  const knife = F.batchFabricMaterial({ name: '刀口布', batchRemain: 5, batchUnit: 'kg', batchUnitPrice: 3 });
  F.seedMaterials([zip, knife]);

  const p1 = loadPage('../pages/materials/detail.js');
  p1.onLoad({ id: zip.id });
  stub.toasts.length = 0;
  p1.openOut();
  equal(p1.data.showSheet, true, '辅料仍走弹层（按数量）');
  equal(stub.navs('navigateTo').length, 0, '辅料不该跳裁剪界面');

  const p2 = loadPage('../pages/materials/detail.js');
  p2.onLoad({ id: knife.id });
  stub.toasts.length = 0;
  p2.openOut();
  equal(p2.data.showSheet, true, '刀口布仍走弹层（按批估量）');
  equal(stub.navs('navigateTo').length, 0, '刀口布不该跳裁剪界面');
});
