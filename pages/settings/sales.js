// pages/settings/sales.js —— 成品出入库（销售 / 生产，跨成品汇总）
// 2026-09-27（V73）由「销售记录」改名 —— 本页含出（销售）与进（生产）两条
//
// 2026-09-27 D75/D76。系统里没有「成品流水表」，成品的进出挂在成品对象上
// （p.productions / p.sales）⇒ 本页做**展示层聚合**，聚合逻辑全在 services/trace.js
// （纯函数 + 单测），页面只负责取数、筛条件、拼展示字段 —— 这样核心口径可被自动化测试覆盖。
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const trace = require('../../services/trace.js');
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

const CURVE_DAYS = 30;      // 曲线固定窗口（与「物料出入库」页的"近 30 天"对齐）

// 近 N 天日期（升序，含今天）—— 交给 trace.dailySeries 当"柱子槽位"
// ⚠️ 日期加减只在有 util 的地方做：trace.js 是零依赖的纯函数层，不许 require util
function recentDates(end, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(util.addDays(end, -i));
  return out;
}

Page({
  data: {
    curName: '全部空间',
    tab: 'sales',                    // sales（出）| production（进）
    rows: [],
    summary: { count: 0, qty: 0, amountText: '0.00' },
    // V144：趋势曲线（与「物料出入库」页对称 —— 那边是物料的进/出，这边是成品的出/进）
    curvePoints: [], curveLabel: '销售额', curveSummary: '', curveEmptyText: '暂无数据',
    curveUnit: '¥', curveUnitPos: 'pre',
    kw: '', dateStart: '', dateEnd: '',
    dpStart: false, dpEnd: false
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    const curName = (cats.find(c => c.id === cur) || {}).name || '全部空间';

    const opts = {
      categoryId: cur,
      dateStart: this.data.dateStart,
      dateEnd: this.data.dateEnd,
      kw: this.data.kw
    };
    const isSales = this.data.tab === 'sales';
    const products = store.getProducts();
    const raw = isSales ? trace.salesLog(products, opts) : trace.productionLog(products, opts);
    const sum = trace.summarize(raw, isSales ? 'amount' : 'cost');

    // 展示字段在 js 里拼好，wxml 保持简单（避免模板里做计算）
    const rows = raw.map(r => (isSales ? {
      id: r.id, productId: r.productId, productName: r.productName, date: r.date,
      qty: r.qty, client: r.client,
      amountText: util.money(r.amount),
      subText: '单价 ¥' + util.money(r.price)
    } : {
      id: r.id, productId: r.productId, productName: r.productName, date: r.date,
      qty: r.qty, client: '',
      amountText: util.money(r.cost),
      subText: '单件 ¥' + util.money(r.unitCost)
    }));

    // ---------- 趋势曲线（V144 新增）----------
    // ⭐ 与「物料出入库」页**刻意对称**（那页是物料的进/出，本页是成品的出/进），
    //    对称的四件事：图形、量纲、区间、摘要写法。
    //   · 图形：一天卖了几笔 / 做了几批 —— **离散事件** ⇒ 柱状（有动作的那天才有柱）
    //   · 量纲：**金额**（销售=销售额、生产=扣料成本），与 V143 统一后的物料页一致；
    //     件数放进摘要（"共 N 件"）而不是当纵轴 —— 一张图只能有一个量纲。
    //   · 区间：**固定近 30 天**，⚠️ **不跟随下面的日期筛选** ——
    //     同一张卡里出现两个时间概念（"近 30 天" vs "你筛的区间"）必然有人看错；
    //     物料页也是这么定的。关键词（成品名）照旧跟随 —— 那是"看哪个成品"，不是时间。
    //   · 图形跟随 tab：切「销售」看销售额柱，切「生产」看扣料成本柱（不用再加一组分段控件）。
    const days = recentDates(util.today(), CURVE_DAYS);
    const curveLog = isSales
      ? trace.salesLog(products, { categoryId: cur, kw: this.data.kw })
      : trace.productionLog(products, { categoryId: cur, kw: this.data.kw });
    const cs = trace.dailySeries(curveLog, days, isSales ? 'amount' : 'cost');
    const verb = isSales ? '销售' : '生产';
    const kwTrim = (this.data.kw || '').trim();
    const curveSummary = CURVE_DAYS + ' 天里 ' + cs.activeDays + ' 天有' + verb +
      '　合计 ¥' + util.money(cs.total) +
      '　共 ' + util.trimNum(cs.totalQty, 2) + ' 件' +
      (cs.peak && cs.peak.value > 0
        ? '　最多 ' + String(cs.peak.date).slice(5) + ' ¥' + util.money(cs.peak.value)
        : '') +
      (kwTrim ? '　（已按「' + kwTrim + '」筛选）' : '');

    this.setData({
      curName,
      rows,
      summary: { count: sum.count, qty: sum.qty, amountText: util.money(sum.amount) },
      curvePoints: cs.points,
      curveLabel: isSales ? '销售额' : '生产扣料成本',
      curveSummary: curveSummary,
      curveEmptyText: '近 ' + CURVE_DAYS + ' 天没有' + verb + '记录'
    });
  },

  switchTab(e) {
    const t = e.currentTarget.dataset.t;
    if (t === this.data.tab) return;
    this.setData({ tab: t });
    this.reload();
  },
  onKw(e) { this.setData({ kw: e.detail.value }); this.reload(); },
  onDateStart(e) { this.setData({ dateStart: e.detail.value }); this.reload(); },
  onDateEnd(e) { this.setData({ dateEnd: e.detail.value }); this.reload(); },
  openDateStart() { this.setData({ dpStart: true }); },
  openDateEnd() { this.setData({ dpEnd: true }); },
  closeDate() { this.setData({ dpStart: false, dpEnd: false }); },
  resetFilters() { this.setData({ dateStart: '', dateEnd: '', kw: '' }); this.reload(); },

  // 点一行进成品详情 —— 全链路追溯的下一跳（从记录回到那个成品）
  goProduct(e) {
    util.navTo({ url: '/pages/products/detail?id=' + e.currentTarget.dataset.pid });
  }
});
