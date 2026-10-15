// tests/dashboard-commission-card.test.js —— 看板「排单」堆叠卡片
//
// 需求（2026-09-14 用户）：把看板原来的「排单交付倒计时」全宽列表**原位改造**成：
//   标题「排单」（样式与「原料资产」一致）+ 一张**固定高度**的堆叠卡片
//   · 层叠：最多 3 层（1 张完整可见 + 2 层露边，暗示还有更多）
//   · 置顶规则：超期优先 → 否则交付截止最近
//   · 点整卡任意位置 → 排单列表页
//   · 无排单 → 空状态占位，不显示堆叠
//   · 固定高度与「灵感记录 / 想做清单」严格一致（三张卡统一固定高度）
//
// 已与用户确认的三个决策：原位改造 / 统一固定高度 / 3 层错开 8rpx。
//
// TDD：本文件先写，应当全红（calc.topCommission / calc.commissionStackLayers 尚未实现）。

const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;
const calc = require('../utils/calc.js');

// 相对今天 n 天的日期（避免测试依赖具体日期）
const D = (n) => util.addDays(util.today(), n);

// 造一条"已映射好"的排单（页面/看板里那种带 daysLeft 的形态）
function cm(daysLeft, extra) {
  return Object.assign({
    id: 'c' + daysLeft, productName: 'P' + daysLeft, client: '客户',
    deadline: D(daysLeft), daysLeft: daysLeft, qty: 2, deliveredQty: 0, remain: 2
  }, extra || {});
}

// ---------- 纯函数：置顶规则 ----------
group('排单置顶 · calc.topCommission');

test('空列表 / null / undefined → null', () => {
  equal(calc.topCommission([]), null);
  equal(calc.topCommission(null), null);
  equal(calc.topCommission(undefined), null);
});

test('全部未超期 → 取倒计时最小的（截止最近）', () => {
  const top = calc.topCommission([cm(9), cm(2), cm(5)]);
  equal(top.daysLeft, 2);
});

test('★ 有超期 → 超期优先（哪怕未超期的天数更小）', () => {
  const top = calc.topCommission([cm(1), cm(-3), cm(7)]);
  equal(top.daysLeft, -3, '超期必须优先于未超期');
});

test('多条超期 → 取最超期的（天数最小）', () => {
  const top = calc.topCommission([cm(-1), cm(-9), cm(-4)]);
  equal(top.daysLeft, -9);
});

test('只有一条 → 就是它', () => {
  equal(calc.topCommission([cm(3)]).daysLeft, 3);
});

test('没带 daysLeft 字段 → 用 deadline 现算', () => {
  const top = calc.topCommission([{ id: 'a', deadline: D(6) }, { id: 'b', deadline: D(1) }]);
  equal(top.id, 'b');
});

test('★ 截止日无效（算出来是 NaN）→ 排到最后，不许抢置顶位', () => {
  const top = calc.topCommission([{ id: 'bad', deadline: '' }, cm(4)]);
  equal(top.id, 'c4', '无效截止日不能因为 NaN 比较而乱序');
});

test('全部截止日都无效 → 仍返回一条，不返回 null', () => {
  const top = calc.topCommission([{ id: 'x', deadline: '' }, { id: 'y', deadline: '乱写的' }]);
  ok(top, '应有兜底返回');
  ok(top.id === 'x' || top.id === 'y');
});

test('纯函数：不修改传入数组', () => {
  const list = [cm(5), cm(1)];
  const before = list.map((x) => x.id).join(',');
  calc.topCommission(list);
  equal(list.map((x) => x.id).join(','), before, '原数组顺序不能被动');
});

test('契约：daysLeft 与 deadline 同时存在时，以 daysLeft 为准（缓存优先）', () => {
  // 刻意让两者矛盾：缓存说 10 天后，deadline 说 2 天后 → 按 daysLeft 判定
  const top = calc.topCommission([
    { id: 'A', daysLeft: 10, deadline: D(2) },
    { id: 'B', daysLeft: 3, deadline: D(99) }
  ]);
  equal(top.id, 'B', '以 daysLeft 为准（B 的 3 < A 的 10）');
});

// ---------- 纯函数：堆叠层数 ----------
group('排单堆叠 · calc.commissionStackLayers');

test('层数规则：0、1 条不叠；2 条叠 1 层；3 条以上叠 2 层（上限）', () => {
  equal(calc.commissionStackLayers(0), 0);
  equal(calc.commissionStackLayers(1), 0, '只有一条时不叠');
  equal(calc.commissionStackLayers(2), 1);
  equal(calc.commissionStackLayers(3), 2);
  equal(calc.commissionStackLayers(99), 2, '上限 2 层（加顶卡共 3 层）');
});

test('异常输入（负数 / undefined / 字符串）→ 0', () => {
  equal(calc.commissionStackLayers(-1), 0);
  equal(calc.commissionStackLayers(undefined), 0);
  equal(calc.commissionStackLayers(null), 0);
});

// ---------- 纯函数：倒计时文案 ----------
group('排单倒计时文案 · calc.commissionDDLText');

test('未超期 → 「剩 N 天」', () => {
  equal(calc.commissionDDLText(0), '剩 0 天');
  equal(calc.commissionDDLText(5), '剩 5 天');
});

test('超期 → 「超期 N 天」', () => {
  equal(calc.commissionDDLText(-1), '超期 1 天');
  equal(calc.commissionDDLText(-12), '超期 12 天');
});

test('★ 无有效截止日（NaN / undefined / 非数）→ 「未设截止」，绝不出现 NaN 字样', () => {
  equal(calc.commissionDDLText(NaN), '未设截止');
  equal(calc.commissionDDLText(undefined), '未设截止');
  equal(calc.commissionDDLText(null), '未设截止', 'null 会被 Number 成 0，这里明确按无截止处理');
  equal(calc.commissionDDLText('乱写的'), '未设截止');
  ok(calc.commissionDDLText(NaN).indexOf('NaN') < 0);
});

// ---------- 页面级：看板 ----------
group('看板 · 排单卡片数据与跳转');

function setup(list) {
  F.reset();
  const p = F.product({ name: '测试成品' });
  F.seedProducts([p]);
  (list || []).forEach((c) => store.saveCommission(Object.assign({
    productId: p.id, productName: '发夹', client: '小美', qty: 3, categoryId: 'bc_default'
  }, c)));
  const page = loadPage('../pages/dashboard/dashboard.js');
  page.reload();
  return page;
}

test('无排单 → 置顶为 null、总数 0、不叠层（空状态占位）', () => {
  const page = setup([]);
  equal(page.data.cmTop, null, '无数据时不给置顶卡');
  equal(page.data.cmTotal, 0);
  equal(page.data.cmStack, 0, '空状态不显示堆叠');
});

test('1 条排单 → 置顶是它，但不叠层', () => {
  const page = setup([{ deadline: D(5) }]);
  equal(page.data.cmTotal, 1);
  ok(page.data.cmTop, '应有置顶数据');
  equal(page.data.cmTop.daysLeft, 5);
  equal(page.data.cmStack, 0, '只有一条不叠');
});

test('2 条排单 → 叠 1 层；置顶取截止最近的那条', () => {
  const page = setup([{ deadline: D(9) }, { deadline: D(2) }]);
  equal(page.data.cmTotal, 2);
  equal(page.data.cmTop.daysLeft, 2, '置顶应是截止较近的');
  equal(page.data.cmStack, 1);
});

test('★ 5 条排单（含超期）→ 叠 2 层（上限），置顶是超期那条', () => {
  const page = setup([
    { deadline: D(8) }, { deadline: D(3) }, { deadline: D(-4) },
    { deadline: D(1) }, { deadline: D(12) }
  ]);
  equal(page.data.cmTotal, 5);
  equal(page.data.cmStack, 2, '叠满 2 层');
  equal(page.data.cmTop.daysLeft, -4, '超期优先');
  ok(page.data.cmTop.productName, '置顶卡要有名称可显示');
});

test('★ 点击整卡 → 跳转排单列表页', () => {
  const page = setup([{ deadline: D(3) }]);
  const before = stub.toasts.length;
  page.goCommissionList();
  const nav = stub.toasts.slice(before).find((t) => t && t.nav);
  ok(nav, '应发起一次导航');
  equal(nav.url, '/pages/commission/list', '目标必须是排单列表页（此前那页没有任何入口）');
});

test('置顶随数据变化：新增一条更超期的 → 置顶跟着换', () => {
  const page = setup([{ deadline: D(-1) }]);
  equal(page.data.cmTop.daysLeft, -1);

  const p = store.getProducts()[0];
  store.saveCommission({ productId: p.id, productName: '发夹', client: '小美', qty: 1, deadline: D(-6), categoryId: 'bc_default' });
  page.reload();

  equal(page.data.cmTop.daysLeft, -6, '置顶必须实时反映最新数据');
  equal(page.data.cmTotal, 2);
});

test('置顶卡带上展示所需字段（名称 / 客户 / 剩余件数 / 倒计时）', () => {
  const page = setup([{ deadline: D(2), qty: 5 }]);
  // 记一次部分交付（新建排单的已交付必为 0，所以走更新路径改成"交付过 1 件"）
  const c = store.getCommissions()[0];
  c.deliveredQty = 1;
  store.saveCommission(c);
  page.reload();

  const t = page.data.cmTop;
  equal(t.productName, '发夹');
  equal(t.client, '小美');
  equal(t.remain, 4, '余量 = 数量 - 已交付');
  equal(t.daysLeft, 2);
});

test('已交付完成的排单不进卡片（只算进行中的）', () => {
  const page = setup([{ deadline: D(2) }]);
  const c = store.getCommissions()[0];
  c.status = 'done';
  store.saveCommission(c);
  page.reload();
  equal(page.data.cmTotal, 0, 'done 的排单不该出现在看板排单卡里');
  equal(page.data.cmTop, null);
});
