// tests/cut-return-channel.test.js —— 「裁剪结果回传」这条链路的兜底与守卫（V124）
//
// 为什么单开一个文件（用户 2026-10-08 真机反馈的收尾）：
//   用户在成品里增加数量 → 进裁剪页排片 → 点「就这样裁」→ **页面正常关掉、什么都不说、什么都不做**，
//   最后是自己发现成品数量没加上。往回查时发现两件事：
//     ① `cut-editor` 的 `confirm()` 结尾是 `if (ch && ch.emit) { …emit… }` **然后无条件 `wx.navigateBack()`**
//        —— **没有 else**。通道一旦不通，就是"静默退出"：用户排了半天的片被丢掉，且一句提示都没有。
//     ② **这条链路从来没被测过** —— 现有 `cut-editor-*` 测试都是**手工造一个 channel** 直接测裁剪页，
//        「上游注册监听 → 下游回传 → 回调真的执行」这一段没有任何守卫。
//
// 本文件补两件事：
//   A. 通道不通时**必须让人看见**（弹窗说明原因）且**不许把用户排好的片一起丢掉**（不关页面）；
//   B. 把整条链路**真跑一遍**：列表页确认数量 → 上游注册 onChoose → 裁剪页排片 → 点确认 →
//      回调执行 → 成品库存真的加上去。
//
// ⚠️ 注意「5 个入口都必须带 events」那条守卫：不带 events 的入口一进来就会撞上 A 的弹窗
//    （因为回传无处可去），所以它既是防呆，也是 A 的前提。
const fs = require('fs');
const path = require('path');
const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const calc = require('../utils/calc.js');

const CUT = '../pages/cut-editor/cut-editor.js';
const LIST = '../pages/products/list.js';
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');

// 一块 200×150 的面料（第 1 块布），再给一个辅料（拉链）—— 与 produce-stock-guard 同构
function seed() {
  stub.resetStorage();
  store.ensureSeed();
  const fab = store.saveMaterial({ name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(fab.id, 0, { length: 200, width: 150, total: 25 }, '入库');
  const zip = store.saveMaterial({ name: '黑色隐形拉链', materialCategoryId: 'mc_zipper', unit: '个', price: 0.5 });
  store.inbound(zip.id, 40, 0.5, '入库');
  const p = store.saveProduct({
    name: '测试成品 回传链路', productCategoryId: 'pc_other', nature: 'merchandise',
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

// 打开单件模式的裁剪页（一块布、一片），把尺寸填好 → canConfirm 为真
function openSingle(fabId) {
  const cut = loadPage(CUT);
  cut.onLoad({ id: fabId, len: 40, wid: 30 });
  return cut;
}

function modalText() {
  return stub.modals.map((m) => String(m.title || '') + '|' + String(m.content || '')).join(' ');
}
function navCount(kind) { return stub.navs(kind).length; }

// 从 openIdx 之后第一个 `{` 开始，**括号配平**地取出整块，返回 { body, end }
// （body 不含最外层花括号；end = 闭合花括号的下标）
function matchBlock(s, openIdx) {
  const i = s.indexOf('{', openIdx);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (d === 0) return { body: s.slice(i + 1, j), end: j }; }
  }
  return null;
}

group('V124 · 裁剪结果回传：通道不通绝不静默 + 整条链路真的跑一遍');

// ---------------------------------------------------------------
// A. 通道不通 = 回传无门。**绝不能**"页面正常关掉、什么都不说、什么都不做"。
// ---------------------------------------------------------------
test('★ ① 通道不通 ⇒ 必须弹窗说明原因，且**不许把用户排好的片一起丢掉**', () => {
  const s = seed();
  const cut = openSingle(s.fab.id);
  equal(cut.data.canConfirm, true, '前提：一片 40×30 放在 200×150 的布上放得下（不然根本走不到回传那一步）');

  // 不注入 channel，且页面没有 getOpenerEventChannel ⇒ ch 为空（模拟"回传无门"）
  cut.channel = null;
  cut.getOpenerEventChannel = null;
  cut.confirm();

  const t = modalText();
  ok(/没找到接收/.test(t),
    '★ 通道不通必须**明确告诉用户"结果没送回去"** —— 不能像本次 bug 那样页面一关、什么都不说。实际弹窗：' + t);
  equal(navCount('navigateBack'), 0,
    '★ 不关页面：用户排好的片还在，可以重试 —— 静默关掉等于把工作量一起丢掉（本次 bug 的痛点）');
});

test('② 通道通 ⇒ 照旧回传 + 关页面，且**不误报**', () => {
  const s = seed();
  const cut = openSingle(s.fab.id);
  const got = [];
  cut.channel = { emit: (ev, d) => { got.push({ ev: ev, d: d }); } };
  cut.confirm();

  equal(got.length, 1, '通道通就该回传一次（正是这条通道把方案带回成品编辑页）');
  equal(got[0].ev, 'onCutChosen', '单件模式回传的事件名是 onCutChosen');
  ok(got[0].d && got[0].d.schemes && got[0].d.schemes.length === 1, '回传要带这一行的片清单');
  equal(navCount('navigateBack'), 1, '一切正常时照旧关掉裁剪页');
  equal(/没找到接收/.test(modalText()), false, '正常路径不许弹"没找到接收"（否则正常流程也被吓一跳）');
});

// ---------------------------------------------------------------
// B. 跨页链路：上游注册 → 下游回传 → 回调真的执行。
//    老测试都是"手工造 channel 直接测裁剪页"，所以这一段从没被守过 ——
//    而用户本次踩的正是这段（排完片点了确认，成品数量没加上）。
// ---------------------------------------------------------------
test('★★ ③ 整条链路跑一遍：列表页 → 裁剪页排片 → 确认 → **成品库存真的 +2**', async () => {
  const s = seed();
  const page = loadPage(LIST);

  // 上游注册：把真机上交给 wx.navigateTo 的 options 截下来（里面有 events.onChoose）
  const realNav = stub.wx.navigateTo;
  let navOpt = null;
  const passQueue = [];
  stub.wx.navigateTo = (opt) => {
    navOpt = opt;
    const patched = Object.assign({}, opt, {
      success: (res) => {
        // 真机上 res.eventChannel 就是页面之间那条通道：这里接管 emit 以便取回 passQueue
        res.eventChannel.emit = (ev, d) => { passQueue.push({ ev: ev, d: d }); return res.eventChannel; };
        if (opt.success) opt.success(res);
      }
    });
    return realNav(patched);
  };
  try {
    page.setData({ actionProd: s.p, qtyValue: '2', qtyMode: 'produce', usageLines: [] });
    page.confirmQty();
    // ⚠️ navigateTo 的 success 是真机上的**异步回调**，passQueue 是在里面发的 —— 必须等一拍
    await stub.flush();
  } finally {
    stub.wx.navigateTo = realNav;
  }

  ok(navOpt, '上游应当跳到裁剪页');
  ok(navOpt.events && typeof navOpt.events.onChoose === 'function',
    '★ 上游必须**注册回传监听**（events.onChoose）—— 没有它，裁剪页拿到的结果无处可去');
  const pq = passQueue.find((x) => x.ev === 'passQueue');
  ok(pq && pq.d && pq.d.queue && pq.d.queue.length === 2,
    '上游要把"这批要裁哪两片"递进裁剪页（passQueue），实际：' + JSON.stringify(passQueue.map((x) => x.ev)));

  // 下游：真的把裁剪页开起来、把队列喂进去、排好片、点「就这样裁」
  const cut = loadPage(CUT);
  let feed = null;
  cut.channel = {
    on: (ev, fn) => { if (ev === 'passQueue') feed = fn; },
    // 回传**照真机走回上游注册的回调**（而不是测试自己造一个替身）
    emit: (ev, d) => { if (ev === 'onChoose') navOpt.events.onChoose(d); }
  };
  cut.onLoad({ mode: 'queue' });
  feed(pq.d);
  equal(cut.data.parts.length, 2, '做 2 件 ⇒ 这一批要裁 2 片');
  equal(cut.data.canConfirm, true, '自动排片应当排得下（不然确认会被前置闸拦住，测不到回传）');

  cut.confirm();

  // ⚠️ 用**相对量**断言：新建成品默认自带 1 件（记一件"打样"），所以基线不是 0
  const before = store.getProduct(s.p.id).sellableStock;
  equal(before - s.p.sellableStock, 2,
    '★ 这条链路走完，成品库存必须真的 +2 —— 用户本次就是"排完片点了确认，数量没加上"，' +
    '而这段（上游注册 → 下游回传 → 回调执行）此前**没有任何守卫**');
});

test('④ 队列模式的回传事件名是 onChoose（和单件的 onCutChosen 分开）', () => {
  const s = seed();
  const cut = loadPage(CUT);
  const got = [];
  let feed = null;
  cut.channel = {
    on: (ev, fn) => { if (ev === 'passQueue') feed = fn; },
    emit: (ev, d) => { got.push({ ev: ev, d: d }); }
  };
  cut.onLoad({ mode: 'queue' });
  feed({ queue: calc.cutQueueFor(s.p.bom, 2), qty: 2 });
  cut.confirm();

  equal(got.length, 1, '排片模式也要回传');
  equal(got[0].ev, 'onChoose', '排片模式的事件名是 onChoose（生产入口在听这个）');
  ok(got[0].d && got[0].d.chosen, '要带逐件的选择（chosen），不传的话用户选的布会被静默丢掉');
});

// ---------------------------------------------------------------
// C. 源码守卫：挡住"以后有人又把 else 删掉 / 又加一个不带 events 的入口"。
// ---------------------------------------------------------------
test('★ ⑤ 守卫：confirm 的通道分支必须有 else；进裁剪页的入口都必须带 events', () => {
  const src = stripComments(read('pages/cut-editor/cut-editor.js'));
  const iCf = src.indexOf('confirm() {');
  ok(iCf > 0, '找不到 confirm（切片锚点漂了）');
  const body = src.slice(iCf, src.indexOf('wx.navigateBack();', iCf));

  // ⚠️ 不能只搜一个 `} else {` —— confirm 里本来就有 `if (this.queueMode) … else …`（两个回传分支），
  //    那样搜到的根本不是"通道分支的 else"。必须**括号配平地**取到 `if (ch && ch.emit)` 的块，
  //    再看它紧跟着是不是 else。
  const iIf = body.indexOf('if (ch && ch.emit)');
  ok(iIf >= 0, '找不到 `if (ch && ch.emit)`（通道判定没了？）');
  const ifBlk = matchBlock(body, iIf);
  ok(ifBlk, '取 `if (ch && ch.emit)` 的块失败（括号不配平？）');

  // 注入法自检：括号配平器本身要可信（嵌套也要正确）
  const nested = 'if (a) { if (b) { x(); } y(); } else { z(); }';
  const n1 = matchBlock(nested, 0);
  ok(n1 && n1.body.indexOf('y()') >= 0 && n1.body.indexOf('z()') < 0,
    '自检失败：括号配平器把嵌套 if 切错了 —— 后面几条守卫都没有牙');
  ok(/^\s*else\s*\{/.test(nested.slice(n1.end + 1)), '自检失败：配平后没认出 else');

  const tail = body.slice(ifBlk.end + 1);
  const mElse = /^\s*else\s*\{/.exec(tail);
  ok(mElse, '★ 通道不可用时**必须有 else** —— 本次 bug 的根：只有 if，' +
    '通道不通就静默退出（页面照关、什么不说、排好的片一起丢）');

  // 老写法（只有 if、没有 else）必须能被判出来
  const oldWay = 'if (ch && ch.emit) { ch.emit("onChoose", {}); } wx.navigateBack();';
  const oB = matchBlock(oldWay, 0);
  ok(!/^\s*else\s*\{/.test(oldWay.slice(oB.end + 1)),
    '自检失败：老写法（无 else）没被检出 —— 这条守卫没有牙');

  const elseBlk = matchBlock(tail, mElse.index);
  ok(elseBlk, '取 else 块失败');
  ok(/util\.alert|util\.toast/.test(elseBlk.body),
    '★ else 里必须给用户一句话（不许 console 一下就完事）—— 静默失败是本项目反复出现的坑');
  ok(/没找到|重试|没保存|没送/.test(elseBlk.body),
    '★ 那句话要说清"结果没送回去"，用户才知道下一步该干什么');
  ok(!/navigateBack/.test(elseBlk.body),
    '★ else 里不许关页面：用户排好的片要留着让他能重试（否则等于把工作量一起丢掉）');

  // 进裁剪页的入口：漏一个，那个入口一进来就会撞上"回传无门"的弹窗
  const files = ['pages/materials/detail.js', 'pages/products/edit.js',
    'pages/products/instances.js', 'pages/products/list.js'];
  let total = 0;
  files.forEach((f) => {
    const js = read(f);
    let from = 0;
    let n = 0;
    for (;;) {
      const i = js.indexOf('cut-editor/cut-editor', from);
      if (i < 0) break;
      n++;
      const block = js.slice(Math.max(0, i - 700), i + 700);
      ok(/events\s*:/.test(block),
        '★ ' + f + ' 第 ' + n + ' 个进裁剪页的入口没带 events ⇒ 回传无处可去' +
        '（用户排完片点确认，只会得到一个"没找到接收"的弹窗）');
      from = i + 1;
    }
    total += n;
  });
  equal(total, 5, '进裁剪页的入口一共 5 处（物料详情出库 / 成品编辑 ×2 / 成品详情 / 成品列表）' +
    '—— 数量变了就更新这条守卫');
});
