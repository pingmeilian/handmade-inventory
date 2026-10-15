// tests/calc.test.js —— 成本计算引擎 特征测试（按现行为断言）
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const calc = require('../utils/calc.js');
const util = require('../utils/util.js');

group('calc · computeProduct 成本构成');

test('非面料：物料成本 = 用量 × 单位成本', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 3 });          // unitCost = 3
  F.seedMaterials([m]);
  const p = F.product({ bom: [{ materialId: m.id, usage: 10 }] });

  const c = calc.computeProduct(p);
  near(c.materialCost, 30, 0.01);
  near(c.totalCost, 30, 0.01, '不含人工的硬成本');
  near(c.price, 30, 0.01);
  near(c.profit, 0, 0.01);
});

test('含人工（按件）：售价含人工，利润 = 人工', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 3 });
  F.seedMaterials([m]);
  const p = F.product({
    bom: [{ materialId: m.id, usage: 10 }],
    includeLabor: true, laborMode: 'perPiece', laborFeePerPiece: 20
  });

  const c = calc.computeProduct(p);
  near(c.materialCost, 30, 0.01);
  near(c.laborCost, 20, 0.01);
  near(c.totalCost, 30, 0.01, '硬成本不含人工');
  near(c.price, 50, 0.01, '售价 = 物料 + 人工');
  near(c.profit, 20, 0.01, '利润 = 人工');
  near(c.profitRate, 0.4, 1e-4, '利润率 = 20 / 50');
});

test('含人工（按小时）：人工 = 时薪 × 工时', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  F.seedMaterials([m]);
  const p = F.product({
    bom: [{ materialId: m.id, usage: 10 }],
    includeLabor: true, laborMode: 'hourly', hourlyRate: 50, laborHours: 1.5
  });
  const c = calc.computeProduct(p);
  near(c.laborCost, 75, 0.01);
  near(c.price, 85, 0.01);
});

test('面料按面积：成本 = 面积(cm²) × 元/cm²', () => {
  F.reset();
  const fab = F.fabricMaterial({ unitPrice: 0.02, fabricWidth: 150, pieces: [[100, 100]] }); // 面积 10000
  F.seedMaterials([fab]);
  const p = F.product({ bom: [{ materialId: fab.id, isFabric: true, area: 500 }] });

  const c = calc.computeProduct(p);
  near(c.materialCost, 10, 0.01, '500 × 0.02');
});

test('面料按批（刀口布）：成本 = 每件用量 × 元/kg', () => {
  F.reset();
  const fab = F.batchFabricMaterial({ batchRemain: 10, batchUnitPrice: 8 }); // unitCost = 8
  F.seedMaterials([fab]);
  const p = F.product({ bom: [{ materialId: fab.id, isFabric: true, batchUsage: 0.5 }] });

  const c = calc.computeProduct(p);
  near(c.materialCost, 4, 0.01, '0.5 × 8');
});

test('包装与运费只对商品计入，样品强制为 0', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  F.seedMaterials([m]);
  const bom = [{ materialId: m.id, usage: 10 }];

  const goods = calc.computeProduct(F.product({ bom, packaging: 5, shipping: 8 }));
  near(goods.packaging, 5, 0.01);
  near(goods.shipping, 8, 0.01);
  near(goods.price, 23, 0.01);

  const sample = calc.computeProduct(F.product({ bom, nature: 'sample', packaging: 5, shipping: 8 }));
  near(sample.packaging, 0, 0.01, '样品不计包装');
  near(sample.shipping, 0, 0.01, '样品不计运费');
  near(sample.price, 10, 0.01);
});

test('不含人工时利润为 0，利润率为 0', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  F.seedMaterials([m]);
  const c = calc.computeProduct(F.product({ bom: [{ materialId: m.id, usage: 10 }], includeLabor: false }));
  near(c.laborCost, 0, 0.01);
  near(c.profit, 0, 0.01);
  near(c.profitRate, 0, 1e-6);
});

test('售价为 0 时利润率为 null（避免除零）', () => {
  F.reset();
  const c = calc.computeProduct(F.product({ bom: [] }));
  equal(c.profitRate, null);
});

test('BOM 引用不存在的物料时按 0 计，不抛错', () => {
  F.reset();
  const c = calc.computeProduct(F.product({ bom: [{ materialId: 'm_ghost', usage: 10 }] }));
  near(c.materialCost, 0, 0.01);
});

test('目标利润率达标判定', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 3 });
  F.seedMaterials([m]);
  // 利润 20 / 售价 50 = 0.4
  const hit = calc.computeProduct(F.product({
    bom: [{ materialId: m.id, usage: 10 }],
    includeLabor: true, laborMode: 'perPiece', laborFeePerPiece: 20, targetProfit: 0.3
  }));
  equal(hit.targetAchieved, true);

  const miss = calc.computeProduct(F.product({
    bom: [{ materialId: m.id, usage: 10 }],
    includeLabor: true, laborMode: 'perPiece', laborFeePerPiece: 20, targetProfit: 0.5
  }));
  equal(miss.targetAchieved, false);
});

test('BOM 多行成本累加', () => {
  F.reset();
  const a = F.simpleMaterial({ quantity: 100, unitPrice: 2 });
  const b = F.simpleMaterial({ quantity: 100, unitPrice: 5 });
  F.seedMaterials([a, b]);
  const c = calc.computeProduct(F.product({
    bom: [{ materialId: a.id, usage: 3 }, { materialId: b.id, usage: 2 }]
  }));
  near(c.materialCost, 3 * 2 + 2 * 5, 0.01);
});

group('calc · 排单到期判定');

test('commissionDDLStatus 三档：过期 / 临近 / 正常', () => {
  const t = util.today();
  equal(calc.commissionDDLStatus(util.addDays(t, -1)), 'over');
  equal(calc.commissionDDLStatus(t), 'warn', '今天 → 3 天内算临近');
  equal(calc.commissionDDLStatus(util.addDays(t, 3)), 'warn');
  equal(calc.commissionDDLStatus(util.addDays(t, 4)), 'normal');
});

group('calc · dashboardMetrics 看板口径');

test('库存总值取物料 totalValue 之和（仅当前空间）', () => {
  F.reset();
  F.seedMaterials([
    F.simpleMaterial({ quantity: 10, unitPrice: 10 }),   // 100
    F.simpleMaterial({ quantity: 5, unitPrice: 20 })     // 100
  ]);
  const d = calc.dashboardMetrics('bc_default');
  equal(d.materialCount, 2);
  near(d.inventoryValue, 200, 0.01);
});

test('销售统计：营业额与毛利按销售快照计算', () => {
  F.reset();
  const today = util.today();
  const p = F.product({
    saleStatus: 'sold',
    sales: [
      { qty: 1, price: 100, date: today, costSnapshot: { totalCost: 60 } },
      { qty: 2, price: 100, date: today, costSnapshot: { totalCost: 60 } }
    ]
  });
  F.seedProducts([p]);

  const d = calc.dashboardMetrics('bc_default');
  near(d.totalSales, 300, 0.01, '1×100 + 2×100');
  near(d.totalProfit, 120, 0.01, '120 = 3 × (100 - 60)');
  near(d.monthlyGrossProfit, 120, 0.01, '本月口径');
  equal(d.soldCount, 1);
});

test('缺少 costSnapshot 时按成本 0 计（毛利被高估）', () => {
  F.reset();
  const today = util.today();
  const p = F.product({ sales: [{ qty: 1, price: 100, date: today }] });
  F.seedProducts([p]);
  const d = calc.dashboardMetrics('bc_default');
  near(d.totalProfit, 100, 0.01, '无快照 → 视为零成本');
});

test('目标达成率只统计商品且设有目标利润率的成品', () => {
  F.reset();
  F.seedProducts([
    F.product({ nature: 'merchandise', targetProfit: 0.1, includeLabor: true, laborFeePerPiece: 0, bom: [] }),
    F.product({ nature: 'sample', targetProfit: 0.5, bom: [] })
  ]);
  const d = calc.dashboardMetrics('bc_default');
  equal(d.targetTotal, 1, '样品不计入');
});

group('calc · buildCurve 曲线');

test('7 天区间按日返回销售曲线，无销售处为 0', () => {
  F.reset();
  const today = util.today();
  const p = F.product({
    sales: [{ qty: 1, price: 50, date: today, costSnapshot: { totalCost: 20 } }]
  });
  F.seedProducts([p]);

  const points = calc.buildCurve('sales', 7, null, null, 'bc_default');
  equal(points.length, 7, '共 7 个点');
  equal(points[6].date, today, '最后一个点是今天');
  near(points[6].value, 50, 0.01);
  near(points[0].value, 0, 0.01);
});

test('利润曲线按 qty × (售价 − 快照成本) 累加', () => {
  F.reset();
  const today = util.today();
  const p = F.product({
    sales: [{ qty: 2, price: 60, date: today, costSnapshot: { totalCost: 25 } }]
  });
  F.seedProducts([p]);

  const points = calc.buildCurve('profit', 7, null, null, 'bc_default');
  near(points[6].value, 2 * (60 - 25), 0.01);
});
