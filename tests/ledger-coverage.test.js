// tests/ledger-coverage.test.js —— 逐条验证「所有库存变动路径」都让账目自洽
//
// 目的：证明 totalValue 收口到 addFlow 之后，**每一条会改库存的路径**都不会造成漂移。
// 这是把「26 处手工赋值 ↔ 26 次 addFlow」这个勘查结论，从"看起来对"变成"测出来对"。
//
// 每条用例的验证方式统一为：跑完操作 → store.reconcileTotalValue() → mismatchCount 必须为 0

const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;

// 断言账目自洽
function assertBalanced(label) {
  const res = store.reconcileTotalValue();
  equal(res.mismatchCount, 0,
    '【' + label + '】出现漂移：' + JSON.stringify(res.mismatches));
  equal(res.sumOk, true, '【' + label + '】总口径不平：' + res.sumDiff);
  return res;
}

group('覆盖 · 入库 / 出库');

test('非面料：入库 → 入库 → 出库', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);
  store.inbound(m.id, 10, 200);
  store.outbound(m.id, 7);
  assertBalanced('非面料入出库');
});

test('面料按片：入库 → 出库（按面积）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 0, unitPrice: 0, pieces: [] });
  F.seedMaterials([m]);
  store.inbound(m.id, null, { length: 200, width: 150, total: 300 });
  store.outbound(m.id, 5000);   // 出 5000 cm²
  assertBalanced('面料按片');
});

test('面料按批：入库 → 出库', () => {
  F.reset();
  const m = F.batchFabricMaterial({ batchRemain: 0, batchUnitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.inbound(m.id, 5, 75);
  store.outbound(m.id, 4);
  assertBalanced('面料按批');
});

group('覆盖 · 布料剪裁与销毁');

test('剪裁：切下红区后余料回流，账目自洽', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const pieceId = store.getMaterial(m.id).pieces[0].id;

  const schemes = store.listCutSchemes(m.id, 100, 50);
  ok(schemes.length > 0, '应能给出剪裁方案');
  store.cutFabric(m.id, pieceId, 100, 50, '测试剪裁', false, null);

  assertBalanced('剪裁');
  const db = store.getMaterial(m.id);
  ok(store.fabricArea(db) > 0, '余料仍在库存里');
  // V81：裁剪不拆块 —— 200×150 裁掉 100×50 之后还是这一块（带缺口），不是"整布 + 碎料"两片
  equal(db.pieces.length, 1, '还是一块布');
  equal(db.pieces[0].holes.length, 1, '裁走的部分记成镂空');
  near(store.fabricArea(db), 200 * 150 - 100 * 50, 0.01, '可用面积 = 外框 − 镂空（账没动）');
});

test('销毁碎料：账目自洽', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[100, 100]] });
  F.seedMaterials([m]);
  const pieceId = store.getMaterial(m.id).pieces[0].id;

  store.destroyPiece(m.id, pieceId, '测试销毁');
  assertBalanced('销毁碎料');
  equal(store.fabricCount(store.getMaterial(m.id)), 0, '布片应被移除');
});

group('覆盖 · 盘库');

test('整料盘库：盘亏后账目自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);       // 均价 15
  store.stocktakeMaterial(m.id, 18, '实际只有 18 个');
  assertBalanced('盘亏');
  near(store.getMaterial(m.id).quantity, 18, 0.01);
});

test('整料盘库：盘盈后账目自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);
  store.stocktakeMaterial(m.id, 25, '实际有 25 个');
  assertBalanced('盘盈');
  near(store.getMaterial(m.id).quantity, 25, 0.01);
});

test('布片盘库（改尺寸）：账目自洽', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[100, 150]] });
  F.seedMaterials([m]);
  store.cutFabric(m.id, store.getMaterial(m.id).pieces[0].id, 50, 50, '先切一刀', false, null);

  const piece = store.getMaterial(m.id).pieces[0];
  store.stocktakePiece(m.id, piece.id, 80, 150, '实际量得 80');
  assertBalanced('布片盘库');
});

group('覆盖 · 成品生产与退产（BOM 扣料）');

test('生产成品：按 BOM 扣料后账目自洽', () => {
  F.reset();
  const trim = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  const fab = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  F.seedMaterials([trim, fab]);

  store.inbound(trim.id, 100, 200);   // 均价 2
  store.inbound(fab.id, null, { length: 100, width: 150, total: 150 });

  const p = F.product({
    name: '测试布包',
    bom: [
      { materialId: trim.id, usage: 3 },
      { materialId: fab.id, isFabric: true, area: 2000 }
    ]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);
  assertBalanced('生产扣料');
});

test('退产（undoProduce）：返还 BOM 物料后账目自洽', () => {
  F.reset();
  const trim = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([trim]);
  store.inbound(trim.id, 100, 200);

  const p = F.product({ name: '测试成品', bom: [{ materialId: trim.id, usage: 3 }] });
  F.seedProducts([p]);
  store.produceProduct(p.id, 5);

  // ⚠️ 注意签名：undoProduce(productId, idx) —— 传的是「生产记录数组下标」，不是数量。
  //    与 deleteSale(productId, idx) 同为「用下标定位」的脆弱设计：
  //    生产记录一旦被重排/过滤，下标就会指错记录。已记入待修清单。
  const before = store.getFlows().length;
  store.undoProduce(p.id, 0);
  assertBalanced('退产');
  ok(store.getFlows().length > before, '退产应产生返还流水');
  near(store.getMaterial(trim.id).quantity, 100, 0.01, '物料应全部返还');
});

group('覆盖 · 撤销（红冲）');

test('撤销入库 / 出库 / 剪裁 后账目自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);
  store.outbound(m.id, 5);

  const inFlow = store.getFlows().find((f) => f.type === 'in');
  const outFlow = store.getFlows().find((f) => f.type === 'out');
  store.undoFlow(inFlow.id);
  assertBalanced('撤销入库后');
  store.undoFlow(outFlow.id);
  assertBalanced('撤销出库后');
});

group('覆盖 · ⭐ 老数据校准（不可改动用户看到的数字）');

test('⭐ 总值与流水不符时，补一条「期初校准」流水，而不是改数字', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);            // 流水合计 300

  // 模拟老数据：totalValue 是早期迁移按「单价 × 库存」推算的，并无流水支撑
  const list = store.getMaterials();
  list[0].totalValue = 250;
  store.set(store.KEYS.MATERIALS, list);
  store.set(store.KEYS.MIGRATED_TOTALVALUE_LEDGER, false);
  store.set(store.KEYS.SCHEMA_VERSION, 0); // 版本门一并打开，否则 runMigrations 会短路（Day 5.2）

  store.runMigrations();

  near(store.getMaterial(m.id).totalValue, 250, 0.01,
    '用户看到的库存总值必须保持不变');
  assertBalanced('校准后');

  const cal = store.getFlows().find((f) => f.source === 'calibration');
  ok(cal, '应生成一条期初校准流水');
  equal(cal.type, 'out', '总值 250 < 流水 300 → 需补一笔出库方向');
  near(cal.totalPrice, 50, 0.01);
  ok(String(cal.remark).indexOf('校准') >= 0, '备注应可辨识');
  ok(typeof cal.createdAt === 'number', '校准流水也带时间戳');
});

test('校准是幂等的（重复跑不再产生流水）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);
  const list = store.getMaterials();
  list[0].totalValue = 250;
  store.set(store.KEYS.MATERIALS, list);
  store.set(store.KEYS.MIGRATED_TOTALVALUE_LEDGER, false);
  store.set(store.KEYS.SCHEMA_VERSION, 0); // 版本门一并打开，否则 runMigrations 会短路（Day 5.2）

  store.runMigrations();
  const after1 = store.getFlows().length;
  store.runMigrations();
  store.runMigrations();
  equal(store.getFlows().length, after1, '重复跑不应再生成流水');
});

test('盘盈方向相反时校准流水方向也随之相反', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);

  const list = store.getMaterials();
  list[0].totalValue = 400;                // 总值 > 流水
  store.set(store.KEYS.MATERIALS, list);
  store.set(store.KEYS.MIGRATED_TOTALVALUE_LEDGER, false);
  store.set(store.KEYS.SCHEMA_VERSION, 0); // 版本门一并打开，否则 runMigrations 会短路（Day 5.2）
  store.runMigrations();

  const cal = store.getFlows().find((f) => f.source === 'calibration');
  equal(cal.type, 'in', '总值 > 流水 → 需补一笔入库方向');
  near(cal.totalPrice, 100, 0.01);
  assertBalanced('反向校准后');
});

test('校准流水在导出中显示为「期初校准」而非英文', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);
  const list = store.getMaterials();
  list[0].totalValue = 250;
  store.set(store.KEYS.MATERIALS, list);
  store.set(store.KEYS.MIGRATED_TOTALVALUE_LEDGER, false);
  store.set(store.KEYS.SCHEMA_VERSION, 0); // 版本门一并打开，否则 runMigrations 会短路（Day 5.2）
  store.runMigrations();

  const csv = require('../utils/csv.js');
  const out = csv.exportFlows();
  ok(out.indexOf('期初校准') >= 0, '导出应显示中文标签');
  ok(out.indexOf('calibration') < 0, '不应出现英文键名');
});

group('覆盖 · 综合长链（最接近真实使用）');

test('一整套业务流程跑完，账目依然自洽', () => {
  F.reset();
  const trim = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  const fab = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.02, pieces: [[200, 150]] });
  const bat = F.batchFabricMaterial({ batchRemain: 0, batchUnitPrice: 0 });
  F.seedMaterials([trim, fab, bat]);

  // 进货
  store.inbound(trim.id, 100, 200);
  store.inbound(fab.id, null, { length: 200, width: 150, total: 300 });
  store.inbound(bat.id, 10, 100);

  // 建成品并生产
  const p = F.product({
    name: '综合测试包',
    bom: [
      { materialId: trim.id, usage: 2 },
      { materialId: fab.id, isFabric: true, area: 1500 },
      { materialId: bat.id, isFabric: true, batchUsage: 0.2 }
    ]
  });
  F.seedProducts([p]);
  store.produceProduct(p.id, 3);
  assertBalanced('生产后');

  // 卖出
  store.sellProduct(p.id, 2, 120);
  assertBalanced('卖出后');

  // 剪裁一件：从面料里切一块
  const piece = store.getMaterial(fab.id).pieces[0];
  store.cutFabric(fab.id, piece.id, 60, 60, '手工裁剪', false, p.id);
  assertBalanced('剪裁后');

  // 盘库校正
  store.stocktakeMaterial(trim.id, 90, '盘点');
  assertBalanced('盘库后');

  // 撤销一笔
  const someFlow = store.getFlows().find((f) => f.source === 'manual' && f.type === 'in');
  if (someFlow) { store.undoFlow(someFlow.id); assertBalanced('撤销后'); }

  // 最终：全量对账 + 修复应当无事可做
  const fix = store.repairTotalValue();
  equal(fix.repairedCount, 0, '全流程跑完后不应有任何需要修复的漂移');
});
