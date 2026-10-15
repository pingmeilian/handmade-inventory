// tests/cut-editor-bom.test.js —— 「裁剪界面 → BOM」这条跨页契约，真的跑一遍（2026-09-30 V85）
//
// 为什么要单独有这个文件：V85 让裁剪界面上的尺寸可以按**米**填。而 BOM 一侧（以及下游扣料）
// 有 8 处是**按厘米直接读** b.length / b.width 的（store.js ×4 / calc.js ×3 / edit.js 回填），
// 米制值一旦落进 BOM 就会被当成厘米用 —— 差 100 倍，而且**静默**。
// 所以定死一条契约：**裁剪界面回传的一律是厘米**（cm/m 只是那一屏的输入方式）。
//
// 这条契约横跨两个页面，光看源码守卫不够（V78 白屏就是这么漏的：守卫全绿、真机白屏）。
// 这里把两个页面都加载起来、走完整路径验一遍。
const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const util = require('../utils/util.js');

const CUT = '../pages/cut-editor/cut-editor.js';
const EDIT = '../pages/products/edit.js';

// 一个「面料 + 按片」的物料（裁剪排版只对这类料生效），入库走真实路径
function setup() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({
    name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米'
  });
  store.inbound(m.id, 0, { length: 200, width: 140, total: 280 }, '初始入库');
  const fab = store.getMaterial(m.id);

  const page = loadPage(EDIT);
  page.onLoad({});
  page.addBom();                       // 真实流程里选择器是从某个 BOM 行打开的
  page.openMatPicker({ currentTarget: { dataset: { i: 0 } } });
  return { page, fab };
}

group('裁剪界面 → BOM · 单位口径跨页契约（V85）');

test('① 成品编辑里点一块面料 → 跳裁剪界面，并带上 onCutChosen 回调', () => {
  const { page, fab } = setup();
  stub.navs && stub.navs();
  page.selectMat({ currentTarget: { dataset: { id: fab.id } } });
  const nav = stub.navs('navigateTo').pop();
  ok(nav, '点面料应当跳走');
  equal(nav.url, '/pages/cut-editor/cut-editor?id=' + fab.id, '跳到裁剪界面');
});

test('★★ ② 裁剪界面按**米**填 0.3 × 0.2 → 存进 BOM 的必须是 30 × 20（厘米）', () => {
  const { page, fab } = setup();

  // —— 真跑裁剪界面：切到米、填 0.3 / 0.2、点「就这样裁」——
  const cut = loadPage(CUT);
  let payload = null;
  cut.channel = { emit: (ev, d) => { payload = d; } };
  cut.onLoad({ id: fab.id });
  cut.pickUnit({ currentTarget: { dataset: { u: 'm' } } });
  cut.setPartLen({ currentTarget: { dataset: { i: 0 } }, detail: { value: '0.3' } });
  cut.setPartWid({ currentTarget: { dataset: { i: 0 } }, detail: { value: '0.2' } });
  equal(cut.data.canConfirm, true, '0.3m × 0.2m 放在 2m × 1.4m 的布上放得下');
  cut.confirm();
  ok(payload, '裁剪界面要回传 onCutChosen');

  // —— 交给成品编辑页接收（等于真机上的 onCutChosen）——
  page.applyMatToBom(fab.id, payload.schemes);
  const row = page.data.bom[0];
  equal(Number(row.length), 30, '存进 BOM 的是 30（厘米），不是 0.3');
  equal(Number(row.width), 20, '存进去的是 20（厘米），不是 0.2');
  equal(row.lenUnit || 'cm', 'cm', 'BOM 行的单位是厘米');
  equal(row.isFabric, true, '这行仍是面料行');
});

test('③ 厘米模式原样透传：填 30 × 20 → BOM 就是 30 × 20', () => {
  const { page, fab } = setup();
  const cut = loadPage(CUT);
  let payload = null;
  cut.channel = { emit: (ev, d) => { payload = d; } };
  cut.onLoad({ id: fab.id });                       // 默认厘米
  cut.setPartLen({ currentTarget: { dataset: { i: 0 } }, detail: { value: '30' } });
  cut.setPartWid({ currentTarget: { dataset: { i: 0 } }, detail: { value: '20' } });
  cut.confirm();
  page.applyMatToBom(fab.id, payload.schemes);
  const row = page.data.bom[0];
  equal(Number(row.length), 30);
  equal(Number(row.width), 20);
});

test('④ 非面料物料不受影响：仍「点一下直接选中」，不跳裁剪界面', () => {
  const { page } = setup();
  const zip = store.saveMaterial({
    name: '黑色隐形拉链', materialCategoryId: 'mc_trim', unit: '个'
  });
  page.setData({ matAll: page.data.matAll.concat([store.getMaterial(zip.id)]) });
  const before = stub.navs('navigateTo').length;
  page.selectMat({ currentTarget: { dataset: { id: zip.id } } });
  equal(stub.navs('navigateTo').length, before, '拉链不该跳裁剪界面（没有排版可言）');
  equal(page.data.bom[0].materialId, zip.id, '应当直接选中');
});

/* ===== V87：在裁剪界面「就这样裁」= 这行的裁剪方案已定 =====
 * 真机反馈（2026-09-30 截图）：已经在裁剪界面选好布、点了「就这样裁」，保存成品时还是弹
 * 「请先完成裁剪 —— 还有 1 个面料已填尺寸但未选择裁剪方案」。
 * 根因：`applyMatToBom` 只写了 length/width，**没写 chosenScheme** ⇒
 *   ① `calc.pendingCutLines` 判定这行"没选方案" → 保存被拦；
 *   ② 就算绕过去，`store.saveProduct` 的 `findChosen` 也找不到方案 ⇒ 扣料时
 *      `pickCutSource` **自己随便挑一块布**，用户在界面上选的那块布和摆的位置全被丢掉。
 */
function setupTwoPieces() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({
    name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米'
  });
  // A：35×80（小、紧配）—— 自动挑布会优先挑它；B：100×80（大）
  store.inbound(m.id, 0, { length: 35, width: 80, total: 28 }, '入库A');
  store.inbound(m.id, 0, { length: 100, width: 80, total: 80 }, '入库B');
  const fab = store.getMaterial(m.id);
  const page = loadPage(EDIT);
  page.onLoad({});
  page.addBom();
  page.openMatPicker({ currentTarget: { dataset: { i: 0 } } });
  return { page, fab };
}

// 真跑一遍裁剪界面：选第 idx 块布 → 填 长×宽 → 点「就这样裁」→ 把回传交给成品编辑页
function cutAndApply(page, fab, idx, len, wid) {
  const cut = loadPage(CUT);
  let payload = null;
  cut.channel = { emit: (ev, d) => { payload = d; } };
  cut.onLoad({ id: fab.id });
  // 换布（V91：① 区点一块 = 把**当前这一片**挪过去，不再有"整屏选一块"那种 cur）
  const bids = store.getMaterial(fab.id).pieces.filter(p => p.status === 'in').map(p => p.id);
  cut.pickBoard({ currentTarget: { dataset: { id: bids[idx] } } });
  cut.setPartLen({ currentTarget: { dataset: { i: 0 } }, detail: { value: String(len) } });
  cut.setPartWid({ currentTarget: { dataset: { i: 0 } }, detail: { value: String(wid) } });
  equal(cut.data.canConfirm, true, '这个尺寸应该放得下');
  cut.confirm();
  ok(payload, '裁剪界面要回传 onCutChosen');
  page.applyMatToBom(fab.id, payload.schemes);
  return { payload, pieceId: bids[idx] };
}

const calc = require('../utils/calc.js');

test('★★ ⑤ 「就这样裁」之后，这行必须记成**已选裁剪方案**（否则保存被拦）', () => {
  const { page, fab } = setupTwoPieces();
  const { pieceId } = cutAndApply(page, fab, 1, 30, 20);   // 选第 2 块（大的那块）
  const row = page.data.bom[0];
  ok(row.chosenSchemes && row.chosenSchemes.length,
    'BOM 行必须有 chosenSchemes（V91 起是数组）—— 否则保存时弹「请先完成裁剪」（真机反馈）');
  equal(row.chosenSchemes[0].pieceId, pieceId, '方案里要记住**用户选的那块布**');
  equal(Number(row.chosenSchemes[0].length), 30, '方案的尺寸 = 行里的长（cm）');
  equal(Number(row.chosenSchemes[0].width), 20);
  // 保存前的那道闸：pendingCutLines 必须放行
  const pending = calc.pendingCutLines(page.data.bom, {});
  equal(pending.length, 0, '已选方案的行不该再被 pendingCutLines 拦下（' + JSON.stringify(pending) + '）');
});

test('★★ ⑥ 保存扣料时，扣的是**用户选的那块布**（不是系统自己挑的紧配小块）', () => {
  const { page, fab } = setupTwoPieces();
  const pieces = store.getMaterial(fab.id).pieces;
  const small = pieces[0], big = pieces[1];        // A=35×80（自动挑布会优先它）、B=100×80
  const { pieceId } = cutAndApply(page, fab, 1, 30, 20);
  equal(pieceId, big.id, '界面上选的是大的那块');

  store.saveProduct({
    name: '测试成品·裁剪口径', categoryId: 'bc_default', productCategoryId: 'pc_other',
    nature: 'merchandise', includeLabor: false, price: 0,
    bom: [{
      materialId: fab.id, materialName: fab.name, isFabric: true, stockMode: 'piece',
      length: 30, width: 20, area: 600, lenUnit: 'cm', widUnit: 'cm', matSel: 0,
      priceSnapshot: fab.price
    }]
  }, { chosenSchemes: page.collectRowChosen() });

  const after = store.getMaterial(fab.id).pieces;
  const a2 = after.find(x => x.id === small.id), b2 = after.find(x => x.id === big.id);
  ok(a2 && b2, '两块布都还在（裁剪不拆块）');
  equal(util.round(a2.area, 2), util.round(small.area, 2), '小的那块**一点没动**（系统本来会挑它）');
  equal(util.round(b2.area, 2), util.round(big.area - 600, 2), '大那块少了 30×20 = 600cm²');
  const hole = (b2.holes || [])[0];
  ok(hole, '大那块上要有挖走的镂空');
  equal(util.round(hole.length, 2), 30, '挖的是 30×20');
  equal(util.round(hole.width, 2), 20);
});

test('⑦ 自动兜底仍有效：**没**选方案时按紧配挑布（老行为不许被破坏）', () => {
  const { page, fab } = setupTwoPieces();
  const pieces = store.getMaterial(fab.id).pieces;
  const small = pieces[0];
  page.applyMatToBom(fab.id, []);                  // 只选物料、**不带裁剪方案**（老路径）
  const row0 = page.data.bom[0];
  ok(!row0.chosenScheme && !(row0.chosenSchemes || []).length, '不带方案时不该凭空造一个');
  store.saveProduct({
    name: '测试成品·兜底', categoryId: 'bc_default', productCategoryId: 'pc_other',
    nature: 'merchandise', includeLabor: false, price: 0,
    bom: [{
      materialId: fab.id, materialName: fab.name, isFabric: true, stockMode: 'piece',
      length: 30, width: 20, area: 600, lenUnit: 'cm', widUnit: 'cm', matSel: 0,
      priceSnapshot: fab.price
    }]
  });
  const after = store.getMaterial(fab.id).pieces;
  const a2 = after.find(x => x.id === small.id);
  equal(util.round(a2.area, 2), util.round(small.area - 600, 2), '没选方案 → 仍是紧配优先，扣小的那块');
});

test('★ ⑧ 保存被拦时，「去剪裁」那个按钮必须**真的跳**（原来点了没反应）', async () => {
  const { page, fab } = setupTwoPieces();
  page.setData({ name: '测试成品' });
  page.applyMatToBom(fab.id, []);              // 只选了物料、还没裁剪
  // 手动把长宽填上（真机上就是用户在 BOM 那行输入的）—— **填了尺寸但没定方案** ⇒ 保存该被拦
  const bom0 = page.data.bom.slice();
  bom0[0].length = 30; bom0[0].width = 20;
  page.setData({ bom: bom0 });
  const before = stub.navs('navigateTo').length;
  page.save();
  await stub.flush();

  const modal = stub.modals[stub.modals.length - 1];
  ok(modal && modal.title === '请先完成裁剪', '应当弹「请先完成裁剪」，实际 ' + (modal && modal.title));
  equal(modal.confirmText, '去剪裁', '按钮文案');
  ok(String(modal.content).length <= 60, '弹窗文案要短（全站文案从简），实际 ' + String(modal.content).length + ' 字');
  // stub 默认点「确定」→ success 回调必须真的把人送到排版页
  const navs = stub.navs('navigateTo');
  ok(navs.length > before, '点了「去剪裁」必须真的跳转 —— 否则用户看到的是"点了没反应"');
  ok(/cut-picker|cut-editor/.test(navs[navs.length - 1].url),
    '跳到裁剪排版页，实际 ' + navs[navs.length - 1].url);
});

