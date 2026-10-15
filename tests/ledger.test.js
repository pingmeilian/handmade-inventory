// tests/ledger.test.js —— 库存流水与库存总值 特征测试
// ⭐ 本文件最关键的一条：库存总值 ≡ 流水带符号求和（流水化改造的数学基准）
const { test, group, ok, equal, near, throws } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;

// 流水带符号求和：入库为正、出库为负。
// 排除 priceMode === 'product' 的成品盘库流水 —— 那类流水不参与物料库存总值。
function signedFlowSum() {
  return util.round(
    store.getFlows()
      .filter((f) => f.priceMode !== 'product')
      .reduce((s, f) => s + (f.type === 'in' ? 1 : -1) * (Number(f.totalPrice) || 0), 0),
    2
  );
}
function materialTotalValueSum() {
  return util.round(store.getMaterials().reduce((s, m) => s + (Number(m.totalValue) || 0), 0), 2);
}

group('流水 · 入库');

test('非面料首次入库：数量与总值同时建立', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);

  store.inbound(m.id, 10, 100);
  const db = store.getMaterial(m.id);
  near(db.quantity, 10, 0.01);
  near(db.totalValue, 100, 0.01);
  near(store.unitCost(db), 10, 1e-6, '均价 = 100 / 10');
});

test('非面料二次入库采用移动加权平均', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);

  store.inbound(m.id, 10, 100);   // 均价 10
  store.inbound(m.id, 10, 200);   // 再入 10 个共 200 元 → 均价 15
  const db = store.getMaterial(m.id);
  near(db.quantity, 20, 0.01);
  near(db.totalValue, 300, 0.01);
  near(store.unitCost(db), 15, 1e-6);
});

test('非面料入库不填总价时，按当前均价计价', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);        // 均价 10
  store.inbound(m.id, 5);              // 不填总价
  const db = store.getMaterial(m.id);
  near(db.quantity, 15, 0.01);
  near(db.totalValue, 150, 0.01, '按均价 10 补 50 元');
  near(store.unitCost(db), 10, 1e-6, '均价保持不变');
});

test('⚠️ 首次入库不填总价 → 总值为 0、均价为 0（已知边界行为）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10);             // 没有历史均价可参照
  const db = store.getMaterial(m.id);
  near(db.quantity, 10, 0.01);
  near(db.totalValue, 0, 0.01, '无参照价，总值记 0');
  near(store.unitCost(db), 0, 1e-6, '均价为 0，后续成本计算会失真');
});

test('面料按片入库：新增布片、面积与总值同步', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 0, unitPrice: 0, pieces: [] });
  F.seedMaterials([m]);

  store.inbound(m.id, null, { length: 100, width: 150, total: 150 });
  const db = store.getMaterial(m.id);
  equal(db.pieces.length, 1);
  near(store.fabricArea(db), 15000, 0.01, '面积 = 100 × 150');
  near(db.totalValue, 150, 0.01);
  near(store.unitCost(db), 0.01, 1e-6, '元/cm²');
  equal(db.fabricWidth, 150, '幅宽取录入的宽');
  equal(db.pieces[0].isOffcut, false, '整幅宽 → 整布');
  near(db.price, 100, 1e-4, 'price 存储口径为 元/㎡');
});

test('面料按批入库：以 batchRemain 计量并算加权单价', () => {
  F.reset();
  const m = F.batchFabricMaterial({ batchRemain: 0, batchUnitPrice: 0 });
  F.seedMaterials([m]);

  store.inbound(m.id, 10, 100);
  const db = store.getMaterial(m.id);
  near(db.batchRemain, 10, 0.01);
  near(db.totalValue, 100, 0.01);
  near(store.unitCost(db), 10, 1e-6);
});

test('面料入库缺少长宽时抛错', () => {
  F.reset();
  const m = F.fabricMaterial({ unitPrice: 0, pieces: [] });
  F.seedMaterials([m]);
  throws(() => store.inbound(m.id, null, { length: 0, width: 150, total: 10 }), '缺长应抛错');
});

test('入库数量非正数时抛错', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  throws(() => store.inbound(m.id, 0, 10));
  throws(() => store.inbound(m.id, -5, 10));
});

test('物料不存在时抛错', () => {
  F.reset();
  throws(() => store.inbound('m_ghost', 1, 10));
});

group('流水 · 出库');

test('非面料出库：按均价扣减，均价不变', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 4);

  const db = store.getMaterial(m.id);
  near(db.quantity, 6, 0.01);
  near(db.totalValue, 60, 0.01);
  near(store.unitCost(db), 10, 1e-6, '出库不改变均价');
});

test('出库超过库存时抛错并保持数据不变', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 5, 50);
  throws(() => store.outbound(m.id, 6));
  const db = store.getMaterial(m.id);
  near(db.quantity, 5, 0.01, '失败后库存不应变动');
  near(db.totalValue, 50, 0.01);
});

test('按批面料出库：扣减 batchRemain 与总值', () => {
  F.reset();
  const m = F.batchFabricMaterial({ batchRemain: 0, batchUnitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 4);
  const db = store.getMaterial(m.id);
  near(db.batchRemain, 6, 0.01);
  near(db.totalValue, 60, 0.01);
  near(store.unitCost(db), 10, 1e-6);
});

group('流水 · 撤销');

test('inbound / outbound 返回物料本体，不是流水（页面的用法依赖）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);

  const fromInbound = store.inbound(m.id, 10, 100);
  equal(fromInbound.id, m.id, '入库返回物料 id');
  equal(fromInbound.totalValue, 100, '返回的是更新后的物料');

  const fromOutbound = store.outbound(m.id, 2);
  equal(fromOutbound.id, m.id, '出库同样返回物料');
  // 页面要撤销时，是从已加载的流水列表里取 id，而不是从写函数的返回值取
  equal(store.getFlows().length, 2, '流水需另行查询获取');
});

test('撤销入库流水：数量与总值回滚，并留下冲销痕迹', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  equal(store.getFlows().length, 1);

  const originalId = store.getFlows()[0].id;
  store.undoFlow(originalId);

  const db = store.getMaterial(m.id);
  near(db.quantity, 0, 0.01, '数量回滚');
  near(db.totalValue, 0, 0.01, '总值回滚');

  const flows = store.getFlows();
  equal(flows.length, 2, '原流水保留 + 追加一条红冲');
  const original = flows.find((f) => f.id === originalId);
  const reversal = flows.find((f) => f.source === 'reversal');

  equal(original.undone, true, '原流水被标记为已冲销');
  ok(typeof original.undoneAt === 'number', '原流水带冲销时间戳');
  equal(reversal.type, 'out', '入库的红冲方向为出库');
  equal(reversal.reversesFlowId, originalId, '红冲指向被冲销的流水');
  near(reversal.totalPrice, 100, 0.01, '红冲金额与原流水一致');
  ok(String(reversal.remark).indexOf('冲销') === 0, '红冲备注可辨识');
});

test('撤销出库流水：库存与总值加回（同样走红冲）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 4);
  const outFlow = store.getFlows().find((x) => x.type === 'out');
  store.undoFlow(outFlow.id);

  const db = store.getMaterial(m.id);
  near(db.quantity, 10, 0.01);
  near(db.totalValue, 100, 0.01);

  const reversal = store.getFlows().find((f) => f.source === 'reversal');
  equal(reversal.type, 'in', '出库的红冲方向为入库');
});

test('⚠️ 防重复：同一笔流水不能被撤销两次', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  const flowId = store.getFlows()[0].id;

  store.undoFlow(flowId);
  // 第二次必须被拦住，否则库存会被重复回滚成负数
  throws(() => store.undoFlow(flowId), '重复冲销应被拒绝');

  const db = store.getMaterial(m.id);
  near(db.quantity, 0, 0.01, '库存不应被二次回滚');
  near(db.totalValue, 0, 0.01);
  equal(store.getFlows().length, 2, '不产生第三条流水');
});

test('⚠️ 防链式：红冲记录本身不能再被撤销', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  const originalId = store.getFlows()[0].id;
  const reversal = store.undoFlow(originalId);

  throws(() => store.undoFlow(reversal.id), '冲销记录不可再撤销');
  equal(store.getFlows().length, 2);
});

test('撤销不存在的流水时抛错', () => {
  F.reset();
  throws(() => store.undoFlow('f_ghost'));
});

group('⭐ 库存总值与流水自洽（流水化改造的数学基准）');

test('单次入库后：总值 ≡ 流水带符号求和', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  near(materialTotalValueSum(), signedFlowSum(), 0.02);
});

test('连续入库出库后仍自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.inbound(m.id, 10, 200);
  store.outbound(m.id, 5);
  store.outbound(m.id, 3);
  near(materialTotalValueSum(), signedFlowSum(), 0.02);
});

test('多种物料（面料 + 非面料）混合操作后仍自洽', () => {
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

  near(materialTotalValueSum(), signedFlowSum(), 0.02);
});

test('红冲后依然自洽（原流水保留，红冲流水反向抵消）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.inbound(m.id, 5, 75);
  store.outbound(m.id, 3);

  // 冲销最后一笔入库（金额 75）
  const target = store.getFlows().filter((f) => f.type === 'in' && f.totalPrice === 75)[0];
  store.undoFlow(target.id);

  near(materialTotalValueSum(), signedFlowSum(), 0.02);
  equal(store.getFlows().length, 4, '3 条原始 + 1 条红冲，全部留痕');
});

test('多次红冲后仍自洽', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.inbound(m.id, 10, 200);
  store.outbound(m.id, 5);
  store.outbound(m.id, 2);

  const outs = store.getFlows().filter((f) => f.type === 'out' && f.source !== 'reversal');
  equal(outs.length, 2, '应有 2 条出库流水');
  outs.forEach((f) => store.undoFlow(f.id));

  near(materialTotalValueSum(), signedFlowSum(), 0.02);
  equal(store.getFlows().length, 6, '4 条原始 + 2 条红冲，全部留痕');
  near(store.getMaterial(m.id).totalValue, 300, 0.01, '两次出库全部冲回后总值为 300');
});

test('每条流水都带时间戳（用户要求「所有波动都要有时间戳」）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 2);

  const flows = store.getFlows();
  equal(flows.length, 2);
  flows.forEach((f) => {
    ok(typeof f.createdAt === 'number' && f.createdAt > 0, '缺少 createdAt 时间戳: ' + f.id);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(f.date), 'date 格式应为 YYYY-MM-DD: ' + f.date);
    ok(typeof f.totalPrice === 'number', '缺少 totalPrice: ' + f.id);
  });
});
