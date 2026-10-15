// tests/valuation.test.js —— 库存总值的派生与对账（本次改造的核心）
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;
const valuation = require('../services/valuation.js');

group('valuation · 纯函数：从流水派生总值');

test('空流水 → 派生素为 0', () => {
  equal(valuation.deriveTotalValue('m1', []), 0);
});

test('入库为正、出库为负', () => {
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm1', type: 'out', totalPrice: 30 },
    { materialId: 'm2', type: 'in', totalPrice: 999 }
  ];
  near(valuation.deriveTotalValue('m1', flows), 70, 0.01);
});

test('排除其它物料与成品盘库流水', () => {
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm2', type: 'in', totalPrice: 50 },
    { materialId: 'm1', type: 'in', totalPrice: 80, priceMode: 'product' } // 成品盘库，不参与
  ];
  near(valuation.deriveTotalValue('m1', flows), 100, 0.01, '成品盘库流水应被排除');
});

test('红冲流水自动抵消（原流水 + 反向流水）', () => {
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm1', type: 'out', totalPrice: 100, source: 'reversal' }
  ];
  near(valuation.deriveTotalValue('m1', flows), 0, 0.01);
});

test('缺少 totalPrice 的流水按 0 计，不产生 NaN', () => {
  const flows = [{ materialId: 'm1', type: 'in' }];
  near(valuation.deriveTotalValue('m1', flows), 0, 0.01);
});

group('valuation · 对账');

test('数据自洽时 ok 为 true', () => {
  const m = { id: 'm1', name: '测试', totalValue: 70 };
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm1', type: 'out', totalPrice: 30 }
  ];
  const r = valuation.reconcile(m, flows);
  equal(r.ok, true);
  near(r.diff, 0, 0.001);
});

test('⚠️ 漂移时能检出，并报出差额与方向', () => {
  const m = { id: 'm1', name: '测试', totalValue: 55 };  // 应为 70，少了 15
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm1', type: 'out', totalPrice: 30 }
  ];
  const r = valuation.reconcile(m, flows);
  equal(r.ok, false, '应检出不一致');
  near(r.cached, 55, 0.01);
  near(r.derived, 70, 0.01);
  near(r.diff, -15, 0.01, 'diff = 缓存 − 派生，负数表示少记');
});

test('reconcileAll 汇总全量与不匹配项', () => {
  const mats = [
    { id: 'm1', name: '好的', totalValue: 100 },
    { id: 'm2', name: '坏的', totalValue: 1 }
  ];
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm2', type: 'in', totalPrice: 200 }
  ];
  const res = valuation.reconcileAll(mats, flows);
  equal(res.checked, 2);
  equal(res.okCount, 1);
  equal(res.mismatchCount, 1);
  equal(res.mismatches[0].materialId, 'm2');
  equal(res.sumOk, false);
});

test('reconcileAll 可按手作空间过滤', () => {
  const mats = [
    { id: 'm1', name: 'A', totalValue: 100, categoryId: 'bc_a' },
    { id: 'm2', name: 'B', totalValue: 999, categoryId: 'bc_b' }
  ];
  const flows = [{ materialId: 'm1', type: 'in', totalPrice: 100 }];
  const res = valuation.reconcileAll(mats, flows, { categoryId: 'bc_a' });
  equal(res.checked, 1, '只查 A 空间');
  equal(res.mismatchCount, 0);
});

test('applyRepairs 生成修复后的列表（纯函数，不改原数组）', () => {
  const mats = [
    { id: 'm1', name: '好的', totalValue: 100 },
    { id: 'm2', name: '坏的', totalValue: 1 }
  ];
  const flows = [
    { materialId: 'm1', type: 'in', totalPrice: 100 },
    { materialId: 'm2', type: 'in', totalPrice: 200 }
  ];
  const res = valuation.applyRepairs(mats, flows);
  equal(res.repairedCount, 1);
  near(res.materials[1].totalValue, 200, 0.01, '已修正为派生值');
  near(mats[1].totalValue, 1, 0.01, '原数组不应被修改（纯函数）');
  equal(res.repaired[0].name, '坏的');
});

group('⭐ 真实数据流：操作序列跑完后账目自洽');

test('一串入库出库后，全量对账通过', () => {
  F.reset();
  const sim = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  const fab = F.fabricMaterial({ fabricWidth: 0, unitPrice: 0, pieces: [] });
  const bat = F.batchFabricMaterial({ batchRemain: 0, batchUnitPrice: 0 });
  F.seedMaterials([sim, fab, bat]);

  store.inbound(sim.id, 20, 300);
  store.inbound(fab.id, null, { length: 100, width: 150, total: 150 });
  store.inbound(bat.id, 10, 80);
  store.outbound(sim.id, 5);
  store.outbound(bat.id, 2);

  const res = store.reconcileTotalValue();
  equal(res.mismatchCount, 0, '不应有漂移：' + JSON.stringify(res.mismatches));
  equal(res.sumOk, true);
});

test('红冲之后依然自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 3);
  store.undoFlow(store.getFlows().find((f) => f.type === 'out').id);

  const res = store.reconcileTotalValue();
  equal(res.mismatchCount, 0, JSON.stringify(res.mismatches));
});

group('⭐⭐ 演示：故意制造一次错账，看对账能否抓出来');

test('⭐ 把 totalValue 手动改错 → 对账检出 → 修复还原', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);

  // 正常业务：入 20 个花 300 元，再出 5 个（按均价 15 元 → 成本 75）
  store.inbound(m.id, 20, 300);
  store.outbound(m.id, 5);
  near(store.getMaterial(m.id).totalValue, 225, 0.01, '业务跑完应为 225');

  // ── 第一步：模拟「漏改一处」造成的漂移（历史上最隐蔽的那类 bug）──
  const list = store.getMaterials();
  list[0].totalValue = 9999;          // 手改一个明显不对的值
  store.set(store.KEYS.MATERIALS, list);

  // ── 第二步：对账应当检出 ──
  const before = store.reconcileTotalValue();
  equal(before.mismatchCount, 1, '对账应检出 1 处不一致');
  equal(before.sumOk, false, '全量口径应报不平');
  near(before.mismatches[0].cached, 9999, 0.01);
  near(before.mismatches[0].derived, 225, 0.01);
  near(before.mismatches[0].diff, 9774, 0.01, '差额可精确定位');

  // ── 第三步：一键修复 ──
  const fix = store.repairTotalValue();
  equal(fix.repairedCount, 1);
  near(fix.repaired[0].from, 9999, 0.01);
  near(fix.repaired[0].to, 225, 0.01);

  // ── 第四步：修复后应恢复自洽 ──
  const after = store.reconcileTotalValue();
  equal(after.mismatchCount, 0);
  equal(after.sumOk, true);
  near(store.getMaterial(m.id).totalValue, 225, 0.01);
});

test('⭐ 无漂移时修复不做任何改动（幂等）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);

  const fix = store.repairTotalValue();
  equal(fix.repairedCount, 0, '自洽时不应改动任何数据');
});

test('⭐ 漂移修复后，均价也随之纠正（这是漂移最伤的地方）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 300);   // 均价应为 15

  const list = store.getMaterials();
  list[0].totalValue = 400;        // 漂移 → 均价会算成 20
  store.set(store.KEYS.MATERIALS, list);
  near(store.unitCost(store.getMaterial(m.id)), 20, 1e-6, '漂移后均价确实错了');

  store.repairTotalValue();
  near(store.unitCost(store.getMaterial(m.id)), 15, 1e-6, '修复后均价回到正确值');
});
