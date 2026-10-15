// tests/bom-batch-produce.test.js —— 刀口布（按批估量）在「生产 / 交付 / 退产 / 撤销」链路上的物料口径
//
// 与 bom-batch.test.js 同一个根因（手写 `b.isFabric` 漏掉 stockMode==='batch'），
// 但受害点是「库存账」而不是「编辑页校验」，单独成文件便于定位回归：
//   ⑤ 生产扣料：应按每件用量扣 batchRemain，且不给刀口布写裁剪红区（脏数据源头）
//   ⑥ 交付扣料（assignCommission）：应按每件用量扣，且不足时要拦住
//   ⑦ 退产 / 撤销交付：应按每件用量加回，不能凭空生成假余料片
//   ⑧ 清单页与 CSV 导出：不得把刀口布当面积

const stub = require('./wx-stub.js');
const { test, group, ok, equal, near } = require('./harness.js');
const store = require('../utils/store.js');
const calc = require('../utils/calc.js');
const util = require('../utils/util.js');

// ---------- 造数：一个刀口布（每件 0.05kg，共 2kg） + 一个拉链 ----------
// ⚠️ 刀口布必须走真实入库（inbound）建立库存流水：totalValue 是由流水派生的
//    （store.addFlow → syncTotalValueFromFlows 是唯一收口点），直接写 totalValue 字段
//    会在下一次流水落盘时被流水重算覆盖成负数。
function seed() {
  stub.resetStorage();
  store.ensureSeed();
  const bat = store.saveMaterial({
    name: '碎花刀口布', keywords: '刀口布', materialCategoryId: 'mc_fabric',
    attrs: { 花纹: '碎花' }, unit: '米',
    stockMode: 'batch', batchUnit: 'kg', batchTotal: 0
  });
  store.inbound(bat.id, 2, 25, '初始入库');   // 2kg / 25 元 → 12.5 元/kg
  const zip = store.saveMaterial({
    name: '黑色隐形拉链', keywords: '拉链', materialCategoryId: 'mc_zipper', unit: '个', price: 0.5, threshold: 10
  });
  store.inbound(zip.id, 100, 50, '初始入库');
  return { bat: store.getMaterial(bat.id), zip: store.getMaterial(zip.id) };
}

function makeProduct(bom) {
  return store.saveProduct({
    name: '测试成品 蝴蝶结发夹',
    productCategoryId: 'pc_other',
    nature: 'merchandise',
    bom: bom,
    includeLabor: false, laborMode: 'perPiece', laborFeePerPiece: 0,
    hourlyRate: 0, laborHours: 0, packaging: 0, shipping: 0, targetProfit: 0
  });
}

function batchLine(m, extra) {
  return Object.assign({
    materialId: m.id, materialName: m.name, isFabric: true, stockMode: 'batch', batchUsage: 0.05
  }, extra || {});
}

// ---------- ⑤ 生产扣料 ----------
group('刀口布 · 生产扣料（batchRemain，不走面积）');

// 说明：保存成品时系统会按「一份用量」预扣物料（既有设计，三种物料口径一致）。
// 因此生产/交付类断言都以「保存后」的余量为基线做相对比较，避免把预扣算成扣料偏差。
function batchRemainAfterSave(m) { return store.getMaterial(m.id).batchRemain; }

test('★ 生产 4 件：按 4×0.05=0.2 扣 batchRemain', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat)]);
  const base = batchRemainAfterSave(m.bat);

  store.produceProduct(p.id, 4);

  const after = store.getMaterial(m.bat.id);
  near(after.batchRemain, util.round(base - 0.2, 2), 0.001, '应按每件用量扣减，实际 ' + after.batchRemain + '（基线 ' + base + '）');
  near(after.totalValue, util.round(after.batchRemain * 12.5, 2), 0.01, '库存金额应同步回算');
});

test('★ 生产不给刀口布写裁剪红区（脏数据回灌的源头）', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat)]);

  store.produceProduct(p.id, 2);

  const rec = store.getProduct(p.id);
  ok(!(rec.fabricRects || {})[m.bat.id], '刀口布不该出现在 fabricRects，实际：' + JSON.stringify(rec.fabricRects || {}));
});

test('★ 旧脏数据：刀口布行残留长宽 → 生产仍不写裁剪红区', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat, { length: 50, width: 50 })]);

  store.produceProduct(p.id, 2);

  const rec = store.getProduct(p.id);
  ok(!(rec.fabricRects || {})[m.bat.id], '残留长宽也不该生成红区，实际：' + JSON.stringify(rec.fabricRects || {}));
});

test('刀口布库存不足 → 生产前拦住并报缺量', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat, { batchUsage: 1 })]);   // 每件 1kg，库存 2kg

  let err = null;
  try { store.produceProduct(p.id, 5); } catch (e) { err = e; }
  ok(err, '库存不足应抛错');
  ok(JSON.stringify(err).indexOf('刀口布') >= 0, '缺量提示应点名刀口布，实际：' + JSON.stringify(err));
});

// ---------- ⑥ 交付扣料 ----------
group('刀口布 · 交付扣料（assignCommission）');

test('★ 交付 4 件：按 4×0.05=0.2 扣 batchRemain', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat)]);
  const c = store.saveCommission({ productId: p.id, qty: 4, customer: '测试客户', dueDate: util.today() });
  const base = batchRemainAfterSave(m.bat);

  store.assignCommission(c.id, 4);

  const after = store.getMaterial(m.bat.id);
  near(after.batchRemain, util.round(base - 0.2, 2), 0.001, '交付应按每件用量扣减，实际 ' + after.batchRemain + '（基线 ' + base + '）');
});

test('刀口布库存不足 → 交付前拦住', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat, { batchUsage: 1 })]);   // 每件 1kg
  const c = store.saveCommission({ productId: p.id, qty: 5, customer: '测试客户', dueDate: util.today() });

  let err = null;
  try { store.assignCommission(c.id, 5); } catch (e) { err = e; }
  ok(err, '库存不足应抛错');
  ok(JSON.stringify(err).indexOf('刀口布') >= 0, '缺量提示应点名刀口布，实际：' + JSON.stringify(err));
});

// ---------- ⑦ 退产 / 撤销交付 ----------
group('刀口布 · 退产与撤销交付返还');

test('★ 退产：按每件用量加回 batchRemain，不生成假余料片', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat)]);
  const base = batchRemainAfterSave(m.bat);
  store.produceProduct(p.id, 4);
  near(store.getMaterial(m.bat.id).batchRemain, util.round(base - 0.2, 2), 0.001, '生产后应为基线-0.2');
  const piecesBefore = (store.getMaterial(m.bat.id).pieces || []).length;

  store.undoProduce(p.id, 0);

  const back = store.getMaterial(m.bat.id);
  near(back.batchRemain, base, 0.001, '退产应把每件用量加回，实际 ' + back.batchRemain);
  equal((back.pieces || []).length, piecesBefore, '刀口布不该凭空多出余料片');
});

test('★ 撤销交付：按每件用量加回 batchRemain，不生成假余料片', () => {
  const m = seed();
  const p = makeProduct([batchLine(m.bat)]);
  const c = store.saveCommission({ productId: p.id, qty: 4, customer: '测试客户', dueDate: util.today() });
  const base = batchRemainAfterSave(m.bat);
  store.assignCommission(c.id, 4);
  near(store.getMaterial(m.bat.id).batchRemain, util.round(base - 0.2, 2), 0.001, '交付后应为基线-0.2');
  const piecesBefore = (store.getMaterial(m.bat.id).pieces || []).length;

  store.undoDeliver(c.id, 0);

  const back = store.getMaterial(m.bat.id);
  near(back.batchRemain, base, 0.001, '撤销交付应把每件用量加回，实际 ' + back.batchRemain);
  equal((back.pieces || []).length, piecesBefore, '刀口布不该凭空多出余料片');
});

// ---------- ⑧ 清单页判定 + CSV 导出 ----------
group('刀口布 · 清单页判定与 CSV 导出');

test('清单页/生产页共用判定：刀口布残留长宽也不进裁剪任务', () => {
  const m = seed();
  const p = makeProduct([
    { materialId: m.zip.id, materialName: m.zip.name, usage: 2 },
    batchLine(m.bat, { length: 50, width: 50 })
  ]);

  const queue = calc.cutQueueFor(store.getProduct(p.id).bom, 1);

  equal(queue.filter(t => t.materialId === m.bat.id).length, 0, '刀口布不该进裁剪队列');
  equal(queue.filter(t => t.materialId === m.zip.id).length, 0, '非面料不该进裁剪队列');
});

test('CSV 导出：刀口布显示每件用量，不出现 0cm²', () => {
  const m = seed();
  makeProduct([batchLine(m.bat, { batchUnit: 'kg' })]);

  const csv = require('../utils/csv.js');
  const text = csv.exportProducts();

  ok(text.indexOf('0cm²') < 0, '不该出现 0cm² 的面积写法');
  ok(text.indexOf(m.bat.name) >= 0, '应包含刀口布名称');
  ok(text.indexOf('每件') >= 0, '应显示每件用量，实际导出片段：' + text.slice(0, 400));
});
