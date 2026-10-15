// pages/materials/list.js —— 物料库列表
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');
const palette = require('../../utils/palette.js');
const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

const SORT_OPTIONS = [
  [{ key: 'stock_desc', name: '库存高→低' }, { key: 'stock_asc', name: '库存低→高' }],
  [{ key: 'total_desc', name: '总价高→低' }, { key: 'total_asc', name: '总价低→高' }],
  [{ key: 'unit_desc', name: '单价高→低' }, { key: 'unit_asc', name: '单价低→高' }],
  [{ key: 'name_asc', name: '名称 A→Z' }, { key: 'name_desc', name: '名称 Z→A' }]
];

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
    keyword: '', activeMc: '', sortKey: '',
    sortOpen: false, sortSnap: null, sortOptions: SORT_OPTIONS,
    mcChips: [], list: []
  },

  // V116：首帧量一次固定带高度（onReady 时几何已就绪）
  onReady() {
    this.measureBand();
  },

  onShow() {
    this.measureBand();   // V116：切回本页/换主题后重新量（内容与字号都可能变）

    themePage.apply(this);   // 按当前手作空间上色（V97）
    const cur = state.getCurrentSpace();
    if (this._spaceToken !== cur) {
      // 手作空间已切换（可能来自其它页面），清空本页局部筛选
      this._spaceToken = cur;
      this.clearLocalFilters();
    }
    this.reload();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  clearLocalFilters() {
    this.setData({ keyword: '', activeMc: '' });
  },

  reload() {
    const mcChips = [{ id: '', name: '全部' }].concat(store.getList('materialCategory'));
    this.setData({ mcChips });
    this.applyFilter();
  },

  applyFilter() {
    const cur = state.getCurrentSpace();
    let mats = store.getMaterials().filter(m => (m.categoryId || 'bc_default') === cur);
    const { keyword, activeMc } = this.data;
    if (activeMc) mats = mats.filter(m => m.materialCategoryId === activeMc);
    if (keyword) mats = mats.filter(m => m.name.indexOf(keyword) >= 0);

    const _mcList = store.getList('materialCategory');
    const mcMap = {};
    _mcList.forEach(c => {
      const cc = palette.colorOf(_mcList, c.id, 0);
      mcMap[c.id] = { name: c.name, color: cc.bg, ink: cc.inkSoft, isFabric: !!c.isFabric };
    });

    let list = mats.map(m => {
      const mc = mcMap[m.materialCategoryId] || { name: '其他', color: '#DED3C0', ink: 'rgba(138,122,92,0.5)', isFabric: false };
      // 展示口径（库存文案 / 单价 / 单位后缀）统一取自 store.materialBrief，保证与「选择物料」弹窗一致
      const br = store.materialBrief(m);
      return {
        id: m.id, name: m.name, placeholder: (m.name || '物').slice(0, 1), mcName: mc.name, color: mc.color, ink: mc.ink,
        thumb: (m.photos || [])[0] || '',
        isFabric: br.isFabric, unit: m.unit || '', unitSuffix: br.unitSuffix, priceSeg: br.priceSeg,
        stockText: br.stockText,
        unitPriceText: util.money(br.unitPrice),
        totalPriceText: util.money(br.totalValue),
        sortStock: br.isBatch ? store.stockValue(m) : (br.isFabric ? store.fabricArea(m) : store.stockValue(m)),
        sortTotal: br.totalValue,
        sortUnitPrice: br.unitPrice,
        low: store.isLowStock(m)
      };
    });

    const { sortKey } = this.data;
    if (sortKey) {
      list.sort((a, b) => {
        switch (sortKey) {
          case 'stock_desc': return b.sortStock - a.sortStock;
          case 'stock_asc': return a.sortStock - b.sortStock;
          case 'total_desc': return b.sortTotal - a.sortTotal;
          case 'total_asc': return a.sortTotal - b.sortTotal;
          case 'unit_desc': return b.sortUnitPrice - a.sortUnitPrice;
          case 'unit_asc': return a.sortUnitPrice - b.sortUnitPrice;
          case 'name_asc': return (a.name || '').localeCompare(b.name || '');
          case 'name_desc': return (b.name || '').localeCompare(a.name || '');
          default: return 0;
        }
      });
    }
    this.setData({ list });
  },

  onSearch(e) { this.setData({ keyword: e.detail.value }); this.applyFilter(); },
  pickMc(e) { this.setData({ activeMc: e.currentTarget.dataset.id }); this.applyFilter(); },

  /* ===== 排序弹层 ===== */
  toggleSort() {
    if (this.data.sortOpen) { this.closeSort(); return; }
    this.setData({ sortOpen: true, sortSnap: { sortKey: this.data.sortKey } });
  },
  closeSort() {
    const s = this.data.sortSnap || {};
    this.setData({ sortOpen: false, sortKey: s.sortKey || '' });
    this.applyFilter();
  },
  applySort() { this.setData({ sortOpen: false }); },
  clearSort() { this.setData({ sortKey: '' }); this.applyFilter(); },
  setSort(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ sortKey: this.data.sortKey === k ? '' : k });
    this.applyFilter();
  },
  noop() {},

  goDetail(e) { util.navTo({ url: '/pages/materials/detail?id=' + e.currentTarget.dataset.id }); },
  goEdit() { util.navTo({ url: '/pages/materials/edit' }); },
  goBulk() { util.navTo({ url: '/pages/materials/bulkin' }); }
});
