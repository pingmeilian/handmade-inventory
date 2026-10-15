// utils/stat.js —— 看板弹窗统计聚合（零后端、本地存储）
// 按 7 张看板卡片分别输出：总计、分类明细、时间序列、环比涨跌
const store = require('./store.js');
const util = require('./util.js');
const palette = require('./palette.js');
const calc = require('./calc.js');

// 兜底色板：只在拿不到分类（已删除的历史分类）时用，正常情况下走 palette 的「每类一色」，
// 与物料库 / 作品集列表里那个占位块颜色保持同一个来源。
const COLORS = [
  '#C8A98E', '#B8977B', '#A68B6F', '#9C8063',
  '#BFAE98', '#D4BFA8', '#D9CBB5', '#E6DAC5',
  '#C4B49A', '#B0A28A', '#D1C0A8', '#A89078'
];

const LOSS_TYPE_NAMES = {
  consumable: '耗材摊销',
  depreciation: '资产折旧',
  tool: '工具支出'
};

/* ========== 周期工具 ========== */
function monthFirst(dateStr) { return dateStr.slice(0, 7) + '-01'; }
function monthLast(dateStr) {
  const [y, m] = [Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7))];
  const d = new Date(y, m, 0);
  return util.fmtDate(d);
}
function yearFirst(dateStr) { return dateStr.slice(0, 4) + '-01-01'; }
function yearLast(dateStr) { return dateStr.slice(0, 4) + '-12-31'; }
function prevMonthStart(dateStr) {
  const d = new Date(monthFirst(dateStr) + 'T00:00:00');
  d.setMonth(d.getMonth() - 1);
  return monthFirst(util.fmtDate(d));
}
function prevYearStart(dateStr) { return (Number(dateStr.slice(0, 4)) - 1) + '-01-01'; }

function periodRange(period, dateStr) {
  if (period === 'year') return { start: yearFirst(dateStr), end: yearLast(dateStr) };
  return { start: monthFirst(dateStr), end: monthLast(dateStr) };
}
function prevPeriodRange(period, dateStr) {
  if (period === 'year') {
    const y = Number(dateStr.slice(0, 4)) - 1;
    return { start: y + '-01-01', end: y + '-12-31' };
  }
  const prevStart = prevMonthStart(dateStr);
  return { start: prevStart, end: monthLast(prevStart) };
}
function periodLabel(period, dateStr) {
  if (period === 'year') return dateStr.slice(0, 4) + '年';
  return dateStr.slice(0, 7);
}
function dateInRange(d, start, end) { return d >= start && d <= end; }

/* ========== 分类名称解析 ========== */
function matCategoryName(id) {
  const c = store.getListAll('materialCategory').find(x => x.id === id);
  return c ? c.name : '未分类';
}
function prodCategoryName(id) {
  const c = store.getListAll('productCategory').find(x => x.id === id);
  return c ? c.name : '未分类';
}
function businessCategoryName(id) {
  const c = store.getBusinessCategories().find(x => x.id === id);
  return c ? c.name : '综合';
}

/* ========== 通用聚合工具 ========== */
function groupSum(items, keyFn, valFn, nameFn) {
  const map = {};
  items.forEach(it => {
    let k = keyFn(it);
    // 缺品类字段（undefined/空串，多见于「成品品类」功能上线前的老成品）统一归入 'pc_other'，
    // 经 nameFn 显示为「未分类」，保证看板环图/柱状与卡片计数的口径一致（明细相加 === 总计）。
    if (!k) k = 'pc_other';
    const g = map[k] || { key: k, name: nameFn ? nameFn(k) : k, value: 0, prevValue: 0 };
    g.value = util.round(g.value + (valFn(it) || 0), 2);
    map[k] = g;
  });
  return Object.values(map);
}
function groupByName(items, nameFn, valFn) {
  const map = {};
  items.forEach(it => {
    const n = nameFn(it);
    const g = map[n] || { key: n, name: n, value: 0, prevValue: 0 };
    g.value = util.round(g.value + (valFn(it) || 0), 2);
    map[n] = g;
  });
  return Object.values(map);
}
function sortAndMerge(list, total, keepNonPositive) {
  const sorted = list
    .filter(x => keepNonPositive ? x.value !== 0 : x.value > 0)
    .sort((a, b) => b.value - a.value);
  const t = total || sorted.reduce((s, i) => s + i.value, 0);
  // keepNonPositive（净收益这类可能为负的指标）不做「其他」合并：负值合并到一起会失去意义
  if (t <= 0 || keepNonPositive) return sorted;
  const main = [], other = [];
  sorted.forEach((item, idx) => {
    const ratio = item.value / t;
    // 占比 < 3% 且已有至少 4 条主分类时合并为“其他”
    if (ratio < 0.03 && main.length >= 4) other.push(item);
    else main.push(item);
  });
  if (other.length) {
    const ov = other.reduce((s, i) => s + i.value, 0);
    main.push({ key: '_other', name: '其他', value: ov, isOther: true });
  }
  // 重新按金额降序（“其他”不一定在最后）
  return main.sort((a, b) => b.value - a.value);
}
function decorateList(list, total, prevList, colorFn) {
  const prevMap = {};
  (prevList || []).forEach(x => { prevMap[x.key] = x.value; });
  // 分母兜底：总计为 0 或为负（净收益亏损）时退化成「各项正值之和」，
  // 否则整列占比会全部显示 0.00%（净收益为负时就是这个症状）
  let t = Number(total) || 0;
  if (!(t > 0)) t = list.filter(x => x.value > 0).reduce((s, i) => s + i.value, 0);
  return list.map((item, idx) => {
    const pv = prevMap[item.key] || 0;
    const change = util.round(item.value - pv, 2);
    const percent = t > 0 ? util.round(item.value / t, 4) : 0;
    return Object.assign({}, item, {
      color: (colorFn && colorFn(item.key)) || COLORS[idx % COLORS.length],
      percent: percent,
      percentText: util.percent(percent, 2),
      valueText: item.value === Math.floor(item.value) ? String(item.value) : util.money(item.value),
      prevValue: pv,
      change: change,
      changeText: change === 0 ? '0.00' : (change > 0 ? '+' + util.money(change) : util.money(change)),
      trend: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat')
    });
  });
}

/* ========== 物料相关 ========== */
function filterMaterials(categoryId) {
  const list = store.getMaterials();
  return categoryId && categoryId !== 'all' ? list.filter(m => m.categoryId === categoryId) : list;
}
function materialStockValue(m) {
  // 面料按当前库存面积 * 单价；非面料按数量 * 单价
  return util.round((store.stockValue(m) || 0) * (store.unitCost(m) || 0), 2);
}

/* ========== 成品相关 ========== */
function filterProducts(categoryId) {
  const list = store.getProducts();
  return categoryId && categoryId !== 'all' ? list.filter(p => p.categoryId === categoryId) : list;
}
// 累计完工件数：库存 + 已售 + 已出库（「全部成品数」是累计口径，不是当前库存，
// 否则成品一旦全卖光，明细就整列空了 —— 用户反馈"全部成品数为什么没东西"）
function productTotalStock(p) {
  const sold = (p.sales || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const discarded = (p.discards || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
  return util.round((p.sellableStock || 0) + (p.sampleStock || 0) + sold + discarded, 2);
}
// 单位成本口径（Day 2 修正，三级回退）：
//   ① 生产实际成本（与物料扣减流水对齐 —— 生产扣了多少，成本就是多少）
//   ② 最近一次销售的成本快照
//   ③ 实时按 BOM × 当前物料价估算（没生产过、也没卖过的成品也有成本）
function productCost(p) {
  const actual = store.productActualUnitCost ? store.productActualUnitCost(p) : null;
  if (actual != null) return util.round(actual, 2);
  const snap = (p.costSnapshot && p.costSnapshot.totalCost);
  if (snap != null) return snap;
  return util.round((calc.computeProduct(p) || {}).totalCost || 0, 2);
}
// 成本是否为估算值（界面据此标注「按当前物料价估算」）
function productCostIsEstimate(p) {
  const actual = store.productActualUnitCost ? store.productActualUnitCost(p) : null;
  if (actual != null) return false;
  return !((p.costSnapshot && p.costSnapshot.totalCost) != null);
}
function filterSales(products, start, end) {
  const out = [];
  products.forEach(p => {
    (p.sales || []).forEach(s => {
      if (dateInRange(s.date, start, end)) out.push({ product: p, sale: s });
    });
  });
  return out;
}
function saleProfit(s) { return util.round(s.qty * (s.price - ((s.costSnapshot && s.costSnapshot.totalCost) || 0)), 2); }

// 本期各品类的「生产件数」—— 损耗按件数分摊时的分母，与成品详情页那个「每件分摊参考」同源
function producedUnitsByCategory(products, start, end) {
  const map = {};
  (products || []).forEach(p => {
    const units = (p.productions || [])
      .filter(x => x.date >= start && x.date <= end)
      .reduce((s, x) => s + (Number(x.qty) || 0), 0);
    if (units > 0) map[p.productCategoryId] = (map[p.productCategoryId] || 0) + units;
  });
  return map;
}

/* ========== 时间序列（日） ========== */
function dailySeries(start, end, getter) {
  const out = [];
  let d = start, guard = 0;
  while (d <= end && guard < 1000) {
    out.push({ date: d, value: getter(d) });
    d = util.addDays(d, 1);
    guard++;
  }
  return out;
}
function dayKeyLabel(dateStr) { return dateStr.slice(5).replace('-', '/'); }
// 注意：这里**不再做抽稀**。之前有个 compactSeries 每 5 天取一个点，会把「只有某几天有值」的
// 峰值直接丢掉（例：本月只有 9/10 卖出过，抽稀取的是 9/6、9/11… → 曲线上什么起伏都看不到，
// 用户反馈「毛利趋势这里怎么没有图」）。现在把整段序列交给图表层，由 lineLayout 控制圆点密度。

/* ========== 期间损耗聚合（一次遍历拿到分类明细 + 日序列） ==========
   注：store.getDailyLossCost(d) 每天都要扫描全部耗材/资产，年视图下日期数 × 3 遍是明显浪费。
   这里统一成「每期只遍历一次」，分类明细与日序列共用同一份结果。 */
function lossAgg(start, end) {
  let consumable = 0, depreciation = 0, tool = 0;
  const series = [];
  let d = start, guard = 0;
  while (d <= end && guard < 1000) {
    const dl = store.getDailyLossCost(d);
    consumable += dl.consumableAmort;
    depreciation += dl.depreciation;
    tool += dl.toolExpense;
    series.push({ date: d, value: dl.total });
    d = util.addDays(d, 1);
    guard++;
  }
  consumable = util.round(consumable, 2);
  depreciation = util.round(depreciation, 2);
  tool = util.round(tool, 2);
  return {
    consumable: consumable,
    depreciation: depreciation,
    tool: tool,
    // 总计取三类之和：保证「分类明细」逐项相加 = 总计（各分类各自 round 后不会对不上）
    total: util.round(consumable + depreciation + tool, 2),
    series: series
  };
}

/* ========== 公共：生成一份统计结果 ========== */
function buildStat(cardKey, period, dateStr, categoryId) {
  const range = periodRange(period, dateStr);
  const prev = prevPeriodRange(period, dateStr);
  const curLabel = periodLabel(period, dateStr);

  // 当前周期/上一周期 通用时间序列：毛利、损耗、净收益
  const products = filterProducts(categoryId);
  const materials = filterMaterials(categoryId);
  const curSales = filterSales(products, range.start, range.end);
  const prevSales = filterSales(products, prev.start, prev.end);

  // 损耗：本期/上期各只遍历一次，分类明细与日序列共用（原来要遍历三遍）
  const curLoss = lossAgg(range.start, range.end);
  const prevLoss = lossAgg(prev.start, prev.end);
  const curLossSeries = curLoss.series;
  const curLossTotal = curLoss.total;
  const prevLossTotal = prevLoss.total;

  // 分类配色：与物料库 / 作品集列表同源 —— palette 按「分类在列表中的序号」取色，
  // 所以统计弹窗里「面料」的颜色和物料库里「面料」的占位底色是同一个。
  const mcList = store.getList('materialCategory', categoryId);
  const pcList = store.getList('productCategory', categoryId);
  const matColor = (k) => palette.colorOf(mcList, k, 0).bg;
  const pcColor = (k) => palette.colorOf(pcList, k, palette.PRODUCT_OFFSET).bg;

  const configs = {
    material: () => {
      // 视图1：按物料数量；视图2：按库存估值金额
      const list1 = groupSum(materials, m => m.materialCategoryId, () => 1, k => matCategoryName(k));
      const list2 = groupSum(materials, m => m.materialCategoryId, m => materialStockValue(m), k => matCategoryName(k));
      const prev1 = groupSum(filterMaterials(categoryId), m => m.materialCategoryId, () => 1, k => matCategoryName(k));
      const prev2 = groupSum(filterMaterials(categoryId), m => m.materialCategoryId, m => materialStockValue(m), k => matCategoryName(k));
      const total1 = materials.length;
      const total2 = list2.reduce((s, i) => s + i.value, 0);
      return {
        title: '物料种类',
        total: total1,
        totalText: String(total1),
        hasTime: false,   // 物料只有「当前值」，没有时间维度 —— 弹窗里不显示月/年与日期切换
        views: [
          { key: 'qty', label: '按物料数量', type: 'ring' },
          { key: 'value', label: '按库存估值', type: 'ring' }
        ],
        currentView: 'qty',
        listMap: {
          qty: decorateList(sortAndMerge(list1, total1), total1, prev1, matColor),
          value: decorateList(sortAndMerge(list2, total2), total2, prev2, matColor)
        },
        list: decorateList(sortAndMerge(list1, total1), total1, prev1, matColor),
        series: []
      };
    },
    inv: () => {
      // 物料是「当前值」逻辑：只统计当下的库存构成，不产出时间序列
      const list2 = groupSum(materials, m => m.materialCategoryId, m => materialStockValue(m), k => matCategoryName(k));
      const prev2 = groupSum(filterMaterials(categoryId), m => m.materialCategoryId, m => materialStockValue(m), k => matCategoryName(k));
      const total2 = list2.reduce((s, i) => s + i.value, 0);
      return {
        title: '库存估值',
        total: total2,
        totalText: util.money(total2),
        hasTime: false,   // 库存估值同样是「当前值」，不提供时间维度
        views: [
          { key: 'pie', label: '物料金额占比', type: 'ring' }
        ],
        currentView: 'pie',
        listMap: {
          pie: decorateList(sortAndMerge(list2, total2), total2, prev2, matColor)
        },
        list: decorateList(sortAndMerge(list2, total2), total2, prev2, matColor),
        series: []
      };
    },
    product: () => {
      // 全部成品数：成品条数 / 成本金额
      // ⚠️ 环图必须按「成品条数」聚合（valFn 恒为 1），与看板卡片 productCount（prods.length）
      // 和下钻明细列表（store.getProducts().filter 的条数）保持一致。
      // 之前误用了 productTotalStock（累计件数 = 库存+已售+已出库），导致
      // 「卡片 13、点进明细 24」「发饰总览 10、点进去 6」这类 件数≠条数 的口径不一致。
      // 说明：标签原为「按件数」，现改为「按成品数」，意为成品记录数（与卡片、明细同一口径）。
      const list1 = groupSum(products, p => p.productCategoryId, () => 1, k => prodCategoryName(k));
      const list2 = groupSum(products, p => p.productCategoryId, p => productTotalStock(p) * productCost(p), k => prodCategoryName(k));
      const total1 = list1.reduce((s, i) => s + i.value, 0);
      const total2 = list2.reduce((s, i) => s + i.value, 0);
      return {
        title: '全部成品数',
        total: total1,
        totalText: String(total1),
        views: [
          { key: 'qty', label: '按成品数', type: 'ring' },
          { key: 'cost', label: '按成本金额', type: 'ring' }
        ],
        currentView: 'qty',
        listMap: {
          qty: decorateList(sortAndMerge(list1, total1), total1, null, pcColor),
          cost: decorateList(sortAndMerge(list2, total2), total2, null, pcColor)
        },
        list: decorateList(sortAndMerge(list1, total1), total1, null, pcColor),
        series: []
      };
    },
    sold: () => {
      // 已售成品数：销售金额 / 售卖件数
      const list1 = groupSum(curSales, x => x.product.productCategoryId, x => x.sale.qty * x.sale.price, k => prodCategoryName(k));
      const list2 = groupSum(curSales, x => x.product.productCategoryId, x => x.sale.qty, k => prodCategoryName(k));
      const prevList1 = groupSum(prevSales, x => x.product.productCategoryId, x => x.sale.qty * x.sale.price, k => prodCategoryName(k));
      const prevList2 = groupSum(prevSales, x => x.product.productCategoryId, x => x.sale.qty, k => prodCategoryName(k));
      const total1 = list1.reduce((s, i) => s + i.value, 0);
      const total2 = list2.reduce((s, i) => s + i.value, 0);
      return {
        title: '已售成品数',
        total: total1,
        totalText: util.money(total1),
        views: [
          { key: 'sales', label: '销售金额占比', type: 'ring' },
          { key: 'qty', label: '售卖件数', type: 'ring' }
        ],
        currentView: 'sales',
        listMap: {
          sales: decorateList(sortAndMerge(list1, total1), total1, prevList1, pcColor),
          qty: decorateList(sortAndMerge(list2, total2), total2, prevList2, pcColor)
        },
        list: decorateList(sortAndMerge(list1, total1), total1, prevList1, pcColor),
        series: []
      };
    },
    profit: () => {
      // 本月毛利：品类毛利占比 / 毛利时间趋势
      const list1 = groupSum(curSales, x => x.product.productCategoryId, x => saleProfit(x.sale), k => prodCategoryName(k));
      const total1 = list1.reduce((s, i) => s + i.value, 0);
      const prevList1 = groupSum(prevSales, x => x.product.productCategoryId, x => saleProfit(x.sale), k => prodCategoryName(k));
      const profitSeries = dailySeries(range.start, range.end, d =>
        curSales.filter(x => x.sale.date === d).reduce((s, x) => s + saleProfit(x.sale), 0)
      );
      return {
        title: '本月毛利',
        total: total1,
        totalText: util.money(total1),
        views: [
          { key: 'pie', label: '品类毛利占比', type: 'ring' },
          { key: 'line', label: '毛利时间趋势', type: 'line' }
        ],
        currentView: 'pie',
        listMap: {
          pie: decorateList(sortAndMerge(list1, total1), total1, prevList1, pcColor)
        },
        list: decorateList(sortAndMerge(list1, total1), total1, prevList1, pcColor),
        series: profitSeries
      };
    },
    loss: () => {
      // 本月损耗成本：分类占比（耗材/折旧/工具） / 每日损耗柱状
      // 明细与上期对比都取自上面已聚合好的 curLoss / prevLoss，不再重复遍历日期
      const list1 = [
        { key: 'consumable', name: '耗材摊销', value: curLoss.consumable },
        { key: 'depreciation', name: '资产折旧', value: curLoss.depreciation },
        { key: 'tool', name: '工具支出', value: curLoss.tool }
      ];
      const prevList1 = [
        { key: 'consumable', value: prevLoss.consumable },
        { key: 'depreciation', value: prevLoss.depreciation },
        { key: 'tool', value: prevLoss.tool }
      ];
      const total1 = curLossTotal;
      return {
        title: '本月损耗成本',
        total: total1,
        totalText: util.money(total1),
        views: [
          { key: 'pie', label: '损耗分类占比', type: 'ring' },
          { key: 'bar', label: '每日损耗对比', type: 'bar' }
        ],
        currentView: 'pie',
        listMap: {
          pie: decorateList(sortAndMerge(list1, total1), total1, prevList1)
        },
        list: decorateList(sortAndMerge(list1, total1), total1, prevList1),
        series: curLossSeries
      };
    },
    net: () => {
      // 经营净收益：每日净收益折线 / 各品类净收益贡献（用毛利 - 损耗按比例分摊）
      const profitList = groupSum(curSales, x => x.product.productCategoryId, x => saleProfit(x.sale), k => prodCategoryName(k));
      const totalProfit = util.round(profitList.reduce((s, i) => s + i.value, 0), 2);
      const totalLoss = curLossTotal;
      // 分摊口径（沿用 2026-08-02 定的「中方案」，与成品详情的每件分摊同源）：
      // 损耗是**期间费用**，按「本期生产件数」均摊到各品类。
      // 为什么不用毛利占比：件数是客观的资源消耗量，且「做了但没卖出去」的品类同样消耗了工具/耗材，
      // 理应一并承担费用；按毛利占比则会让不赚钱的品类看起来"不花钱"。
      const unitsByPc = producedUnitsByCategory(products, range.start, range.end);
      const totalUnits = Object.keys(unitsByPc).reduce((s, k) => s + unitsByPc[k], 0);
      const netList = [];
      const seen = {};
      // 先列「本期有生产」的品类（可能因只摊了费用而显示负值，这是真实情况，不该藏）
      Object.keys(unitsByPc).forEach(k => {
        const p = profitList.find(x => x.key === k);
        seen[k] = true;
        netList.push({
          key: k,
          name: p ? p.name : prodCategoryName(k),
          value: util.round((p ? p.value : 0) - totalLoss * (unitsByPc[k] / totalUnits), 2)
        });
      });
      // 有毛利但本期没有生产记录的品类（旧数据缺 productions）也要保留，不能凭空消失
      profitList.forEach(p => {
        if (seen[p.key]) return;
        netList.push({ key: p.key, name: p.name, value: p.value });
      });
      // 本月完全没有生产记录 → 损耗摊不出去，单列一条负项，保证「明细相加 = 总计」
      if (!totalUnits && totalLoss > 0) {
        netList.push({ key: '_loss', name: '本期损耗', value: util.round(-totalLoss, 2), isLoss: true });
      }
      const totalNet = util.round(totalProfit - totalLoss, 2);
      const prevProfit = prevSales.reduce((s, x) => s + saleProfit(x.sale), 0);
      const prevNet = util.round(prevProfit - prevLossTotal, 2);
      // 每日净收益序列
      const netSeries = dailySeries(range.start, range.end, d => {
        const profit = curSales.filter(x => x.sale.date === d).reduce((s, x) => s + saleProfit(x.sale), 0);
        const loss = store.getDailyLossCost(d).total;
        return util.round(profit - loss, 2);
      });
      return {
        title: '经营净收益',
        total: totalNet,
        totalText: util.money(totalNet),
        views: [
          { key: 'line', label: '每日净收益走势', type: 'line' },
          { key: 'pie', label: '品类净收益贡献', type: 'ring' }
        ],
        currentView: 'line',
        listMap: {
          pie: decorateList(sortAndMerge(netList, totalNet, true), totalNet, null, pcColor)
        },
        list: decorateList(sortAndMerge(netList, totalNet, true), totalNet, null, pcColor),
        series: netSeries,
        prevTotal: prevNet,
        prevTotalText: util.money(prevNet)
      };
    }
  };

  const builder = configs[cardKey];
  if (!builder) return null;
  const res = builder();
  res.period = period;
  res.curLabel = curLabel;
  res.range = range;
  res.cardKey = cardKey;
  // 默认把 currentView 对应的 list 挂上
  res.list = res.listMap[res.currentView] || res.list;
  // 环形图分母：只统计正值项（负值项画不进环，但仍会出现在分类明细里）
  res.listTotal = (res.list || []).filter(x => x.value > 0).reduce((s, i) => s + i.value, 0);
  return res;
}

/* ========== 累计总账（总计消费 / 总计收入）· 2026-10-10 V131 ==========
   用户要「从最开始直到现在」的两个数字。口径由用户拍板：
     · 收入 = 售出全额 + 排单**只算已交付那一截**（没交付的排在账外）
     · 消费**两个口径都要**：
         A 累计投入（现金）—— 一共掏了多少钱（机器算原值）
         B 累计已耗（成本）—— 到目前真正消耗掉多少（机器算折旧）
   ⚠️ 最容易错的一处：`bm_flows` 里 type==='in' 的不都是采购 ——
      退料（source=cut/commission）、盘盈（stocktake）、一次性校准（calibration）、
      冲销（reversal）都会写 in。所以采购口径**必须**同时看 source==='manual'。
   ⚠️ 第二处：A 与 B 是"买进来"与"用出去"，**必须分开算**（两者相减 ≈ 还在库存里的料），
      混成一个数就同时失去两个口径的意义。 */

// 区间内「损耗成本」的累计（耗材摊销 / 资产折旧 / 工具支出）
//
// ⚠️ 刻意**按整月**累加（复用 consumableAmortForMonth / assetDepreciationForMonth /
//    toolExpenseForMonth 这三个函数）—— 与看板「本月损耗成本」同口径，两处理论上永远对得上。
//    为什么不逐日累加 getDailyLossCost：它每天都会 `round(x, 2)`，再相加会攒出舍入假差 ——
//    实测「月折旧 100 元」逐日累加会变成 100.13（100/31 → 3.23 × 31），凭空多出 1 毛 3。
//    代价：边界月按整月计（当月只过了一半也算一整月），这与项目现有月报口径一致。
//
// ⚠️ V136：`cat`（手作空间）必须**一路透传**到三个 *ForMonth。那三个函数内部走的是
//    `getConsumablesOf()` / `getAssetsOf()` / `getToolsOf()`，**不传参时默认「当前空间」**——
//    只把空间给 `cumulativeTotals` 而不往下传，就会变成"支出按传入空间算、摊销折旧却按
//    当前空间算"这种半拉子隔离（单空间时看不出来，多空间必然对不上）。
function lossBetween(from, to, cat) {
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const yEnd = Number(to.slice(0, 4)), mEnd = Number(to.slice(5, 7));
  let consumableAmort = 0, depreciation = 0, toolExpense = 0, guard = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && guard < 600) {
    consumableAmort += store.consumableAmortForMonth(y, m, cat);
    depreciation += store.assetDepreciationForMonth(y, m, cat);
    toolExpense += store.toolExpenseForMonth(y, m, cat);
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  return {
    consumableAmort: util.round(consumableAmort, 2),
    depreciation: util.round(depreciation, 2),
    toolExpense: util.round(toolExpense, 2)
  };
}

// 记过账的最早日期（决定「至今」的起点）；一条都没有时回退到今天。
//
// ⚠️ V136：**必须按空间收集**（用户 2026-10-10：「只显示当前空间的总账」）。
//    不按空间收集时，"起算日期"会取到**别的空间**的更早记录 ⇒ 页面上出现一段
//    本空间根本没有数据的区间。金额其实没算错（那些记录会被 ok() 滤掉），
//    但用户看到「2025-01-01 起」却一条 2025 的记录都找不到 —— 纯粹的自找困惑。
function earliestLedgerDate(cat) {
  const sp = (x) => (x && x.categoryId) || 'bc_default';
  const ok = (x) => !cat || sp(x) === cat;
  const ds = [];
  const push = (d) => { if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d))) ds.push(String(d)); };
  store.getFlows().filter(ok).forEach((f) => push(f.date));
  store.getProducts().filter(ok).forEach((p) => (p.sales || []).forEach((s) => push(s.date)));
  store.getConsumables().filter(ok).forEach((c) => push(c.inDate));
  store.getAssets().filter(ok).forEach((a) => { push(a.inDate); (a.repairs || []).forEach((r) => push(r.date)); });
  store.getTools().filter(ok).forEach((t) => push(t.inDate));
  store.getOtherExpenses().filter(ok).forEach((o) => push(o.date));
  store.getCommissions().filter(ok).forEach((c) => (c.deliverLogs || []).forEach((l) => push(l.date)));
  if (!ds.length) return util.today();
  return ds.sort()[0];
}

// 累计总账。opts: { from, to, categoryId }（都可不传 ⇒ 自记账第一天至今）
// ⚠️ V136：页面**必须**传 categoryId（= 当前手作空间）—— 用户拍板「只显示当前空间的总账，
//    不同的空间用不同的总账」。不传 = 把所有空间混成一本（老行为，仅供测试对照）。
function cumulativeTotals(opts) {
  opts = opts || {};
  const space = (x) => x.categoryId || 'bc_default';
  const cat = opts.categoryId && opts.categoryId !== 'all' ? opts.categoryId : null;

  const to = opts.to || util.today();
  let from = opts.from || earliestLedgerDate(cat);
  // 上界保护：最多回溯 10 年（B 口径按日循环，不能让它跑几十万次）
  const hardStart = util.addDays(to, -3650);
  if (from < hardStart) from = hardStart;

  const inRange = (d) => {
    if (!d) return true;              // 没有日期 ⇒ 不因筛选而丢（宁可多算，不静默漏）
    return d >= from && d <= to;
  };
  const ok = (x) => !cat || space(x) === cat;
  const r2 = (n) => util.round(n, 2);

  /* ---------- 收入 ---------- */
  let salesSum = 0;
  store.getProducts().filter(ok).forEach((p) => (p.sales || []).forEach((s) => {
    if (!inRange(s.date)) return;
    salesSum += (Number(s.qty) || 0) * (Number(s.price) || 0);
  }));

  let cmSum = 0;
  store.getCommissions().filter(ok).forEach((c) => {
    const price = Number(c.price) || 0;
    const logs = Array.isArray(c.deliverLogs) ? c.deliverLogs : [];
    if ((opts.from || opts.to) && logs.length) {
      // 有交付日志 ⇒ 按日志日期落在区间内的件数
      logs.forEach((l) => { if (inRange(l.date)) cmSum += (Number(l.qty) || 0) * price; });
      return;
    }
    // 老数据无日志，或未指定区间 ⇒ 按累计交付量（★ 没交付就是 0，不许当成"全交"）
    cmSum += (Number(c.deliveredQty) || 0) * price;
  });

  /* ---------- 消费 A（累计投入 / 现金） ---------- */
  let aMaterial = 0;
  store.getFlows().filter(ok).forEach((f) => {
    if (f.type !== 'in' || f.source !== 'manual') return;   // ★ 只认「真采购」
    if (!inRange(f.date)) return;
    aMaterial += Number(f.totalPrice) || 0;
  });

  let aConsumable = 0;
  store.getConsumables().filter(ok).forEach((c) => {
    if (inRange(c.inDate)) aConsumable += Number(c.totalPrice) || 0;
  });

  let aAsset = 0, aRepair = 0;
  store.getAssets().filter(ok).forEach((a) => {
    if (inRange(a.inDate)) aAsset += Number(a.originalValue) || 0;
    (a.repairs || []).forEach((r) => { if (inRange(r.date)) aRepair += Number(r.fee) || 0; });
  });

  let aTool = 0;
  store.getTools().filter(ok).forEach((t) => { if (inRange(t.inDate)) aTool += Number(t.price) || 0; });

  let aOther = 0;
  store.getOtherExpenses().filter(ok).forEach((o) => {
    if (inRange(o.date)) aOther += Number(o.amount) || 0;
  });

  /* ---------- 消费 B（累计已耗 / 成本） ---------- */
  let bMaterial = 0;
  store.getFlows().filter(ok).forEach((f) => {
    if (!inRange(f.date)) return;
    const v = Number(f.totalPrice) || 0;
    if (f.type === 'out') bMaterial += v;
    else if (f.type === 'in' && f.source !== 'manual') bMaterial -= v;   // 退料/盘盈/校准 ⇒ 抵消
  });
  const loss = lossBetween(from, to, cat);

  const spendA = {
    material: r2(aMaterial), consumable: r2(aConsumable), asset: r2(aAsset),
    tool: r2(aTool), repair: r2(aRepair), other: r2(aOther)
  };
  spendA.total = r2(spendA.material + spendA.consumable + spendA.asset + spendA.tool + spendA.repair + spendA.other);

  const spendB = {
    material: r2(bMaterial),
    consumableAmort: loss.consumableAmort,
    depreciation: loss.depreciation,
    toolExpense: loss.toolExpense
  };
  spendB.total = r2(spendB.material + spendB.consumableAmort + spendB.depreciation + spendB.toolExpense);

  const income = { sales: r2(salesSum), commission: r2(cmSum) };
  income.total = r2(income.sales + income.commission);

  return { from, to, spendA, spendB, income };
}

module.exports = {
  buildStat,
  cumulativeTotals,
  COLORS,
  dayKeyLabel,
  productCost,
  productCostIsEstimate
};
