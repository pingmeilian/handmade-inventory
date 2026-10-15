// pages/settings/history.js —— 物料出入库与变动曲线（M1-11 / M1-10）
// ⚠️ 2026-09-27（V69）由「出入库历史」改名：本页数据源是 getFlows()，**只含物料流水**。
//    成品的「进 / 出」不在流水表里（记在成品对象上），已单独做成
//    「成品出入库」页（pages/settings/sales）—— 别把成品塞进本页。
//
// ⚠️ 2026-10-10（V136）本页成了「累计总账」的下钻落点（总账的「物料采购」→ 入库、
//    「用掉的物料」→ 出库）。跳转参数：`?type=in|out&start=YYYY-MM-DD&end=YYYY-MM-DD&src=ledger`。
//    为什么选这一页而不是物料库：**物料库是 tabBar 页**（只能 switchTab、且 switchTab 不支持
//    带参数）；本页是普通页 ⇒ navTo 能带参数，用户进来就直接落在"入库 / 出库 + 总账那段区间"。
//
//    ⚠️ 两边口径**本来就不完全对应**，所以带 `src=ledger` 时页面要显示一句说明：
//       总账 A「物料采购」只认 `source==='manual'`（真采购），本页「入库」是 `type==='in'` 全部
//       （退料 / 盘盈 / 期初校准 / 冲销都在里面）；总账 B 是扣掉退料后的**净额**，本页「出库」只有出。
//       而且本页列的是**数量**（片 / cm² / m² / kg），总账那个数是**金额**。
//       ⇒ 说明是"方案甲"的组成部分：少了它，用户会以为账算错了。
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');

const SRC = util.FLOW_SOURCE_LABELS;
// V142b：三个指标的**量纲统一为金额**（用户纠正：「出入库的单位应该是金额啊 怎么能按个算」）。
//   改前「入库量 / 出库量」按数量画，而流水数量有 片 / cm² / m² / kg 多种 —— 跨单位根本不能相加，
//   只能"取笔数最多的单位当主单位、其余排除"（图会漏掉一部分流水），所以连名字一起改掉：
//   名字里带 Qty 会让人（包括以后的我）以为是数量。
//   ⚠️ 别跟 `calc.dashboardMetrics()` 里那对 `inboundAmount / outboundAmount` 搞混：那里是**当天**的
//      合计数（给快照用）；本页是**近 30 天逐日**的曲线。
const CURVE_LABELS = { inventoryValue: '库存估值', inboundAmount: '入库金额', outboundAmount: '出库金额' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    curName: '全部空间',
    curvePoints: [],
    curveMetric: 'inventoryValue', curveLabel: '库存估值',
    // V142：图形由指标决定（存量=折线 / 流量=柱状），单位与摘要也一起给
    chartType: 'line', chartUnit: '¥', chartUnitPos: 'pre',
    curveSummary: '', curveNote: '', curveEmptyText: '暂无数据',
    flows: [],
    // 筛选（M1-11 第 2 条：时间区间 / 类型 / 物料名称）
    dateStart: '', dateEnd: '',
    typeFilter: 'all',            // all | in | out
    kw: '',
    // V136：是否从「累计总账」跳进来（决定要不要显示口径说明）
    fromLedger: false,
    // 主题日期选择器（替代原生 mode="date"）
    dpStart: false, dpEnd: false
  },

  // V136：接住「累计总账」带来的参数。
  // ⚠️ 本页原本**只有 onShow、没有 onLoad** —— 不加这个函数，带参数跳过来也只会落在默认态
  //   （"全部 + 无区间"），用户看到的就是另一段东西。
  // ⚠️ 一律**白名单校验**：拿不准的值宁可不设，也不要写进 data（写进去可能让筛选条件变成
  //   永远筛不出东西的怪状态，而页面不会报错）。
  onLoad(options) {
    const o = options || {};
    const patch = {};
    if (o.type === 'in' || o.type === 'out') patch.typeFilter = o.type;
    if (DATE_RE.test(String(o.start || ''))) patch.dateStart = o.start;
    if (DATE_RE.test(String(o.end || ''))) patch.dateEnd = o.end;
    if (o.src === 'ledger') patch.fromLedger = true;
    if (Object.keys(patch).length) this.setData(patch);
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    const curName = (cats.find(c => c.id === cur) || {}).name || '';

    // 确保今日快照，构建库存价值 / 入出库量曲线
    const metrics = calc.dashboardMetrics(cur);
    store.ensureTodaySnapshot(metrics);
    const { curveMetric, dateStart, dateEnd, typeFilter, kw } = this.data;

    // 原始流水（按空间过滤）
    let raw = store.getFlows().filter(f => (f.categoryId || 'bc_default') === cur);
    // 类型筛选
    if (typeFilter !== 'all') raw = raw.filter(f => f.type === typeFilter);
    // 时间区间筛选（含端点）
    if (dateStart) raw = raw.filter(f => f.date >= dateStart);
    if (dateEnd) raw = raw.filter(f => f.date <= dateEnd);
    // 物料名称关键词筛选
    const kwTrim = (kw || '').trim();
    if (kwTrim) raw = raw.filter(f => (f.materialName || '').indexOf(kwTrim) >= 0);

    const flows = raw.slice().sort((a, b) => b.createdAt - a.createdAt)
      .map(f => {
        const sign = f.type === 'in' ? '+' : '-';
        // 数量与单位统一走 store.flowDisplay（页面与导出唯一口径）：
        // 面积按临界值自动选 cm²/m²，不再让用户手动切单位（2026-09-27 V72）
        const d = store.flowDisplay(f);
        // 红冲：原流水标记「已冲销」，红冲流水本身显示「冲销」
        const isReversal = f.source === 'reversal';
        let typeText = isReversal ? '冲销' : (f.type === 'in' ? '入库' : '出库');
        if (!isReversal && f.undone) typeText += '（已冲销）';
        return {
          date: f.date, typeText: typeText,
          typeClass: (isReversal || f.undone) ? 'text-3' : (f.type === 'in' ? 'text-success' : 'text-danger'),
          materialName: f.materialName,
          qtyVal: sign + d.qty,
          qtyUnit: d.unit,
          // V142b：每条流水**同时给数量与金额** ——
          //   曲线已改按金额画（跨单位的数量没法相加），列表里保留数量是因为"这条用了几片/几米"
          //   本身就是有用信息；两者并排，用户才能把图上那根柱子和具体哪几条流水对上。
          amountText: '¥' + util.money(f.totalPrice),
          balance: d.balance,
          remark: f.remark || '', source: SRC[f.source] || f.source
        };
      });

    // ---------- 趋势曲线（V142 重做；V142b 量纲改为金额）----------
    // 用户报：「趋势曲线太丑了，根本看不到有用的信息，为什么只有一个 2.0K，也不知道具体的哪天是哪天，
    //   上面那么多圆，点也点不了」。查实是三件事叠在一起：
    //   ① 组件模板**算好了刻度/圆点收敛/读数却没画**（已补齐，见 components/line-chart 头部注释）；
    //   ② 量程把库存压成一条平线（已改成自适应，见 utils/stat-chart.js 的 niceScale）；
    //   ③ **数据源**：这两条原走快照 + 前向填充，画出来是"上次打开小程序那天的量"延续到今天（硬错）。
    //      ⇒ 改为真实按日聚合流水（calc.buildFlowCurve），并跟着**物料名筛选**走。
    // 用户随后纠正：「出入库的单位应该是金额啊 怎么能按个算」⇒ **三条指标全部是金额**：
    //   库存估值=存量金额（折线）、入库金额 / 出库金额=每日流量金额（柱状）。
    //   金额天然可加可比（数量跨单位不能相加，按数量画只能"取主单位、其余排除"，图会漏流水）。
    const isStock = curveMetric === 'inventoryValue';
    const chartType = isStock ? 'line' : 'bar';
    const chartUnit = '¥';          // 三个指标都是金额
    const chartUnitPos = 'pre';     // 金额走前缀（¥1,280），不是后缀
    let curvePoints = [];
    let curveSummary = '';
    let curveNote = '';
    let curveEmptyText = '';

    if (isStock) {
      // 库存估值：库存本身没有历史，只有"当天打开过小程序"才写一份快照 ⇒ 只能沿用快照
      // （区间内没有快照的日子按上一条前向填充，这是无奈但可接受的近似）
      curvePoints = calc.buildCurve('inventoryValue', 30, null, null, cur)
        .map(p => ({ date: p.date, value: p.value }));
      const first = curvePoints.length ? curvePoints[0].value : 0;
      const last = curvePoints.length ? curvePoints[curvePoints.length - 1].value : 0;
      const delta = last - first;
      curveSummary = '30 天：期初 ¥' + util.money(first) + ' → 期末 ¥' + util.money(last) +
        '　净 ' + (delta >= 0 ? '+' : '−') + '¥' + util.money(Math.abs(delta));
      curveNote = '库存按每日快照统计；物料筛选对它没有影响（快照不分物料）';
      curveEmptyText = '暂无库存快照';
    } else {
      const verb = curveMetric === 'inboundAmount' ? '入库' : '出库';
      const fc = calc.buildFlowCurve(curveMetric, { days: 30, categoryId: cur, kw: kwTrim });
      curvePoints = fc.points;
      curveSummary = '30 天里 ' + fc.activeDays + ' 天有' + verb +
        '　合计 ¥' + util.money(fc.total) +
        (fc.peak && fc.peak.value > 0
          ? '　最多 ' + String(fc.peak.date).slice(5) + ' ¥' + util.money(fc.peak.value)
          : '');
      // ⚠️ 金额口径下**不再需要**"这张图只画了哪个单位"的说明 ——
      //    这正是改金额的目的（改前按数量：跨单位不能相加，只能取笔数最多的单位当主单位，其余排除）。
      if (kwTrim) curveSummary += '　（已按「' + kwTrim + '」筛选）';
      curveEmptyText = '近 30 天没有' + verb + '记录';
    }

    this.setData({
      curName, curvePoints, curveLabel: CURVE_LABELS[curveMetric], flows,
      chartType, chartUnit, chartUnitPos, curveSummary, curveNote, curveEmptyText
    });
  },

  switchCurve(e) {
    const m = e.currentTarget.dataset.m;
    this.setData({ curveMetric: m, curveLabel: CURVE_LABELS[m] });
    this.reload();
  },

  setTypeFilter(e) { this.setData({ typeFilter: e.currentTarget.dataset.v }); this.reload(); },
  onKw(e) { this.setData({ kw: e.detail.value }); this.reload(); },
  onDateStart(e) { this.setData({ dateStart: e.detail.value }); this.reload(); },
  onDateEnd(e) { this.setData({ dateEnd: e.detail.value }); this.reload(); },
  // 主题日期选择器开关（替代原生 picker mode="date"）
  openDateStart() { this.setData({ dpStart: true }); },
  openDateEnd() { this.setData({ dpEnd: true }); },
  closeDate() { this.setData({ dpStart: false, dpEnd: false }); },
  resetFilters() { this.setData({ dateStart: '', dateEnd: '', typeFilter: 'all', kw: '' }); this.reload(); }
  // switchAreaUnit 已删除（2026-09-27 V72）：面积单位不再让用户手动切 ——
  // 每条流水按自己的数值大小自动选 cm² / m²（util.areaAuto），
  // 用户不用再猜"这块布该看哪个单位"。判定与换算收在 store.flowDisplay 里，与导出同一口径。
});
