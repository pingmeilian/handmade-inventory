// pages/dashboard/dashboard.js
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const stat = require('../../utils/stat.js');
const statChart = require('../../utils/stat-chart.js');
const palette = require('../../utils/palette.js');
const image = require('../../utils/image.js');
const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

const METRIC_LABELS = {
  inventoryValue: '库存估值', sales: '销售额', profit: '利润', lossCost: '损耗成本'
};
// 7 张看板卡片与统计弹窗的对应关系
const CARD_TIP = {
  material: '原材料品类',
  inv: '物料总资产',
  product: '累计完工（含样品/待售/已售）',
  sold: '本月成交卖出成品',
  profit: '仅已售商品，销售额减去物料成本',
  loss: '制作环节产生的物料损耗',
  net: '扣除损耗后的本月实际盈利'
};

// 哪些卡片的第一层明细可以继续下钻到「实体」——key → 实体类型。
// loss 的三项是费用类型（耗材摊销/资产折旧/工具支出），底下没有对应实体，所以不下钻。
const CATEGORY_KIND = {
  material: 'material',
  inv: 'material',
  product: 'product',
  sold: 'product',
  profit: 'product',
  net: 'product'
};

Page({
  // V116：量"顶部固定带"的高度 —— 固定带是 position: fixed（脱离文档流、不占位），
  //   所以要靠等高等位 .pin-band-ph 把内容顶下去；高度不能用常量：
  //   · 内容会变：作品集切「作品集/商品/样品」时多一行（cat-sub）、看板的手作空间数量也会变
  //   · 主题会变：不同主题字号/行高略有差异
  //   ⚠️ 量的是 #pinBand（固定带本身），量到 0 就不动（避免把内容顶到 0 高度、页面跳一下）
  measureBand() {
    // ⚠️ 兜底（2026-10-05）：量高失败**不许把页面带崩** ——
    //   某基础库没有 createSelectorQuery、或节点查不到时直接调会抛 ⇒ onReady 挂掉。
    //   量不到就不动（bandH 保持 0）：宁可少一档高度，也不许白屏（与 V115a 同一条纪律）。
    try {
      if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
      wx.createSelectorQuery().in(this).select('#pinBand').boundingClientRect((r) => {
        if (!r || !(r.height > 0)) return;
        const h = Math.round(r.height * 100) / 100;
        if (this.data.bandH !== h) this.setData({ bandH: h });
      }).exec();
    } catch (e) { /* 量不到就不动，别把页面带崩 */ }
  },
  data: {
    bandH: 0,          // V116：顶部固定带的高度（px，量出来）
    spaces: [], currentCategoryId: 'bc_default',
    metrics: {}, metricsReady: false,
    board: [], activeTip: '',
    lowStock: [], wantCount: 0, inspirationCount: 0,
    cmTop: null, cmTotal: 0, cmStack: 0,   // 排单卡：置顶一条 / 总数 / 叠层数
    curveMetric: 'inventoryValue', curveRange: 7,
    curvePoints: [], curveLabel: '库存估值',
    startDate: '', endDate: '',
    // 主题日期选择器（替代原生 mode="date"）
    dpStart: false, dpEnd: false,

    // 统计弹窗
    statVisible: false,
    statCardKey: '',
    statPeriod: 'month',          // month | year
    statDate: util.today(),
    statMonth: util.today().slice(0, 7),  // 当前统计月份 YYYY-MM
    statData: null,
    statViewIndex: 0,
    statList: [],
    // 图表（纯 DOM/CSS 渲染）：类型 + 各类型所需的布局数据
    chartType: 'ring',
    ring: null,               // ringLayout() 的结果：环几何 + 扇区热区 + 引线 + 标签
    ringHi: -1,
    lineLayout: null,
    bars: [],
    chartW: 0, chartH: 0,
    lineTip: null,             // 折线图点折点浮现的数据气泡 {x, y, text}
    // 第二层：某个大类下的具体物料 / 成品明细
    dtVisible: false,
    dtKind: '',               // material | product
    dtTitle: '',
    dtList: [],
    // 月份选择底部弹窗
    showMonthPicker: false,
    monthList: []
  },

  // V116：首帧量一次固定带高度（onReady 时几何已就绪）
  onReady() {
    this.measureBand();
  },

  onShow() {
    this.measureBand();   // V116：切回本页/换主题后重新量（内容与字号都可能变）

    themePage.apply(this);   // 按当前手作空间上色（V97；换主题/换大类都会走到这里）
    this.reload();
    // 启动静默体检的结果：账不平才显示提示条（app.js onLaunch 里算好存 globalData）
    const app = getApp();
    const ck = app && app.globalData && app.globalData.checkup;
    this.setData({ checkupAlert: ck && ck.mismatchCount > 0 ? ck : null, checkupDismissed: false });
    // 图片空间告警（Day 4 任务 4.5）：USER_DATA_PATH 用量超 80% 时提示条（不弹窗打扰）
    const that = this;
    image.userDataUsage().then((u) => {
      if (u.ratio >= 0.8) {
        // 口径：横幅里的「张」只数图片（photoCount），不含备份/CSV 等文件
        that.setData({ imgAlert: { percent: Math.round(u.ratio * 100), count: u.photoCount, usedText: (u.used / 1024 / 1024).toFixed(1) }, imgAlertDismissed: false });
      }
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  // 横幅关闭（本次会话内不再出现，下次启动账仍不平时会再提示）
  dismissCheckup() {
    this.setData({ checkupDismissed: true });
  },

  // 图片空间告警关闭
  dismissImgAlert() {
    this.setData({ imgAlertDismissed: true });
  },

  goCheckup() {
    util.navTo({ url: '/pages/settings/checkup' });
  },

  goBackup() {
    util.navTo({ url: '/pages/settings/backup' });
  },

  reload() {
    const cats = store.getBusinessCategories();
    let cur = state.getCurrentSpace();
    if (!cats.find(c => c.id === cur)) cur = cats[0] ? cats[0].id : 'bc_default';

    const metrics = calc.dashboardMetrics(cur);
    store.ensureTodaySnapshot(metrics);

    const lowStock = calc.lowStockMaterials(cur).map(m => {
      const fabric = store.isMaterialFabric(m);
      return {
        id: m.id, name: m.name,
        stock: (fabric && m.stockMode !== 'batch') ? util.areaToM2(store.stockValue(m)) : store.stockValue(m),
        unit: (fabric && m.stockMode !== 'batch') ? 'm²' : (fabric ? (m.batchUnit || 'kg') : m.unit),
        threshold: fabric ? util.areaToM2(m.threshold == null ? store.getSettings().defaultThreshold : m.threshold)
                           : (m.threshold == null ? store.getSettings().defaultThreshold : m.threshold)
      };
    });

    const commissions = calc.activeCommissions(cur).map(c => {
      const d = calc.commissionDaysLeft(c.deadline);
      return Object.assign({}, c, {
        daysLeft: d,
        ddlStatus: calc.commissionDDLStatus(c.deadline),
        remain: util.round((c.qty || 0) - (c.deliveredQty || 0), 2)
      });
    });

    // 损耗成本（期间费用）：本月合计；经营净收益 = 本月毛利 − 本月损耗成本
    const now = new Date();
    const ml = store.getMonthlyLossCost(now.getFullYear(), now.getMonth() + 1);
    const monthlyGross = metrics.monthlyGrossProfit || 0;
    const netProfit = util.round(monthlyGross - ml.total, 2);

    // 资产三大板块（看板数据卡片）
    const board = [
      { title: '原料资产', cards: [
        { key: 'material', title: '物料种类', value: metrics.materialCount, tip: CARD_TIP.material },
        { key: 'inv', title: '库存估值', value: util.money(metrics.inventoryValue), tip: CARD_TIP.inv }
      ]},
      { title: '成品资产', cards: [
        { key: 'product', title: '全部成品数', value: metrics.productCount, tip: CARD_TIP.product },
        { key: 'sold', title: '已售成品数', value: metrics.monthlySoldCount, tip: CARD_TIP.sold }
      ]},
      { title: '营收与盈利', cards: [
        { key: 'profit', title: '本月毛利', value: util.money(monthlyGross), tip: CARD_TIP.profit },
        { key: 'loss', title: '本月损耗成本', value: util.money(ml.total), tip: CARD_TIP.loss, warn: true },
        { key: 'net', title: '经营净收益', value: util.money(netProfit), tip: CARD_TIP.net }
      ]}
    ];

    // 排单卡片：置顶一条 + 叠层数（单一判定在 calc，见 topCommission 的注释）
    const cmTotal = commissions.length;
    const cmTopRaw = calc.topCommission(commissions);
    // 补上展示用的倒计时文案与紧迫标记（daysLeft 可能是 NaN，不能直接拼进模板）
    const cmTop = cmTopRaw ? Object.assign({}, cmTopRaw, {
      ddlText: calc.commissionDDLText(cmTopRaw.daysLeft),
      urgent: cmTopRaw.ddlStatus === 'over'
    }) : null;
    const cmStack = calc.commissionStackLayers(cmTotal);

    this.setData({
      spaces: cats,
      currentCategoryId: cur,
      metrics, metricsReady: true,
      board, activeTip: '',
      lowStock,
      // 注意：不再把整个 commissions 数组塞进 data —— 视图只用 cmTop/cmTotal/cmStack，
      // 原来的排单列表已改成堆叠卡片，多传一份数组纯属无谓负载（评审发现）
      cmTop, cmTotal, cmStack,
      wantCount: store.getWants().filter(w => w.status !== 'done' && (w.categoryId || 'bc_default') === cur).length,
      inspirationCount: store.getInspirations().filter(i => (i.categoryId || 'bc_default') === cur).length
    });
    this.refreshCurve();
  },

  switchCategory(e) {
    const id = e.currentTarget.dataset.id;
    state.setCurrentSpace(id);
    // ⚠️ 本页**显式再刷一遍**，不依赖广播 —— 跟「手作空间管理」页的 chooseTheme 同一写法
    //    （广播走页面栈、是"尽力而为"，本页换不换色不该由广播决定）。
    //    `themePage.apply` 这句**必须在**：2026-10-04 用户报的 bug（D148）就是它漏了 ——
    //    原先这里只有 reload()，而它只重算数据（资产/低库存/排单/趋势），**主题不在里面**；
    //    主题挂在 onShow 里的 apply ⇒ 现象是"点了胶囊数据变了、颜色没变，切走再回来才对"。
    themePage.apply(this);
    this.reload();
  },

  switchMetric(e) {
    const m = e.currentTarget.dataset.m;
    this.setData({ curveMetric: m, curveLabel: METRIC_LABELS[m] });
    this.refreshCurve();
  },

  switchRange(e) {
    const r = e.currentTarget.dataset.r;
    const data = { curveRange: r };
    if (r === 'custom') {
      data.startDate = util.addDays(util.today(), -13);
      data.endDate = util.today();
    } else {
      data.curveRange = Number(r);
      data.startDate = ''; data.endDate = '';
    }
    this.setData(data);
    this.refreshCurve();
  },

  onStartChange(e) { this.setData({ startDate: e.detail.value }); this.refreshCurve(); },
  onEndChange(e) { this.setData({ endDate: e.detail.value }); this.refreshCurve(); },
  // 主题日期选择器开关（替代原生 picker mode="date"）
  openStartDate() { this.setData({ dpStart: true }); },
  openEndDate() { this.setData({ dpEnd: true }); },
  closeDate() { this.setData({ dpStart: false, dpEnd: false }); },

  refreshCurve() {
    const { curveMetric, curveRange, startDate, endDate } = this.data;
    if (curveMetric === 'lossCost') {
      let start, end = util.today();
      if (curveRange === 'custom' && startDate && endDate) { start = startDate; end = endDate; }
      else if (curveRange === 30) start = util.addDays(end, -29);
      else start = util.addDays(end, -6);
      this.setData({ curvePoints: store.getLossCostSeries(start, end), curveLabel: '损耗成本' });
      return;
    }
    let points;
    if (curveRange === 'custom') {
      points = calc.buildCurve(curveMetric, null, startDate, endDate, this.data.currentCategoryId);
    } else {
      points = calc.buildCurve(curveMetric, curveRange, null, null, this.data.currentCategoryId);
    }
    this.setData({ curvePoints: points });
  },

  goMaterial() { util.navTo({ url: '/pages/materials/edit' }); },
  goProduct() { util.navTo({ url: '/pages/products/edit' }); },
  goBelowTargetProducts() { util.navTo({ url: '/pages/products/list?filter=below' }); },
  goInspiration() { util.navTo({ url: '/pages/inspiration/edit' }); },
  goCommission() { util.navTo({ url: '/pages/commission/edit' }); },
  // 看板排单卡整卡点击 → 排单列表页（这页此前没有任何入口，2026-09-14 补上）
  goCommissionList() { util.navTo({ url: '/pages/commission/list' }); },
  goMaterialDetail(e) { util.navTo({ url: '/pages/materials/detail?id=' + e.currentTarget.dataset.id }); },
  // （原 goCommissionDetail 已删除：它唯一的调用方是看板那段排单列表，
  //   2026-09-14 改成堆叠卡片后整卡跳列表页，它就成了死代码。成品详情页有自己的同名方法。）
  goWants() { util.navTo({ url: '/pages/want/list' }); },
  goInspirations() { util.navTo({ url: '/pages/inspiration/list' }); },

  /* ==================== 统计弹窗 ==================== */
  openStat(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      statVisible: true,
      statCardKey: key,
      statPeriod: 'month',
      statDate: util.today(),
      statViewIndex: 0,
      ring: null,
      lineLayout: null,
      bars: [],
      ringHi: -1
    });
    this.refreshStat();
  },

  closeStat() {
    if (this._chartTimer) { clearTimeout(this._chartTimer); this._chartTimer = null; }
    this.setData({
      statVisible: false, statData: null, statList: [],
      ring: null, lineLayout: null, bars: [], ringHi: -1,
      dtVisible: false, dtList: []
    });
  },

  switchStatPeriod(e) {
    const period = e.currentTarget.dataset.period;
    this.setData({ statPeriod: period, statViewIndex: 0 });
    this.refreshStat();
  },

  prevStatDate() {
    const { statPeriod, statDate } = this.data;
    let d = statDate;
    if (statPeriod === 'year') {
      const y = Number(d.slice(0, 4)) - 1;
      d = y + d.slice(4);
    } else {
      const a = new Date(d.slice(0, 7) + '-01T00:00:00');
      a.setMonth(a.getMonth() - 1);
      d = util.fmtDate(a).slice(0, 7) + '-01';
    }
    // 不允许往前翻过「有数据的最早月份」（与 nextStatDate 的"不超过今天"对称），
    // 否则可以一路点到 1970 年，翻出来全是空数据
    if (d.slice(0, 7) < store.getFirstActiveMonth()) return;
    this.setData({ statDate: d });
    this.refreshStat();
  },

  nextStatDate() {
    const { statPeriod, statDate } = this.data;
    let d = statDate;
    if (statPeriod === 'year') {
      const y = Number(d.slice(0, 4)) + 1;
      d = y + d.slice(4);
    } else {
      const a = new Date(d.slice(0, 7) + '-01T00:00:00');
      a.setMonth(a.getMonth() + 1);
      d = util.fmtDate(a).slice(0, 7) + '-01';
    }
    // 不允许超过今天
    if (d > util.today()) return;
    this.setData({ statDate: d });
    this.refreshStat();
  },

  // 月份选择：底部弹窗，列表区间为「注册月 → 当月」（倒序，最新在上）
  openMonthPicker() {
    this.setData({ monthList: store.buildMonthList(), showMonthPicker: true });
  },
  closeMonthPicker() { this.setData({ showMonthPicker: false }); },
  pickMonth(e) {
    const m = e.currentTarget.dataset.m;               // YYYY-MM
    // 年视图下选中具体月份时，自动切回月视图，保证口径直观
    const period = this.data.statPeriod === 'year' ? 'month' : this.data.statPeriod;
    this.setData({
      statDate: m + '-01',
      statPeriod: period,
      statViewIndex: 0,
      showMonthPicker: false
    });
    this.refreshStat();
  },

  switchStatView(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ statViewIndex: idx });
    this.refreshStat();
  },

  refreshStat() {
    const { statCardKey, statPeriod, statDate, currentCategoryId, statViewIndex } = this.data;
    const data = stat.buildStat(statCardKey, statPeriod, statDate, currentCategoryId);
    if (!data) return;
    // 根据当前视图索引切换 list
    const view = data.views[statViewIndex] || data.views[0];
    data.currentViewKey = view.key;
    data.currentViewLabel = view.label;
    data.list = data.listMap[view.key] || data.list;
    // 环图分母：只统计正值项（负值项画不进环，但仍列在明细里）
    data.listTotal = (data.list || []).filter(x => x.value > 0).reduce((s, i) => s + i.value, 0);
    data.tip = CARD_TIP[statCardKey];

    // 为时间序列补齐友好日期标签
    (data.series || []).forEach(s => {
      s.dateLabel = stat.dayKeyLabel(s.date);
    });

    this.setData({
      statData: data,
      statList: data.list,
      statMonth: statDate.slice(0, 7),
      ringHi: -1,             // 换了卡片/期间/视图，上一个高亮就失效了
      lineTip: null
    });

    // 弹层有开启动画，等渲染稳定后再量尺寸绘制；顺手清掉上一个待执行任务，避免快速切换时重复绘制
    if (this._chartTimer) { clearTimeout(this._chartTimer); this._chartTimer = null; }
    wx.nextTick(() => {
      this._chartTimer = setTimeout(() => this.renderChart(), 50);
    });
  },

  // 图表渲染分两类：
  //   · 柱状：纯 CSS 百分比，不需要量尺寸
  //   · 环形 / 折线：都要先量容器像素尺寸（环形算引线与标签坐标，折线算线段坐标）
  renderChart() {
    const { statData, statViewIndex } = this.data;
    if (!statData) return;
    const view = statData.views[statViewIndex] || statData.views[0];
    if (!view) return;

    if (view.type === 'bar') {
      this.setData({
        chartType: 'bar', lineLayout: null, ring: null, ringHi: -1,
        bars: statChart.barBars(statData.series, 31)
      });
      return;
    }
    this.measureAndRender(view.type, true);
  },

  // 量出图表显示区尺寸 → 算出布局数据
  // retry：弹层刚打开时节点可能还没有尺寸，允许稍后重试一次（否则会留一张空白图）
  measureAndRender(type, retry) {
    wx.createSelectorQuery().in(this).select('.stat-chart-box').boundingClientRect().exec((res) => {
      const r = res && res[0];
      if (!r || !r.width || !r.height) {
        if (retry) this._chartTimer = setTimeout(() => this.measureAndRender(type, false), 150);
        return;
      }
      const w = Math.round(r.width), h = Math.round(r.height);
      const { statData, statViewIndex, ringHi } = this.data;
      const view = statData && (statData.views[statViewIndex] || statData.views[0]);
      if (!view || view.type !== type) return;   // 期间视图被切走了就不再画

      if (type === 'ring') {
        this.setData({
          chartType: 'ring', chartW: w, chartH: h,
          lineLayout: null, bars: [],
          ring: statChart.ringLayout(statData.list, statData.listTotal || 0, w, h, ringHi)
        });
      } else {
        this.setData({
          chartType: 'line', chartW: w, chartH: h,
          ring: null, bars: [],
          lineLayout: statChart.lineLayout(statData.series || [], w, h)
        });
      }
    });
  },

  // 只换高亮项时重画环（尺寸没变，不用重新量）
  repaintRing(hi) {
    const { statData, chartType, chartW, chartH } = this.data;
    if (!statData || chartType !== 'ring' || !chartW || !chartH) return;
    this.setData({
      ring: statChart.ringLayout(statData.list, statData.listTotal || 0, chartW, chartH, hi)
    });
  },

  /* ========== 第二层：某个大类 / 品类下的实体明细 ========== */
  // 点下方的分类行、或点环外的标签 → 打开该类明细（两者行为一致）
  onListTap(e) { this.openCategoryDetail(Number(e.currentTarget.dataset.idx)); },
  onRingTap(e) { this.openCategoryDetail(Number(e.currentTarget.dataset.idx)); },

  // 点折线图上的折点 → 浮现当日数据（再点同一个点收起）
  onLineDotTap(e) {
    const { x, y, tip } = e.currentTarget.dataset;
    if (!tip) return;
    const cur = this.data.lineTip;
    if (cur && cur.text === tip && cur.x === Number(x)) {
      this.setData({ lineTip: null });
      return;
    }
    this.setData({ lineTip: { x: Number(x), y: Number(y), text: tip } });
  },

  // 点环上的扇区。
  // 不用 clip-path 热区 —— 小程序里 hit-test 不可靠（会被上层元素挡住、点哪都命中最后一个）。
  // 改为自己判断落点：按下时记位置，抬手时若基本没动就当作点击，
  // 再按「到圆心的距离 + 角度」算出是哪一段；这样在环图区域上下滑动也不会误触发。
  onRingTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._ringTouch = { x: t.clientX, y: t.clientY, at: Date.now() };
  },

  onRingTouchEnd(e) {
    const s = this._ringTouch;
    this._ringTouch = null;
    if (!s || !this.data.ring) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    // 移动超过 10px、或按了太久 → 判定为在滚动，不当作点击
    if (Math.sqrt(dx * dx + dy * dy) > 10 || Date.now() - s.at > 800) return;
    const x = t.clientX, y = t.clientY;
    wx.createSelectorQuery().in(this).select('.ring-wrap').boundingClientRect().exec((res) => {
      const idx = statChart.hitRing(this.data.ring, res && res[0], x, y);
      if (idx >= 0) this.openCategoryDetail(idx);
    });
  },

  openCategoryDetail(idx) {
    const { statData, statCardKey, statList } = this.data;
    const item = (statList || [])[idx];
    if (!statData || !item) return;
    // 「其他」是占比过小被合并的项、「本期损耗」是摊不出去的负项 —— 都没有对应实体
    if (item.isOther || item.isLoss) return;
    const kind = CATEGORY_KIND[statCardKey];
    if (!kind) return;   // 损耗卡片的三类是费用类型，不下钻

    const cur = state.getCurrentSpace();
    const list = kind === 'material'
      ? this._materialDetail(item.key, cur)
      : this._productDetail(item.key, cur);

    this.setData({
      dtVisible: true,
      dtKind: kind,
      dtTitle: item.name,
      dtList: list,
      ringHi: idx
    });
    this.repaintRing(idx);
  },

  _materialDetail(mcId, cur) {
    const cc = palette.colorOf(store.getList('materialCategory', cur), mcId, 0);
    return store.getMaterials()
      .filter(m => (m.categoryId || 'bc_default') === cur && m.materialCategoryId === mcId)
      .map(m => {
        const b = store.materialBrief(m);
        return {
          id: m.id, name: m.name,
          thumb: (m.photos || [])[0] || '',
          placeholder: (m.name || '物').slice(0, 1),
          color: cc.bg, ink: cc.inkSoft,
          sub: b.stockText,
          valueText: b.priceSeg
        };
      });
  },

  _productDetail(pcId, cur) {
    const cc = palette.colorOf(store.getList('productCategory', cur), pcId, palette.PRODUCT_OFFSET);
    return store.getProducts()
      .filter(p => (p.categoryId || 'bc_default') === cur && p.productCategoryId === pcId)
      .map(p => {
        const stock = (p.sellableStock || 0) + (p.sampleStock || 0);
        const cost = (p.costSnapshot && p.costSnapshot.totalCost) || 0;
        return {
          id: p.id, name: p.name,
          thumb: (p.photos || [])[0] || '',
          placeholder: (p.name || '成').slice(0, 1),
          color: cc.bg, ink: cc.inkSoft,
          sub: '库存 ' + stock + ' 件 · 成本 ' + util.money(cost),
          valueText: '×' + stock
        };
      });
  },

  closeDetail() {
    this.setData({ dtVisible: false, dtList: [], ringHi: -1 });
    this.repaintRing(-1);
  },

  // 点明细行 → 进物料详情 / 成品详情
  goDetailItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const url = this.data.dtKind === 'material'
      ? '/pages/materials/detail?id=' + id
      : '/pages/products/detail?id=' + id;
    util.navTo({ url });
  },

  preventTouchMove() {},
  noop() {}
});
