// tests/product-mat-preview.test.js —— 成品编辑页「物料长按预览」的页面级交互
//
// 需求（2026-09-14）：在 BOM 物料选择器里，长按任一物料 → 弹出预览卡；
// 松开手指 → 自动消失；且**不打断正常的选择流程**（正常点按仍能选物料）。
//
// 交互实现（用微信原生 longpress，不自己写计时器）：
//   bindlongpress  → 显示预览
//   bindtouchend / bindtouchcancel → 关闭预览
//   bindtap        → 照旧选物料
//   平台保证：longpress 一旦触发，同一次手势的 tap 不再触发 → 天然不会误选
//
// TDD：本文件先写，应当全红（页面尚无 onMatPreview / matPreview）。

const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const F = require('./fixtures.js');

const store = F.store;

// 一个按片面料（2 片）+ 一个非面料，覆盖两类分支
function setup() {
  F.reset();
  const fab = F.fabricMaterial({
    name: '米白纯棉平布', fabricWidth: 150, unitPrice: 0.01,
    pieces: [[200, 150], [50, 90]]
  });
  const zip = F.simpleMaterial({ name: '黑色隐形拉链', unit: '个', quantity: 100, unitPrice: 0.5 });
  F.seedMaterials([fab, zip]);

  const page = loadPage('../pages/products/edit.js');
  page.onLoad({});
  // 真实流程里选择器是从某个 BOM 行打开的（data-i 指向该行）——先建一行，否则选中无处可写
  page.addBom();
  return { page, fab: store.getMaterial(fab.id), zip: store.getMaterial(zip.id) };
}

function longPress(page, id) {
  page.onMatPreview({ currentTarget: { dataset: { id } } });
}
function release(page) {
  page.onMatPreviewEnd();
}
function openPicker(page, i) {
  page.openMatPicker({ currentTarget: { dataset: { i: i == null ? 0 : i } } });
}
function tapMat(page, id) {
  page.selectMat({ currentTarget: { dataset: { id } } });
}

group('长按预览 · 触发与关闭');

test('初始状态：没有预览数据（不该上来就显示卡片）', () => {
  const { page } = setup();
  ok(!page.data.matPreview, '初始 matPreview 应为空');
});

test('★ 长按物料 → 立即出现该物料的预览数据', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);

  const pv = page.data.matPreview;
  ok(pv, '长按后应有预览数据');
  equal(pv.id, fab.id);
  equal(pv.name, '米白纯棉平布');
  equal(pv.isFabric, true);
  ok(pv.pieces.length > 0, '面料预览应带布片清单');
});

test('★ 松手（touchend）→ 预览自动消失', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  ok(page.data.matPreview, '前提：长按后有预览');

  release(page);

  ok(!page.data.matPreview, '松手后预览应清空（不能留在屏幕上）');
});

test('手势被打断（touchcancel）也走同一个关闭逻辑', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  // wxml 上 touchcancel 与 touchend 绑同一个处理函数，这里直接验「处理函数能关掉」
  release(page);
  ok(!page.data.matPreview, '被打断也应收起预览');
});

test('长按非面料 → 预览走非面料口径（无布片清单）', () => {
  const { page, zip } = setup();
  openPicker(page, 0);
  longPress(page, zip.id);

  const pv = page.data.matPreview;
  equal(pv.name, '黑色隐形拉链');
  equal(pv.isFabric, false);
  equal(pv.pieces.length, 0);
  ok(pv.stockText.indexOf('100') >= 0, '应显示可用数量，实际：' + pv.stockText);
});

test('长按不存在的物料 → 不崩、不显示预览', () => {
  const { page } = setup();
  openPicker(page, 0);
  longPress(page, 'm_not_exist');
  ok(!page.data.matPreview, '取不到数据时不应显示空壳卡片');
});

group('长按预览 · 不打断正常选择流程');

test('★ 长按→松手之后，正常点按仍能选中物料（回归保护）', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  release(page);

  tapMat(page, fab.id);

  // 2026-09-30 V83：**面料的点按行为改了** —— 不再直接选中，而是进「裁剪排版」
  // （把选料与裁剪合并成一步，用户 D101/D103）。这里改为断言"没有直接写进 BOM"。
  ok(!page.data.bom[0].materialId, '面料点按不再直接选中（改为进裁剪排版，见 pages/cut-editor）');
  ok(!page.data.matPreview, '松手后不该残留预览（长按预览仍不干扰）');
});

test('直接点按（没长按）→ 选中，且全程没有出现过预览', () => {
  const { page, zip } = setup();
  openPicker(page, 0);
  tapMat(page, zip.id);

  equal(page.data.bom[0].materialId, zip.id);
  ok(!page.data.matPreview, '普通点按不该闪出预览');
});

test('长按之后立刻点按另一个物料 → 选中的是后点的那个（预览不干扰）', () => {
  const { page, fab, zip } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  release(page);
  tapMat(page, zip.id);

  equal(page.data.bom[0].materialId, zip.id, '应选中后点的物料');
});

group('长按预览 · 状态不留残');

test('关闭选择器 → 预览一并清空（避免下次打开还挂着上一条）', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  ok(page.data.matPreview, '前提：有预览');

  page.closeMatPicker();

  ok(!page.data.matPreview, '关闭选择器后预览必须清空');
});

test('重新打开选择器 → 不带上次的预览残留', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  page.closeMatPicker();
  openPicker(page, 0);

  ok(!page.data.matPreview, '重新打开时不该有残留预览');
});

test('预览数据实时对应当前库存（改库存后长按拿到新数据）', () => {
  const { page } = setup();
  // 新增一片大布后，预览的片数应跟着变
  const m2 = store.getMaterial(F.store.getMaterials().find(x => x.name === '米白纯棉平布').id);
  const before = store.materialPreview(m2).piecesTotal;
  m2.pieces.push(F.piece(300, 150));
  store.saveMaterial(m2);

  openPicker(page, 0);
  longPress(page, m2.id);

  equal(page.data.matPreview.piecesTotal, before + 1, '预览应取实时库存，不是打开弹层时的快照');
});

test('★ 页面切走（onHide）→ 预览清空（按住时长按遇来电/切后台，平台可能不补 touchcancel）', () => {
  const { page, fab } = setup();
  openPicker(page, 0);
  longPress(page, fab.id);
  ok(page.data.matPreview, '前提：有预览');

  page.onHide();

  ok(!page.data.matPreview, '页面不可见时必须收起预览，避免回来时残留');
});
