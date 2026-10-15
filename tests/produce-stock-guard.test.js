// tests/produce-stock-guard.test.js —— 生产前的库存总检必须在**进裁剪页之前**说清楚（V123）
//
// 用户 2026-10-08 两连报：
//   ① 「成品增加数量的时候，如果除了布料之外的物料不够，系统不会提醒，点确定进入剪裁布料界面，
//       布料是可以剪裁的，但点完就这样裁之后就结束了，结束之后发现成品数量也没加上」
//   ② 「目前是每次都这样 静不静默是次要的 主要应该在我输入增加数量的时候告诉我，辅料不够」
//
// 只读定位（两处叠加）：
//   A. `store.checkBomStock()` **返回 shortages 数组、不抛错**，但两处页面只 `try/catch`
//      ⇒ 前置校验**形同虚设**（函数不抛、catch 不进）⇒ 页面以为没问题、放用户进裁剪页。
//   B. 真正的拦截在 `produceProduct` 内部（它正确用返回值并 throw），但那已经发生在
//      **裁剪页之后**；而回传回调里的提示 toast 显示在**正在被关闭的裁剪页**上
//      ⇒ 随页面一起消失 ⇒ 用户「没有任何提示，是自己发现数量没加上」。
//
// 本版把"料够不够"这道闸收口到 **进裁剪页之前**，并用 modal **列出缺什么、缺多少**。
const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const util = require('../utils/util.js');

const LIST = '../pages/products/list.js';
const INST = '../pages/products/instances.js';

function navUrls() { return stub.toasts.filter((t) => t.nav).map((t) => t.url || ''); }
function modalText() {
  return stub.modals.map((m) => String(m.title || '') + '|' + String(m.content || '')).join(' ');
}

// 面料够 + 辅料不够（1 个，每件要 2 个）
function seed(zipQty) {
  stub.resetStorage();
  store.ensureSeed();
  const fab = store.saveMaterial({ name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(fab.id, 0, { length: 200, width: 150, total: 25 }, '入库');
  const zip = store.saveMaterial({ name: '黑色隐形拉链', materialCategoryId: 'mc_zipper', unit: '个', price: 0.5 });
  store.inbound(zip.id, zipQty, 0.5, '入库');
  const p = store.saveProduct({
    name: '测试成品 拉链不够', productCategoryId: 'pc_other', nature: 'merchandise',
    bom: [
      { materialId: fab.id, materialName: fab.name, isFabric: true, stockMode: 'piece', unit: '米',
        priceSnapshot: 0, usage: 0, batchUsage: 0, length: 40, width: 30 },
      { materialId: zip.id, materialName: zip.name, isFabric: false, unit: '个',
        priceSnapshot: 0.5, usage: 2 }
    ],
    includeLabor: false, laborMode: 'perPiece', laborFeePerPiece: 0, hourlyRate: 0, laborHours: 0,
    packaging: 0, shipping: 0, targetProfit: 0
  });
  return { fab: store.getMaterial(fab.id), zip: store.getMaterial(zip.id), p: store.getProduct(p.id) };
}

group('V123 · 生产前库存总检（进裁剪页之前就要说清楚）');

test('① 成品列表页：辅料不够 ⇒ 不进裁剪页，且**说清缺什么**', () => {
  // 存量 2：够"保存成品"（按 1 件用量校验），但做 2 件要 4 个 ⇒ 生产时缺 2
  const s = seed(2);
  const page = loadPage(LIST);
  page.setData({ actionProd: s.p, qtyValue: '2', qtyMode: 'produce', usageLines: [] });
  page.confirmQty();

  equal(navUrls().filter(u => u.indexOf('cut-editor') >= 0).length, 0,
    '★ 料不够就不该进裁剪页 —— 用户白排一趟，然后什么都看不见（本次 bug 的现象）');
  const t = modalText();
  ok(t.indexOf('拉链') >= 0, '★ 必须告诉用户缺的是哪个料，实际弹窗：' + t);
  ok(t.indexOf('缺') >= 0, '要说清"缺多少"，实际：' + t);
});

test('② 成品详情页（另一个入口）：同样在进裁剪页之前拦住', () => {
  const s = seed(2);   // 同①：够保存、不够做 2 件
  const page = loadPage(INST);
  page.setData({ id: s.p.id, qtyValue: '2', qtyMode: 'produce', usageLines: [] });
  page.confirmQty();

  equal(navUrls().filter(u => u.indexOf('cut-editor') >= 0).length, 0,
    '★ 两个入口都得拦（V114a 起的老纪律：同源多处必须同步）');
  ok(modalText().indexOf('拉链') >= 0, '也要说清缺什么，实际：' + modalText());
});

test('③ 料够 ⇒ 照旧进裁剪页，且不打扰（不该出现"不够"弹窗）', () => {
  const s = seed(20);                      // 拉链 20 个，做 2 件要 4 个 ⇒ 够
  const page = loadPage(LIST);
  page.setData({ actionProd: s.p, qtyValue: '2', qtyMode: 'produce', usageLines: [] });
  page.confirmQty();

  ok(navUrls().some(u => u.indexOf('cut-editor') >= 0), '料够就该照旧进裁剪页排片');
  equal(modalText().indexOf('缺'), -1, '料够时不该弹"缺料"，实际：' + modalText());
});

test('④ 缺料文案：多条要列全，且空清单不产生文案（注入法自检）', () => {
  const txt = util.shortageMessage([
    { name: '黑色隐形拉链', lack: '3个' },
    { name: '米白纯棉平布', lack: '2 件裁剪空间不足' }
  ]);
  ok(txt.indexOf('拉链') >= 0 && txt.indexOf('平布') >= 0, '多条缺料都要列出来，实际：' + txt);
  equal(util.shortageMessage([]), '', '没有缺料时必须返回空串（否则料够也会弹窗）');
  equal(util.shortageMessage(null), '', '空值也要安全（别让页面崩）');
});

test('⑤ 守卫：两处入口都必须"看返回值"，且库存总检排在进裁剪页之前', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  [['pages/products/list.js', '成品列表页'], ['pages/products/instances.js', '成品详情页']].forEach((row) => {
    const js = read(row[0]);
    ok(js.indexOf('short = store.checkBomStock') >= 0,
      row[1] + ' 必须接住 checkBomStock 的**返回值** —— 只 try/catch 等于没校验（本次 bug 根因之一）');
    ok(js.indexOf('if (short.length)') >= 0, row[1] + ' 缺料时要当场拦住');
    ok(js.indexOf('util.shortageMessage(short)') >= 0, row[1] + ' 缺料提示要说清"缺什么、缺多少"');
    const iShort = js.indexOf('short = store.checkBomStock');
    const iQueue = js.indexOf('cutQueueFor');
    ok(iShort >= 0 && iQueue > iShort,
      row[1] + ' 的库存总检必须排在 cutQueueFor 之前（料不够就别让用户进裁剪页白排一趟）');
  });
  // 注入法自检：老写法（只 try/catch、不接返回值）必须被判得出
  const oldWay = 'try { store.checkBomStock(p, q, ov); } catch (err) { util.toast(err.msg); return; }';
  ok(oldWay.indexOf('short') < 0, '自检失败：老写法里竟然有 short —— 判据没有牙');
});
