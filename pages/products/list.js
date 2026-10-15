// pages/products/list.js —— 作品集总库：作品集(全部) ⊃ 商品·待售 / 商品·已售 / 样品
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const palette = require('../../utils/palette.js');

// 各视图可用的排序项（成对：高→低 / 低→高 放在同一行）
const SORT_OPTIONS = {
  all: [
    [{ key: 'created_desc', name: '最近创建' }, { key: 'created_asc', name: '最早创建' }],
    [{ key: 'stock_desc', name: '总库存高→低' }, { key: 'stock_asc', name: '总库存低→高' }],
    [{ key: 'price_desc', name: '单价高→低' }, { key: 'price_asc', name: '单价低→高' }],
    [{ key: 'hours_desc', name: '耗时多→少' }, { key: 'hours_asc', name: '耗时少→多' }],
    [{ key: 'materialCost_desc', name: '物料成本高→低' }, { key: 'materialCost_asc', name: '物料成本低→高' }],
    [{ key: 'profit_desc', name: '利润高→低' }, { key: 'profit_asc', name: '利润低→高' }],
    [{ key: 'name_asc', name: '名称 A→Z' }, { key: 'name_desc', name: '名称 Z→A' }]
  ],
  merch: [
    [{ key: 'profit_desc', name: '利润高→低' }, { key: 'profit_asc', name: '利润低→高' }],
    [{ key: 'price_desc', name: '单价高→低' }, { key: 'price_asc', name: '单价低→高' }],
    [{ key: 'hours_desc', name: '耗时多→少' }, { key: 'hours_asc', name: '耗时少→多' }],
    [{ key: 'materialCost_desc', name: '物料成本高→低' }, { key: 'materialCost_asc', name: '物料成本低→高' }],
    [{ key: 'stock_desc', name: '库存多→少' }, { key: 'stock_asc', name: '库存少→多' }],
    [{ key: 'created_desc', name: '最近创建' }, { key: 'created_asc', name: '最早创建' }]
  ],
  sold: [
    [{ key: 'date_desc', name: '最近售出' }, { key: 'date_asc', name: '最早售出' }],
    [{ key: 'qty_desc', name: '销量高→低' }, { key: 'qty_asc', name: '销量低→高' }],
    [{ key: 'profit_desc', name: '总利润高→低' }, { key: 'profit_asc', name: '总利润低→高' }],
    [{ key: 'rate_desc', name: '利润率高→低' }, { key: 'rate_asc', name: '利润率低→高' }]
  ],
  sample: [
    [{ key: 'cost_desc', name: '成本高→低' }, { key: 'cost_asc', name: '成本低→高' }],
    [{ key: 'price_desc', name: '单价高→低' }, { key: 'price_asc', name: '单价低→高' }],
    [{ key: 'hours_desc', name: '耗时多→少' }, { key: 'hours_asc', name: '耗时少→多' }],
    [{ key: 'materialCost_desc', name: '物料成本高→低' }, { key: 'materialCost_asc', name: '物料成本低→高' }],
    [{ key: 'stock_desc', name: '库存多→少' }, { key: 'stock_asc', name: '库存少→多' }],
    [{ key: 'created_desc', name: '最近创建' }, { key: 'created_asc', name: '最早创建' }]
  ]
};

const TIME_RANGES = [
  { key: 'all', name: '全部时间' },
  { key: '7d', name: '最近 7 天' },
  { key: '30d', name: '最近 30 天' },
  { key: 'year', name: '今年' }
];

const DEFAULT_SORT = { all: 'created_desc', merch: 'profit_desc', sold: 'date_desc', sample: 'created_desc' };


function inRange(date, range) {
  if (range === 'all') return true;
  const d = new Date(date);
  const now = new Date();
  if (isNaN(d.getTime())) return true;
  if (range === '7d') { const t = new Date(now); t.setDate(t.getDate() - 7); return d >= t; }
  if (range === '30d') { const t = new Date(now); t.setDate(t.getDate() - 30); return d >= t; }
  if (range === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

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
    view: 'all',                   // all | merch | sold | sample
    renderMode: 'list',            // list | grid（鸟瞰）
    filterOpen: false,             // 筛选弹层
    filterSnap: null,              // 打开弹层时的筛选快照（取消可还原）
    searchText: '',
    selectedKeywords: [],          // 多选：productCategoryId 列表
    selectedKwMap: {},             // { [id]: true }，供 WXML 可靠高亮
    sortKey: '',                   // 当前排序（''=默认）
    timeRange: 'all',              // 已售时间范围
    kwOptions: [],                 // 关键词 chips [{id,name}]
    sortOptions: SORT_OPTIONS.all,
    timeRanges: TIME_RANGES,
    headerSummary: '',             // 标题下方的统计行
    filteredCount: 0,              // 当前命中条数（筛选弹层反馈用）
    activeFilterCount: 0,          // 已激活的筛选条件数（筛选按钮角标用）
    list: [],                      // 渲染项（kind: prod | sale）
    // 长按菜单
    showAction: false, actionProd: null,
    showQtyInput: false, qtyTitle: '', qtyValue: '', qtyMode: '',
    // 「这批实际用料」（2026-09-27 V74）：默认按 BOM 每件用量算好，用户只改要改的行。
    // 纯计算在 utils/calc.js（可单测），这里只存展示状态。
    usageLines: [], usageExpanded: false
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
      // 手作空间已切换（可能来自其它页面），清空本页局部筛选并回到「作品集全集」
      this._spaceToken = cur;
      this.clearLocalFilters();
    }
    this.reload();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  clearLocalFilters() {
    this.setData({ searchText: '', selectedKeywords: [], sortKey: '', timeRange: 'all', view: 'all' });
  },

  reload() {
    const cur = state.getCurrentSpace();
    const pcList = store.getList('productCategory');
    const pcMap = {}; pcList.forEach(c => pcMap[c.id] = c.name);
    // 无图占位块配色：按成品品类取色（与物料体系错开）
    const pcColor = {};
    pcList.forEach(c => {
      const cc = palette.colorOf(pcList, c.id, palette.PRODUCT_OFFSET);
      pcColor[c.id] = { color: cc.bg, ink: cc.inkSoft };
    });
    const fallbackColor = { color: '#DED3C0', ink: 'rgba(138,122,92,0.5)' };
    const all = store.getProducts().filter(p => (p.categoryId || 'bc_default') === cur);
    const { view, searchText, selectedKeywords, sortKey, timeRange } = this.data;
    const kw = (searchText || '').trim().toLowerCase();

    // 关键词选项（来自成品品类）
    const kwSet = {};
    all.forEach(p => { if (p.productCategoryId) kwSet[p.productCategoryId] = pcMap[p.productCategoryId] || '其他'; });
    const kwOptions = Object.keys(kwSet).map(id => ({ id, name: kwSet[id] }));

    // 视图基础集
    let items;
    if (view === 'sold') {
      const recs = [];
      all.filter(p => (p.sales || []).length > 0).forEach(p => {
        (p.sales || []).forEach((s, idx) => {
          const c0 = calc.computeProduct(p);
          const cost = (s.costSnapshot && s.costSnapshot.totalCost) != null ? s.costSnapshot.totalCost : c0.totalCost;
          const profit = util.round(s.qty * (s.price - cost), 2);
          const rate = s.price > 0 ? util.round((s.price - cost) / s.price, 4) : null;
          const cc = pcColor[p.productCategoryId] || fallbackColor;
          recs.push({
            kind: 'sale', id: p.id + '_' + idx, productId: p.id, name: p.name,
            date: s.date, qty: s.qty, price: s.price, profit, rate,
            rateTxt: rate == null ? '—' : util.percent(rate),
            thumb: (p.photos || [])[0] || '', placeholder: (p.name || '成').slice(0, 1),
            color: cc.color, ink: cc.ink
          });
        });
      });
      items = recs;
    } else {
      let base = all;
      // 按子库存过滤（单一 SKU 可同时持有商品+样品，所以用库存字段而非 nature 判定）
      if (view === 'merch') base = base.filter(p => util.round(p.sellableStock || 0, 2) > 0);
      else if (view === 'sample') base = base.filter(p => util.round(p.sampleStock || 0, 2) > 0);
      items = base.map(p => {
        const c = calc.computeProduct(p);
        const sellable = util.round(p.sellableStock || 0, 2);
        const sample = util.round(p.sampleStock || 0, 2);
        const cc = pcColor[p.productCategoryId] || fallbackColor;
        return {
          kind: 'prod', id: p.id, name: p.name, thumb: (p.photos || [])[0] || '',
          pcId: p.productCategoryId, pcName: pcMap[p.productCategoryId] || '其他',
          placeholder: (p.name || '成').slice(0, 1),
          color: cc.color, ink: cc.ink,
          nature: p.nature, sellableStock: sellable, sampleStock: sample,
          total: util.round(sellable + sample, 2),
          price: p.price || 0, profit: c.profit, profitRate: c.profitRate, cost: c.totalCost,
          materialCost: c.materialCost,
          laborHours: p.includeLabor ? (p.laborMode === 'perPiece' ? null : (p.laborHours || 0)) : null,
          rateTxt: c.profitRate == null ? '—' : util.percent(c.profitRate),
          profitTxt: '利润 ¥' + util.money(c.profit),
          priceTxt: p.price ? '¥' + util.money(p.price) : '未定价',
          costTxt: '成本 ¥' + util.money(c.totalCost)
        };
      });
    }

    // 搜索
    if (kw) {
      items = items.filter(it =>
        (it.name || '').toLowerCase().includes(kw) ||
        (it.pcName || '').toLowerCase().includes(kw) ||
        (it.placeholder || '').toLowerCase().includes(kw)
      );
    }
    // 关键词（品类）多选
    if (selectedKeywords.length) {
      if (view === 'sold') {
        const pidSet = {};
        all.forEach(p => { if (selectedKeywords.indexOf(p.productCategoryId) >= 0) pidSet[p.id] = true; });
        items = items.filter(it => pidSet[it.productId]);
      } else {
        items = items.filter(it => selectedKeywords.indexOf(it.pcId) >= 0);
      }
    }
    // 已售时间范围
    if (view === 'sold' && timeRange !== 'all') {
      items = items.filter(it => inRange(it.date, timeRange));
    }

    // 排序（双向）
    const sk = sortKey || DEFAULT_SORT[view];
    items.sort((a, b) => {
      switch (sk) {
        case 'created_desc': return (b.id || '').localeCompare(a.id || '');
        case 'created_asc': return (a.id || '').localeCompare(b.id || '');
        case 'stock_desc': return (b.total || 0) - (a.total || 0);
        case 'stock_asc': return (a.total || 0) - (b.total || 0);
        case 'name_asc': return (a.name || '').localeCompare(b.name || '');
        case 'name_desc': return (b.name || '').localeCompare(a.name || '');
        case 'profit_desc': return (b.profit || 0) - (a.profit || 0);
        case 'profit_asc': return (a.profit || 0) - (b.profit || 0);
        case 'price_desc': return (b.price || 0) - (a.price || 0);
        case 'price_asc': return (a.price || 0) - (b.price || 0);
        case 'cost_desc': return (b.cost || 0) - (a.cost || 0);
        case 'cost_asc': return (a.cost || 0) - (b.cost || 0);
        case 'materialCost_desc': return (b.materialCost || 0) - (a.materialCost || 0);
        case 'materialCost_asc': return (a.materialCost || 0) - (b.materialCost || 0);
        case 'hours_desc': return (b.laborHours == null ? -1 : b.laborHours) - (a.laborHours == null ? -1 : a.laborHours);
        case 'hours_asc': return (a.laborHours == null ? -1 : a.laborHours) - (b.laborHours == null ? -1 : b.laborHours);
        case 'date_desc': return (b.date || '').localeCompare(a.date || '');
        case 'date_asc': return (a.date || '').localeCompare(b.date || '');
        case 'qty_desc': return (b.qty || 0) - (a.qty || 0);
        case 'qty_asc': return (a.qty || 0) - (b.qty || 0);
        case 'rate_desc': return (b.rate || 0) - (a.rate || 0);
        case 'rate_asc': return (a.rate || 0) - (b.rate || 0);
        default: return 0;
      }
    });

    // 标题统计行（按库存件数统计，保证 共N件 = 商品M + 样品K）
    let headerSummary = '';
    if (view === 'all') {
      const merchPieces = all.reduce((s, p) => s + util.round(p.sellableStock || 0, 2), 0);
      const samplePieces = all.reduce((s, p) => s + util.round(p.sampleStock || 0, 2), 0);
      headerSummary = '共 ' + util.round(merchPieces + samplePieces, 2) + ' 件 · 商品 ' + merchPieces + ' · 样品 ' + samplePieces;
    } else if (view === 'merch') {
      const tp = items.reduce((s, it) => util.round(s + (it.sellableStock || 0), 2), 0);
      headerSummary = '待售 ' + tp + ' 件（计入商品数）';
    } else if (view === 'sample') {
      const tp = items.reduce((s, it) => util.round(s + (it.sampleStock || 0), 2), 0);
      headerSummary = '样品 ' + tp + ' 件（仅成本，不出利润）';
    } else {
      const tp = items.reduce((s, it) => util.round(s + it.profit, 2), 0);
      const tq = items.reduce((s, it) => s + (it.qty || 0), 0);
      headerSummary = '已售 ' + items.length + ' 笔 · ' + tq + ' 件 · 利润 ¥' + util.money(tp);
    }

    const filteredCount = items.length;
    const activeFilterCount = (searchText ? 1 : 0) + selectedKeywords.length + (sortKey ? 1 : 0) + (timeRange !== 'all' ? 1 : 0);
    const selectedKwMap = {};
    selectedKeywords.forEach(id => { selectedKwMap[id] = true; });

    this.setData({
      kwOptions,
      selectedKwMap,
      sortOptions: SORT_OPTIONS[view],
      headerSummary,
      filteredCount,
      activeFilterCount,
      list: items
    });
  },

  /* ===== 类目切换（横向 chips） ===== */
  selectCat(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ view: v, sortKey: '', timeRange: 'all' });
    this.reload();
    // V116：切「作品集/商品/样品」会多出或少掉「待售/已售」那一行 ⇒ 固定带高度变了，重量一次
    this.measureBand();
  },

  /* ===== 视图切换（列表/鸟瞰） ===== */
  toggleRenderMode() {
    this.setData({ renderMode: this.data.renderMode === 'list' ? 'grid' : 'list' });
  },

  /* ===== 筛选弹层（打开即快照，取消可还原） ===== */
  toggleFilter() {
    if (this.data.filterOpen) { this.closeFilter(); return; }
    this.setData({
      filterOpen: true,
      filterSnap: {
        searchText: this.data.searchText,
        selectedKeywords: this.data.selectedKeywords.slice(),
        sortKey: this.data.sortKey,
        timeRange: this.data.timeRange
      }
    });
  },
  // 取消：还原打开前的筛选状态并收起
  closeFilter() {
    const s = this.data.filterSnap || {};
    this.setData({
      filterOpen: false,
      searchText: s.searchText || '',
      selectedKeywords: s.selectedKeywords || [],
      sortKey: s.sortKey || '',
      timeRange: s.timeRange || 'all'
    });
    this.reload();
  },
  // 完成：保留当前选择并收起
  applyFilter() { this.setData({ filterOpen: false }); },
  // 清除：一键清空当前弹层内所有筛选条件
  clearFilter() {
    this.setData({ searchText: '', selectedKeywords: [], sortKey: '', timeRange: 'all' });
    this.reload();
  },
  onSearchInput(e) { this.setData({ searchText: e.detail.value }); this.reload(); },
  toggleKeyword(e) {
    const id = e.currentTarget.dataset.id;
    const cur = this.data.selectedKeywords.slice();
    const i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else cur.push(id);
    this.setData({ selectedKeywords: cur });
    this.reload();
  },
  setSort(e) {
    const sk = e.currentTarget.dataset.k;
    this.setData({ sortKey: this.data.sortKey === sk ? '' : sk });
    this.reload();
  },
  setTimeRange(e) {
    this.setData({ timeRange: e.currentTarget.dataset.k });
    this.reload();
  },

  noop() {},
  goDetail(e) { util.navTo({ url: '/pages/products/detail?id=' + e.currentTarget.dataset.id }); },
  goMerch(e) { util.navTo({ url: '/pages/products/instances?id=' + e.currentTarget.dataset.id + '&type=merch' }); },
  goSample(e) { util.navTo({ url: '/pages/products/instances?id=' + e.currentTarget.dataset.id + '&type=sample' }); },

  /* ===== 长按菜单：生产 / 卖出 / 转类 ===== */
  onLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const p = store.getProduct(id);
    if (!p) return;
    this.setData({
      showAction: true,
      actionView: this.data.view,   // 菜单按「长按时所在的视图」显示不同项：商品视图可卖，样品视图可出库
      actionProd: {
        id: p.id, name: p.name, nature: p.nature, price: p.price || 0,
        sellableStock: util.round(p.sellableStock || 0, 2),
        sampleStock: util.round(p.sampleStock || 0, 2)
      }
    });
  },
  closeAction() { this.setData({ showAction: false, actionProd: null }); },

  actionProduce() {
    const p = this.data.actionProd;
    this.setData({
      showAction: false, showQtyInput: true, qtyTitle: '增加成品数量', qtyValue: '1', qtyMode: 'produce',
      // 默认用量先按 1 件算好，用户改数量时会自动重算（见 onQtyInput）
      // V130（2026-10-10）：**默认展开** —— 用户要「直接看到这批要扣哪些料」，
      //   不要"先点『可改』再展开"。仍可手动收起（物料多时叠起来看按钮）。
      usageLines: p ? calc.produceUsageLines(p.bom, 1) : [], usageExpanded: true
    });
  },
  actionSell() {
    const p = this.data.actionProd;
    this.setData({ showAction: false });
    if (!p) return;
    // 跳商品管理页自动打开「记录售出」主题面板（原来在这里弹原生 showModal 确认售价）
    util.navTo({ url: '/pages/products/instances?id=' + p.id + '&type=merch&action=sell' });
  },
  actionToSample() {
    const p = this.data.actionProd;
    if (!p || p.nature === 'sample') { this.setData({ showAction: false }); return; }
    this.setData({ showAction: false, showQtyInput: true, qtyTitle: '转为样品（件）', qtyValue: '1', qtyMode: 'toSample' });
  },
  actionToMerch() {
    const p = this.data.actionProd;
    if (!p || p.nature === 'merchandise') { this.setData({ showAction: false }); return; }
    this.setData({ showAction: false, showQtyInput: true, qtyTitle: '转为商品（件）', qtyValue: '1', qtyMode: 'toMerch' });
  },
  // 样品出库（销毁 / 自用 / 赠送…）：复用「样品管理」页那套面板，带上 action=discard 自动打开
  actionDiscard() {
    const p = this.data.actionProd;
    this.setData({ showAction: false });
    if (!p) return;
    util.navTo({ url: '/pages/products/instances?id=' + p.id + '&type=sample&action=discard' });
  },

  /* ===== 数量输入面板 ===== */
  onQtyInput(e) {
    const v = e.detail.value;
    // 数量变了 → 默认用量跟着重算（用户改过的行保留输入，不被冲掉）。
    // 数量暂时非法（空/0）时不重算，否则整块会闪没。
    const p = this.data.actionProd;
    const q = Number(v);
    const usageLines = (q > 0 && p) ? calc.retuneUsageLines(this.data.usageLines, p.bom, q) : this.data.usageLines;
    this.setData({ qtyValue: v, usageLines: usageLines });
  },
  closeQtyInput() {
    this.setData({ showQtyInput: false, qtyValue: '', qtyMode: '', usageLines: [], usageExpanded: false });
  },
  toggleUsage() { this.setData({ usageExpanded: !this.data.usageExpanded }); },
  onUsageInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    const lines = this.data.usageLines.slice();
    if (!lines[i]) return;
    lines[i] = Object.assign({}, lines[i], { input: e.detail.value, touched: true });
    this.setData({ usageLines: lines });
  },
  // 面料几何行（填了长宽）自 V92 起不再进这个面板 —— 用量由裁剪界面定，
  // 所以这里不再有「一件一件剪 / 合起来剪」的处理（onCutMode / onMergedInput 已删）
  async confirmQty() {
    const q = Number(this.data.qtyValue);
    if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
    const mode = this.data.qtyMode;
    const p = this.data.actionProd;
    if (!p) return;
    this.setData({ showQtyInput: false });
    const prod = store.getProduct(p.id);
    if (!prod) { util.toast('成品不存在'); return; }

    if (mode === 'produce') {
      // 「这批实际用料」：只把用户改过的行作为覆盖传下去；没改的行零影响（2026-09-27 V74）
      const ov = calc.produceOverrides(this.data.usageLines);
      // V123：同上（成品列表页这个入口）—— 看**返回值**、并把缺什么说清楚，且必须在进裁剪页之前。
      let short = [];
      try { short = store.checkBomStock(prod, q, ov) || []; }
      catch (err) { util.toast(err.msg || '物料库存不足'); return; }
      if (short.length) { util.alert('物料不够，先补货', util.shortageMessage(short)); return; }
      // 与生产页共用同一判定（calc.cutQueueFor）：刀口布不裁剪、没填长宽的面积行也进不来，
      // 所以列出来的就是"需要用户排版的面料"（V92 去掉了 overrides 参数）
      const queue = calc.cutQueueFor(prod.bom, q);
      if (queue.length) {
        // 2026-09-30 V90：走裁剪排版页的**排片模式**（?mode=queue）——
        //   这一屏把整批排完：每片各自填长宽、各自选布，摆好一次确认（V89 还是"一件一件确认"）。
        //   回传的 data.chosen 仍是**逐件结构**（chosen[第几件][第几个面料行]），
        //   直接作为 produceProduct 的第 6 个参数（perPiece）—— 不传的话用户的选择会被静默丢掉。
        util.navTo({
          url: '/pages/cut-editor/cut-editor?mode=queue',
          events: {
            onChoose: (data) => {
              // ⚠️ 数量以**回传的 qty 为准**（V90）：那一屏里片数能加减 = 件数能改，
              //    这里若还用弹窗填的 q，用户多加的那两件就白排了（片排好了却不生产）。
              const n = Math.max(1, Number(data && data.qty) || q);
              try { store.produceProduct(p.id, n, null, null, ov, data.chosen); util.toast('已增加 ' + n + ' 件库存', 'success'); this.reload(); }
              catch (err) { util.toast(err.msg || '物料库存不足'); }
            }
          },
          success: (res) => {
            if (res.eventChannel) res.eventChannel.emit('passQueue', { queue: queue, qty: q });
          }
        });
      } else {
        try { store.produceProduct(p.id, q, null, null, ov); util.toast('已增加 ' + q + ' 件库存', 'success'); this.reload(); }
        catch (err) { util.toast(err.msg || '物料库存不足'); }
      }
    } else if (mode === 'toSample' || mode === 'toMerch') {
      // 单一 SKU 可同时持有商品+样品：转类只是把件从一个子库存搬到另一个，来源按动作决定
      const fromNature = mode === 'toSample' ? 'merchandise' : 'sample';
      const toNature = mode === 'toSample' ? 'sample' : 'merchandise';
      try {
        store.transferProduct(p.id, fromNature, toNature, q);
        util.toast(mode === 'toSample' ? '已转样品 ' + q + ' 件' : '已转商品 ' + q + ' 件', 'success');
        this.reload();
      } catch (err) { util.toast(err.msg || '转类失败'); }
    }
  }
});
