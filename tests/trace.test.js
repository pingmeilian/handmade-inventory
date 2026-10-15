// tests/trace.test.js —— 全链路记录聚合（2026-09-27 D75/D76）
//
// 背景：用户要「我的」页能看销售记录，并问「流水里只有物料吗，有成品吗」。
// 核查结论：系统**只有物料流水**（`FLOWS`）；成品的「进/出」记在**成品对象自己身上**
// （`productions[]` / `sales[]`），没有统一时间轴 —— 所以「物料出入库」页看不到成品。
//
// 本次**不动数据模型**（改模型要迁移、风险大），改用「**展示层聚合**」：
// 把各成品的 productions / sales 汇总成一份可筛选的列表。
// 聚合逻辑抽成**纯函数**放 `services/trace.js` —— 纯函数能自动化测试，
// 页面层不能（项目纪律：页面靠反向规格 + 人工验收兜底）。
//
// 本文件锁住聚合最容易错的几点：
//   ① 时间倒序 —— 各成品的记录混在一起，必须重排（否则列表按成品分组、时间跳跃）
//   ② 日期区间**含端点** —— 与「物料出入库」页口径一致，不能一处含一处不含
//   ③ 买家字段（client）**可空但必须原样带出** —— 老数据没有该字段，不能变成 undefined
//   ④ 空间隔离 —— 不能把别的手作空间的记录混进来
//   ⑤ 脏数据安全 —— 缺字段 / 空数组不能让页面炸

const { test, group, ok, equal } = require('./harness.js');
const trace = require('../services/trace.js');

const PRODUCTS = [
  {
    id: 'p1', name: '雏菊发夹', categoryId: 'bc_default', nature: 'merchandise',
    sales: [
      { id: 's1', qty: 2, price: 45, date: '2026-09-20', client: '小美' },
      { id: 's2', qty: 1, price: 40, date: '2026-09-25' }        // 老数据：没有 client
    ],
    productions: [{ id: 'pp1', qty: 5, cost: 12.5, unitCost: 2.5, date: '2026-09-18' }]
  },
  {
    id: 'p2', name: '猫窝', categoryId: 'bc_default', nature: 'merchandise',
    sales: [{ id: 's3', qty: 1, price: 120, date: '2026-09-26', client: '阿强' }],
    productions: [{ id: 'pp2', qty: 2, cost: 60, unitCost: 30, date: '2026-09-22' }]
  },
  {
    id: 'p3', name: '别的大类的成品', categoryId: 'bc_other',
    sales: [{ id: 's4', qty: 9, price: 9, date: '2026-09-26' }], productions: []
  }
];

group('全链路记录 · 销售 / 生产记录聚合（services/trace.js）');

test('① 销售记录汇总全部成品，并按时间倒序', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default' });
  equal(list.length, 3, 'bc_default 下应有 3 笔销售');
  equal(list[0].date, '2026-09-26', '最新的一笔排最前');
  equal(list[0].productName, '猫窝', '并能带出是哪款成品');
  equal(list[2].date, '2026-09-20', '最旧的一笔排最后');
});

test('② 金额 = 数量 × 单价；买家原样带出，老数据不变成 undefined', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default' });
  const s1 = list.find(x => x.id === 's1');
  const s2 = list.find(x => x.id === 's2');
  equal(s1.amount, 90, '2 × 45 = 90');
  equal(s1.client, '小美');
  equal(s2.client, '', '老数据没有 client → 空串（页面直接显示不会出现 undefined）');
  ok(list.every(x => typeof x.client === 'string'), 'client 恒为字符串');
});

test('③ 空间隔离：不把别的手作空间的销售混进来', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default' });
  ok(list.every(x => x.productId !== 'p3'), 'bc_other 的成品不得出现');
});

test('④ 日期区间含端点（与「物料出入库」页口径一致）', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default', dateStart: '2026-09-20', dateEnd: '2026-09-25' });
  equal(list.length, 2, '含 09-20 与 09-25 两端');
  const onlyEdge = trace.salesLog(PRODUCTS, { categoryId: 'bc_default', dateStart: '2026-09-25', dateEnd: '2026-09-25' });
  equal(onlyEdge.length, 1, '起止同一天时应含当天这笔');
});

test('⑤ 关键词按成品名筛选', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default', kw: '猫' });
  equal(list.length, 1);
  equal(list[0].productName, '猫窝');
});

test('⑥ 生产记录同样聚合（件数 / 批次成本 / 单件成本）', () => {
  const list = trace.productionLog(PRODUCTS, { categoryId: 'bc_default' });
  equal(list.length, 2, 'bc_default 下 2 个生产批次');
  equal(list[0].date, '2026-09-22', '按时间倒序');
  const pp1 = list.find(x => x.id === 'pp1');
  equal(pp1.qty, 5);
  equal(pp1.cost, 12.5, '批次总成本');
  equal(pp1.unitCost, 2.5, '单件成本');
  equal(pp1.productName, '雏菊发夹');
});

test('⑦ 脏数据安全：缺字段 / 空数组 / 传 null 都不炸', () => {
  equal(trace.salesLog([], {}).length, 0, '空成品表');
  equal(trace.salesLog(null, {}).length, 0, '传 null');
  const dirty = [{ id: 'p9', name: '缺字段的成品', categoryId: 'bc_default' }]; // 无 sales/productions
  equal(trace.salesLog(dirty, {}).length, 0, '成品没有 sales 字段');
  equal(trace.productionLog(dirty, {}).length, 0, '成品没有 productions 字段');
  const noDate = [{ id: 'p8', name: '无日期', categoryId: 'bc_default', sales: [{ id: 'sx', qty: 1, price: 5 }] }];
  const l = trace.salesLog(noDate, { dateStart: '2026-01-01' });
  equal(l.length, 0, '没有日期的记录在按区间筛选时被排除（不参与比较，避免 NaN）');
});

group('全链路记录 · 成品出入库（生产 = 入 / 销售 = 出）');

test('⑧ 生产与销售合到一条时间轴上，类型区分正确', () => {
  // 用户 2026-09-27：「数据导出的流水表里加上成品」——
  // 原先只有物料流水，成品的进出只能一条条点进成品看，导不出来。
  const list = trace.productFlowLog(PRODUCTS, { categoryId: 'bc_default' });
  equal(list.length, 5, '3 笔销售 + 2 个生产批次');
  ok(list.every(x => x.kind === 'produce' || x.kind === 'sale'), 'kind 只能是这两种');
  equal(list[0].date, '2026-09-26', '同样按日期倒序');
  const produce = list.find(x => x.id === 'pp1');
  equal(produce.kind, 'produce', '生产批次标记为 produce');
  equal(produce.qty, 5);
  equal(produce.unitPrice, 2.5, '生产的单价 = 单件成本');
  equal(produce.amount, 12.5, '生产的金额 = 该批次扣料总额');
  const sale = list.find(x => x.id === 's1');
  equal(sale.kind, 'sale');
  equal(sale.unitPrice, 45, '销售的单价 = 售价');
  equal(sale.amount, 90, '销售的金额 = 数量 × 单价');
  equal(sale.client, '小美', '销售带买家');
  equal(produce.client, '', '生产没有买家 → 空串，不是 undefined');
});

test('⑨ 成品出入库同样受空间与日期区间约束（含端点）', () => {
  const other = trace.productFlowLog(PRODUCTS, { categoryId: 'bc_other' });
  equal(other.length, 1, 'bc_other 只有 1 笔销售、没有生产');
  const ranged = trace.productFlowLog(PRODUCTS, { categoryId: 'bc_default', dateStart: '2026-09-20', dateEnd: '2026-09-22' });
  equal(ranged.length, 2, '09-20 的销售与 09-22 的生产都含端点');
});

group('V144 · 按日分桶（趋势曲线用，services/trace.js dailySeries）');

test('⑩ dailySeries：只统计窗口内的记录，并按日期落位', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default' });
  const dates = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-25', '2026-09-26'];
  const r = trace.dailySeries(list, dates, 'amount');

  equal(r.points.length, 5, '铺满传入的每一天（含没记录的日子）');
  equal(r.points[0].date, '2026-09-18', '升序：第一条是最早那天');
  equal(r.points[0].value, 0, '09-18 只有生产、没有销售 ⇒ 0（**不许**拿别的日子顶替）');
  equal(r.points.find((p) => p.date === '2026-09-20').value, 90, '09-20：2 × 45 = 90');
  equal(r.points.find((p) => p.date === '2026-09-25').value, 40, '09-25：1 × 40 = 40');
  equal(r.points.find((p) => p.date === '2026-09-26').value, 120, '09-26：猫窝 1 × 120 = 120');
  equal(r.total, 250, '合计 = 90 + 40 + 120');
  equal(r.totalQty, 4, '件数合计 = 2 + 1 + 1');
  equal(r.activeDays, 3, '3 天有销售');
  equal(r.flowCount, 3, '窗口内 3 笔（bc_other 那笔不在空间里）');
  equal(r.peak.date, '2026-09-26', '峰值是最贵那天的 120（不是件数最多那天）');
  equal(r.peak.value, 120);
});

test('⑪ dailySeries：窗口外的记录、没有日期的记录，都不许进图', () => {
  const list = trace.salesLog(PRODUCTS, { categoryId: 'bc_default' });
  // 窗口只留 09-26 一天 ⇒ 其余全部落在窗外
  const r = trace.dailySeries(list, ['2026-09-26'], 'amount');
  equal(r.points.length, 1, '就一天');
  equal(r.points[0].value, 120, '只剩 09-26 那笔');
  equal(r.flowCount, 1, '窗外的不计入笔数');

  // 没有日期的记录：dates 里没有空串这个槽位 ⇒ 自然落不进去
  const noDate = [{ id: 'x', qty: 1, amount: 999, date: '' }];
  equal(trace.dailySeries(noDate, ['2026-09-26'], 'amount').flowCount, 0, '无日期的记录不入桶');
  equal(trace.dailySeries(noDate, ['2026-09-26'], 'amount').total, 0, '也不许把它算进合计');
});

test('⑫ dailySeries：生产用 cost、并用笔数（不是金额）判"有动作的天数"', () => {
  const prod = trace.productionLog(PRODUCTS, { categoryId: 'bc_default' });
  const r = trace.dailySeries(prod, ['2026-09-18', '2026-09-22'], 'cost');
  equal(r.points[0].value, 12.5, '09-18 那批扣料 12.5');
  equal(r.points[1].value, 60, '09-22 那批扣料 60');
  equal(r.totalQty, 7, '件数 = 5 + 2');

  // ⭐ 白送 / 成本为 0 的那天也算"有动作"：否则摘要里"N 天有销售"会跟明细条数打架
  const free = [{ id: 'f1', qty: 1, amount: 0, date: '2026-09-26' }];
  const r2 = trace.dailySeries(free, ['2026-09-26'], 'amount');
  equal(r2.activeDays, 1, '金额 0 但确实有一笔 ⇒ 算"有动作"');
  equal(r2.total, 0, '合计还是 0（不编数）');
  equal(r2.peak, null, '全为 0 时**没有峰值**（不给一个"0 元的峰值"）');
});

test('⑬ dailySeries：脏数据 / 空入参不许炸', () => {
  equal(trace.dailySeries(null, null, 'amount').points.length, 0, '两个都空');
  equal(trace.dailySeries([{ id: 'a', qty: 1, amount: 5, date: '2026-09-26' }], null, 'amount').flowCount, 0, '没有槽位就没有图');
  const dirty = [{ id: 'd', date: '2026-09-26' }, null, undefined];
  const r = trace.dailySeries(dirty, ['2026-09-26'], 'amount');
  equal(r.flowCount, 1, 'null / undefined 记录跳过，剩一条能算');
  equal(r.points[0].value, 0, '缺 amount ⇒ 按 0 计（不编数）');
  equal(r.points[0].count, 1, '但它是"一笔"');
});
