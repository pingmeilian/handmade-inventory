// tests/bom-batch.test.js —— 刀口布（按批估量）不参与裁剪 / 面积口径
//
// 真机反馈（2026-09-12）：成品编辑页保存时，BOM 里含刀口布会错误弹出「请先完成裁剪」，
// 直接阻止保存。刀口布按「每件用量(kg/片)」扣料，根本不需要裁剪。
//
// 根因：各处判断直接写 `b.isFabric`，漏了 `stockMode === 'batch'`。同一个根因有 4 个受害点：
//   ① 成品编辑保存校验（用户报的）
//   ② 生产时误生成裁剪任务 → 强制弹出剪裁选择器（更烦人）
//   ③ 保存时给刀口布写下长宽 / 面积 / fabricRects 红区（脏数据回灌 → 下次编辑又被拦）
//   ④ 成品详情 / 教程卡把刀口布规格显示成「面积」
//
// 修法：把「是否需要裁剪」收口成 calc 的单一判定，所有调用点统一走它（防第 5 次再踩）。

const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const calc = require('../utils/calc.js');

function toastTitles() { return stub.toasts.map((t) => String(t.title || '')); }
function hasToast(text) { return toastTitles().some((t) => t.indexOf(text) >= 0); }
function modalTitles() { return stub.modals.map((m) => String(m.title || '')); }
function navUrls() { return stub.toasts.filter((t) => t.nav).map((t) => t.url || t.nav); }

// ---------- 造数：一个刀口布 + 一个按片面料 + 一个非面料 ----------
function seedMaterials() {
  stub.resetStorage();
  store.ensureSeed();
  const bat = store.saveMaterial({
    name: '碎花刀口布', keywords: '刀口布', materialCategoryId: 'mc_fabric',
    attrs: { 花纹: '碎花' }, unit: '米',
    stockMode: 'batch', batchUnit: 'kg',
    batchTotal: 2, batchRemain: 2, batchUnitPrice: 12.5, totalValue: 25
  });
  const piece = store.saveMaterial({
    name: '米白纯棉平布', keywords: '平布', materialCategoryId: 'mc_fabric',
    attrs: { 颜色: '米白', 材质: '纯棉' }, unit: '米'
  });
  store.inbound(piece.id, 0, { length: 200, width: 150, total: 25 }, '初始入库'); // 3 m²
  const zip = store.saveMaterial({
    name: '黑色隐形拉链', keywords: '拉链', materialCategoryId: 'mc_zipper', unit: '个', price: 0.5, threshold: 10
  });
  store.inbound(zip.id, 100, 50, '初始入库');
  return {
    batch: store.getMaterial(bat.id),
    piece: store.getMaterial(piece.id),
    zip: store.getMaterial(zip.id)
  };
}

function makeProduct(bom, extra) {
  return store.saveProduct(Object.assign({
    name: '测试成品 蝴蝶结发夹',
    productCategoryId: 'pc_other',
    nature: 'merchandise',
    bom: bom,
    includeLabor: false, laborMode: 'perPiece', laborFeePerPiece: 0,
    hourlyRate: 0, laborHours: 0, packaging: 0, shipping: 0, targetProfit: 0
  }, extra || {}));
}

// ---------- 判定口径（单元级） ----------
group('刀口布 · 判定口径（calc 单一判定）');

test('bomLineNeedsCut：按片面料要裁剪；刀口布与非面料都不要', () => {
  const m = seedMaterials();
  const pieceRow = { materialId: m.piece.id, isFabric: true, stockMode: 'piece', length: '50', width: '50' };
  const batchRow = { materialId: m.batch.id, isFabric: true, stockMode: 'batch', batchUsage: 0.05 };
  const zipRow = { materialId: m.zip.id, isFabric: false, usage: 2 };
  equal(calc.bomLineNeedsCut(pieceRow), true, '按片面料需要裁剪');
  equal(calc.bomLineNeedsCut(batchRow), false, '★ 刀口布不需要裁剪（本次 bug 根因）');
  equal(calc.bomLineNeedsCut(zipRow), false, '非面料不需要裁剪');
});

test('兼容旧数据：行上没有 stockMode 时，回落到物料当前值判断', () => {
  const m = seedMaterials();
  const legacyBatch = { materialId: m.batch.id, isFabric: true, length: '50', width: '50' }; // 无 stockMode
  const legacyPiece = { materialId: m.piece.id, isFabric: true, length: '50', width: '50' };
  equal(calc.bomLineNeedsCut(legacyBatch, m.batch), false, '物料是刀口布 → 不需要裁剪');
  equal(calc.bomLineNeedsCut(legacyPiece, m.piece), true, '物料是按片面料 → 需要裁剪');
});

test('pendingCutLines：刀口布带残留长宽也不进「未完成裁剪」列表', () => {
  const m = seedMaterials();
  const bom = [
    { materialId: m.batch.id, materialName: '碎花刀口布', isFabric: true, stockMode: 'batch', batchUsage: 0.05, length: '50', width: '50' },
    { materialId: m.piece.id, materialName: '米白纯棉平布', isFabric: true, stockMode: 'piece', length: '30', width: '40', lenUnit: 'cm', widUnit: 'cm' }
  ];
  const unCut = calc.pendingCutLines(bom, {});
  equal(unCut.length, 1, '只有按片面料待裁剪，实际：' + JSON.stringify(unCut));
  equal(unCut[0], '米白纯棉平布');
});

test('cutQueueFor：刀口布不生成裁剪队列；按片面料「每件一条」', () => {
  const m = seedMaterials();
  const bom = [
    { materialId: m.batch.id, materialName: '碎花刀口布', isFabric: true, stockMode: 'batch', batchUsage: 0.05, length: 50, width: 50 },
    { materialId: m.piece.id, materialName: '米白纯棉平布', isFabric: true, stockMode: 'piece', length: 30, width: 40 }
  ];
  const queue = calc.cutQueueFor(bom, 2);
  equal(queue.length, 2, '只有按片面料要排裁剪；做 2 件 → 2 条（逐件确认），实际：' + JSON.stringify(queue));
  queue.forEach((t) => equal(t.materialName, '米白纯棉平布'));
  equal(queue[0].pieceNo, 1, '第 1 件');
  equal(queue[1].pieceNo, 2, '第 2 件');
});

// ---------- ① 成品编辑保存（用户报的 bug） ----------
group('刀口布 · 成品编辑保存不再被裁剪校验拦住');

test('★ BOM 含刀口布（带残留长宽）→ 保存成功，不弹「请先完成裁剪」', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.zip.id, materialName: m.zip.name, usage: 2 },
    { materialId: m.batch.id, materialName: m.batch.name, isFabric: true, batchUsage: 0.05 }
  ]);
  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ id: p.id });
  // 模拟「刀口布行上残留了长宽」（换物料/旧数据回灌都会造成这种脏数据）
  page.setData({ bom: page.data.bom.map(b => Object.assign({}, b, { length: '50', width: '50' })) });
  page.save();

  equal(modalTitles().indexOf('请先完成裁剪') >= 0, false, '不得再弹裁剪要求（本次 bug 的现象）');
  ok(hasToast('已保存'), '应保存成功，实际提示：' + toastTitles().join(' / '));
});

test('保存后：刀口布行的长宽/面积归零、batchUsage 保留、不写 fabricRects', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.batch.id, materialName: m.batch.name, isFabric: true, batchUsage: 0.05 }
  ]);
  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ id: p.id });
  page.setData({ bom: page.data.bom.map(b => Object.assign({}, b, { length: '50', width: '50' })) });
  page.save();

  const after = store.getProduct(p.id);
  const line = (after.bom || []).find(b => b.materialId === m.batch.id);
  equal(line.length, 0, '刀口布不该存长');
  equal(line.width, 0, '刀口布不该存宽');
  equal(line.area, 0, '刀口布不计面积');
  equal(line.batchUsage, 0.05, '每件用量必须保留');
  equal(line.stockMode, 'batch');
  ok(!(after.fabricRects || {})[m.batch.id], '刀口布不该产生裁剪红区');
});

test('旧脏数据：已保存的刀口布行带长宽 → 打开编辑页后长宽为空（清理）', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.batch.id, materialName: m.batch.name, isFabric: true, batchUsage: 0.05 }
  ]);
  // 手工灌入脏数据，模拟历史版本落库的长宽
  const list = store.getProducts();
  const i = list.findIndex(x => x.id === p.id);
  list[i].bom[0].length = 50;
  list[i].bom[0].width = 50;
  store.set(store.KEYS.PRODUCTS, list);

  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ id: p.id });
  const row = page.data.bom.find(b => b.materialId === m.batch.id);
  equal(row.length, '', '刀口布的「长」应被清空');
  equal(row.width, '', '刀口布的「宽」应被清空');
  equal(String(row.batchUsage), '0.05', '每件用量照常回填');
});

test('回归保护：按片面料改了尺寸未裁剪 → 仍然弹「请先完成裁剪」', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.piece.id, materialName: m.piece.name, isFabric: true, length: 100, width: 100, area: 10000, stockMode: 'piece' }
  ]);
  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ id: p.id });
  // 把尺寸改成与已保存红区不同 → 需要重新裁剪
  page.setData({ bom: page.data.bom.map(b => Object.assign({}, b, { length: '30', width: '40' })) });
  page.save();

  ok(modalTitles().indexOf('请先完成裁剪') >= 0, '按片面料改尺寸后必须仍要求裁剪');
  equal(hasToast('已保存'), false, '未完成裁剪不得保存');
});

// ---------- ② 生产不再对刀口布强制裁剪 ----------
group('刀口布 · 生产时不再强制裁剪');

test('★ 含刀口布的成品生产 → 直接生产，不跳剪裁选择器', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.zip.id, materialName: m.zip.name, usage: 2 },
    { materialId: m.batch.id, materialName: m.batch.name, isFabric: true, batchUsage: 0.05 }
  ]);
  const page = loadPage('../pages/products/instances.js');
  page.onLoad({ id: p.id });
  page.setData({ qtyValue: '2', qtyMode: 'produce' });
  page.confirmQty();

  equal(navUrls().some((u) => String(u).indexOf('cut-editor') >= 0), false, '不该跳裁剪页（本次根因的第二受害点）');
  ok(hasToast('已增加 2 件库存'), '应直接生产成功，实际提示：' + toastTitles().join(' / '));
});

test('回归保护：含按片面料且填了长宽的成品 → 仍然跳裁剪排版页', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.piece.id, materialName: m.piece.name, isFabric: true, length: 30, width: 40, area: 1200, stockMode: 'piece' }
  ]);
  const page = loadPage('../pages/products/instances.js');
  page.onLoad({ id: p.id });
  page.setData({ qtyValue: '2', qtyMode: 'produce' });
  page.confirmQty();

  // 2026-09-30 V89：入口从旧的方案选择器换成裁剪排版页的「逐件模式」
  ok(navUrls().some((u) => String(u).indexOf('cut-editor') >= 0), '按片面料必须先去排裁剪');
});

// ---------- ④ 展示口径 ----------
group('刀口布 · 成品详情展示口径');

test('成品详情：刀口布行显示「每件用量」而不是面积', () => {
  const m = seedMaterials();
  const p = makeProduct([
    { materialId: m.batch.id, materialName: m.batch.name, isFabric: true, batchUsage: 0.05 }
  ]);
  const page = loadPage('../pages/products/detail.js');
  page.onLoad({ id: p.id });
  const line = (page.data.bomLines || []).find((b) => b.name === m.batch.name);
  ok(line, '应有一行刀口布');
  ok(line.spec.indexOf('每件用量') >= 0, '应显示每件用量，实际：' + line.spec);
  ok(line.spec.indexOf('m²') < 0, '不该显示面积，实际：' + line.spec);
});
