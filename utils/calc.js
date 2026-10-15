// utils/calc.js —— 业务计算引擎（纯函数，零网络）
const store = require('./store.js');
const util = require('./util.js');

// 单个 BOM 行成本（含面料面积折算）
// 方案 A（2026-07-31）：成品成本统一使用「实时当前物料加权平均单价」（store.unitCost），
// 与生产扣料 consumeBom 的口径完全一致——非面料按 元/单位、面料按 元/cm² 计，
// 保证「生产扣料减少的库存价值」与「成品核算的成本」一一对应，账目对得上。
// （不再使用建单时锁定的 priceSnapshot / b.cost，避免均价变动后账不平。）
function bomLineCost(b, material) {
  if (!material) return { cost: 0, needWidth: false };
  const unit = store.unitCost(material); // 当前加权平均单价：非面料 元/单位，面料 元/cm²
  // BOM 行手动「面料」开关优先级最高：即使用户物料分类的 isFabric 标记缺失，也按面料面积计价
  const fabric = b.isFabric || store.isMaterialFabric(material);
  if (fabric) {
    // 按批估量（刀口布）：成本 = 每件用量(kg/片) × 当前单价，与 consumeBom / saveProduct 扣料口径一致
    if (material.stockMode === 'batch') {
      return { cost: util.round((b.batchUsage || 0) * unit, 2), needWidth: false };
    }
    return { cost: util.round((b.area || 0) * unit, 2), needWidth: false };
  }
  return { cost: util.round((b.usage || 0) * unit, 2), needWidth: false };
}

// 成品成本核算（成本/利润模型：售价 = 物料 + 人工 + 包装 + 运费；利润 = 人工）
// - 售价：正向自动计算，不由用户手动输入
// - 利润：即人工，是制作者的纯利润
// - 总成本（硬成本）：物料 + 包装 + 运费，不含人工
// - 利润率：利润 ÷ 售价
function computeProduct(p) {
  const materials = store.getMaterials();
  let materialCost = 0;
  let needWidth = false;
  (p.bom || []).forEach(b => {
    const m = materials.find(x => x.id === b.materialId);
    const r = bomLineCost(b, m);
    materialCost = util.round(materialCost + r.cost, 2);
    if (r.needWidth) needWidth = true;
  });
  let laborCost = 0;
  if (p.includeLabor) {
    if (p.laborMode === 'perPiece') laborCost = util.round(p.laborFeePerPiece || 0, 2);
    else laborCost = util.round((p.hourlyRate || 0) * (p.laborHours || 0), 2);
  }
  const packaging = p.nature === 'merchandise' ? (p.packaging || 0) : 0;
  const shipping = p.nature === 'merchandise' ? (p.shipping || 0) : 0;
  // 售价 = 物料 + 人工 + 包装 + 运费（正向自动算）
  const price = util.round(materialCost + laborCost + packaging + shipping, 2);
  // 总成本（硬成本，不含人工）= 物料 + 包装 + 运费
  const totalCost = util.round(materialCost + packaging + shipping, 2);
  // 利润 = 人工（纯利润）
  const profit = laborCost;
  const profitRate = price > 0 ? util.round(profit / price, 4) : null;
  const targetProfit = p.targetProfit || 0;
  const targetAchieved = (profitRate != null) ? (profitRate >= targetProfit) : false;
  return {
    materialCost, laborCost, packaging, shipping, totalCost, price, profit, profitRate, targetProfit, targetAchieved, needWidth
  };
}

// 排单剩余天数（A.8）
function commissionDaysLeft(deadline) {
  return util.diffDays(util.today(), deadline);
}
function commissionDDLStatus(deadline) {
  const d = commissionDaysLeft(deadline);
  if (d < 0) return 'over';
  if (d <= 3) return 'warn';
  return 'normal';
}

/* ===================== 排单「置顶」与堆叠（看板排单卡片的单一判定） =====================
 *
 * 为什么收口成函数：看板卡片要按「超期优先 → 否则截止最近」挑出置顶的一条。
 * 这个规则若散在页面里手写，会踩一个隐蔽的坑 —— `diffDays` 对无效日期返回 **NaN**，
 * 而 NaN 参与任何比较都是 false，于是"谁更紧急"直接失效、顺序变成随机的。
 */

// 取一条排单的"优先天数"（越小越紧急）。取值优先级，契约写清楚免得后人猜：
//   ① 先用现成的 `daysLeft`（调用方可能已经算好，避免重复计算）
//   ② 没有或不是有效数字时，才用 `deadline` 现算
//   ③ 两条路都拿不到有效天数 → Infinity，即**没有有效截止日的排单排在最后**
// ⚠️ ①与②理论上可能不一致（daysLeft 是缓存的、deadline 是原始值）。本项目的调用方
//    （看板 reload）里 daysLeft 就是由 deadline 现算的，二者同源；若将来有调用方传入
//    不同源的 daysLeft，会以 daysLeft 为准 —— 这是刻意的（缓存优先），但调用方需自知。
function commissionPriorityDays(c) {
  let d = c && c.daysLeft;
  if (typeof d !== 'number' || isNaN(d)) d = commissionDaysLeft(c && c.deadline);
  return (typeof d === 'number' && !isNaN(d)) ? d : Infinity;   // 无效截止日 → 排最后
}

// 置顶：取优先天数最小的。超期是负数 → 天然排在未超期之前；同为超期则最超期的在前
function topCommission(list) {
  const arr = (list || []).filter(Boolean);
  if (!arr.length) return null;
  let best = arr[0];
  let bestKey = commissionPriorityDays(best);
  for (let i = 1; i < arr.length; i++) {
    const k = commissionPriorityDays(arr[i]);
    if (k < bestKey) { best = arr[i]; bestKey = k; }
  }
  return best;
}

// 堆叠装饰层数：1 张完整可见 + 最多 2 层露边（暗示还有更多）。
// 0/1 条时没有"更多"可暗示 → 不叠；≥3 条叠满 2 层
function commissionStackLayers(total) {
  const n = Number(total);
  if (!isFinite(n) || n <= 1) return 0;
  return n === 2 ? 1 : 2;
}

// 倒计时文案：超期「超期 N 天」／未超期「剩 N 天」／无有效截止日「未设截止」。
// 放在这里的原因同 topCommission：daysLeft 可能是 NaN，直接拼进模板会显示「剩 NaN 天」。
// ⚠️ null / undefined 必须走"未设截止"分支 —— 否则 Number(null) === 0 会被当成"剩 0 天"（今天到期），语义完全反了
function commissionDDLText(daysLeft) {
  if (daysLeft == null) return '未设截止';
  const d = Number(daysLeft);
  if (!isFinite(d)) return '未设截止';
  return d < 0 ? ('超期 ' + (-d) + ' 天') : ('剩 ' + d + ' 天');
}

// 看板指标（M1-10 / M1-17）
function dashboardMetrics(categoryId) {
  const _cat = categoryId && categoryId !== 'all' ? categoryId : 'bc_default';
  const mats = store.getMaterials().filter(m => (m.categoryId || 'bc_default') === _cat);
  const prods = store.getProducts().filter(p => (p.categoryId || 'bc_default') === _cat);
  const flows = store.getFlows().filter(f => (f.categoryId || 'bc_default') === _cat);

  const materialCount = mats.length;
  const inventoryValue = util.round(mats.reduce((s, m) => s + (m.totalValue || 0), 0), 2);
  const lowStockCount = mats.filter(m => store.isLowStock(m)).length;

  const ym = util.today().slice(0, 7); // 当前年月 YYYY-MM，用于「本月」口径
  let totalSales = 0, totalProfit = 0, soldCount = 0;
  let monthlyGrossProfit = 0, monthlySoldCount = 0;
  prods.forEach(p => {
    (p.sales || []).forEach(s => {
      const lineProfit = util.round(s.qty * (s.price - (s.costSnapshot && s.costSnapshot.totalCost || 0)), 2);
      totalSales = util.round(totalSales + s.qty * s.price, 2);
      totalProfit = util.round(totalProfit + lineProfit, 2);
      if (s.date && s.date.slice(0, 7) === ym) {
        monthlyGrossProfit = util.round(monthlyGrossProfit + lineProfit, 2);
        monthlySoldCount = util.round(monthlySoldCount + (s.qty || 0), 0);
      }
    });
    if (p.saleStatus === 'sold') soldCount++;
  });
  const productCount = prods.length;
  let targetTotal = 0, targetHit = 0;
  prods.forEach(p => {
    if (p.nature !== 'merchandise') return;
    if (p.targetProfit == null) return;
    const c = computeProduct(p);
    targetTotal++;
    if (c.targetAchieved) targetHit++;
  });
  const targetAchievement = targetTotal > 0 ? util.round(targetHit / targetTotal, 4) : 0;

  const t = util.today();
  // 入库 / 出库 **金额**（V142b 修正）：
  //   改前是 `s + f.qty` —— 把当天的「片 / cm² / m² / kg」直接加在一起，
  //   等于"把米和斤加起来"（硬错）。而且这个字段**只被写进快照、没有任何页面读它**
  //   （`getSnapshots` 的消费方只读 inventoryValue），属于"算了没人用"。
  //   口径与「物料出入库」页的曲线统一为金额：入库=本次采购总价、出库=按均价扣减的成本。
  const sumAmount = (dir) => util.round(
    flows.filter(f => f.type === dir && f.date === t)
      .reduce((s, f) => s + (Number(f.totalPrice) || 0), 0), 2);
  const inboundAmount = sumAmount('in');
  const outboundAmount = sumAmount('out');

  return {
    materialCount, inventoryValue, lowStockCount, productCount, soldCount,
    totalSales, totalProfit, targetAchievement, targetHit, targetTotal,
    monthlyGrossProfit, monthlySoldCount,
    inboundAmount, outboundAmount
  };
}

// 构建日期曲线
function buildCurve(metric, days, startDate, endDate, categoryId) {
  let start, end = util.today();
  if (days === 7 || days === 30) start = util.addDays(end, -(days - 1));
  else { start = startDate; end = endDate; }

  // 销售额 / 利润：按日实时汇总销售记录。
  // 原来走快照 —— 快照只在「当天打开过小程序」时才生成，其余日期靠前向填充，
  // 于是整条曲线要么平、要么直接没数据（用户反馈「销售额、利润里都没数据」）。
  if (metric === 'sales' || metric === 'profit') {
    const cid = categoryId || (store.getBusinessCategories()[0] || {}).id || 'bc_default';
    const products = store.getProducts().filter(p => (p.categoryId || 'bc_default') === cid);
    const out = [];
    let cursor = start;
    while (util.diffDays(cursor, end) >= 0) {
      let val = 0;
      products.forEach(p => (p.sales || []).forEach(s => {
        if (s.date !== cursor) return;
        if (metric === 'sales') val += s.qty * s.price;
        else val += s.qty * (s.price - ((s.costSnapshot && s.costSnapshot.totalCost) || 0));
      }));
      out.push({ date: cursor, value: util.round(val, 2) });
      cursor = util.addDays(cursor, 1);
    }
    return out;
  }

  // 库存估值：库存本身没有历史，只能沿用快照（这段曲线意义有限，暂留）
  // ⚠️ 快照是**分空间**存的（每条带 categoryId）—— 必须把空间透传下去。
  //    写成 `store.getSnapshots()` 会吃默认值（= 当前空间），等于"偷看"全局状态：
  //    调用方以为自己指定了空间，其实没有 —— 与 V136 修掉的摊销/折旧是同一个坑。
  const snaps = store.getSnapshots(categoryId);
  const result = [];
  let cursor = start;
  while (util.diffDays(cursor, end) >= 0) {
    const s = snaps.find(x => x.date === cursor);
    result.push({ date: cursor, value: s ? s[metric] : (result.length ? result[result.length - 1].value : 0) });
    cursor = util.addDays(cursor, 1);
  }
  return result;
}

/* ---------- 入库 / 出库 的每日趋势：**按日聚合金额**（V142；V142b 按用户纠正改为金额） ----------

   为什么不再走上面那条「快照」路：
     `store.ensureTodaySnapshot()` 只在「当天打开过小程序」时才写一条快照，历史日期没有；
     `buildCurve` 遇到没有快照的日子只能**前向填充**（拿上一条的值一直往后填）。
     对「库存估值」这是无奈但可接受的近似（库存本来就没有历史记录）；
     但对**入库 / 出库**是**硬错**：画出来的是"上次打开小程序那天的量"一直延续到今天。
     ⇒ 这两条曲线改为直接聚合 `flows`（每条流水自带 date / type / totalPrice），真实且能跟着筛选走。

   ⚠️⚠️ 量纲是**金额**，不是数量（用户原话：「出入库的单位应该是金额啊 怎么能按个算」）：
     ① **跨单位不能相加**：流水数量有 片 / cm² / m² / kg 多种，把 qty 直接相加等于"把米和斤加起来"。
        曾经的做法是"取笔数最多的单位当主单位、其余排除"—— 那是个勉强的妥协：
        图会漏掉一部分流水，而且不同物料根本不可比。金额没有这个问题。
     ② **金额天然可比可加**：每条流水都带 `totalPrice`
        （入库=本次采购总价；出库=按当时加权均价扣减的成本；盘库/校准/冲销也都写）。
     ③ **口径统一**：库存估值那条本来就是金额 ⇒ 三个指标一套量纲，
        刻度与摘要都不再需要额外解释，也与「累计总账」对齐。
     ④ **有些流水数量为 0 但金额不为 0**（`source='calibration'` 的期初校准：只对齐金额、不动数量）
        —— 按数量画它们会**整个消失**，按金额画才画得出来。

   ⚠️ 仍然**不做前向填充**：没有流水的日子就是 0（"这天没动"本身是信息）。

   @param metric 'inboundAmount' | 'outboundAmount'（其余按入库处理）
   @param opts   { days=30, start, end, categoryId, kw }
   @returns { points:[{date,value,count}], unit:'¥', unitPos:'pre',
              total, activeDays, flowCount, peak } */
function buildFlowCurve(metric, opts) {
  const o = opts || {};
  const type = metric === 'outboundAmount' ? 'out' : 'in';
  const end = o.end || util.today();
  const days = Math.max(1, Number(o.days) || 30);
  const start = o.start || util.addDays(end, -(days - 1));
  const cid = o.categoryId || (store.getBusinessCategories()[0] || {}).id || 'bc_default';
  const kw = String(o.kw || '').trim();

  const flows = store.getFlows().filter((f) => {
    if ((f.categoryId || 'bc_default') !== cid) return false;
    if (f.type !== type) return false;
    if (f.date < start || f.date > end) return false;
    if (kw && String(f.materialName || '').indexOf(kw) < 0) return false;
    return true;
  });

  // 逐日累加**金额**。totalPrice 缺失/非法按 0 计 —— 宁可少算也不编一个数出来。
  const dayMap = {};
  flows.forEach((f) => {
    const day = dayMap[f.date] || (dayMap[f.date] = { value: 0, count: 0 });
    day.value += Number(f.totalPrice) || 0;
    day.count += 1;
  });

  // 铺满区间（没有流水的日子 value=0 —— 柱状图要能看见"这天没动"）
  const points = [];
  let cursor = start;
  let guard = 0;
  while (util.diffDays(cursor, end) >= 0 && guard < 400) {
    const day = dayMap[cursor];
    points.push({
      date: cursor,
      value: util.round(day ? day.value : 0, 2),
      count: day ? day.count : 0
    });
    cursor = util.addDays(cursor, 1);
    guard++;
  }

  const total = util.round(points.reduce((s, p) => s + p.value, 0), 2);
  const activePoints = points.filter((p) => p.value > 0);
  let peak = null;
  points.forEach((p) => { if (p.value > 0 && (!peak || p.value > peak.value)) peak = p; });

  return {
    points: points,
    unit: '¥',
    unitPos: 'pre',
    total: total,
    activeDays: activePoints.length,
    flowCount: flows.length,
    peak: peak
  };
}

// 低库存物料列表
function lowStockMaterials(categoryId) {
  const _cat = categoryId && categoryId !== 'all' ? categoryId : 'bc_default';
  return store.getMaterials().filter(m => ((m.categoryId || 'bc_default') === _cat) && store.isLowStock(m));
}
// 活跃排单（按 DDL 升序，未取消/未完成的）
function activeCommissions(categoryId) {
  const _cat = categoryId && categoryId !== 'all' ? categoryId : 'bc_default';
  return store.getCommissions()
    .filter(c => c.status !== 'done' && c.status !== 'cancelled' && ((c.categoryId || 'bc_default') === _cat))
    .sort((a, b) => util.diffDays(util.today(), a.deadline) - util.diffDays(util.today(), b.deadline));
}

/* ===================== BOM 行的「裁剪 / 面积」口径（单一判定） =====================
 *
 * 为什么单独收口：BOM 行有两种面料口径 ——
 *   · 按片面料（piece）：按长×宽算面积、需要排裁剪
 *   · 按批估量 / 刀口布（batch）：按「每件用量(kg/片)」扣料，**不裁剪、不计面积**
 * 历史上多处直接写 `b.isFabric` 就当成「要裁剪的面料」，漏掉 batch，造成同一个根因的连环 bug：
 *   成品编辑保存被「请先完成裁剪」拦住、生产被强制排裁剪、刀口布被写下长宽/红区脏数据、
 *   详情页把刀口布规格显示成面积（2026-09-12 真机反馈）。
 * 因此：**所有涉及裁剪/面积的地方都必须走下面这几个函数**，不要再手写 isFabric 判断。
 */
function bomLineIsBatch(b, material) {
  // 纯判定下沉在 util（store 也用它，避免 calc ↔ store 循环依赖）
  return util.bomIsBatchLine(b, material);
}

// 该行是否需要「裁剪 / 按面积」：面料，且不是按批估量
function bomLineNeedsCut(b, material) {
  const m = material || (b && b.materialId ? store.getMaterial(b.materialId) : null);
  const fabric = !!(b && (b.isFabric || (m && store.isMaterialFabric(m))));
  return fabric && !bomLineIsBatch(b, m);
}

// 保存成品的裁剪校验：返回「已填尺寸但本轮未排裁剪」的物料名数组。
// 尺寸与上次保存一致的行沿用旧裁剪，放行（避免编辑时被迫重剪每条）。
function pendingCutLines(bom, oldRects) {
  const rects = oldRects || {};
  const out = [];
  (bom || []).forEach(b => {
    if (!bomLineNeedsCut(b)) return;          // 非面料 / 刀口布：无需裁剪
    if (!b.length || !b.width) return;        // 没填尺寸，无需裁剪
    // 本轮已选定方案（V91 起是数组：一个面料行可以用两块布，每片一条）
    if ((b.chosenSchemes && b.chosenSchemes.length) || b.chosenScheme) return;
    const len = util.round(util.toCm(b.length, b.lenUnit || 'cm'), 2);
    const wid = util.round(util.toCm(b.width, b.widUnit || 'cm'), 2);
    const oldRect = rects[b.materialId];
    if (oldRect && util.round(oldRect.length, 2) === len && util.round(oldRect.width, 2) === wid) return;
    out.push(b.materialName || '面料');
  });
  return out;
}

// 逐件裁剪队列（2026-09-29 V78）：**每件 × 每个需要裁剪的面料行**一条，带 pieceNo。
//
// 为什么不是「每个物料一条」：用户要的是**逐件的决定权** ——
//   「每一件都由我来剪裁，都由我来确定，不是只确定一件、其他的都跟他一样」。
// 裁剪界面按 pieceNo 分组、一片一片让他定（V90 起是一屏排完，但每一片仍各自定）。
//
// ⚠️ 2026-09-30 V92：去掉了原来的 overrides 参数 ——
//   它只用来跳过「合起来剪」的行（那一行用户已经报了整块尺寸、不必再逐件选），
//   而那条路已退场（这件事现在在裁剪界面里做：片数减到 1、填上那块的长宽）。
//   如今还留在面板里的行（辅料 / 刀口布 / 面积行）本来就一条都进不了这个队列。
function cutQueueFor(bom, qty) {
  const q = Math.max(1, Math.round(Number(qty) || 1));
  const rects = [];
  (bom || []).forEach(b => {
    if (!bomLineNeedsCut(b)) return;
    if (!(Number(b.length) > 0 && Number(b.width) > 0)) return;
    // ⭐ V122：一个物料可以用**多块布** —— 队列要按**片数**展开，
    //   否则用户进裁剪页永远只看到一片（"这件到底要裁几片"从起点就错了）。
    const pl = (Array.isArray(b.chosenSchemes) ? b.chosenSchemes : [])
      .filter(x => x && Number(x.length) > 0 && Number(x.width) > 0);
    const specs = pl.length
      ? pl.map(x => ({ redLen: util.round(Number(x.length), 2), redWid: util.round(Number(x.width), 2) }))
      : [{ redLen: util.round(Number(b.length), 2), redWid: util.round(Number(b.width), 2) }];
    specs.forEach(sp => rects.push({
      materialId: b.materialId, materialName: b.materialName,
      redLen: sp.redLen, redWid: sp.redWid
    }));
  });
  const out = [];
  for (let i = 1; i <= q; i++) {
    rects.forEach(r => { out.push(Object.assign({ pieceNo: i }, r)); });
  }
  return out;
}

/* ===== 「这批实际用料」编辑行（2026-09-27 V74，承接 D72/D73）=====
 *
 * 要解决的问题（用户原话）：
 *   「新增多个成品跟新增一个成品，用的布料可能不太一样 —— 可能是一大块儿布」。
 *   现按「每件用量 × 数量」扣，整块布没用完的部分仍挂在库存 ⇒ 库存虚高 + 这批成本偏低。
 *
 * 为什么不去动成本公式：系统契约本来就是「**扣了多少料，这批成本就是多少**」
 *   （produceProduct 把本次扣料流水金额汇成 batchCost，单件成本 = batchCost / 数量）。
 *   所以只要让「这次扣多少」能填对，成本自动就对了 —— 公式一行不改。
 *
 * 三类 BOM 行（与 consumeBom 的三个分支一一对应，别在这里另立口径）：
 *   · area  ：面料按面积 → 展示用 m²（与全项目面积口径一致），内部 cm² ⇒ scale=10000
 *   · batch ：刀口布（按批估量）→ 展示用自身单位（kg / 片）
 *   · each  ：普通辅料 → 展示用物料单位
 *
 * ⚠️ 2026-09-30 V92：**填了长宽的面料行不进这个列表** —— 它的用量由裁剪界面定
 *   （每片各自填长宽、各自选布；片数减到 1 就是"这批合起来裁一块"）。
 *   面板里再列一遍只会让"面料用量"多出一处口径，两处必然漂。
 */
function produceUsageLines(bom, qty) {
  const q = util.round(Number(qty) || 0, 2);
  const out = [];
  (bom || []).forEach(b => {
    const m = b && b.materialId ? store.getMaterial(b.materialId) : null;
    if (!m) return;                                   // 物料被删 → 这行本来也扣不动
    const line = { materialId: m.id, name: m.name || b.materialName || '', spec: bomLineSpec(b, m) };
    if (bomLineIsBatch(b, m)) {
      line.kind = 'batch';
      line.unit = store.displayUnit(m.batchUnit);
      line.scale = 1;
      line.decimals = 2;
      line.def = util.round((Number(b.batchUsage) || 0) * q, 2);
    } else if (b.isFabric || store.isMaterialFabric(m)) {
      // 面料几何行（填了长×宽）：**不进这个面板**（2026-09-30 V92，用户拍板「只删面料那部分」）。
      //   它的用量由裁剪界面定 —— 那片能自己填长宽、自己选布，片数减到 1 就是"这批合起来裁一块"
      //   （V77 当初做「一件一件剪 / 合起来剪」就是为了这件事，现在整件事归裁剪界面）。
      const len = util.round(Number(b.length) || 0, 2);
      const wid = util.round(Number(b.width) || 0, 2);
      if (len > 0 && wid > 0) return;
      // 只剩「没填长宽」的面积面料行：没有形状可用、也进不了裁剪队列，按每件面积扣
      line.def = util.round((Number(b.area) || 0) * q / 10000, 4);   // 内部 cm² → 展示 m²
      line.kind = 'area';
      line.unit = 'm²';
      line.scale = 10000;                               // m² → cm²
      line.decimals = 4;
    } else {
      line.kind = 'each';
      line.unit = m.unit || '';
      line.scale = 1;
      line.decimals = 2;
      line.def = util.round((Number(b.usage) || 0) * q, 2);
    }
    if (line.def <= 0) return;                        // 用量为 0 的行不展示（本来也不扣）
    line.input = String(line.def);
    line.touched = false;
    out.push(line);
  });
  return out;
}

// 把编辑行转成「覆盖表」：**只收用户改过的行**。
// 没改的一律不传 ⇒ 走原来的标准路径（含裁剪选片），也就是说「不改 = 行为完全不变」。
// 值 = 该物料这一批实际用掉多少（面积行已 ×scale 转回 cm²）。
//
// ⚠️ 2026-09-30 V92：原先还有一种「几何行 → { mode:'merged', length, width }」的形态
//   （V77 的「合起来剪」）。那条路已退场 —— "这批合起来裁一块"现在在**裁剪界面**里做
//   （片数减到 1、填上那块的长宽），所以这里只剩数值一种形态。
function produceOverrides(lines) {
  const out = {};
  (lines || []).forEach(l => {
    if (!l || !l.materialId) return;
    const raw = String(l.input == null ? '' : l.input).trim();
    if (raw === '') return;                           // 留空 → 视为没改
    const v = Number(raw);
    if (!isFinite(v) || v < 0) return;                // 乱填 / 负数 → 视为没改（别把脏输入变成扣料）
    if (Math.abs(v - l.def) < 1e-9) return;           // 与默认一致 → 没改
    out[l.materialId] = util.round(v * (l.scale || 1), 4);
  });
  return out;
}

// 数量变化时重算默认值：**没被用户动过的行跟着新数量走，动过的行保留用户输入**。
// （否则用户先改好用量、再回头改数量，输入就被冲掉了）
function retuneUsageLines(lines, bom, qty) {
  const fresh = produceUsageLines(bom, qty);
  const byId = {};
  fresh.forEach(l => { byId[l.materialId] = l; });
  return (lines || []).map(old => {
    const nl = byId[old.materialId];
    if (!nl) return null;                             // BOM 里已删的行 / 已改回"归裁剪界面"的面料行 → 丢掉
    // 「动过没有」以**值本身**为准（input ≠ 旧默认即为动过），touched 只是加速标记。
    // 这样页面层只改 input 也不会丢用户输入 —— 少一个必须记得同步的字段。
    const wasTouched = old.touched === true || String(old.input) !== String(old.def);
    nl.touched = wasTouched;
    if (wasTouched) nl.input = old.input;
    return nl;
  }).filter(Boolean);
}

// BOM 行的「规格」展示口径（详情页 / 教程卡导出共用一个来源，避免两处写法漂移）
//   刀口布（按批估量）→ 每件用量；按片面料 → 长×宽 · 面积；其他 → 用量
function bomLineSpec(b, m) {
  const mat = m || (b && b.materialId ? store.getMaterial(b.materialId) : null);
  if (bomLineIsBatch(b, mat)) {
    return '每件用量 ' + util.round(Number(b.batchUsage || 0), 2) + (mat ? store.displayUnit(mat.batchUnit) : '');
  }
  const fabric = !!(b && (b.isFabric || (mat && store.isMaterialFabric(mat))));
  if (fabric) {
    // ⭐ V122：一个物料可以用**多块布**（每块各裁一片）—— 规格必须说得出"几片、每片多大"，
    //   否则用户看到一组长宽就以为只裁了一片（2026-10-06：「物料清单里还是只有一片布的长宽」）。
    const pl = (Array.isArray(b.chosenSchemes) ? b.chosenSchemes : [])
      .filter(x => x && Number(x.length) > 0 && Number(x.width) > 0);
    if (pl.length > 1) {
      const each = pl.map(x => util.round(x.length, 0) + '×' + util.round(x.width, 0) + 'cm').join(' + ');
      const sum = (Number(b.area) > 0) ? Number(b.area)
        : pl.reduce((t, x) => t + Number(x.length) * Number(x.width), 0);
      return pl.length + ' 片 · ' + each + ' · ' + util.areaToM2(sum) + 'm²';
    }
    if (b.length && b.width) {
      return util.round(b.length, 0) + '×' + util.round(b.width, 0) + 'cm · ' + util.areaToM2(b.area) + 'm²';
    }
    return '面积 ' + util.areaToM2(b.area) + 'm²';
  }
  return '用量 ' + util.round(b.usage, 2) + (mat ? (mat.unit || '') : '');
}

module.exports = {
  bomLineCost, computeProduct,
  bomLineIsBatch, bomLineNeedsCut, pendingCutLines, cutQueueFor, bomLineSpec,
  produceUsageLines, produceOverrides, retuneUsageLines,
  commissionDaysLeft, commissionDDLStatus, topCommission, commissionStackLayers, commissionDDLText,
  dashboardMetrics, buildCurve, buildFlowCurve, lowStockMaterials, activeCommissions
};
