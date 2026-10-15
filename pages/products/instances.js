// pages/products/instances.js —— 单成品「商品 / 样品」独立管理页
const store = require('../../utils/store.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const palette = require('../../utils/palette.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    id: '', type: 'merch',
    name: '', thumb: '', placeholder: '成', color: '#DED3C0', ink: 'rgba(138,122,92,0.5)', pcName: '', count: 0, costText: '',
    sales: [],
    // 数量输入面板
    showQty: false, qtyTitle: '', qtyValue: '', qtyMode: '',
    // 「这批实际用料」（2026-09-27 V74）：默认按 BOM 每件用量算好，用户只改要改的行
    usageLines: [], usageExpanded: false,
    // 记录售出面板：价格可按单价 / 总价录入（与成品详情页同一套交互）
    showSell: false, sellQty: '1', sellPrice: '', sellDate: '', sellClient: '', sellMode: 'unit', sellPreview: '',
    sellUnitCost: 0, sellInfo: '',
    dpSell: false,
    // 样品出库面板（销毁 / 自用 / 赠送…）
    showDiscard: false, dcQty: '1', dcReason: '销毁', dcDate: '', dcCostText: '0.00', dcRemark: '',
    dcTypeList: ['销毁', '自用', '赠送', '其他'],
    dpDc: false
  },

  onLoad(options) {
    const type = options.type === 'sample' ? 'sample' : 'merch';
    this.setData({ id: options.id, type });
    wx.setNavigationBarTitle({ title: type === 'sample' ? '样品管理' : '商品管理' });
    // 从作品集长按菜单的「出库」跳进来时，自动把出库面板打开（不重复做一套 UI）
    if (options.action === 'discard') this._autoDiscard = true;
    if (options.action === 'sell') this._autoSell = true;
    this.reload();
  },
  onShow() {
    themePage.apply(this);   // 按当前手作空间上色（V97）
    this.reload();
    if (this._autoDiscard) { this._autoDiscard = false; this.openDiscard(); }
    if (this._autoSell) { this._autoSell = false; this.openSell(); }
  },

  reload() {
    const p = store.getProduct(this.data.id);
    if (!p) { util.toast('成品不存在'); return; }
    const type = this.data.type;
    const count = type === 'sample'
      ? util.round(p.sampleStock || 0, 2)
      : util.round(p.sellableStock || 0, 2);
    const pcList = store.getList('productCategory');
    const pcMap = {}; pcList.forEach(x => pcMap[x.id] = x.name);
    const cc = palette.colorOf(pcList, p.productCategoryId, palette.PRODUCT_OFFSET);
    const c = calc.computeProduct(p);

    // 已售记录（商品页展示；样品无逐件记录）
    const sales = (p.sales || []).map((s, i) => {
      const c0 = calc.computeProduct(p);
      const cost = (s.costSnapshot && s.costSnapshot.totalCost) != null ? s.costSnapshot.totalCost : c0.totalCost;
      const profit = util.round(s.qty * (s.price - cost), 2);
      return {
        idx: i, qty: s.qty, price: util.money(s.price), date: s.date,
        amount: util.money(util.round(s.qty * s.price, 2)),
        profit: util.money(profit)
      };
    });

    this.setData({
      name: p.name,
      thumb: (p.photos || [])[0] || '',
      placeholder: (p.name || '成').slice(0, 1),
      color: cc.bg, ink: cc.inkSoft,
      pcName: pcMap[p.productCategoryId] || '其他',
      count,
      costText: '成本 ¥' + util.money(c.totalCost),
      sales
    });
  },

  goDetail() { util.navTo({ url: '/pages/products/detail?id=' + this.data.id }); },
  noop() {},

  /* ===== 动作入口：先弹数量输入 ===== */
  openProduceQty() {
    const p = store.getProduct(this.data.id);
    this.setData({
      showQty: true, qtyTitle: '增加成品数量', qtyValue: '1', qtyMode: 'produce',
      // 「这批实际用料」（2026-09-27 V74）：默认按 BOM 每件用量算好，用户只改要改的行
      // V130（2026-10-10）：**默认展开** —— 「让用户直接看到，不要点『可改』再展开」。
      usageLines: p ? calc.produceUsageLines(p.bom, 1) : [], usageExpanded: true
    });
  },
  openTransferQty() {
    const t = this.data.type === 'sample' ? '转为商品（件）' : '转为样品（件）';
    this.setData({ showQty: true, qtyTitle: t, qtyValue: '1', qtyMode: 'transfer', usageLines: [], usageExpanded: false });
  },
  onQtyInput(e) {
    const v = e.detail.value;
    // 数量变了 → 默认用量跟着重算（用户改过的行保留输入）；数量非法时不重算，避免整块闪没
    const p = this.data.qtyMode === 'produce' ? store.getProduct(this.data.id) : null;
    const q = Number(v);
    const usageLines = (q > 0 && p) ? calc.retuneUsageLines(this.data.usageLines, p.bom, q) : this.data.usageLines;
    this.setData({ qtyValue: v, usageLines: usageLines });
  },
  closeQty() {
    this.setData({ showQty: false, qtyValue: '', qtyMode: '', usageLines: [], usageExpanded: false });
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

  confirmQty() {
    const q = Number(this.data.qtyValue);
    if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
    const mode = this.data.qtyMode;
    this.setData({ showQty: false, qtyValue: '' });
    const p = store.getProduct(this.data.id);
    if (!p) return;

    if (mode === 'produce') {
      // 「这批实际用料」：只把用户改过的行作为覆盖传下去；没改的行零影响（2026-09-27 V74）
      const ov = calc.produceOverrides(this.data.usageLines);
      // V123：**就在这一步**把"料够不够"说清楚（在进裁剪页**之前**）——
      //   ① checkBomStock 返回的是**缺料清单**、不抛错；只 try/catch 等于没校验
      //      （用户 2026-10-08：辅料不够时"系统不会提醒"，还让人白跑一趟裁剪页）；
      //   ② 等用户排完裁剪再拦，提示会**随裁剪页一起关闭** ⇒ 什么都看不见。
      let short = [];
      try { short = store.checkBomStock(p, q, ov) || []; }
      catch (err) { util.toast(err.msg || '物料库存不足'); return; }
      if (short.length) { util.alert('物料不够，先补货', util.shortageMessage(short)); return; }
      // 需要先排裁剪的行统一走 calc.cutQueueFor：刀口布（按批估量）不裁剪，
      // 手写 `b.isFabric` 会把刀口布也算进去而强制弹剪裁选择器（2026-09-12 真机反馈）
      // （V92 去掉了 overrides 参数 —— 面板里剩下的行本来就一条都进不了这个队列）
      const queue = calc.cutQueueFor(p.bom, q);
      if (queue.length) {
        // 2026-09-30 V90：走裁剪排版页的**排片模式**（与成品列表页同一处改动）
        util.navTo({
          url: '/pages/cut-editor/cut-editor?mode=queue',
          events: {
            onChoose: (data) => {
              // 第 6 个参数 = 逐件选择（perPiece）—— 见 list.js 同一处的说明。
              // 数量以**回传的 qty 为准**（V90）：那一屏里片数能加减 = 件数能改。
              const n = Math.max(1, Number(data && data.qty) || q);
              try { store.produceProduct(this.data.id, n, null, this.data.type === 'sample' ? 'sample' : null, ov, data.chosen); util.toast('已增加 ' + n + ' 件库存', 'success'); this.reload(); }
              catch (err) { util.toast(err.msg || '物料库存不足'); }
            }
          },
          success: (res) => {
            if (res.eventChannel) res.eventChannel.emit('passQueue', { queue: queue, qty: q });
          }
        });
      } else {
        try { store.produceProduct(this.data.id, q, null, this.data.type === 'sample' ? 'sample' : null, ov); util.toast('已增加 ' + q + ' 件库存', 'success'); this.reload(); }
        catch (err) { util.toast(err.msg || '物料库存不足'); }
      }
    } else if (mode === 'transfer') {
      const toNature = this.data.type === 'sample' ? 'merchandise' : 'sample';
      const fromNature = this.data.type === 'sample' ? 'sample' : 'merchandise';
      try {
        store.transferProduct(this.data.id, fromNature, toNature, q);
        util.toast('已完成转类', 'success'); this.reload();
      } catch (err) { util.toast(err.msg || '转类失败'); }
    }
  },

  /* ===== 记录售出：价格可按「单价 / 总价」录入（与 products/detail 同一套，改动请同步） ===== */
  openSell() {
    const p = store.getProduct(this.data.id) || {};
    const price = p.price ? String(util.round(p.price, 2)) : '';
    // 每件成本：利润率 =（实际售价 − 每件成本）÷ 实际售价
    const unitCost = util.round((calc.computeProduct(p) || {}).totalCost || 0, 2);
    // 「卖给谁」默认带出关联排单的客户（2026-09-27 D76，与成品详情页同口径）
    const linkedC = store.getCommissions().filter(x => x.productId === this.data.id && x.client);
    const firstClient = (linkedC[0] || {}).client || '';
    this.setData({
      showSell: true, sellMode: 'unit', sellUnitCost: unitCost,
      sellQty: '1', sellPrice: price, sellDate: util.today(), sellClient: firstClient,
      sellPreview: '', sellInfo: ''
    });
    this.refreshSellPreview('1', price, 'unit');
  },
  closeSell() { this.setData({ showSell: false }); },

  // 单价 / 总价 切换：同一个输入框，换的是「你填的是哪种价」
  switchSellMode(e) {
    const mode = e.currentTarget.dataset.m;
    this.setData({ sellMode: mode });
    this.refreshSellPreview(this.data.sellQty, this.data.sellPrice, mode);
  },

  // 实时换算：按单价填显示「合计」，按总价填显示「折合单价」；并附上成本与利润率
  refreshSellPreview(qty, amount, mode) {
    const q = Number(qty), a = Number(amount);
    const m = mode || this.data.sellMode;
    if (amount === '' || amount == null || !(q > 0) || isNaN(a)) {
      this.setData({ sellPreview: '', sellInfo: '' });
      return;
    }
    const unit = m === 'unit' ? a : a / q;
    const cost = Number(this.data.sellUnitCost) || 0;
    const rate = unit > 0 ? (unit - cost) / unit : 0;
    this.setData({
      sellPreview: m === 'unit'
        ? '合计 ¥' + util.money(util.round(q * a, 2))
        : '折合单价 ¥' + util.money(util.round(unit, 2)),
      sellInfo: '成本 ¥' + util.money(cost) + ' · 利润率 ' + util.percent(rate, 1)
    });
  },

  onSellQty(e) { this.setData({ sellQty: e.detail.value }); this.refreshSellPreview(e.detail.value, this.data.sellPrice); },
  onSellPrice(e) { this.setData({ sellPrice: e.detail.value }); this.refreshSellPreview(this.data.sellQty, e.detail.value); },
  onSellDate(e) { this.setData({ sellDate: e.detail.value }); },
  onSellClient(e) { this.setData({ sellClient: e.detail.value }); },
  openSellDate() { this.setData({ dpSell: true }); },
  closeSellDate() { this.setData({ dpSell: false }); },

  confirmSell() {
    const q = Number(this.data.sellQty), a = Number(this.data.sellPrice);
    if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
    if (this.data.sellPrice === '' || isNaN(a) || a < 0) {
      util.toast(this.data.sellMode === 'unit' ? '请输入单价' : '请输入总价'); return;
    }
    // store 里存的一律是单价：按总价录入时在这里折算（保留 2 位小数）
    const unitPrice = this.data.sellMode === 'unit' ? a : util.round(a / q, 2);
    try {
      store.sellProduct(this.data.id, q, unitPrice, this.data.sellDate, this.data.sellClient);
      util.toast('已卖出 ' + q + ' 件', 'success');
      this.setData({ showSell: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '出库失败'); }
  },

  /* ===== 样品出库：销毁 / 自用 / 赠送… 只记成本、不计利润 ===== */
  openDiscard() {
    const p = store.getProduct(this.data.id) || {};
    const unitCost = util.round((calc.computeProduct(p) || {}).totalCost || 0, 2);
    this.setData({
      showDiscard: true, dcQty: '1', dcReason: '销毁',
      dcDate: util.today(), dcCostText: util.money(unitCost), dcRemark: ''
    });
  },
  closeDiscard() { this.setData({ showDiscard: false }); },
  onDcQty(e) { this.setData({ dcQty: e.detail.value }); },
  onDcRemark(e) { this.setData({ dcRemark: e.detail.value }); },
  pickDcType(e) { this.setData({ dcReason: e.currentTarget.dataset.r }); },
  onDcDate(e) { this.setData({ dcDate: e.detail.value }); },
  openDcDate() { this.setData({ dpDc: true }); },
  closeDcDate() { this.setData({ dpDc: false }); },

  confirmDiscard() {
    const q = Number(this.data.dcQty);
    if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
    try {
      store.discardSample(this.data.id, q, this.data.dcReason, this.data.dcDate, this.data.dcRemark);
      util.toast('已出库 ' + q + ' 件 · ' + this.data.dcReason, 'success');
      this.setData({ showDiscard: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '出库失败'); }
  }
});
