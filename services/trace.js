// services/trace.js —— 全链路记录聚合（销售 / 生产），纯函数、零依赖、零副作用
//
// 为什么单独抽一层：成品的「进 / 出」记在**成品对象自己身上**
// （`p.productions[]` 生产批次 / `p.sales[]` 销售记录），系统里**没有成品流水表** ——
// 所以「物料出入库」页只看得到物料。要在页面上跨成品汇总，逻辑就落在本文件。
//
// ⭐ 放纯函数的原因：页面层无法自动化测试（项目既有约束），
//    聚合逻辑抽出来就能被 `tests/trace.test.js` 直接覆盖（含日期边界、脏数据）。
//
// 三个口径上的约定（与「物料出入库」页保持一致，别再各写各的）：
//   · 日期区间**含端点**
//   · 无日期的记录在**按区间筛选时被排除**（且不得参与比较，避免 NaN 把顺序打乱）
//   · 排序按日期倒序，同一天用 id 兜底 ⇒ 顺序稳定、测试可复现

const round = (v, n) => {
  const f = Math.pow(10, n);
  return Math.round((Number(v) || 0) * f) / f;
};

const dateOf = (r) => (r && r.date) || '';

// 通用筛选：手作空间（空间）/ 日期区间 / 关键词（按成品名）
function matches(rec, product, opts) {
  const o = opts || {};
  if (o.categoryId && (product.categoryId || 'bc_default') !== o.categoryId) return false;
  const d = dateOf(rec);
  if (o.dateStart && (!d || d < o.dateStart)) return false;
  if (o.dateEnd && (!d || d > o.dateEnd)) return false;
  const kw = (o.kw || '').trim();
  if (kw && (product.name || '').indexOf(kw) < 0) return false;
  return true;
}

// 日期倒序；同一天按 id 倒序兜底（稳定排序，保证测试与界面顺序可复现）
function sortDesc(list) {
  return list.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * 销售记录聚合（跨成品）
 * @param {Array} products store.getProducts() 的结果
 * @param {Object} opts { categoryId, dateStart, dateEnd, kw }
 * @returns {Array} [{ id, productId, productName, date, qty, price, amount, client }]
 *   ⚠️ client 恒为字符串（老数据没有该字段 → 空串），页面可直接显示而不会出现 undefined
 */
function salesLog(products, opts) {
  const out = [];
  (products || []).forEach((p) => {
    if (!p) return;
    (p.sales || []).forEach((s) => {
      if (!s || !matches(s, p, opts)) return;
      const qty = Number(s.qty) || 0;
      const price = Number(s.price) || 0;
      out.push({
        id: s.id,
        productId: p.id,
        productName: p.name || '',
        date: dateOf(s),
        qty: round(qty, 2),
        price: round(price, 2),
        amount: round(qty * price, 2),
        client: typeof s.client === 'string' ? s.client : ''
      });
    });
  });
  return sortDesc(out);
}

/**
 * 生产记录聚合（跨成品）
 * @returns {Array} [{ id, productId, productName, date, qty, cost, unitCost }]
 */
function productionLog(products, opts) {
  const out = [];
  (products || []).forEach((p) => {
    if (!p) return;
    (p.productions || []).forEach((pr) => {
      if (!pr || !matches(pr, p, opts)) return;
      out.push({
        id: pr.id,
        productId: p.id,
        productName: p.name || '',
        date: dateOf(pr),
        qty: round(pr.qty, 2),
        cost: round(pr.cost, 2),
        unitCost: round(pr.unitCost, 6)
      });
    });
  });
  return sortDesc(out);
}

/**
 * 成品出入库（生产 = 入 / 销售 = 出）—— 合成一条时间轴
 *
 * ⭐ 为什么要有它：物料有流水表（`FLOWS`），**成品没有** —— 成品的进出挂在成品对象上，
 * 于是导数据时「看不到成品动过什么」，页面上也只能一款一款点进去看。
 * 本函数把两者合成统一形状，供「成品出入库」导出与页面使用。
 *
 * @returns {Array} [{ id, productId, productName, date, kind, qty, unitPrice, amount, unitCost, profit, client }]
 *   · kind：'produce'（入）| 'sale'（出）
 *   · unitPrice：生产 = 单件成本；销售 = 售价（口径不同，但都是「每件多少钱」）
 *   · amount：生产 = 该批次扣料总额；销售 = 数量 × 售价
 *   · unitCost / profit（2026-09-27 V72 新增）：**只有销售有**，生产恒为 null
 *     —— 生产只是"做出来"，还没有利润可言；填 0 会被误读成"这批白干"
 *   · 老数据的销售记录没有 costSnapshot ⇒ unitCost/profit 也是 null（**不能拿售价当利润**)。
 *     宁可留空，也不算一个错的数出来 —— 导出会被当账用
 *   · client：只有销售有；生产恒为空串（保证导出列里不出现 undefined）
 */
function productFlowLog(products, opts) {
  const out = [];
  (products || []).forEach((p) => {
    if (!p) return;
    (p.productions || []).forEach((pr) => {
      if (!pr || !matches(pr, p, opts)) return;
      out.push({
        id: pr.id,
        productId: p.id,
        productName: p.name || '',
        date: dateOf(pr),
        kind: 'produce',
        qty: round(pr.qty, 2),
        unitPrice: round(pr.unitCost, 6),
        amount: round(pr.cost, 2),
        unitCost: null,
        profit: null,
        client: ''
      });
    });
    (p.sales || []).forEach((s) => {
      if (!s || !matches(s, p, opts)) return;
      const qty = Number(s.qty) || 0;
      const price = Number(s.price) || 0;
      // 成本取「卖出当时锁定的单件成本」（costSnapshot.totalCost 的既有语义就是单件成本）；
      // 没有快照（老数据 / 手工造的记录）就不要硬算 —— 见上方注释
      const snap = s.costSnapshot || {};
      const hasCost = typeof snap.totalCost === 'number' && isFinite(snap.totalCost);
      const unitCost = hasCost ? round(snap.totalCost, 2) : null;
      out.push({
        id: s.id,
        productId: p.id,
        productName: p.name || '',
        date: dateOf(s),
        kind: 'sale',
        qty: round(qty, 2),
        unitPrice: round(price, 2),
        amount: round(qty * price, 2),
        unitCost: unitCost,
        // 利润 = 数量 × (售价 − 单件成本)；样品/作品集按售价锁定成本 ⇒ 利润恒为 0（与 stat 口径一致）
        profit: hasCost ? round(qty * (price - unitCost), 2) : null,
        client: typeof s.client === 'string' ? s.client : ''
      });
    });
  });
  return sortDesc(out);
}

/**
 * 汇总：笔数 / 数量 / 金额
 * @param {Array} list salesLog / productionLog 的结果
 * @param {String} amountKey 金额字段名（销售用 'amount'，生产用 'cost'）
 */
function summarize(list, amountKey) {
  const key = amountKey || 'amount';
  let qty = 0;
  let amount = 0;
  (list || []).forEach((x) => {
    qty += Number(x.qty) || 0;
    amount += Number(x[key]) || 0;
  });
  return { count: (list || []).length, qty: round(qty, 2), amount: round(amount, 2) };
}

/**
 * 按日分桶（供**趋势曲线**用）—— 2026-10-12（V144）「成品出入库」页加曲线时新增
 *
 * 与 salesLog / productionLog 的分工：
 *   · 那两个负责「筛出记录、按时间倒序」—— 明细列表用；
 *   · 本函数负责「把记录塞进一根根日期柱子里」—— 图表用。
 *
 * ⚠️ 为什么"近 N 天"由调用方给：本文件是**零依赖**的（不许 require util），
 *    而"30 天前是几号"需要日期加减 ⇒ 调用方把 `dates`（升序）准备好传进来。
 *    好处：分桶逻辑完全可测（测试直接给日期数组，不受"今天是几号"影响）。
 * ⚠️ 落在 `dates` 之外的记录**直接丢掉**（含没有日期的）—— 曲线固定看一个窗口，
 *    窗口外的记录不该在图上出现。
 * ⚠️ `activeDays` 按**笔数**算、不按金额 —— 白送 / 成本为 0 的那天也算"有动作"，
 *    否则摘要里的"N 天有销售"会跟明细列表的条数对不上（同一个页面两个数互相矛盾）。
 *
 * @param {Array} list      salesLog / productionLog 的结果
 * @param {Array} dates     要铺满的日期（升序，YYYY-MM-DD）
 * @param {String} amountKey 'amount'（销售）| 'cost'（生产）
 * @returns {Object} { points:[{date,value,qty,count}], total, totalQty, activeDays, flowCount, peak }
 *   · value = 当天金额合计（销售=销售额、生产=扣料成本）
 *   · qty   = 当天件数合计；count = 当天笔数（曲线读数里要显示"几笔"）
 *   · peak  = 金额最大的那天（全为 0 时为 null —— 别给个"0 元的峰值"）
 */
function dailySeries(list, dates, amountKey) {
  const key = amountKey || 'amount';
  const days = (dates || []).slice();
  // 用无原型对象当索引：`{}` 会继承 Object.prototype —— 万一某个键取成 'constructor' 之类
  // 就会命中继承来的成员。日期都是 YYYY-MM-DD，碰不到，但别留这种缝。
  const at = Object.create(null);
  days.forEach((d, i) => { at[d] = i; });

  const buckets = days.map((d) => ({ date: d, value: 0, qty: 0, count: 0 }));
  let flowCount = 0;
  (list || []).forEach((r) => {
    if (!r) return;
    const i = at[dateOf(r)];
    if (i === undefined) return;              // 窗口外 / 没有日期
    buckets[i].value += Number(r[key]) || 0;
    buckets[i].qty += Number(r.qty) || 0;
    buckets[i].count += 1;
    flowCount++;
  });

  const points = buckets.map((b) => ({
    date: b.date, value: round(b.value, 2), qty: round(b.qty, 2), count: b.count
  }));

  let total = 0, totalQty = 0, activeDays = 0, peak = null;
  points.forEach((p) => {
    total += p.value;
    totalQty += p.qty;
    if (p.count > 0) activeDays++;
    if (p.value > 0 && (!peak || p.value > peak.value)) peak = p;
  });

  return {
    points: points,
    total: round(total, 2),
    totalQty: round(totalQty, 2),
    activeDays: activeDays,
    flowCount: flowCount,
    peak: peak
  };
}

module.exports = { salesLog, productionLog, productFlowLog, summarize, dailySeries };
