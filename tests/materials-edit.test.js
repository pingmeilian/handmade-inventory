// tests/materials-edit.test.js —— 物料编辑页的「进入即带数据，保存只改所动之处」
//
// 背景（2026-09-12 真机反馈）：
//   物料详情点「编辑」→ 保存 → 永远弹「请输入本次总价」，编辑功能直接卡死。
//   根因：「总价*」输入框在编辑态是被隐藏的（showPriceFields=false），但校验无条件执行
//   —— 弹窗让用户填一个屏幕上根本不存在的字段。
//   另一个隐患：saveMaterial 内部是 list[i] = m 的**整体替换**，编辑页只拿表单字段拼对象，
//   表单管不到的字段（如 createdAt）会被静默删除。
//
// 需求（用户拍板）：
//   1. 进入编辑页，所有已有数据（含总价）自动回填，不允许空白/必填重填
//   2. 只改需要变动的字段，未改动的自动保留原值
//   3. 保存只更新被修改的内容，详情页其他数据不得被改动/清空/重新计算覆盖
//   4. 回填值须与详情页展示完全一致
//
// 这些是「页面行为」层面的契约，所以用页面级测试（直接跑页面方法）来锁。

const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');

function toastTitles() { return stub.toasts.map((t) => String(t.title || '')); }
function hasToast(text) { return toastTitles().some((t) => t.indexOf(text) >= 0); }

// ---------- 造数据：走真实业务路径，账本自洽 ----------
// 按片面料：2m × 1.5m，入库总价 25 元 → 均价 25/3m² ≈ 8.3333/m²
function seedFabric() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({
    name: '米白纯棉平布', keywords: '平布',
    materialCategoryId: 'mc_fabric',
    attrs: { 颜色: '米白', 材质: '纯棉' },
    unit: '米'
  });
  store.inbound(m.id, 0, { length: 200, width: 150, total: 25 }, '初始入库');
  return store.getMaterial(m.id);
}

// 按批估量（刀口布）：2kg，25 元 → 12.5 元/kg
function seedBatch() {
  stub.resetStorage();
  store.ensureSeed();
  return store.saveMaterial({
    name: '碎花刀口布', keywords: '刀口布',
    materialCategoryId: 'mc_fabric',
    attrs: { 花纹: '碎花' },
    unit: '米',
    stockMode: 'batch', batchUnit: 'kg',
    batchTotal: 2, batchRemain: 2, batchUnitPrice: 12.5, totalValue: 25
  });
}

function openEdit(id) {
  const page = loadPage('../pages/materials/edit.js');
  page.onLoad({ id: id });
  return page;
}

// 账本口径字段快照：这些一律不允许被「改资料」动到
function ledgerSnapshot(m) {
  return JSON.stringify({
    totalValue: m.totalValue, price: m.price, quantity: m.quantity, pieces: m.pieces,
    batchRemain: m.batchRemain, batchUnitPrice: m.batchUnitPrice, batchTotal: m.batchTotal,
    totalPrice: m.totalPrice, createdAt: m.createdAt, stockMode: m.stockMode,
    fabricLength: m.fabricLength, fabricWidth: m.fabricWidth, unit: m.unit
  });
}

group('物料编辑 · 进入即带数据（需求 1 / 4）');

test('打开编辑页：已有数据全部回填，没有空白必填项', () => {
  const m = seedFabric();
  const page = openEdit(m.id);

  equal(page.data.isEdit, true, '应处于编辑态');
  equal(page.data.generatedName, m.name, '名称已回填');
  equal(page.data.keywords, '平布', '关键词已回填');
  equal(page.data.unit, '米', '单位已回填');
  equal(page.data.fabricLength, '2', '面料长已回填（m）');
  equal(page.data.fabricWidth, '1.5', '面料幅宽已回填（m）');
  equal(page.data.purchaseL1, '供应商', '购买渠道一级已回填');
  ok(page.data.stockValueText, '库值总值应展示（编辑态只读）');
  ok(String(page.data.avgPrice).length > 0, '当前均价已回填');
  // 属性（颜色/材质）应带出已选值
  const color = (page.data.attrGroups || []).find((g) => g.dimension === '颜色');
  ok(color && color.value === '米白', '颜色属性已回填，实际：' + JSON.stringify(color));
});

test('需求 4：编辑页展示的均价与详情页完全一致', () => {
  const m = seedFabric();
  const edit = openEdit(m.id);
  const detail = loadPage('../pages/materials/detail.js');
  detail.onLoad({ id: m.id });
  equal(edit.data.avgPrice, detail.data.avgPrice, '均价展示口径必须与详情页一致');
  equal(edit.data.avgUnit, detail.data.avgUnit, '均价单位必须与详情页一致');
});

test('★ 根因锁：编辑态不渲染「总价*」输入框 —— 它绝不可能是必填项', () => {
  const m = seedFabric();
  const page = openEdit(m.id);
  equal(page.data.showPriceFields, false,
    '编辑态必须隐藏「总价/数量」录入区（showPriceFields=false）；'
    + '若为 true，用户又会看到「总价*」并被要求填写（本次事故的根因）');
});

group('物料编辑 · 保存只改所动之处（需求 2 / 3）');

test('不改任何字段直接保存 → 成功，不再出现「请输入本次总价」', () => {
  const m = seedFabric();
  const before = ledgerSnapshot(store.getMaterial(m.id));
  const page = openEdit(m.id);
  page.save();

  equal(hasToast('请输入本次总价'), false, '编辑态不得再要求填总价（本次事故的直接现象）');
  ok(hasToast('已保存'), '应保存成功，实际提示：' + toastTitles().join(' / '));
  equal(ledgerSnapshot(store.getMaterial(m.id)), before, '未改动任何账本字段');
});

test('只改关键词 → 名称跟着变，其他字段一字不动', () => {
  const m = seedFabric();
  const before = ledgerSnapshot(store.getMaterial(m.id));
  const page = openEdit(m.id);
  page.setData({ keywords: '斜纹' });     // 模拟用户只改这一处
  page.save();

  const after = store.getMaterial(m.id);
  ok(after.name.indexOf('斜纹') >= 0, '名称应由属性+关键词重新生成，实际：' + after.name);
  equal(after.keywords, '斜纹');
  equal(ledgerSnapshot(after), before, '除名称/关键词外不得改动任何字段');
});

test('★ 表单管不到的字段不能被吞（saveMaterial 是整体替换，曾丢 createdAt 等）', () => {
  const m = seedFabric();
  // 塞入「表单不知道的字段」：模拟历史遗留 / 将来新增的字段
  const list = store.getMaterials();
  const i = list.findIndex((x) => x.id === m.id);
  list[i].legacyField = 'keep-me';
  list[i].supplier = '老王布料行';
  store.set(store.KEYS.MATERIALS, list);

  const page = openEdit(m.id);
  page.setData({ keywords: '斜纹' });
  page.save();

  const after = store.getMaterial(m.id);
  equal(after.legacyField, 'keep-me', '未在表单里的字段必须原样保留');
  equal(after.supplier, '老王布料行', '旧字段（supplier）必须原样保留');
  ok(after.createdAt, '创建时间不能被清掉');
});

test('面料：改了长宽后，库存总值与均价不被重算覆盖', () => {
  const m = seedFabric();
  const before = store.getMaterial(m.id);
  const page = openEdit(m.id);
  page.setData({ fabricLength: '2.5' });   // 用户量错了要改成长 2.5m
  page.save();

  const after = store.getMaterial(m.id);
  equal(after.fabricLength, 250, '长应更新为 250cm');
  equal(after.totalValue, before.totalValue, '库存总值不得被表单重算覆盖');
  equal(after.price, before.price, '均价缓存不得被表单覆盖');
  equal(after.pieces.length, before.pieces.length, '布片清单不得被清空或重建');
});

test('按批估量物料：编辑资料后存量/单价/总值保持原样', () => {
  const m = seedBatch();
  const before = ledgerSnapshot(store.getMaterial(m.id));
  const page = openEdit(m.id);
  page.setData({ remark: '只剩一小卷了' });
  page.save();

  const after = store.getMaterial(m.id);
  equal(after.remark, '只剩一小卷了', '备注应更新');
  equal(after.batchRemain, 2, '存量不得被改动');
  equal(after.batchUnitPrice, 12.5, '单价不得被改动');
  equal(after.totalValue, 25, '库存总值不得被改动');
  equal(after.batchTotal, 2, '总量不得被改动');
  ok(before.indexOf('"batchRemain":2') >= 0, '前置条件：种子数据的存量应为 2（防止用例本身失效）');
});

group('物料编辑 · 新建态回归（不能被本次修改带坏）');

test('新建态仍然要求总价（必填保护不能丢）', () => {
  stub.resetStorage();
  store.ensureSeed();
  const page = loadPage('../pages/materials/edit.js');
  page.onLoad({});                          // 新建
  equal(page.data.showPriceFields, true, '新建态应显示总价/数量录入区');
  page.setData({ keywords: '测试新料', fabricLength: '2' });   // 故意不填总价
  page.save();

  ok(hasToast('请输入本次总价'), '新建态必须仍然校验总价，实际提示：' + toastTitles().join(' / '));
  equal(store.getMaterials().length, 0, '校验不通过不得落库');
});

test('新建态正常保存：按面积反算均价并建立初始库存', () => {
  stub.resetStorage();
  store.ensureSeed();
  const page = loadPage('../pages/materials/edit.js');
  page.onLoad({});
  page.setData({ keywords: '测试新料', fabricLength: '2', totalPrice: '25' });
  page.save();

  const list = store.getMaterials();
  equal(list.length, 1, '应落库一条');
  ok(list[0].price > 0, '应按面积反算出均价，实际：' + list[0].price);
  ok((list[0].totalValue || 0) > 0, '初始入库应建立库存总值，实际：' + list[0].totalValue);
  equal(list[0].totalPrice, 25, '本次总价应记录');
});
