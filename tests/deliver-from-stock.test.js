// tests/deliver-from-stock.test.js —— 排单交付：先选「货从哪来」（V149）
//
// 用户 2026-10-12 报：「排单交付点交付之后，没有扣除成品的数量啊」。
// 顺着查下去是三件事叠在一起：
//   ① 交付只扣物料，**从来没碰过成品在库**（sellableStock）；
//   ② 也不写销售记录 ⇒ 交付出去的货不进「成品出入库 → 销售」；
//   ③ 而它扣料是**系统按面积 FIFO 自动刨布** —— 全项目唯一一条"用户没得选从哪块布上裁"的路径。
//
// 用户定的口径（原话「1 用户自己选 2 记 3 1步」）：
//   · **用户自己选**货从哪来（从成品在库出 / 从物料出现做现交）—— 系统不预选、不替他决定；
//   · 走「从物料出」要**记**一条生产记录（这样成本口径与"在库 +N 又 −N"天然对上）；
//   · 界面**一步**（弹窗里一次问清：数量 + 来源）。
//
// 本文件盯的是**账**：物料 / 成品在库 / 销售 三笔账在四条路径（A 交、B 交、撤 A、撤 B）
// 下各自怎么动、动多少。行为对不对，看这里；结构上会不会漏，看 guard-deliver-source.test.js。
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');
const util = F.util;
const store = F.store;

group('排单交付 · 货从哪来（V149）');

// 一个"辅料型"成品：BOM 只有一条非面料行（不需要裁剪）——把几何裁剪排除在外，
// 先单独验两条账路本身。
function seedTrim() {
  F.reset();
  const m = F.simpleMaterial({ name: '合金配件', quantity: 100, unitPrice: 2 });
  F.seedMaterials([m]);
  const p = F.product({ name: '发夹', bom: [{ materialId: m.id, materialName: m.name, usage: 2 }] });
  F.seedProducts([p]);
  const c = store.saveCommission({
    productId: p.id, productName: '发夹', client: '小美', qty: 3, price: 50,
    deadline: util.addDays(util.today(), 5)
  });
  return { m: store.getMaterial(m.id), p: store.getProduct(p.id), c: store.getCommission(c.id) };
}

// 一个"面料型"成品：BOM 一行面料（30×20），库存两块布（大 100×100 / 小 40×30）
function seedFabric() {
  F.reset();
  const f = F.fabricMaterial({ name: '棉布', pieces: [[100, 100], [40, 30]], unitPrice: 0.01, fabricWidth: 100 });
  F.seedMaterials([f]);
  const fm = store.getMaterial(f.id);
  const big = fm.pieces.find(x => util.round(x.length, 2) === 100);
  const small = fm.pieces.find(x => util.round(x.length, 2) === 40);
  const p = F.product({
    name: '布偶',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, stockMode: 'piece', length: 30, width: 20 }]
  });
  F.seedProducts([p]);
  const c = store.saveCommission({
    productId: p.id, productName: '布偶', client: '阿强', qty: 1, price: 80,
    deadline: util.addDays(util.today(), 3)
  });
  return { fm, big, small, p: store.getProduct(p.id), c: store.getCommission(c.id) };
}

function giveStock(productId, n) {
  const list = store.getProducts();
  list.find(x => x.id === productId).sellableStock = n;
  store.set(store.KEYS.PRODUCTS, list);
}

// ---------- A · 从成品在库出 ----------
test('★ ① 「从成品在库出」：在库扣减、写销售、★ 物料一点不动', () => {
  const s = seedTrim();
  giveStock(s.p.id, 10);
  const qtyBefore = store.getMaterial(s.m.id).quantity;
  const flowsBefore = store.getFlows().length;

  store.assignCommission(s.c.id, 3, { fromStock: 'product' });

  const p = store.getProduct(s.p.id);
  equal(p.sellableStock, 7, '★ 在库 10 − 3 = 7');
  equal((p.sales || []).length, 1, '要写一条销售记录（客户＝排单客户）');
  equal(p.sales[0].client, '小美', '客户名要带上');
  equal(Number(p.sales[0].price), 50, '售价按排单单价');
  equal(store.getMaterial(s.m.id).quantity, qtyBefore, '★ 物料数量一点不动 —— 料在生产时就扣过了');
  equal(store.getFlows().length, flowsBefore, '★ 也不许产生任何物料流水（否则就是双重扣料）');

  const c = store.getCommission(s.c.id);
  equal(c.deliveredQty, 3, '排单减量');
  equal(c.deliverLogs[0].fromStock, 'product', '来源要记下来');
  ok(c.deliverLogs[0].saleId, '★ 要记下销售记录 id —— 撤销靠它把那笔销售删掉');
});

test('② 「从成品在库出」在库不够 → NOSTOCK，一个数字都不许动', () => {
  const s = seedTrim();
  giveStock(s.p.id, 2);
  const qtyBefore = store.getMaterial(s.m.id).quantity;
  let err = null;
  try { store.assignCommission(s.c.id, 3, { fromStock: 'product' }); } catch (e) { err = e; }
  ok(err, '必须拦住');
  equal(err.code, 'NOSTOCK');
  equal(store.getProduct(s.p.id).sellableStock, 2, '在库不动');
  equal((store.getProduct(s.p.id).sales || []).length, 0, '不许留下半条销售记录');
  equal(store.getMaterial(s.m.id).quantity, qtyBefore);
  equal(store.getCommission(s.c.id).deliveredQty, 0, '排单也不许减量');
});

// ---------- B · 从物料出（现做现交） ----------
test('★ ③ 「从物料出」：扣料一次、在库 +N 又 −N 净零、销售照写', () => {
  const s = seedTrim();
  const qtyBefore = store.getMaterial(s.m.id).quantity;

  store.assignCommission(s.c.id, 3, { fromStock: 'material' });

  equal(util.round(qtyBefore - store.getMaterial(s.m.id).quantity, 2), 6,
    '★ 扣料 = 2/件 × 3 件 = 6（一次，不多不少）');
  const p = store.getProduct(s.p.id);
  equal(p.sellableStock, 0, '★ 现做现交：在库 +3 又 −3 = 0（货没在库里停过）');
  equal((p.sales || []).length, 1, '销售记录照写（收入要进账）');
  equal((p.productions || []).length, 1, '★ 要记一条生产记录（用户拍板：记）');
  const c = store.getCommission(s.c.id);
  equal(c.deliverLogs[0].fromStock, 'material');
  ok(c.deliverLogs[0].prodId, '★ 要记下生产记录 id —— 撤销靠它退产返还物料');
});

test('★ ④ 回归：先生产再交付（走「在库出」）→ 料只扣生产那一次，绝不重复扣', () => {
  // 这是 V149 修的**真正的账错**：老版本两条路径各自扣料、互不知情
  //   ⇒ 料被扣两遍、成品一件没少（用户报的"没扣除成品数量"就是它的表象）。
  const s = seedTrim();
  const qty0 = store.getMaterial(s.m.id).quantity;

  store.produceProduct(s.p.id, 3);                          // 先做 3 件放着
  equal(util.round(qty0 - store.getMaterial(s.m.id).quantity, 2), 6, '生产扣 6');
  equal(store.getProduct(s.p.id).sellableStock, 3, '在库 3');

  store.assignCommission(s.c.id, 3, { fromStock: 'product' });   // 再按单交付

  equal(util.round(qty0 - store.getMaterial(s.m.id).quantity, 2), 6,
    '★ 交付不许再扣一遍料（修前这里会变成 12：料没了、货还在）');
  equal(store.getProduct(s.p.id).sellableStock, 0, '在库 3 → 0');
});

// ---------- 面料：必须用户选，不许自动刨布 ----------
test('★ ⑤ 需要裁剪的面料 · 不带方案 → NEEDCUT，一条流水都不许产生', () => {
  const s = seedFabric();
  const flowsBefore = store.getFlows().length;
  let err = null;
  try { store.assignCommission(s.c.id, 1, { fromStock: 'material' }); } catch (e) { err = e; }
  ok(err, '必须拦住（而不是像老版本那样静默自动取片）');
  equal(err.code, 'NEEDCUT', '错误码要是 NEEDCUT —— 上层据此把用户带进裁剪页');
  equal(store.getFlows().length, flowsBefore, '★ 一条流水都不许产生');
  equal(store.getCommission(s.c.id).deliveredQty, 0, '排单不许减量');
});

test('★ ⑥ 需要裁剪的面料 · 带逐件方案 → 成功，且扣的是**用户选的那片布**', () => {
  const s = seedFabric();
  // 用户在两块布里选了**小的那块**（40×30 里裁 30×20）
  const perPiece = [[{
    materialId: s.fm.id, pieceId: s.small.id,
    length: 30, width: 20, rotate: false, at: { x: 1, y: 1 }
  }]];

  store.assignCommission(s.c.id, 1, { fromStock: 'material', perPiece });

  const after = store.getMaterial(s.fm.id);
  const smallAfter = after.pieces.find(x => x.id === s.small.id);
  const bigAfter = after.pieces.find(x => x.id === s.big.id);
  equal((smallAfter.holes || []).length, 1, '★ 大的那块布一点没动 —— 用户选的是小的这块');
  near(smallAfter.area, util.round(40 * 30 - 30 * 20, 2), 0.01, '小布挖掉 30×20 = 600cm²');
  equal((bigAfter.holes || []).length, 0, '★ 大布不许被碰');

  const flows = store.getFlows();
  const f = flows[flows.length - 1];
  equal(f.source, 'commission', '★ 交付产生的流水，来源必须是「排单履约」（V72 口径，别退回「成品裁剪」）');
  equal(f.remark, '排单交付 · 阿强', '★ 备注要带客户名 —— 否则在物料流水里认不出是哪一单');
  ok((f.origins || []).some(o => o.pieceId === s.small.id),
    '★ 出处要指向**用户选的那片**，实际：' + JSON.stringify((f.origins || []).map(o => o.pieceId)));
  equal(store.getProduct(s.p.id).sellableStock, 0, '在库 +1 又 −1 = 0');
});

// ---------- 撤销：按来源反向 ----------
test('★ ⑦ 撤销「从成品在库出」：删销售 + 在库加回；物料一动不动', () => {
  const s = seedTrim();
  giveStock(s.p.id, 10);
  const qtyBefore = store.getMaterial(s.m.id).quantity;
  store.assignCommission(s.c.id, 3, { fromStock: 'product' });
  const flowsAfterDeliver = store.getFlows().length;

  store.undoDeliver(s.c.id, 0);

  const p = store.getProduct(s.p.id);
  equal(p.sellableStock, 10, '★ 在库加回 7 → 10');
  equal((p.sales || []).length, 0, '★ 那条销售记录要删掉（不然收入平白多一笔）');
  equal(store.getMaterial(s.m.id).quantity, qtyBefore, '物料不动');
  equal(store.getFlows().length, flowsAfterDeliver, '★ 不产生任何物料流水');
  const c = store.getCommission(s.c.id);
  equal(c.deliveredQty, 0, '排单余量恢复');
  equal(c.deliverLogs.length, 0, '交付记录也撤掉');
});

test('★ ⑧ 撤销「从物料出」：删销售 + 退产返还物料 + 在库减回', () => {
  const s = seedTrim();
  const qty0 = store.getMaterial(s.m.id).quantity;
  store.assignCommission(s.c.id, 3, { fromStock: 'material' });
  const outFlows = store.getFlows().length;

  store.undoDeliver(s.c.id, 0);

  equal(util.round(store.getMaterial(s.m.id).quantity - qty0, 2), 0,
    '★ 料要全部还回来（6 还回去，净变化 0）');
  const p = store.getProduct(s.p.id);
  equal(p.sellableStock, 0, '在库仍为 0（+3 又 −3）');
  equal((p.sales || []).length, 0, '销售记录删掉');
  equal((p.productions || []).length, 0, '★ 那条"为交付而做"的生产记录也要撤掉');
  ok(store.getFlows().length > outFlows, '返还物料会留下入库流水（这是对的：账要留痕）');
  equal(store.getCommission(s.c.id).deliveredQty, 0);
});

test('⑨ 老记录（V149 之前、没有 fromStock）→ 沿用原逻辑：按 BOM 反向返还物料', () => {
  // 口径：**不猜、不追溯**。老记录当年就是"扣了料、没写销售、没动在库"，
  // 撤销就照它当年的样子反着走 —— 硬改成新口径等于替用户改历史账。
  const s = seedTrim();
  const qty0 = store.getMaterial(s.m.id).quantity;
  const c = store.getCommission(s.c.id);
  c.deliveredQty = 3;
  c.deliverLogs = [{ date: util.today(), qty: 3 }];      // ← 老记录：只有 date/qty，没有 fromStock
  store.saveCommission(c);

  store.undoDeliver(s.c.id, 0);

  equal(util.round(store.getMaterial(s.m.id).quantity - qty0, 2), 6,
    '★ 按 BOM 反向返还：2/件 × 3 件 = 6');
  equal(store.getCommission(s.c.id).deliveredQty, 0, '排单余量恢复');
  ok(store.getFlows().some(f => f.source === 'commission' && f.type === 'in'),
    '返还流水也要标「排单履约」');
});

// ---------- 交付记录里到底存了什么 ----------
test('⑩ 交付记录必须存齐：fromStock / prodId / saleId / origins', () => {
  const s = seedFabric();
  const perPiece = [[{
    materialId: s.fm.id, pieceId: s.small.id,
    length: 30, width: 20, rotate: false, at: { x: 1, y: 1 }
  }]];
  store.assignCommission(s.c.id, 1, { fromStock: 'material', perPiece });
  const log = store.getCommission(s.c.id).deliverLogs[0];
  equal(log.fromStock, 'material');
  ok(log.prodId, 'prodId（退产用）');
  ok(log.saleId, 'saleId（撤销售用）');
  ok((log.origins || []).length > 0, 'origins（这批料是从哪几片布的哪个位置来的）');
});
