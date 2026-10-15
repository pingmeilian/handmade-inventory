// tests/demo-preset.test.js —— Day 5 真机需求：①恢复出厂预设 ②演示数据填充
// 背景：用户真机上默认手作空间被删 → 预设全没了无法恢复（清空数据曾保留 SEEDED 导致
// ensureSeed 跳过 —— 隐藏 bug，本次一并根治）；且工具重导入丢数据，需要演示数据预览。
// ⚠️ 2026-09-14（V50）：demo.js 已从 services/ 移到 tools/（开发区，不进代码包）——
//    上线前检查发现原「填充演示数据」按钮对用户可达，会灌假数据。本用例改用新路径，
//    同时证明"移出代码包后生成器仍可用"。
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const demo = require('../tools/demo.js');

group('修复 · 清空数据 = 恢复出厂（SEEDED 不再豁免）');

test('清空数据后 ensureSeed 会重新写入全部预设；OPENID 与内部快照仍保留', () => {
  stub.resetStorage();
  store.ensureSeed();
  store.getOpenid(); // 生成 OPENID
  storage.set(KEYS.BACKUP_SNAPSHOTS, [{ id: 'snap_x', data: {} }]);
  // 模拟用户改过预设
  storage.set(KEYS.UNITS, [{ id: 'u1', name: '自定义单位' }]);
  storage.set(KEYS.MATERIALS, [{ id: 'm1', name: '会没掉的物料' }]);
  store.clearAll();
  equal(storage.get(KEYS.MATERIALS, []).length, 0, '业务数据清空');
  ok(storage.get(KEYS.OPENID, '') !== '', 'OPENID 保留');
  ok(storage.get(KEYS.BACKUP_SNAPSHOTS, []).length === 1, '内部快照保留');
  store.ensureSeed();
  ok(storage.get(KEYS.UNITS, []).length >= 8, '单位预设回来了');
  ok(storage.get(KEYS.MATERIAL_CATEGORIES, []).length >= 5, '物料分类预设回来了');
  ok(storage.get(KEYS.BUSINESS_CATEGORIES, []).length >= 1, '默认手作空间回来了');
});

group('恢复出厂预设 · restoreFactoryPresets（不动业务数据）');

test('预设列表被清空时回填默认值；非空列表不覆盖', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.UNITS, []);
  storage.set(KEYS.PLATFORMS, []);
  storage.set(KEYS.MATERIAL_CATEGORIES, []);
  const r = store.restoreFactoryPresets();
  equal(storage.get(KEYS.UNITS, []).length >= 8, true);
  equal(storage.get(KEYS.PLATFORMS, []).length >= 6, true);
  equal(storage.get(KEYS.MATERIAL_CATEGORIES, []).length >= 5, true);
  ok(r.restored.indexOf('单位预设') >= 0);
});

test('默认手作空间被删后自动补回，自定义大类保留', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.BUSINESS_CATEGORIES, [{ id: 'bc_x', name: '拼豆', sort: 0, createdAt: '2026-01-01' }]);
  const r = store.restoreFactoryPresets();
  const bcs = storage.get(KEYS.BUSINESS_CATEGORIES, []);
  ok(bcs.some((x) => x.id === 'bc_default'), '默认大类补回');
  ok(bcs.some((x) => x.id === 'bc_x'), '用户自定义大类不动');
  ok(r.restored.indexOf('手作空间') >= 0);
});

test('restoreFactoryPresets 幂等：连跑两次无变化', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.UNITS, []);
  store.restoreFactoryPresets();
  const a = JSON.stringify(storage.get(KEYS.UNITS, []));
  store.restoreFactoryPresets();
  equal(JSON.stringify(storage.get(KEYS.UNITS, [])), a);
});

group('演示数据 · fillDemoData（每个部位 > 20 条）');

test('填充后：所有主要部位都超过 20 条，账目自洽', () => {
  stub.resetStorage();
  store.ensureSeed();
  const r = demo.fillDemoData();
  const gt20 = (n, label) => ok(n > 20, label + ' 应 > 20，实际 ' + n);
  gt20(store.getMaterials().length, '物料');
  gt20(store.getProducts().length, '成品');
  gt20(store.getFlows().length, '流水');
  gt20(store.getInspirations().length, '灵感');
  gt20(store.getWants().length, '心愿');
  gt20(store.getCommissions().length, '排单');
  gt20(store.getConsumables().length, '耗材');
  gt20(store.getAssets().length, '固定资产');
  gt20(store.getTools().length, '工具');
  gt20(store.getCollectedSteps().length, '收藏工序');
  gt20(store.getProducts().reduce((t, p) => t + (p.sales || []).length, 0), '销售记录');
  equal(store.reconcileTotalValue().mismatchCount, 0, '演示数据账目必须全平');
  ok(r && typeof r === 'object');
});

test('可重复填充（追加语义），账目仍平', () => {
  stub.resetStorage();
  store.ensureSeed();
  demo.fillDemoData();
  const n1 = store.getMaterials().length;
  demo.fillDemoData();
  equal(store.getMaterials().length, n1 * 2, '追加不覆盖');
  equal(store.reconcileTotalValue().mismatchCount, 0);
});

group('演示数据 · 语义正确性（2026-09-12 用户指正后加固）');

test('每个成品的 BOM：物料名非空、用量大于 0（修复 qty/usage 字段错位）', () => {
  stub.resetStorage();
  store.ensureSeed();
  demo.fillDemoData();
  const prods = store.getProducts();
  prods.forEach((p) => {
    ok((p.bom || []).length >= 3, p.name + ' 应有 3 行 BOM');
    (p.bom || []).forEach((b) => {
      ok(b.materialName, p.name + ' 的 BOM 行缺 materialName');
      const used = Number(b.usage || 0) > 0 || Number(b.batchUsage || 0) > 0;
      ok(used, p.name + ' 的 BOM 行 ' + (b.materialName || '?') + ' 用量为 0');
    });
  });
});

test('生产真实扣料：存在生产消耗流水，且物料库存被扣减', () => {
  stub.resetStorage();
  store.ensureSeed();
  demo.fillDemoData();
  const flows = store.getFlows();
  const cutFlows = flows.filter((f) => f.source === 'cut' && f.type === 'out');
  ok(cutFlows.length > 20, '生产扣料流水应 > 20 条，实际 ' + cutFlows.length);
  // 任取一个非面料物料：有出库流水说明扣减真实发生
  const outMatIds = new Set(cutFlows.map((f) => f.materialId));
  ok(outMatIds.size >= 5, '被扣料的物料种类应 ≥ 5，实际 ' + outMatIds.size);
});

test('演示物料信息完整：面料有长/幅宽，全部物料有购买渠道', () => {
  stub.resetStorage();
  store.ensureSeed();
  demo.fillDemoData();
  store.getMaterials().forEach((m) => {
    ok(m.purchaseL2, m.name + ' 缺购买渠道（编辑页会显示为空）');
  });
  const fabricPiece = store.getMaterials().filter((m) => m.materialCategoryId === 'mc_fabric' && m.stockMode !== 'batch');
  ok(fabricPiece.length > 0, '应有按片面料');
  fabricPiece.forEach((m) => {
    ok(m.fabricLength > 0, m.name + ' 缺「长」');
    ok(m.fabricWidth > 0, m.name + ' 缺「幅宽」');
  });
});
