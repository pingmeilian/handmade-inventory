// pages/products/detail.js —— 成品详情（M1-06 / M1-09 / M1-21）
const store = require('../../utils/store.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
// ⛔ 2026-10-09 移除两样东西（详见台账 V126）：
//    · `const share = require('../../utils/share.js')` —— 原本只被 `_shareFile()` 用
//    · `PALETTE`（材料属性色块调色板）—— 原本只喂 `_drawCard()` 画属性色块
//    这两处都属于详情页那块「可视化教程卡」，而它早已是**没人调用的死代码**
//    （`generateTutorialCard()` 全项目无引用），这次随教程功能一起清掉了。
//    ⚠️ 恢复教程功能**不需要**它们：教程卡的绘制与转发都在导出页里另有一份。
//    另外那行注释「字母头像的配色板」是历史遗留的错误说明 —— PALETTE 从来只给教程卡用。

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    id: '', p: null, pcName: '', bcName: '',
    c: null, bomLines: [],
    sales: [], saleTotal: '0.00',
    linkedCommissions: [],
    tutorial: null,
    // ⛔ 图文教程暂不上架（2026-10-09 · 台账 V126）：改成 true 就恢复详情页那张教程卡片。
    //    数据与逻辑都还在，只是不渲染。edit.js 里有一个同名开关，两处要一起改。
    showTutorial: false,
    // 记录售出：价格可以按「单价」或「总价」录入（saleMode）
    showSale: false, saleQty: '1', salePrice: '', saleDate: '', saleClient: '',
    saleMode: 'unit', salePreview: '', saleUnitCost: 0, saleInfo: '',
    // 主题日期选择器（替代原生 mode="date"）
    dpSale: false,
    sheetKey: '', costSummary: '', lossSummary: '',
    costRows: [], lossRows: [],
    // 盘库面板：待售 / 样品 分别填实测件数
    showStocktake: false, stkSellable: '', stkSample: '', stkUnitCost: 0, stkPreview: '', stkRemark: '盘库盈亏',
    // 转类面板（商品 ⇄ 样品）
    showTransfer: false, transferNature: 'sample', transferMax: 0, transferTitle: '', transferQty: '1'
  },

  onLoad(options) { this.setData({ id: options.id, saleDate: util.today() }); this.reload(); },
  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const p = store.getProduct(this.data.id);
    if (!p) { util.toast('成品不存在'); return; }
    const c = calc.computeProduct(p);
    const pcMap = {}; store.getList('productCategory').forEach(x => pcMap[x.id] = x.name);
    const bcMap = {}; store.getBusinessCategories().forEach(x => bcMap[x.id] = x.name);

    const bomLines = (p.bom || []).map(b => {
      const m = store.getMaterial(b.materialId);
      const r = calc.bomLineCost(b, m);
      return {
        name: b.materialName, cost: util.money(r.cost),
        // 规格口径统一走 calc.bomLineSpec：刀口布显示「每件用量」，不再被当成面积（2026-09-12）
        spec: calc.bomLineSpec(b, m)
      };
    });

    const sales = (p.sales || []).map((s, i) => ({
      rid: s.id || i,   // 优先用记录 id；老数据无 id 时回退下标
      qty: s.qty, price: util.money(s.price), date: s.date, amount: util.money(util.round(s.qty * s.price, 2))
    }));
    const productions = (p.productions || []).map((pr, i) => ({ rid: pr.id || i, qty: util.round(pr.qty, 2), date: pr.date }));
    const saleTotal = util.money((p.sales || []).reduce((s, x) => s + x.qty * x.price, 0));

    const linked = store.getCommissions().filter(x => x.productId === p.id)
      .map(x => ({
        id: x.id,
        name: x.client || '排单',
        // 原始客户名（2026-09-27 D76）：供「记录售出」一键填入「卖给谁」。
        // 与 name 分开，因为 name 有「排单」兜底 —— 那是显示用的，不能当客户名填进去。
        client: x.client || '',
        remain: util.round((x.qty || 0) - (x.deliveredQty || 0), 2),
        status: x.status
      }));

    const tutRaw = p.tutorial || {};
    const matNameMap = {}; store.getMaterials().forEach(m => { matNameMap[m.id] = m.name; });
    const tut = (tutRaw.steps && tutRaw.steps.length) ? {
      title: tutRaw.title || '',
      steps: tutRaw.steps.map(s => ({
        title: s.title || '',
        body: s.body || '',
        images: (s.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
        matNames: (s.mats || []).map(id => matNameMap[id] || '物料')
      }))
    } : null;

    // WXML 表达式不支持方法调用(.toFixed)，金额/利润率在此预格式化为字符串
    const profitRateText = c.profitRate == null ? '—' : Math.round(c.profitRate * 100) + '%';
    const targetProfitText = Math.round(c.targetProfit * 100) + '%';
    const costText = {
      materialCost: util.money(c.materialCost),
      packaging: util.money(c.packaging),
      shipping: util.money(c.shipping),
      profit: util.money(c.profit)
    };

    // 损耗分摊参考（中方案）：本月损耗成本 ÷ 本月生产件数，仅展示不计入硬成本/售价
    const now = new Date();
    const loss = store.getMonthlyLossCost(now.getFullYear(), now.getMonth() + 1);
    const produced = store.getMonthlyProducedUnits(now.getFullYear(), now.getMonth() + 1);
    const producedText = (Math.round(produced) === produced) ? String(Math.round(produced)) : util.money(produced);
    const lossRef = {
      lossText: util.money(loss.total),
      consumableText: util.money(loss.consumableAmort),
      depreciationText: util.money(loss.depreciation),
      toolText: util.money(loss.toolExpense),
      producedText: producedText,
      perText: produced > 0 ? util.money(util.round(loss.total / produced, 2)) : '—',
      hasProduced: produced > 0
    };

    // 折叠卡片摘要 + 二级面板明细行（不在首屏平铺，点击标题弹出）
    const totalCost = util.round(c.materialCost + c.packaging + c.shipping + c.profit, 2);
    const costSummary = p.nature === 'sample'
      ? ('总成本 ¥' + util.money(totalCost) + '（样品无利润）')
      : ('总成本 ¥' + util.money(totalCost) + ' · 利润 ¥' + util.money(c.profit));
    const costRows = [
      { label: '物料成本', value: '¥' + costText.materialCost },
      { label: '人工（即利润）', value: '¥' + costText.profit },
      { label: '包装', value: '¥' + costText.packaging },
      { label: '运费', value: '¥' + costText.shipping },
      { label: '售价', value: '¥' + util.money(c.price), strong: true },
      { label: '利润率', value: profitRateText },
      { label: '目标利润率（品类参考）', value: targetProfitText }
    ];
    const lossSummary = lossRef.hasProduced
      ? ('本月损耗 ¥' + lossRef.lossText + ' · 每件 ¥' + lossRef.perText + '/件')
      : ('本月损耗 ¥' + lossRef.lossText + ' · 暂无分摊');
    const lossRows = [
      { label: '本月损耗合计', value: '¥' + lossRef.lossText },
      { label: '· 耗材摊销', value: '¥' + lossRef.consumableText, sub: true },
      { label: '· 资产折旧', value: '¥' + lossRef.depreciationText, sub: true },
      { label: '· 工具支出', value: '¥' + lossRef.toolText, sub: true },
      { label: '每件成品分摊 ≈', value: '¥' + lossRef.perText + ' /件', strong: true }
    ];

    this.setData({
      p, pcName: pcMap[p.productCategoryId] || '其他', bcName: bcMap[p.categoryId] || '',
      c, profitRateText, targetProfitText, costText,
      priceText: util.money(c.price), profitText: util.money(c.profit),
      bomLines, sales, saleTotal, productions, linkedCommissions: linked, tutorial: tut, lossRef,
      costSummary, lossSummary, costRows, lossRows
    });
  },

  goEdit() { util.navTo({ url: '/pages/products/edit?id=' + this.data.id }); },
  copyTemplate() { util.navTo({ url: '/pages/products/edit?template=' + this.data.id }); },
  previewPhoto(e) {
    const idx = Number(e.currentTarget.dataset.i);
    const p = this.data.p;
    if (!p || !p.photos || !p.photos.length) return;
    wx.previewImage({ current: p.photos[idx], urls: p.photos });
  },

  // 打开「记录售出」：单价默认带入成品自己的售价，数量默认 1
  openSale() {
    const p = this.data.p || {};
    const price = p.price ? String(util.round(p.price, 2)) : '';
    // 每件成本：利润率 =（你实际填的售价 − 每件成本）÷ 售价
    const unitCost = util.round((this.data.c && this.data.c.totalCost) || 0, 2);
    // 「卖给谁」默认带出关联排单的客户 —— 有排单时，买主多半就是那个人（可不改）
    const linked = this.data.linkedCommissions || [];
    const firstClient = (linked.find(x => x.client) || {}).client || '';
    this.setData({
      showSale: true, saleMode: 'unit', saleUnitCost: unitCost,
      saleQty: '1', salePrice: price, saleDate: util.today(),
      saleClient: firstClient,
      salePreview: '', saleInfo: ''
    });
    this.refreshSalePreview('1', price, 'unit');
  },
  closeSale() { this.setData({ showSale: false }); },
  onSaleClient(e) { this.setData({ saleClient: e.detail.value }); },
  pickSaleClient(e) { this.setData({ saleClient: e.currentTarget.dataset.c || '' }); },

  // 单价 / 总价 切换：同一个输入框，换的是「你填的是哪种价」
  switchSaleMode(e) {
    const mode = e.currentTarget.dataset.m;
    this.setData({ saleMode: mode });
    this.refreshSalePreview(this.data.saleQty, this.data.salePrice, mode);
  },

  // 实时换算：按单价填显示「合计」，按总价填显示「折合单价」；并附上成本与利润率
  refreshSalePreview(qty, amount, mode) {
    const q = Number(qty), a = Number(amount);
    const m = mode || this.data.saleMode;
    if (amount === '' || amount == null || !(q > 0) || isNaN(a)) {
      this.setData({ salePreview: '', saleInfo: '' });
      return;
    }
    const unit = m === 'unit' ? a : a / q;            // 折合单价
    const cost = Number(this.data.saleUnitCost) || 0;
    const rate = unit > 0 ? (unit - cost) / unit : 0;
    this.setData({
      salePreview: m === 'unit'
        ? '合计 ¥' + util.money(util.round(q * a, 2))
        : '折合单价 ¥' + util.money(util.round(unit, 2)),
      saleInfo: '成本 ¥' + util.money(cost) + ' · 利润率 ' + util.percent(rate, 1)
    });
  },

  onSaleQty(e) { this.setData({ saleQty: e.detail.value }); this.refreshSalePreview(e.detail.value, this.data.salePrice); },
  onSalePrice(e) { this.setData({ salePrice: e.detail.value }); this.refreshSalePreview(this.data.saleQty, e.detail.value); },
  onSaleDate(e) { this.setData({ saleDate: e.detail.value }); },
  // 主题日期选择器开关（替代原生 picker mode="date"）
  openSaleDate() { this.setData({ dpSale: true }); },
  closeDate() { this.setData({ dpSale: false }); },
  noop() {},
  openSheet(e) { this.setData({ sheetKey: e.currentTarget.dataset.key }); },
  closeSheet() { this.setData({ sheetKey: '' }); },
  confirmSale() {
    const q = Number(this.data.saleQty), a = Number(this.data.salePrice);
    if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
    if (this.data.salePrice === '' || isNaN(a) || a < 0) {
      util.toast(this.data.saleMode === 'unit' ? '请输入单价' : '请输入总价'); return;
    }
    // store 里存的一律是单价：按总价录入时在这里折算（保留 2 位小数）
    const unitPrice = this.data.saleMode === 'unit' ? a : util.round(a / q, 2);
    try {
      store.sellProduct(this.data.id, q, unitPrice, this.data.saleDate, this.data.saleClient);
      util.toast('已记录售出', 'success');
      this.setData({ showSale: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '售出失败'); }
  },

  goCommissionDetail(e) { util.navTo({ url: '/pages/commission/detail?id=' + e.currentTarget.dataset.id }); },

  // ===== 盘库（待售 / 样品 分别填实测件数，不触发扣料） =====
  openStocktake() {
    const p = this.data.p;
    const c = this.data.c;
    this.setData({
      showStocktake: true,
      stkSellable: String(util.round(p.sellableStock || 0, 2)),
      stkSample: String(util.round(p.sampleStock || 0, 2)),
      stkUnitCost: util.round(c.totalCost, 2),
      stkPreview: '', stkRemark: '盘库盈亏'
    });
  },
  closeStocktake() { this.setData({ showStocktake: false }); },
  onStkSellable(e) { this.setData({ stkSellable: e.detail.value }); this._computeStkPreview(); },
  onStkSample(e) { this.setData({ stkSample: e.detail.value }); this._computeStkPreview(); },
  onStkRemark(e) { this.setData({ stkRemark: e.detail.value }); },
  _computeStkPreview() {
    const p = this.data.p;
    const uc = this.data.stkUnitCost;
    const curS = util.round(p.sellableStock || 0, 2), curM = util.round(p.sampleStock || 0, 2);
    const aS = Number(this.data.stkSellable), aM = Number(this.data.stkSample);
    if (!(aS >= 0) || !(aM >= 0)) { this.setData({ stkPreview: '请输入有效件数' }); return; }
    const dS = util.round(aS - curS, 2), dM = util.round(aM - curM, 2);
    const valS = util.round(uc * dS, 2), valM = util.round(uc * dM, 2);
    const seg = (label, d, v) => {
      const tag = d > 0 ? '盘盈' : (d < 0 ? '盘亏' : '无差异');
      const vt = (v >= 0 ? '+' : '-') + util.money(Math.abs(v));
      return `${label} ${tag} ${Math.abs(d)}件 · 价值 ${vt}`;
    };
    this.setData({ stkPreview: seg('待售', dS, valS) + '　|　' + seg('样品', dM, valM) });
  },
  confirmStocktake() {
    const aS = Number(this.data.stkSellable), aM = Number(this.data.stkSample);
    if (!(aS >= 0) || !(aM >= 0)) { util.toast('请输入实测件数'); return; }
    try {
      store.stocktakeProduct(this.data.id, aS, aM, this.data.stkRemark || '盘库盈亏');
      util.toast('已盘库', 'success');
      this.setData({ showStocktake: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '盘库失败'); }
  },

  // 转类：商品 ⇄ 样品（按件移动）—— 用主题面板，不用原生 showModal（丑 + 会接着预设字写）
  transferToSample() { this._openTransfer('sample'); },
  transferToMerch() { this._openTransfer('merchandise'); },
  _openTransfer(toNature) {
    const p = this.data.p;
    const fromStock = toNature === 'sample' ? (p.sellableStock || 0) : (p.sampleStock || 0);
    this.setData({
      showTransfer: true, transferNature: toNature, transferMax: util.round(fromStock, 2),
      transferTitle: toNature === 'sample' ? '转为样品' : '转为商品',
      transferQty: '1'
    });
  },
  closeTransfer() { this.setData({ showTransfer: false }); },
  onTransferQty(e) { this.setData({ transferQty: e.detail.value }); },
  confirmTransfer() {
    const q = Number(this.data.transferQty);
    if (!(q > 0)) { util.toast('请输入大于0的件数'); return; }
    const toNature = this.data.transferNature;
    const fromNature = toNature === 'sample' ? 'merchandise' : 'sample';
    try {
      store.transferProduct(this.data.id, fromNature, toNature, q);
      util.toast('已完成转类', 'success');
      this.setData({ showTransfer: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '转类失败'); }
  },

  // 删除单条销售记录：返还库存并剔除该笔收入
  delSale(e) {
    const rid = e.currentTarget.dataset.rid;   // 记录 id（老数据回退为下标，store 内部兼容）
    util.confirm('删除销售记录', '删除后返还库存，并剔除该笔收入', '删除').then(ok => {
      if (!ok) return;
      try { store.deleteSale(this.data.id, rid); util.toast('已删除', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  // 退产：撤销某条生产记录，返还所耗物料并扣减库存
  undoProduce(e) {
    const rid = e.currentTarget.dataset.rid;
    util.confirm('退产', '返还该次生产所用的物料，并扣减库存', '退产').then(ok => {
      if (!ok) return;
      try { store.undoProduce(this.data.id, rid); util.toast('已退产', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },

  /* ⛔ 2026-10-09 删除：详情页那块「可视化教程卡」绘图链（台账 V126）
     被删的是一整条**彼此自洽、且全项目无人调用**的死代码：
       generateTutorialCard() → _drawAndExport() → _drawCard() →（_roundRect / _cut / PALETTE）
                                                        → _afterCard() →（_saveAlbum / _shareFile）
     证据：`generateTutorialCard` 全项目只有它自己的定义行；wxml 里也没有任何 bindtap 指向它。
     它配套的离屏 canvas（#tutCanvas）也从 detail.wxml 删掉了。
     ⚠️ 教程卡功能**不是**靠这段实现的 —— 页面上的「预览教程 / 导出教程」是跳到
        pages/products/tutorial-export，那边有独立的一份绘制。所以恢复教程功能时**不要**把这段加回来。
     ⚠️ 未动：`_unit(mid)` 也是死方法，但它与教程无关（只是当年留下的便利函数），这次没碰。 */
  _unit(mid) { const m = store.getMaterial(mid); return m ? m.unit : ''; },

  /* ===== 教程预览 / 导出（复用导出页，读取本机成品）=====
     ⛔ 2026-10-09 暂不上架（台账 V126）：下面这几个方法对应的按钮，
        随详情页那张「图文教程」卡片一起被 `data.showTutorial` 遮住（开关为 false ⇒ 整块不渲染）。
     这里**故意保留实现**（不删、也不注释）——
        · 恢复只需把本页与 edit.js 的 `data.showTutorial` 改成 true；
        · 教程数据（product.tutorial）与导出页、utils/tutorial-export.js 全部原样保留，
          已有成品的教程内容一个字都不会丢。 */
  openTutorialPreview() {
    const app = getApp();
    app.globalData.tutDraft = this._tutorialSnapshot();
    util.navTo({ url: '/pages/products/tutorial-export?mode=preview' });
  },
  openTutorialExport() {
    const app = getApp();
    app.globalData.tutDraft = this._tutorialSnapshot();
    util.navTo({ url: '/pages/products/tutorial-export?mode=export' });
  },
  _tutorialSnapshot() {
    const p = store.getProduct(this.data.id);
    const matNames = {}; (p.bom || []).forEach(b => { if (b.materialId) matNames[b.materialId] = b.materialName; });
    return {
      name: p.name || '未命名成品',
      photos: p.photos || [],
      nature: p.nature,
      price: p.price || 0,
      bom: (p.bom || []).map(b => ({ materialName: b.materialName, isFabric: b.isFabric, stockMode: b.stockMode, batchUsage: b.batchUsage, batchUnit: b.batchUnit, length: b.length, width: b.width, unit: b.unit })),
      tutorial: {
        title: (p.tutorial && p.tutorial.title) || (p.name ? p.name + ' 制作教程' : ''),
        steps: ((p.tutorial && p.tutorial.steps) || [])
          .filter(s => (s.title || '').trim() || (s.body || '').trim() || (s.images || []).length || (s.mats || []).length)
          .map(s => ({
            id: s.id, title: s.title, body: s.body,
            images: (s.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
            mats: (s.mats || []).map(id => matNames[id] || '物料'),
            pageBreak: !!s.pageBreak
          }))
      }
    };
  },
  previewTutImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const imgs = (this.data.tutorial.steps[i].images || []).map(im => im.path);
    wx.previewImage({ urls: imgs, current: imgs[Number(e.currentTarget.dataset.j)] || imgs[0] });
  },

  /* ⛔ 2026-10-09 删除（台账 V126）：教程卡的"存相册 / 转发"出口 —— `_afterCard` / `_saveAlbum` / `_shareFile`。
     它们只被上面那条死链（`_drawAndExport` → `_afterCard`）调用，唯一入口没了就整条一起走。
     📌 顺带效果：之后 detail.js 里**不再使用** `wx.saveImageToPhotosAlbum` 与 `wx.shareFileMessage`。
        但 `tools/privacy-manifest.js` 的隐私声明**不需要改** —— 这两项在导出页
        （pages/products/tutorial-export）里仍在使用，后台照旧要勾。
     ⚠️ 这里的 `share`（utils/share.js）已随本段一起移除。 */

  async del() {
    const p = store.getProduct(this.data.id);
    if (!p) return;
    // 库存硬拦：有在库（商品/样品）直接拦下，必须先卖出或转出
    const hasStock = (p.sellableStock || 0) > 0 || (p.sampleStock || 0) > 0;
    if (hasStock) {
      wx.showModal({
        title: '暂不能删除',
        content: `该成品还有在库（商品 ${p.sellableStock || 0} · 样品 ${p.sampleStock || 0}），请先卖出或转出后再删除`,
        showCancel: false, confirmText: '知道了'
      });
      return;
    }
    // 已售记录强提醒：允许删，但确认框写明将连带删除 N 笔已售及对应利润
    const sold = (p.sales || []).length;
    const msg = sold > 0
      ? `将一并删除 ${sold} 笔已售记录及对应利润，看板已售数据会相应减少，且不可恢复`
      : '删除后不可恢复';
    const ok = await util.confirm('删除成品', msg, '删除');
    if (!ok) return;
    store.removeProduct(this.data.id);
    util.toast('已删除', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
