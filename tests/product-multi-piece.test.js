// tests/product-multi-piece.test.js —— 「一个物料用两块布」全线贯通（V122）
//
// 用户 2026-10-06 报（三连）：一个物料裁两片布 →
//   ① 回到成品编辑界面，物料清单里还是只有一片布的长宽；
//   ② 保存成品后打开该成品，也只有一片布；
//   ③ 增加成品数量，只扣一片布。
//
// 只读定位的四个断点（同一根因：下游只认"一个物料 = 一组长宽 = 一片"）：
//   A 存    ：BOM 行的 length/width/area 只记**主片**
//   B 显示  ：界面只画一组长宽，不展开 chosenSchemes
//   C 回填  ：从成品读回 BOM 的字段是**白名单**，chosenSchemes 不在其中 ⇒ 一保存就丢
//   D 扣料  ：saveProduct 按"每物料一个矩形"扣一刀；生产时队列与 consumeBom 也都只认一片
//
// 本版把"多片"做成正式口径：area = 各片之和；方案随成品存；保存/生产**逐片扣**；
// 队列按片数展开；规格文案说得出片数。老数据（只有一组长宽）继续兼容。
const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const calc = require('../utils/calc.js');
const util = require('../utils/util.js');

const EDIT = '../pages/products/edit.js';

// 一个物料 + 两块布片（170×140 / 120×140）——与用户截图同形
function seed() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({ name: '米白雪纺波点布', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 170, width: 140, total: 10 }, '入库A');
  store.inbound(m.id, 0, { length: 120, width: 140, total: 10 }, '入库B');
  const fab = store.getMaterial(m.id);
  return { m: fab, p1: fab.pieces[0], p2: fab.pieces[1] };
}

function bomRow(m) {
  return {
    materialId: m.id, materialName: m.name, isFabric: true, stockMode: 'piece',
    unit: '米', priceSnapshot: 0, usage: 0, batchUsage: 0, length: 0, width: 0
  };
}

// 两片方案：布1 裁 40×30、布2 裁 25×30（用户截图里的那两刀）
function schemes(s) {
  return [
    { materialId: s.m.id, length: 40, width: 30, pieceId: s.p1.id, rotate: false, at: { x: 5, y: 5 } },
    { materialId: s.m.id, length: 25, width: 30, pieceId: s.p2.id, rotate: false, at: { x: 5, y: 5 } }
  ];
}

function makeProduct(bom, extra) {
  return store.saveProduct(Object.assign({
    name: '测试成品 双片裁剪', productCategoryId: 'pc_other', nature: 'merchandise',
    bom: bom, includeLabor: false, laborMode: 'perPiece', laborFeePerPiece: 0,
    hourlyRate: 0, laborHours: 0, packaging: 0, shipping: 0, targetProfit: 0
  }, extra || {}));
}

// 把两片方案写成"已保存的成品"（模拟用户保存后的状态）
function savedProduct(s) {
  const rows = schemes(s).map(x => ({
    materialId: x.materialId, length: x.length, width: x.width,
    pieceId: x.pieceId, rotate: x.rotate, at: x.at
  }));
  return makeProduct([Object.assign(bomRow(s.m), {
    length: 40, width: 30, chosenSchemes: rows
  })]);
}

function areaOf(s) { return util.round(store.fabricArea(store.getMaterial(s.m.id)), 2); }

group('V122 · 一个物料两块布（全线按片）');

test('① 排两片后：面积 = **两片之和**，长宽仍是主片，方案落在行上', () => {
  const s = seed();
  const p = makeProduct([bomRow(s.m)]);
  const page = loadPage(EDIT);
  page.onLoad({ id: p.id });
  page.setData({ matAll: [{ id: s.m.id, name: s.m.name, isFabric: true, stockMode: 'piece', unit: '米', price: 0 }] });
  page.applyMatToBom(s.m.id, schemes(s), 0);

  const row = page.data.bom[0];
  equal(row.length, 40, '主片长照旧落在 length（列表那栏显示的仍是主片）');
  equal(row.width, 30, '主片宽照旧落在 width');
  equal(row.chosenSchemes.length, 2, '两片方案要整组落在这行上');

  page.save();
  const line = (store.getProduct(p.id).bom || []).find(b => b.materialId === s.m.id);
  equal(line.area, 1950, '★ 面积必须是两片之和（40×30 + 25×30 = 1950cm²），不是只有主片 1200');
  equal(line.chosenSchemes.length, 2, '★ 方案要跟着成品存下来（跨会话不能丢）');
  equal(line.chosenSchemes[1].length, 25, '第二片的尺寸也在');
});

test('② 保存成品：**两块布各扣一次**（不能只扣主片那块）', () => {
  const s = seed();
  const before = areaOf(s);
  const p = makeProduct([Object.assign(bomRow(s.m), {
    length: 40, width: 30,
    chosenSchemes: schemes(s).map(x => ({
      materialId: x.materialId, length: x.length, width: x.width,
      pieceId: x.pieceId, rotate: x.rotate, at: x.at
    }))
  })]);
  const page = loadPage(EDIT);
  page.onLoad({ id: p.id });
  page.save();

  const after = areaOf(s);
  equal(util.round(before - after, 2), 1950,
    '★ 总库存应减 1950cm²（两片都扣：40×30 + 25×30）；只扣主片的话是 1200');
});

test('③ 打开成品再编辑：两片方案还在（跨会话不丢）', () => {
  const s = seed();
  // 说明：造"已保存的成品"时 BOM 行没面积 ⇒ saveProduct 不扣料（扣料由 ② 与 ④ 专门验），
  //   本例只验"方案能不能从成品读回来"。
  const p = savedProduct(s);

  const page = loadPage(EDIT);
  page.onLoad({ id: p.id });
  const row = page.data.bom.find(b => b.materialId === s.m.id);
  ok(row, '前置：BOM 行要回填出来');
  ok(Array.isArray(row.chosenSchemes) && row.chosenSchemes.length === 2,
    '★ 回填必须保留两片方案 —— 上一版（V120）只治好了同一次会话内，跨保存仍丢');
  equal(row.length, '40', '主片长照旧回填（用作显示）');
});

test('④ 增加数量（不选片）：也要按**已存方案**逐片扣（一件 = 两片）', () => {
  const s = seed();
  const p = savedProduct(s);
  const before = areaOf(s);
  store.produceProduct(p.id, 1);
  const after = areaOf(s);
  equal(util.round(before - after, 2), 1950,
    '★ 一件成品用两块布 ⇒ 两片都要扣（40×30 + 25×30）；原来只扣主片 1200');
});

test('⑤ 增加 2 件：两片各扣两次（每件一套刀，不是只扣一刀）', () => {
  const s = seed();
  const p = savedProduct(s);
  const before = areaOf(s);
  store.produceProduct(p.id, 2);
  const after = areaOf(s);
  equal(util.round(before - after, 2), 3900,
    '★ 2 件 × 每件两片 = 3900cm²（V91「按用户给的刀数扣」针对的是当批刀数；'
    + '这里是每件一套方案，件数要乘）');
});

test('⑥ 裁剪队列：每件按**片数**展开（裁剪页能看到这件要裁两片）', () => {
  const s = seed();
  const p = savedProduct(s);
  const q = calc.cutQueueFor(store.getProduct(p.id).bom, 2);
  equal(q.length, 4, '★ 2 件 × 每件 2 片 = 4 条（原来只生成 2 条 —— 用户在裁剪页永远只看到一片）');
  equal(q[0].redLen, 40, '第一片的尺寸照旧');
  equal(q[0].pieceNo, 1, '第 1 件的第 1 片');
  equal(q[1].redLen, 25, '★ 第二片的尺寸也要进队列（25×30，原来根本没有它）');
  equal(q[1].pieceNo, 1, '先排完一件的两片，再排下一件');
  equal(q[2].pieceNo, 2, '第 2 件的两片在后');
});

test('⑦ 显示：多片要在物料清单里说得出来（不再只显示一组长宽）', () => {
  const s = seed();
  const p = savedProduct(s);
  const mat = store.getMaterial(s.m.id);

  // ① 共享规格文案（详情页 / 教程卡 / CSV 都走它 —— 改一处三处受益）
  const spec = calc.bomLineSpec(store.getProduct(p.id).bom[0], mat);
  ok(spec.indexOf('2 片') >= 0, '规格要说出片数，实际：' + spec);
  ok(spec.indexOf('25') >= 0, '第二片的尺寸也要出现，实际：' + spec);
  equal(spec.indexOf('片'), spec.indexOf('片'), '');

  // ② 编辑页：物料行上要有片摘要（用户就是在这里说"还是只有一片布的长宽"）
  const page = loadPage(EDIT);
  page.onLoad({ id: p.id });
  const row = page.data.bom.find(b => b.materialId === s.m.id);
  ok(row, '前置：BOM 行要回填');
  ok(row.pieceText && row.pieceText.indexOf('2 片') >= 0,
    '编辑页物料行要显示片摘要，实际：' + (row && row.pieceText));
  ok(row.pieceText.indexOf('25') >= 0, '摘要里要能看到第二片的尺寸');

  // 注入法自检：单片不该冒出"片"字（否则摘要会误导）
  const single = calc.bomLineSpec({ materialId: 'x', isFabric: true, length: 40, width: 30, area: 1200 }, null);
  ok(single.indexOf('片') < 0, '自检失败：单片也冒出"片"字 —— 判据没有牙。实际：' + single);
});
