// tests/produce-usage.test.js —— 「这批实际用料」（2026-09-27 V74，承接 D72/D73）
//
// 背景（用户原话）：
//   「我需要成批新增成品……但是新增多个成品跟新增一个成品，它用的布料可能不太一样，
//     它可能用的是一大块儿布，而不是说新增一个成品用的那一小块儿布」
// 定位（见 D72/D73）：
//   · 成本侧**已经支持**每批不同（`produceProduct` 把本次扣料金额记成 batchCost，
//     单件成本 = batchCost / qty）⇒ **成本公式一行不用改**
//   · 缺的是「这批实际用掉多少料」没有表达方式：现按 `每件用量 × 数量` 扣，
//     整块布没用完的那部分仍挂在库存 ⇒ **库存虚高 + 这批成本偏低**
// 处置：给「增加成品数量」加一块「这批实际用料」，默认填标准用量，改了就按改的扣。
//
// 本文件覆盖**纯逻辑**（calc 的行计算 / store 的扣减与校验）与**用户真正看到的那一屏**；
// 源码层另有守卫（guard-produce-usage）。
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');
const { loadPage } = require('./page-helper.js');

const store = F.store;
const util = F.util;
const calc = require('../utils/calc.js');

// ---------- 造数工具 ----------
// 一块 100×100cm 的面料（=10000cm²=1m²），单价 0.01 元/cm² ⇒ 整块 100 元
function fabric100() {
  return F.fabricMaterial({ name: '大块棉布', pieces: [[100, 100]], unitPrice: 0.01 });
}
function trim(name, unit, price) {
  return F.simpleMaterial({ name: name, unit: unit || '个', quantity: 100, unitPrice: price == null ? 1 : price });
}
function batchFabric() {
  return F.batchFabricMaterial({ name: '刀口布', batchRemain: 2, batchUnit: 'kg', batchUnitPrice: 10 });
}

group('calc · 这批实际用料（行计算）');

test('① 三类 BOM 行各自给出「默认用量 + 单位」：普通 / 面积 / 刀口布', () => {
  F.reset();
  const fab = fabric100();      // 面积类
  const bt = batchFabric();     // 按批估量
  const tr = trim('衬布');      // 普通
  F.seedMaterials([fab, bt, tr]);
  const p = F.product({
    name: '测试布包',
    bom: [
      { materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 },        // 每件 1000cm²
      { materialId: bt.id, materialName: bt.name, isFabric: true, batchUsage: 0.05 },    // 每件 0.05kg
      { materialId: tr.id, materialName: tr.name, usage: 5 }                             // 每件 5 个
    ]
  });

  const lines = calc.produceUsageLines(p.bom, 10);
  equal(lines.length, 3, '三条 BOM 行都该出现');

  const areaLine = lines.find(l => l.materialId === fab.id);
  equal(areaLine.kind, 'area');
  equal(areaLine.unit, 'm²', '面积用 m² 展示（与全项目面积口径一致）');
  near(areaLine.def, 1, 1e-9, '10 件 × 1000cm² = 10000cm² = 1 m²');
  equal(areaLine.scale, 10000, '展示单位 → 内部 cm² 的倍数');

  const batchLine = lines.find(l => l.materialId === bt.id);
  equal(batchLine.kind, 'batch');
  equal(batchLine.unit, 'kg', '刀口布按自身单位');
  near(batchLine.def, 0.5, 1e-9, '10 件 × 0.05kg = 0.5kg');

  const eachLine = lines.find(l => l.materialId === tr.id);
  equal(eachLine.kind, 'each');
  equal(eachLine.unit, '个');
  near(eachLine.def, 50, 1e-9, '10 件 × 5 个');
});

test('② 每行带「每件用量」说明，与 BOM 规格文案同源（不另写一套）', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  // 用「只有面积」的面料行 —— 有长宽的几何行自 V92 起不再进这个面板（见 ⑯）
  const b = { materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 };
  const line = calc.produceUsageLines([b], 2)[0];
  ok(line.spec.indexOf('面积') >= 0, '说明里应能看到每件规格，实际「' + line.spec + '」');
  equal(line.spec, calc.bomLineSpec(b, fab), '说明文案必须复用 bomLineSpec（避免两处写法漂移）');
});

test('③ produceOverrides：只收集「用户改过的」行；没改的不传（=零回归）', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  const p = F.product({ name: '包', bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 }] });

  const lines = calc.produceUsageLines(p.bom, 10);           // 默认 1 m²（10000cm²）
  equal(Object.keys(calc.produceOverrides(lines)).length, 0, '一行没改就不该有任何覆盖');

  lines[0].input = '1.5';                                    // 用户改成 1.5 m²
  const ov = calc.produceOverrides(lines);
  near(ov[fab.id], 15000, 1e-6, '面积按 ×10000 换成内部 cm²');
});

test('④ produceOverrides 的边界：留空 / 乱填 / 负数一律视为「没改」；填 0 是有效改动', () => {
  const mk = (input) => [{ materialId: 'm1', def: 5, input: input, scale: 1 }];
  equal(Object.keys(calc.produceOverrides(mk(''))).length, 0, '空 → 没改');
  equal(Object.keys(calc.produceOverrides(mk('abc'))).length, 0, '乱填 → 没改');
  equal(Object.keys(calc.produceOverrides(mk('-1'))).length, 0, '负数 → 没改');
  equal(Object.keys(calc.produceOverrides(mk('5'))).length, 0, '与默认相同 → 没改');
  equal(calc.produceOverrides(mk('0'))['m1'], 0, '填 0 是有效改动（这批没用这个料）');
});

test('⑤ 数量变化时重算默认：没动过的行跟着走，动过的行保留用户输入', () => {
  F.reset();
  const tr = trim('衬布');
  F.seedMaterials([tr]);
  const bom = [{ materialId: tr.id, materialName: tr.name, usage: 5 }];

  let lines = calc.produceUsageLines(bom, 10);               // 50 个
  lines[0].input = '80';                                     // 用户改成 80
  const touched = calc.produceOverrides(lines);
  equal(touched[tr.id], 80);

  lines = calc.retuneUsageLines(lines, bom, 20);             // 数量改成 20
  equal(lines[0].input, '80', '用户改过的行保留原值（不能被数量变化冲掉）');
  near(lines[0].def, 100, 1e-9, '默认值跟着新数量走（20×5=100），用于判断"是否改过"');
});

test('⑥ cutQueueFor：**每件一条**（逐件确认）', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  const bom = [{ materialId: fab.id, materialName: fab.name, isFabric: true, length: 15, width: 10 }];

  const q3 = calc.cutQueueFor(bom, 3);
  equal(q3.length, 3, '做 3 件 → 队列 3 条（每一件都要让用户单独确认）');
  equal(q3[0].pieceNo, 1);
  equal(q3[2].pieceNo, 3);
  q3.forEach((t) => { near(t.redLen, 15, 1e-9); near(t.redWid, 10, 1e-9); });
});

group('store · 生产中按「这批实际用料」扣减');

test('★ ⑦ 整块布全用掉：按实际面积扣，库存归零、这批成本 = 整块布的钱', () => {
  F.reset();
  const fab = fabric100();                                   // 1m²，整块 100 元
  F.seedMaterials([fab]);
  const p = F.product({
    name: '测试布包',
    bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 }]  // 标准每件 1000cm²
  });
  F.seedProducts([p]);

  // 标准算法：10 件 × 1000cm² = 10000cm²，正好也是 1m² —— 换个数量让差距显现
  store.produceProduct(p.id, 6, null, null, { [fab.id]: 10000 });   // 这批实际用掉整块 10000cm²

  const after = store.getMaterial(fab.id);
  near(store.fabricArea(after), 0, 0.01, '整块用掉后库存应归零（边角料报废不再挂账）');

  const pr = store.getProduct(p.id).productions[0];
  near(pr.cost, 100, 0.01, '这批成本 = 实际扣掉的那块布的钱（100 元）');
  near(pr.unitCost, util.round(100 / 6, 6), 1e-6, '单件实际成本 = 这批实际成本 ÷ 数量');
  near(store.getProduct(p.id).sellableStock, 6, 1e-9, '库存入账 6 件');
});

test('⑧ 不传「实际用料」→ 行为与以前完全一致（按 BOM 每件用量扣）', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  const p = F.product({
    name: '测试布包',
    bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 }]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 6);

  near(store.fabricArea(store.getMaterial(fab.id)), 10000 - 6000, 0.01, '按 6 × 1000cm² 扣，剩余 4000cm²');
  near(store.getProduct(p.id).productions[0].cost, 60, 0.01, '成本 = 0.01 元/cm² × 6000cm²');
});

test('★ ⑨ 覆盖量与库存不符时提前拦住（不能扣一半就崩）', () => {
  F.reset();
  const fab = fabric100();                                   // 只有 1m²
  F.seedMaterials([fab]);
  const p = F.product({
    name: '测试布包',
    bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 }]
  });
  F.seedProducts([p]);

  let err = null;
  try { store.produceProduct(p.id, 6, null, null, { [fab.id]: 20000 }); } catch (e) { err = e; }
  ok(err, '要 2m² 但只有 1m² → 应拦住');
  equal(err.code, 'SHORT');
  near(store.fabricArea(store.getMaterial(fab.id)), 10000, 0.01, '拦住后库存分毫未动');
  equal((store.getProduct(p.id).productions || []).length, 0, '不该留下半截生产记录');
  equal(store.getFlows().length, 0, '不该留下半截流水');
});

test('⑩ 填 0 = 这批没用这个料：不扣库存、不进成本', () => {
  F.reset();
  const tr = trim('衬布', '个', 2);
  F.seedMaterials([tr]);
  const p = F.product({ name: '包', bom: [{ materialId: tr.id, materialName: tr.name, usage: 5 }] });
  F.seedProducts([p]);

  store.produceProduct(p.id, 10, null, null, { [tr.id]: 0 });

  equal(store.getMaterial(tr.id).quantity, 100, '库存不动');
  near(store.getProduct(p.id).productions[0].cost, 0, 0.001, '这批成本为 0');
});

test('⑪ 覆盖的物料会被写进流水（带关联成品），追溯链不断', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  const p = F.product({
    name: '测试布包',
    bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, area: 1000 }]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 6, null, null, { [fab.id]: 10000 });

  const flows = store.getFlows();
  equal(flows.length, 1, '一笔扣料流水');
  equal(flows[0].relatedProductId, p.id, '关联成品（导出「关联成品」列就靠它）');
  near(flows[0].qty, 10000, 0.01, '流水数量 = 实际扣掉的数量');
  near(flows[0].totalPrice, 100, 0.01, '流水金额 = 这批实际的料钱');
});

test('⑫ 刀口布（按批估量）同样支持：填整批 kg 数，扣完归零', () => {
  F.reset();
  const bt = batchFabric();                                  // 2kg，10 元/kg
  F.seedMaterials([bt]);
  const p = F.product({
    name: '包',
    bom: [{ materialId: bt.id, materialName: bt.name, isFabric: true, batchUsage: 0.05 }]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 6, null, null, { [bt.id]: 1.5 });   // 这批实际用掉 1.5kg

  near(store.getMaterial(bt.id).batchRemain, 0.5, 0.001, '2kg - 1.5kg = 0.5kg');
  near(store.getProduct(p.id).productions[0].cost, 15, 0.01, '成本 = 10 元/kg × 1.5kg');
});

group('store · 按面积的面料行：做几件就留几笔账');

test('★ ⑬ 只填面积的面料行：做 5 件要留 5 笔扣料，而不是合并成 1 笔', () => {
  // 真机反馈（2026-09-28）：「增加成品数量大于一时……为什么只剪了一个布，不应该新增几个就剪几个吗」
  // 根因：BOM 只填了面积时，原先**一次性扣掉总面积**（5 × 150 = 750），
  //       只留 1 笔流水、库存里那块布看着只被裁了一刀 —— 与"做了 5 个"的心智对不上。
  // 面积法本来就不掌握形状（不知道裁成几条），所以逐件扣与一次扣**面积完全等价**，
  // 但逐件留下了「剪了几件」的痕迹，账目能对上。
  F.reset();
  const f = F.fabricMaterial({ name: '大布', pieces: [[200, 150]], unitPrice: 0.01 });
  F.seedMaterials([f]);
  const p = F.product({
    name: '测试布包',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, area: 150 }]   // 每件 150cm²
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 5);

  const flows = store.getFlows();
  equal(flows.length, 5, '做 5 件就该有 5 笔扣料 —— 用户：「新增几个就剪几个」');
  flows.forEach((fl) => {
    near(fl.qty, 150, 0.01, '每笔正好是一件用的面积');
    equal(fl.relatedProductId, p.id, '每笔都要带关联成品（追溯链）');
  });
  near(store.fabricArea(store.getMaterial(f.id)), 30000 - 750, 0.01, '总面积与一次扣完全一致');
  near(store.getProduct(p.id).productions[0].cost, 7.5, 0.01, '总成本不变（0.01 元/cm² × 750cm²）');
});

test('⑭ 逐件扣后库存粒度不变差：原本一块布，扣完仍有正确的剩余面积', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '大布', pieces: [[200, 150]], unitPrice: 0.01 });
  F.seedMaterials([f]);
  const p = F.product({
    name: '包',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, area: 150 }]
  });
  F.seedProducts([p]);

  store.produceProduct(p.id, 3);

  const m = store.getMaterial(f.id);
  near(store.fabricArea(m), 30000 - 450, 0.01, '剩余面积 = 原面积 − 3 件用量');
  ok((m.pieces || []).length >= 1, '剩余布片仍要在库存里（不能凭空消失）');
  ok((m.pieces || []).every((x) => x.area > 0), '不能产生 0 面积的布片');
});

test('⑮ 面积行的逐件扣也不越过库存线（不够就提前拦住）', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '小布', pieces: [[20, 15]], unitPrice: 0.01 });  // 只有 300cm²
  F.seedMaterials([f]);
  const p = F.product({
    name: '包',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, area: 150 }]
  });
  F.seedProducts([p]);

  let err = null;
  try { store.produceProduct(p.id, 3); } catch (e) { err = e; }   // 需要 450cm²，只有 300
  ok(err, '库存不足应拦住');
  equal(err.code, 'SHORT');
  equal(store.getFlows().length, 0, '拦住后不该留下半截流水');
  near(store.fabricArea(store.getMaterial(f.id)), 300, 0.01, '库存分毫未动');
});

// ---------------------------------------------------------------
// 2026-09-30（V92）。用户看着「增加成品数量」的弹窗说：
//   「那现在这个界面的实际用量就不用了，删掉」
//   追问后拍板：「只删面料那部分」（面板留着管非面料）。
//
// 为什么现在可以删：V91 的裁剪界面已经把"面料怎么裁"整个接过去了 ——
//   每片能各自填长宽、各自选布；片数减到 1 就是"这批合起来裁一块大的"
//   （V74 当初做「合起来剪」就是为了这件事）。
// ⇒ 面板从此只列**不走裁剪界面**的行：辅料、按批估量的刀口布，
//   以及极少数没有长宽、进不了裁剪队列的面积面料行。
//   有长宽的面料几何行一律不再出现 —— 它归裁剪界面管。
// ---------------------------------------------------------------

group('calc · 面料几何行不再进「这批实际用料」（2026-09-30 V92）');

test('★ ⑯ 有长宽的面料行不进面板（用量由裁剪界面定）', () => {
  F.reset();
  const fab = fabric100();
  F.seedMaterials([fab]);
  const bom = [{ materialId: fab.id, materialName: fab.name, isFabric: true, length: 38, width: 83, area: 3154 }];

  equal(calc.produceUsageLines(bom, 3).length, 0,
    '几何行归裁剪界面管 —— 面板里再出现它，用户会以为这儿还能改面料用量');
  equal(Object.keys(calc.produceOverrides(calc.produceUsageLines(bom, 3))).length, 0, '也就不该产生任何覆盖');
});

test('★ ⑰ 面板只留「不走裁剪」的行：辅料 / 刀口布 / 没有长宽的面积行', () => {
  F.reset();
  const area = F.fabricMaterial({ name: '碎布头', pieces: [[100, 100]], unitPrice: 0.01 });   // 只有面积
  const rect = F.fabricMaterial({ name: '棉布', pieces: [[100, 100]], unitPrice: 0.01 });     // 有长宽
  const bt = batchFabric();
  const tr = trim('衬布');
  F.seedMaterials([area, bt, tr, rect]);
  const bom = [
    { materialId: area.id, materialName: area.name, isFabric: true, area: 1000 },
    { materialId: rect.id, materialName: rect.name, isFabric: true, length: 38, width: 83, area: 3154 },
    { materialId: bt.id, materialName: bt.name, isFabric: true, batchUsage: 0.05 },
    { materialId: tr.id, materialName: tr.name, usage: 5 }
  ];

  const ids = calc.produceUsageLines(bom, 2).map(l => l.materialId);
  ok(ids.indexOf(rect.id) < 0, '有长宽的面料行必须不在面板里（归裁剪界面）');
  ok(ids.indexOf(area.id) >= 0, '没有长宽的面料进不了裁剪队列 —— 面板得给它留个改量的口子');
  ok(ids.indexOf(bt.id) >= 0, '刀口布不裁剪（按 kg/片 估量），留在面板');
  ok(ids.indexOf(tr.id) >= 0, '辅料留在面板');
});

// 一块 150×150（幅宽 150 ⇒ 整布）、总价 225 元 ⇒ 0.01 元/cm²
//
// ⚠️ 必须走 store.inbound 真实入库，不能像本文件其它造数那样直接塞 pieces：
//    `totalValue` 现在**由流水派生**（addFlow 末尾统一重算）。直接塞物料没有入库流水支撑，
//    派生值会变成「0 − 出库金额」= 负数 ⇒ 加权单价会算成负的。
//    （真实用户都是从「入库」进来的，所以这是造数陷阱，不是产品问题。）
function fabricSheet() {
  const f = F.fabricMaterial({ name: '棉布', pieces: [], unitPrice: 0, fabricWidth: 150 });
  F.seedMaterials([f]);
  store.inbound(f.id, 0, { length: 150, width: 150, total: 225 });
  return store.getMaterial(f.id);
}
// 每件 38×83
function rectProduct(f) {
  return F.product({
    name: '包',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, length: 38, width: 83, area: 3154 }]
  });
}

group('store · 用户报的一块料（V91 起走逐件方案）');

test('★ ⑱ 只剪 1 刀：做 3 件也只报一块 114×83，1 笔流水', () => {
  F.reset();
  const f = fabricSheet();
  const p = rectProduct(f);
  F.seedProducts([p]);

  // 「做 3 件，但只需要一大片布、只裁一块」—— 片数 < 件数 是合法操作（V91）
  store.produceProduct(p.id, 3, null, null, null, [[{ materialId: f.id, length: 114, width: 83 }]]);

  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 1, '只剪 1 刀 = 1 笔流水，实际 ' + outs.length + ' 笔');
  near(outs[0].qty, 114 * 83, 0.01, '扣的面积 = 114 × 83');
  ok(outs[0].cutSourceId != null && outs[0].cutBefore, '必须是真几何裁剪（带裁剪痕迹），不是面积扣');
  near(store.fabricArea(store.getMaterial(f.id)), 22500 - 114 * 83, 0.01, '库存按这一块扣');
  const pr = store.getProduct(p.id).productions[0];
  near(pr.cost, 114 * 83 * 0.01, 0.01, '这批成本 = 这一块布的钱');
  near(pr.unitCost, (114 * 83 * 0.01) / 3, 0.01, '单件实际成本 = 这块的钱 ÷ 3');
  near(store.getProduct(p.id).sellableStock, 3, 1e-9, '成品照样入账 3 件');
});

test('⑲ 不给方案（默认一件一件剪）→ 做 3 件剪 3 刀，与以前完全一致', () => {
  F.reset();
  const f = fabricSheet();
  const p = rectProduct(f);
  F.seedProducts([p]);

  store.produceProduct(p.id, 3);

  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 3, '3 件 = 3 刀 = 3 笔流水');
  outs.forEach((x) => near(x.qty, 38 * 83, 0.01, '每刀就是一件的尺寸'));
  near(store.fabricArea(store.getMaterial(f.id)), 22500 - 3 * 38 * 83, 0.01);
  near(store.getProduct(p.id).productions[0].cost, 3 * 38 * 83 * 0.01, 0.01);
});

test('★ ⑳ 报的尺寸剪不出来（比任何一片布都大）→ 提前拦住，库存分毫未动', () => {
  F.reset();
  const f = fabricSheet();
  const p = rectProduct(f);
  F.seedProducts([p]);

  let err = null;
  try { store.produceProduct(p.id, 1, null, null, null, [[{ materialId: f.id, length: 200, width: 200 }]]); }
  catch (e) { err = e; }
  ok(err, '200×200 超出布片尺寸，应拦住');
  equal(err.code, 'NOFABRIC');
  near(store.fabricArea(store.getMaterial(f.id)), 22500, 0.01, '拦住后库存分毫未动');
  equal(store.getFlows().filter(x => x.type === 'out').length, 0, '不该留下半截流水');
  equal((store.getProduct(p.id).productions || []).length, 0, '不该留下半截生产记录');
});

// ---------------------------------------------------------------
// 2026-09-30（V92）页面级 —— 用户真正看到的那一屏。
// 为什么一定要跑页面：V83 的教训是"源码守卫全绿、真机还是错"
// （改尺寸只重算了画布，上面那排布片的判定没跟着变）。这里同理：
// 行计算对了不等于弹窗里显示对了，所以把成品列表页加载起来、调它真按钮。
// ---------------------------------------------------------------
group('页面 · 「增加成品数量」的面板（2026-09-30 V92）');

test('★ ㉑ 面板只列非裁剪行：有长宽的面料行不出现，辅料仍在（且还能改）', () => {
  const fab = F.fabricMaterial({ name: '棉布', pieces: [[100, 100]], unitPrice: 0.01 });
  const tr = trim('衬布', '个', 1);
  F.reset();
  F.seedMaterials([fab, tr]);
  const p = F.product({
    name: '包',
    bom: [
      { materialId: fab.id, materialName: fab.name, isFabric: true, length: 38, width: 83, area: 3154 },
      { materialId: tr.id, materialName: tr.name, usage: 5 }
    ]
  });
  F.seedProducts([p]);

  const page = loadPage('../pages/products/list.js');
  page.setData({ actionProd: store.getProduct(p.id) });
  page.actionProduce();

  equal(page.data.usageLines.length, 1, '面板里只该剩辅料那一行（面料几何行归裁剪界面）');
  equal(page.data.usageLines[0].materialId, tr.id, '剩下的必须是辅料');

  // 改一下 → 必须能变成覆盖（非面料的老能力不能被误伤）
  page.onUsageInput({ currentTarget: { dataset: { i: 0 } }, detail: { value: '8' } });
  equal(calc.produceOverrides(page.data.usageLines)[tr.id], 8, '改过的量要成为覆盖（否则改了不生效）');
});

test('★ ㉒ 只有几何面料的成品 → 面板整块不出现（弹窗只剩数量 + 取消/确定）', () => {
  const fab = F.fabricMaterial({ name: '棉布', pieces: [[100, 100]], unitPrice: 0.01 });
  F.reset();
  F.seedMaterials([fab]);
  const p = F.product({
    name: '包',
    bom: [{ materialId: fab.id, materialName: fab.name, isFabric: true, length: 38, width: 83, area: 3154 }]
  });
  F.seedProducts([p]);

  const page = loadPage('../pages/products/list.js');
  page.setData({ actionProd: store.getProduct(p.id) });
  page.actionProduce();

  equal(page.data.usageLines.length, 0,
    '没东西可改 → 面板整块不出现（wxml 的 wx:if 就靠 usageLines.length）');
});

