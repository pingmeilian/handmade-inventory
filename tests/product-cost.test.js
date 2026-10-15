// tests/product-cost.test.js —— 成本锁定时机修正（Day 2 任务 2.6）
// 核心验证：成本在「生产时」锁定，与物料扣减流水对齐 —— 物料涨价不影响已产成品的成本
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;
const calc = require('../utils/calc.js');
const stat = require('../utils/stat.js');

group('成本锁定 · 生产时记录实际成本');

test('生产时记录批次成本与单件成本', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);           // 均价 12.5
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);          // 用 4 个 → 4 × 12.5 = 50

  const db = store.getProduct(p.id);
  equal(db.productions.length, 1);
  near(db.productions[0].cost, 50, 0.01, '批次成本 = 本次扣料流水之和');
  near(db.productions[0].unitCost, 25, 0.01, '单件成本 = 50 / 2');
});

test('⚠️ 物料涨价后，已产成品的成本不变（本修的核心）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);           // 均价 12.5
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);
  store.produceProduct(p.id, 2);          // 成本 50，单件 25

  // 涨价：再进 10 个花 150 元
  //  ⚠️ 注意：生产已消耗 4 个，库存基数变了（10 → 6 → 16），均价要按新基数算
  //  均价 = (75 + 150) / 16 = 14.0625，而不是 13.75
  store.inbound(m.id, 10, 150);
  near(store.unitCost(store.getMaterial(m.id)), 14.0625, 1e-6, '物料均价确实涨了');

  // 若按旧逻辑（卖出时重算），成本会变成 14.0625 × 2 = 28.125 → 利润少算 3.125
  store.sellProduct(p.id, 1, 100);
  const sale = store.getProduct(p.id).sales[0];
  near(sale.costSnapshot.totalCost, 25, 0.01,
    '成本必须是生产时的 25，而不是涨价后的 28.125');
  equal(sale.costSnapshot.isEstimate, false, '有生产记录 → 非估算');
  near(sale.qty * (sale.price - sale.costSnapshot.totalCost), 75, 0.01, '利润 = 100 − 25');
});

test('多批次成本取加权平均', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);           // 均价 12.5
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);          // 50 → 单件 25
  store.inbound(m.id, 10, 150);           // 均价 14.0625（基数 16）
  store.produceProduct(p.id, 2);          // 4 × 14.0625 = 56.25

  near(store.productActualUnitCost(store.getProduct(p.id)), 26.5625, 1e-6,
    '(50 + 56.25) / 4 = 26.5625');
});

test('多批次下卖出按加权平均成本计利润', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);
  store.produceProduct(p.id, 2);          // 50
  store.inbound(m.id, 10, 150);
  store.produceProduct(p.id, 2);          // 56.25
  store.sellProduct(p.id, 3, 100);        // 卖 3 件

  const sale = store.getProduct(p.id).sales[0];
  // ⚠️ costSnapshot.totalCost 的既有语义是「单件成本」
  near(sale.costSnapshot.totalCost, 26.5625, 0.01, '快照存单件成本');
  near(sale.qty * sale.price - sale.costSnapshot.totalCost * sale.qty, 220.3125, 0.01,
    '利润 = 3 × (100 − 26.5625) = 220.3125');
});

test('纯设计稿（从未生产）→ 回退到实时估算并标注', () => {
  F.reset();
  // 用一个独立的便宜物料，估算值好算：unitCost 3 × 用量 2 = 6
  const cheap = F.simpleMaterial({ quantity: 100, unitPrice: 3 });
  F.seedMaterials([cheap]);
  const p = F.product({ sellableStock: 1, bom: [{ materialId: cheap.id, usage: 2 }] });
  F.seedProducts([p]);

  equal(store.productActualUnitCost(store.getProduct(p.id)), null, '无生产记录 → null');
  store.sellProduct(p.id, 1, 50);
  const sale = store.getProduct(p.id).sales[0];
  near(sale.costSnapshot.totalCost, 6, 0.01, '回退为实时估算 2 × 3 = 6');
  equal(sale.costSnapshot.isEstimate, true, '必须标注为估算');
});

test('老数据（生产记录无 cost 字段）→ 不凭空造数，回退估算', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 3 });
  F.seedMaterials([m]);
  const p = F.product({
    bom: [{ materialId: m.id, usage: 2 }],
    productions: [{ date: '2026-01-01', qty: 5 }]   // 老格式：只有 date 和 qty
  });
  F.seedProducts([p]);

  equal(store.productActualUnitCost(store.getProduct(p.id)), null,
    '老数据无成本字段 → 不参与计算');
  equal(stat.productCostIsEstimate(store.getProduct(p.id)), true);
});

test('样品出库（discardSample）也用生产实际成本', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);
  const p = F.product({
    nature: 'sample',
    bom: [{ materialId: m.id, usage: 2 }]
  });
  F.seedProducts([p]);
  store.produceProduct(p.id, 2, null, 'sample');   // 单件 25

  store.discardSample(p.id, 1, '送样');
  const d = store.getProduct(p.id).discards[0];
  near(d.unitCost, 25, 0.01, '样品成本应为生产时的 25');
  equal(d.isEstimate, false);
});

group('成本锁定 · 统计口径（三级回退）');

test('stat.productCost：生产实际 > 销售快照 > 实时估算', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 125);
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);
  store.produceProduct(p.id, 2);          // 单件 25

  const db = store.getProduct(p.id);
  equal(stat.productCostIsEstimate(db), false);
  near(stat.productCost(db), 25, 0.01, '① 生产实际成本优先');

  // 老数据（无生产成本字段）
  const old = F.product({
    bom: [{ materialId: m.id, usage: 2 }],
    productions: [{ date: '2026-01-01', qty: 5 }],
    costSnapshot: { totalCost: 30 }
  });
  F.seedProducts([old]);
  const odb = store.getProduct(old.id);
  equal(stat.productCostIsEstimate(odb), false, '② 有销售快照也不算估算');
  near(stat.productCost(odb), 30, 0.01);

  // 纯设计稿（用独立便宜物料，估算值好算：3 × 2 = 6）
  const cheap2 = F.simpleMaterial({ quantity: 50, unitPrice: 3 });
  F.seedMaterials([cheap2]);
  const draft = F.product({ bom: [{ materialId: cheap2.id, usage: 2 }] });
  F.seedProducts([draft]);
  equal(stat.productCostIsEstimate(store.getProduct(draft.id)), true, '③ 只能估算');
  near(stat.productCost(store.getProduct(draft.id)), 6, 0.01);
});

test('成本快照合计 ≡ 对应生产批次的扣料金额（对账断言）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 40, 500);           // 均价 12.5
  const p = F.product({ bom: [{ materialId: m.id, usage: 2 }] });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);          // 扣 4 个 = 50
  store.produceProduct(p.id, 4);          // 扣 8 个 = 100
  store.sellProduct(p.id, 5, 100);
  store.sellProduct(p.id, 1, 100);

  const db = store.getProduct(p.id);
  const soldQty = db.sales.reduce((s, x) => s + x.qty, 0);
  // ⚠️ totalCost 是单件成本：合计 = 单件成本 × 各笔数量
  const soldCost = db.sales.reduce((s, x) => s + x.costSnapshot.totalCost * x.qty, 0);
  near(soldQty, 6, 0.01);
  near(soldCost, 25 * 6, 0.01, '卖出成本合计 = 单件成本(25) × 数量(6)');
  near(db.sales[0].costSnapshot.totalCost, 25, 0.01, '快照存的是单件成本');

  // 生产批次合计 = 扣料流水合计
  const prodCost = db.productions.reduce((s, x) => s + (x.cost || 0), 0);
  const cutFlowCost = store.getFlows()
    .filter((f) => f.source === 'cut' && f.materialId === m.id)
    .reduce((s, f) => s + (Number(f.totalPrice) || 0), 0);
  near(prodCost, cutFlowCost, 0.02, '生产记录的成本合计必须等于扣料流水合计');
});

group('成本锁定 · 死代码清理');

test('addSale（漏扣库存的死代码）已从导出中移除', () => {
  equal(store.addSale, undefined, 'addSale 不应再被导出');
});

test('addSale 的函数体已删除（全项目零引用）', () => {
  const fs = require('fs');
  const src = fs.readFileSync('utils/store.js', 'utf8');
  equal(src.indexOf('function addSale'), -1, 'store.js 中不应再有 addSale 定义');
});
