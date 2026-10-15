// tests/ledger-space.test.js —— 累计总账「按手作空间隔离」+ 两行下钻到「物料出入库」· 2026-10-10 V136
//
// 用户需求（原话）：
//   「我要总账，只显示当前空间的总账，不同的空间用不同的总账」＋「接物料出入库的入库和出库可以吗」→ 方案**甲**
//
// 两件事必须分开看：
//   ① **空间隔离**：切到另一个空间 ⇒ 换的是**另一本账**（不是"同一个数换个名字"）。
//      之前 `pages/ledger/ledger.js` 调的是 `cumulativeTotals({})` —— **不传空间**，
//      而「我的」页那张卡调的是 `cumulativeTotals({ categoryId: cur })` ⇒ 两个入口本来就是两本账，
//      多空间用户进去一眼就能看出对不上。本文件①⑤条把"必须同一本账"钉死。
//   ② **下钻**：「物料采购 / 用掉的物料」接到现成的「物料出入库」页（`pages/settings/history`）。
//      它**不是 tabBar 页** ⇒ `navTo` 能带参数（tab 页只能 `switchTab`，而 switchTab 不支持参数）。
//
// ⚠️ 守卫⑫盯的是「口径说明」——因为这次下钻的两边**本来就不完全对得上**：
//    总账 A「物料采购」只认 `type='in' && source='manual'`，
//    而「物料出入库」页的「入库」是 `type==='in'` 全部（退料/盘盈/校准/冲销都在里面）；
//    而且页面列的是**数量**（片 / m² / kg），总账那个数是**金额**。
//    用户选的是"甲"（全量 + 一句说明），所以这句说明**不是装饰，是本方案的组成部分** ——
//    少了它，用户点进去就会以为"账算错了"。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const F = require('./fixtures.js');
const wxStub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');

const store = F.store;
const util = F.util;
const stat = require('../utils/stat.js');
const state = require('../services/state.js');
const K = store.KEYS;

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// 固定区间：让"至今"变成可复现的数字（否则折旧/摊销随真实日期漂）
const RANGE = { from: '2026-01-01', to: '2026-01-31' };
const DEFAULT_SPACE = 'bc_default';

// 造第二个手作空间
function secondSpace() { return store.addBusinessCategory('测试第二空间').id; }
// 切空间是有全局副作用的（state 是模块级单例）⇒ 一律 try/finally 复位，别串到下一个用例
function withSpace(id, fn) {
  const back = state.getCurrentSpace();
  state.setCurrentSpace(id);
  try { return fn(); } finally { state.setCurrentSpace(back); }
}

function flow(over) {
  return Object.assign({
    id: util.uid('f'), categoryId: DEFAULT_SPACE, date: '2026-01-10',
    materialId: 'm_x', materialName: 'X', type: 'in', source: 'manual',
    qty: 1, totalPrice: 0
  }, over);
}
function consumable(over) {
  return Object.assign({
    id: util.uid('cs'), categoryId: DEFAULT_SPACE, name: '线', quantity: 10, totalPrice: 100,
    status: 'out', inDate: '2026-01-01', useDate: '2026-01-01', outDate: '2026-01-10'
  }, over);
}

/* ===================== 一、口径：一本空间一本账 ===================== */

group('累计总账 · 按空间隔离（口径）');

test('★ ① 两个空间各算一本账：A 空间的采购不进 B 空间的总账', () => {
  F.reset();
  const sB = secondSpace();
  F.seedFlows([
    flow({ categoryId: DEFAULT_SPACE, totalPrice: 500, date: '2026-01-05' }),
    flow({ categoryId: sB, totalPrice: 300, date: '2026-01-06' })
  ]);

  const a = stat.cumulativeTotals(Object.assign({ categoryId: DEFAULT_SPACE }, RANGE));
  const b = stat.cumulativeTotals(Object.assign({ categoryId: sB }, RANGE));
  equal(a.spendA.material, 500, '默认空间只认自己那 500');
  equal(b.spendA.material, 300, '第二空间只认自己那 300');

  const mixed = stat.cumulativeTotals(RANGE);   // 不传空间 = 混在一起
  equal(mixed.spendA.material, 800, '不传空间时确实是 800 —— 这条用来证明前两个数不是巧合');
  ok(mixed.spendA.material !== a.spendA.material,
    '自检失败：传与不传空间算出了同一个数 ⇒ 这组数据证明不了"隔离"');
});

test('★ ② 收入也必须分空间 —— 不能只有支出分了、收入还混着', () => {
  F.reset();
  const sB = secondSpace();
  F.seedProducts([
    F.product({ name: 'A款', sales: [{ id: 's1', qty: 2, price: 100, date: '2026-01-05' }] }),
    F.product({
      name: 'B款', categoryId: sB,
      sales: [{ id: 's2', qty: 3, price: 200, date: '2026-01-06' }]
    })
  ]);

  const a = stat.cumulativeTotals(Object.assign({ categoryId: DEFAULT_SPACE }, RANGE));
  const b = stat.cumulativeTotals(Object.assign({ categoryId: sB }, RANGE));
  equal(a.income.sales, 200, '默认空间收入 = 2×100');
  equal(b.income.sales, 600, '第二空间收入 = 3×200');

  ok(a.income.sales !== b.income.sales, '自检失败：两个空间的收入一样 ⇒ 证明不了收入也隔离了');
});

test('★ ③ 损耗口径（摊销 / 工具支出）按**传入的空间**算，不许偷看「当前空间」', () => {
  F.reset();
  const sB = secondSpace();
  // 数据全在默认空间；而"当前空间"故意设成 B
  store.set(K.CONSUMABLES, [consumable({ categoryId: DEFAULT_SPACE })]);
  store.saveTool({ categoryId: DEFAULT_SPACE, name: '剪刀', price: 300, inDate: '2026-01-15' });
  store.saveTool({ categoryId: sB, name: 'B空间的刀', price: 900, inDate: '2026-01-16' });

  withSpace(sB, () => {
    const a = stat.cumulativeTotals(Object.assign({ categoryId: DEFAULT_SPACE }, RANGE));
    equal(a.spendB.consumableAmort, 100, 'A 空间的耗材 100 元 10 天用完 ⇒ 全摊');
    equal(a.spendB.toolExpense, 300, '★ 当前空间是 B，但算的必须是 A 的工具支出 —— ' +
      '若实现里偷看当前空间，这里会变 900');
  });

  const b = stat.cumulativeTotals(Object.assign({ categoryId: sB }, RANGE));
  equal(b.spendB.toolExpense, 900, 'B 空间只算自己那把刀');
  equal(b.spendB.consumableAmort, 0, 'B 空间没有耗材 ⇒ 0');
});

test('★ ④ 「起算日期」也按空间 —— 不许拿别的空间的更早日期来充数', () => {
  F.reset();
  const sB = secondSpace();
  F.seedFlows([
    flow({ categoryId: DEFAULT_SPACE, totalPrice: 1, date: '2026-01-05' }),
    flow({ categoryId: sB, totalPrice: 1, date: '2026-03-10' })
  ]);

  const a = stat.cumulativeTotals({ categoryId: DEFAULT_SPACE, to: '2026-12-31' });
  const b = stat.cumulativeTotals({ categoryId: sB, to: '2026-12-31' });
  equal(a.from, '2026-01-05', '默认空间第一笔是 01-05');
  equal(b.from, '2026-03-10',
    '★ 第二空间第一笔是 03-10 —— 若起算日期不按空间收集，这里会显示 01-05（用户会看到一段根本没有的数据区间）');
});

/* ===================== 二、页面：两个入口必须是同一本账 ===================== */

group('累计总账 · 页面必须与「我的」页用同一本账');

test('★ ⑤ 明细页要按当前空间取数 —— 且与「我的」页口径一致', () => {
  const ledgerJs = stripJs(read('pages/ledger/ledger.js'));
  ok(/cumulativeTotals\(\{[\s\S]{0,80}?categoryId/.test(ledgerJs),
    '★ ledger.js 调 cumulativeTotals 必须带 categoryId —— 否则是"全空间混算"，和「我的」页那张卡对不上');
  ok(/getCurrentSpace/.test(ledgerJs), '★ 而且取的是当前手作空间（state.getCurrentSpace）');

  const mineJs = stripJs(read('pages/mine/mine.js'));
  ok(/cumulativeTotals\(\{\s*categoryId/.test(mineJs), 'mine.js 同样是按当前空间取数（本次未改它，作为对照基线）');

  // 注入自检：旧的"不传空间"写法必须能被判出来
  const oldWay = 'const t = stat.cumulativeTotals({});';
  ok(!/categoryId/.test(oldWay), '自检失败：不传空间的旧写法没被检出 —— 这条守卫没有牙');
});

test('★ ⑥ 切到另一个空间后，明细页的数字跟着换一本账', () => {
  F.reset();
  const sB = secondSpace();
  F.seedFlows([
    flow({ categoryId: DEFAULT_SPACE, totalPrice: 500, date: '2026-01-05' }),
    flow({ categoryId: sB, totalPrice: 300, date: '2026-01-06' })
  ]);

  const page = loadPage('../pages/ledger/ledger.js');
  withSpace(DEFAULT_SPACE, () => {
    page.reload();
    equal(page.data.rowsA[0].valueText, util.money(500), '默认空间：物料采购 500');
  });
  ok(!!page.data.spaceName, '★ 页面上要有"当前空间名"，否则切了空间用户看不出换了账');

  withSpace(sB, () => {
    page.reload();
    equal(page.data.rowsA[0].valueText, util.money(300), '第二空间：同一行应该是 300（换了本账）');
  });
});

/* ===================== 三、下钻：两行 → 物料出入库 ===================== */

group('累计总账 · 两行下钻到「物料出入库」（方案甲）');

test('★ ⑦ A「物料采购」→ 入库、B「用掉的物料」→ 出库，并带上总账的起止日期', () => {
  F.reset();
  const page = loadPage('../pages/ledger/ledger.js');
  page.reload();

  const a0 = page.data.rowsA[0], b0 = page.data.rowsB[0];
  equal(a0.label, '物料采购');
  equal(b0.label, '用掉的物料');
  equal(a0.to, 'hist:in', '★ A 第 1 行要指向「入库」（`to` 存在，模板才会给它 row-link 变成可点）');
  equal(b0.to, 'hist:out', '★ B 第 1 行要指向「出库」');

  const before = wxStub.navs('navigateTo').length;
  page.openRow({ currentTarget: { dataset: { to: a0.to } } });
  const nav = wxStub.navs('navigateTo')[before];
  ok(!!nav, '★ 点了应该有跳转（这就是用户上一次问的"为什么点不了"）');
  ok(nav.url.indexOf('/pages/settings/history') === 0, '应跳到「物料出入库」页，实际：' + nav.url);
  ok(/[?&]type=in\b/.test(nav.url), '★ 必须带 type=in，否则进去还是"全部"：' + nav.url);
  ok(nav.url.indexOf('start=' + page.data.from) > 0,
    '★ 必须带上总账的起算日期（' + page.data.from + '），否则用户看到的是另一段区间：' + nav.url);
  ok(nav.url.indexOf('end=' + page.data.to) > 0, '★ 必须带上总账的截止日期');
  ok(/[?&]src=ledger\b/.test(nav.url), '★ 带上来源标记 —— 页面靠它决定要不要显示口径说明');
});

test('★ ⑧ 原有的"损耗页下钻"不能被改坏（本次改了分派方式）', () => {
  F.reset();
  const page = loadPage('../pages/ledger/ledger.js');
  page.reload();

  const before = wxStub.navs('navigateTo').length;
  page.openRow({ currentTarget: { dataset: { to: page.data.rowsA[1].to } } });
  equal(wxStub.navs('navigateTo')[before].url, '/pages/loss/index?seg=consumable',
    '★ 无前缀的 to 仍然是"损耗页分段"（历史写法）');

  // 占位行 / 没有 to 的行：点了必须毫无反应，绝不能跳错页
  const before2 = wxStub.navs('navigateTo').length;
  page.openRow({ currentTarget: { dataset: {} } });
  equal(wxStub.navs('navigateTo').length, before2, '★ 没有 to 的行点了必须毫无反应');
});

test('★ ⑨ 「物料出入库」页能接住总账带来的 type / 起止日期', () => {
  const page = loadPage('../pages/settings/history.js');
  ok(typeof page.onLoad === 'function',
    '★ 该页原本只有 onShow、没有 onLoad ⇒ 参数根本进不去（这是本次唯一的"缺口"）');
  page.onLoad({ type: 'in', start: '2026-01-01', end: '2026-01-31', src: 'ledger' });
  equal(page.data.typeFilter, 'in', 'type=in ⇒ 落在「入库」这一档');
  equal(page.data.dateStart, '2026-01-01');
  equal(page.data.dateEnd, '2026-01-31');
  equal(page.data.fromLedger, true, '来自总账 ⇒ 要显示口径说明');
});

test('⑩ 参数非法时一律忽略（别把页面带进坏状态），不带参数 = 现在的默认行为', () => {
  const bad = loadPage('../pages/settings/history.js');
  bad.onLoad({ type: 'oops', start: 'x', end: '9999', src: 'somewhere' });
  equal(bad.data.typeFilter, 'all', '非法的 type 不许写进去');
  equal(bad.data.dateStart, '', '非法的日期不许写进去');
  equal(bad.data.dateEnd, '', '非法的日期不许写进去');
  equal(bad.data.fromLedger, false, '不是从总账来的 ⇒ 不显示说明（不打扰常规使用）');

  const none = loadPage('../pages/settings/history.js');
  none.onLoad();
  equal(none.data.typeFilter, 'all', '不带参数 ⇒ 默认「全部」（与改动前一致）');
  equal(none.data.fromLedger, false);
});

test('★ ⑪ 落点前提：物料出入库必须**不是 tabBar 页**（是的话带参数就废了）', () => {
  const app = JSON.parse(read('app.json'));
  const tabs = ((app.tabBar && app.tabBar.list) || []).map((x) => x.pagePath);
  ok(tabs.indexOf('pages/settings/history') < 0,
    '★ 一旦它被挪进 tabBar，就只能 switchTab、而 switchTab 不支持参数 —— ' +
    '那"跳过去只看入库"就实现不了（这正是物料库页当初接不上的原因）');
  ok(app.pages.indexOf('pages/settings/history') >= 0, '它必须仍是一个普通页面');
});

/* ===================== 四、口径说明（方案甲的组成部分） ===================== */

group('累计总账 · 下钻落点的口径说明');

test('★★ ⑫ 口径说明必须"只在从总账进来时"出现，且把两处差异讲明白', () => {
  const w = stripWxml(read('pages/settings/history.wxml'));
  ok(/wx:if="\{\{fromLedger\}\}"/.test(w),
    '★ 说明块必须挂在 fromLedger 上 —— 常驻会打扰正常来查流水的人');

  const i = w.indexOf('{{fromLedger}}');
  const note = w.slice(i, i + 400);
  ok(/(退料|盘盈)/.test(note),
    '★ 必须点名"退料 / 盘盈"这类非采购入库 —— 否则用户不知道为什么会比总账多出记录');
  ok(/(数量|金额)/.test(note),
    '★ 必须说明"这里看的是数量、总账看的是金额" —— 这是两边对不上的第二个原因');

  // 注入自检：常驻（不挂 fromLedger）的写法必须能被判出来
  const always = '<view class="note">本页含退料</view>';
  ok(!/wx:if="\{\{fromLedger\}\}"/.test(always), '自检失败：常驻写法没被检出 —— 这条守卫没有牙');
});

test('⑬ 明细页要标出"这是哪个空间的账"（切了空间才看得出换了本账）', () => {
  const w = stripWxml(read('pages/ledger/ledger.wxml'));
  ok(/spaceName/.test(w), '★ 标题区应显示当前空间名');
  const js = stripJs(read('pages/ledger/ledger.js'));
  ok(/getBusinessCategories/.test(js), '空间名要真的从空间列表里取（不能写死）');
});

test('⑭ 空间名取不到时不许显示 undefined / null', () => {
  F.reset();
  const page = loadPage('../pages/ledger/ledger.js');
  // 把空间列表清空 ⇒ 查不到名字（老数据 / 异常情形）
  store.set(K.BUSINESS_CATEGORIES, []);
  withSpace(DEFAULT_SPACE, () => { page.reload(); });
  const n = page.data.spaceName;
  ok(n !== 'undefined' && n !== 'null' && typeof n === 'string',
    '空间名取不到时应当是空串（页面据此整块不显示），实际：' + JSON.stringify(n));
});
