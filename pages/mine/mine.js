// pages/mine/mine.js —— 我的（M1-15 / M1-17 / M1-12 入口）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const stat = require('../../utils/stat.js');   // 累计总账（V131）
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

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
    openid: '', curSpace: '',
    stat: { materials: 0, products: 0, commissions: 0 },
    lossBreak: null, dispNet: '0.00'
  },

  // V116：首帧量一次固定带高度（onReady 时几何已就绪）
  onReady() {
    this.measureBand();
  },

  onShow() {
    this.measureBand();   // V116：切回本页/换主题后重新量（内容与字号都可能变）

    themePage.apply(this);   // 按当前手作空间上色（V97）
    const cats = store.getBusinessCategories();
    const cur = state.getCurrentSpace();
    const curSpace = (cats.find(c => c.id === cur) || {}).name || '';

    const metrics = calc.dashboardMetrics(cur);
    const now = new Date();
    const ml = store.getMonthlyLossCost(now.getFullYear(), now.getMonth() + 1);
    const netProfit = util.round((metrics.totalProfit || 0) - ml.total, 2);

    // 累计总账（2026-10-10 V131）：自记账第一天至今。
    // 主数字按用户拍板用 A（累计投入 = 一共掏了多少钱），B（累计已耗）作副标。
    let ledger = null;
    try {
      const t = stat.cumulativeTotals({ categoryId: cur });
      ledger = {
        spendAText: util.money(t.spendA.total),
        spendBText: util.money(t.spendB.total),
        incomeText: util.money(t.income.total),
        rangeText: (t.from || '') + ' 起'
      };
    } catch (e) { /* 算不出来就不显示这张卡，别把页面带崩 */ }

    this.setData({
      openid: store.getOpenid().slice(-6),
      curSpace,
      stat: {
        materials: store.getMaterials().filter(m => (m.categoryId || 'bc_default') === cur).length,
        products: store.getProducts().filter(p => (p.categoryId || 'bc_default') === cur).length,
        commissions: store.getCommissions().filter(c => (c.categoryId || 'bc_default') === cur).length
      },
      lossBreak: ml,
      ledger,
      dispNet: util.money(netProfit)
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
  },

  go(e) { util.navTo({ url: e.currentTarget.dataset.url }); },
  goLossDetail() { util.navTo({ url: '/pages/loss/index' }); },
  goLedger() { util.navTo({ url: '/pages/ledger/ledger' }); }
});
