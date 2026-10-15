// pages/loss/index.js —— 损耗（资产 / 工具 / 耗材 / 其它支出）列表 + 状态流转
const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

const SEGS = [
  { key: 'asset', name: '资产' },
  { key: 'tool', name: '工具' },
  { key: 'consumable', name: '耗材' },
  // 2026-10-10 V131：其它支出（快递/摊位/电费…）。与上面三类的区别：
  // 它**只有金额一个事实** —— 没有状态流转、没有数量、不摊销 ⇒ 列表是平铺的，无分组。
  { key: 'other', name: '其它支出' }
];

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    segs: SEGS,
    seg: 'asset',
    cGroups: [], aGroups: [], tGroups: [], oItems: [], oTotal: '0.00',
    cFilter: 'stock', aFilter: 'inUse', tFilter: 'inUse',
    topLoss: '', topLossBreak: '',
    // 工具换新 sheet
    sheetShow: false, sheetId: '', sheetName: '', sheetPrice: '', sheetDate: '',
    // 折叠与更多菜单
    openId: '', openRepairId: '', menuItem: null,
    // 主题日期选择器（替代原生 mode="date"）
    dpSheet: false
  },

  // 从「累计总账」下钻过来时带 seg（?seg=consumable|asset|tool|other）——直接落在对应分段
  onLoad(options) {
    const seg = options && options.seg;
    if (seg && SEGS.some(s => s.key === seg)) this.setData({ seg });
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    // 顶部常驻：本月损耗成本合计
    const now = new Date();
    const ml = store.getMonthlyLossCost(now.getFullYear(), now.getMonth() + 1);
    this.setData({
      topLoss: '本月损耗成本 ≈ ¥' + util.money(ml.total),
      topLossBreak: '耗材摊销 ¥' + util.money(ml.consumableAmort) + ' · 折旧 ¥' + util.money(ml.depreciation) + ' · 工具 ¥' + util.money(ml.toolExpense)
    });

    let cGroups = [], aGroups = [], tGroups = [], oItems = [];
    if (this.data.seg === 'consumable') {
      cGroups = this.buildConsumableGroups();
    } else if (this.data.seg === 'asset') {
      aGroups = this.buildAssetGroups();
    } else if (this.data.seg === 'other') {
      oItems = this.buildOtherItems();
    } else {
      tGroups = this.buildToolGroups();
    }
    const oTotal = util.money(oItems.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    const patch = { cGroups, aGroups, tGroups, oItems, oTotal };
    // 若当前状态筛选器对应分组已空，则回退到第一个有数据的分组
    const map = { consumable: { key: 'cFilter', groups: cGroups }, asset: { key: 'aFilter', groups: aGroups }, tool: { key: 'tFilter', groups: tGroups } };
    const cur = map[this.data.seg];
    if (cur && !cur.groups.find(g => g.key === this.data[cur.key])) {
      patch[cur.key] = cur.groups.length ? cur.groups[0].key : this.data[cur.key];
    }
    this.setData(patch);
  },

  buildConsumableGroups() {
    const all = store.getConsumablesOf().map(c => {
      const status = c.status;
      const actions = [{ label: '编辑', method: 'goEditItem' }, { label: '删除', method: 'del', danger: true }];
      let primaryAct = '', primaryMethod = '';
      if (status === 'stock') { primaryAct = '开始使用'; primaryMethod = 'startUse'; }
      else if (status === 'inUse') { primaryAct = '出库'; primaryMethod = 'outStock'; actions.unshift({ label: '撤回', method: 'undoUse' }); }
      else if (status === 'out') { actions.unshift({ label: '撤回', method: 'undoOut' }); }
      return {
        id: c.id, name: c.name, spec: c.spec || '',
        qtyText: (Number(c.quantity) || 0) + ' 件',
        totalText: '¥' + util.money(c.totalPrice),
        unitText: '单价 ¥' + util.money(store.consumableUnitPrice(c)),
        keySub: (Number(c.quantity) || 0) + ' 件 · ¥' + util.money(c.totalPrice),
        status, statusText: c.status === 'stock' ? '库存备用' : c.status === 'inUse' ? '使用中' : '已出库',
        inDate: c.inDate || '', useDate: c.useDate || '', outDate: c.outDate || '',
        primaryAct, primaryMethod, actions
      };
    });
    const mk = (title, st) => ({ title, key: st, items: all.filter(x => x.status === st) });
    return [mk('库存备用', 'stock'), mk('使用中', 'inUse'), mk('已用完', 'out')].filter(g => g.items.length);
  },

  buildAssetGroups() {
    const all = store.getAssetsOf().map(a => {
      const status = a.status;
      const actions = [{ label: '编辑', method: 'goEditItem' }, { label: '删除', method: 'del', danger: true }];
      let primaryAct = '', primaryMethod = '';
      if (status === 'inUse') { primaryAct = '维修'; primaryMethod = 'addRepair'; actions.unshift({ label: '报废', method: 'scrapAsset' }); }
      else if (status === 'scrapped') { actions.unshift({ label: '撤销报废', method: 'undoScrap' }); }
      return {
        id: a.id, name: a.name,
        valText: '原值 ¥' + util.money(a.originalValue),
        depreText: '月折旧 ¥' + util.money(store.assetMonthlyDepreciation(a)),
        keySub: '原值 ¥' + util.money(a.originalValue) + ' · 月折旧 ¥' + util.money(store.assetMonthlyDepreciation(a)),
        status, statusText: a.status === 'inUse' ? '在用' : '已报废',
        inDate: a.inDate || '', scrapDate: a.scrapDate || '',
        repairs: (a.repairs || []).map(r => ({ date: r.date, fee: String(Number(r.fee) || 0), note: r.note })),
        primaryAct, primaryMethod, actions
      };
    });
    const mk = (title, st) => ({ title, key: st, items: all.filter(x => x.status === st) });
    return [mk('在用', 'inUse'), mk('已报废', 'scrapped')].filter(g => g.items.length);
  },

  buildToolGroups() {
    const all = store.getToolsOf().map(t => {
      const status = t.status;
      const actions = [{ label: '编辑', method: 'goEditItem' }, { label: '删除', method: 'del', danger: true }];
      let primaryAct = '', primaryMethod = '';
      if (status === 'inUse') { primaryAct = '换新'; primaryMethod = 'replaceTool'; }
      else if (status === 'replaced') { actions.unshift({ label: '撤销换新', method: 'undoReplace', extra: { newid: t.replacedBy } }); }
      return {
        id: t.id, name: t.name,
        valText: '买价 ¥' + util.money(t.price),
        keySub: '买价 ¥' + util.money(t.price),
        status: t.status, statusText: t.status === 'inUse' ? '能用' : '已报废',
        inDate: t.inDate || '', replaceDate: t.replaceDate || '',
        replacedBy: t.replacedBy || '',
        primaryAct, primaryMethod, actions
      };
    });
    const mk = (title, st) => ({ title, key: st, items: all.filter(x => x.status === st) });
    return [mk('能用的', 'inUse'), mk('已报废', 'replaced')].filter(g => g.items.length);
  },

  // 其它支出（V131）：无状态、无分组、无数量 —— 按日期倒序平铺
  buildOtherItems() {
    return store.getOtherExpensesOf()
      .map(o => ({
        id: o.id, name: o.name,
        amount: Number(o.amount) || 0,
        amountText: '¥' + util.money(o.amount),
        date: o.date || '',
        keySub: (o.date || '') + (o.note ? ' · ' + o.note : ''),
        note: o.note || '',
        status: 'other', statusText: '已记录',
        actions: [{ label: '编辑', method: 'goEditItem' }, { label: '删除', method: 'del', danger: true }]
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  switchSeg(e) {
    const seg = e.currentTarget.dataset.seg;
    if (seg === this.data.seg) return;
    this.setData({ seg });
    this.reload();
  },

  switchGroup(e) {
    const key = e.currentTarget.dataset.group;
    const map = { consumable: 'cFilter', asset: 'aFilter', tool: 'tFilter' };
    const field = map[this.data.seg];
    if (!field || this.data[field] === key) return;
    this.setData({ [field]: key });
  },

  noop() {},

  // 卡片「详情」展开 / 收起（日期、维修记录等次要信息）
  toggleDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openId: this.data.openId === id ? '' : id });
  },
  // 资产维修记录展开 / 收起
  toggleRepair(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openRepairId: this.data.openRepairId === id ? '' : id });
  },
  // 更多操作菜单
  openMenu(e) {
    const id = e.currentTarget.dataset.id;
    // ⚠️ 四段的列表都要搜一遍 —— 漏一段，那一段的「更多 ›」就会静默无反应
    const groups = [].concat(this.data.cGroups, this.data.aGroups, this.data.tGroups);
    let found = null;
    for (const g of groups) { const it = g.items.find(x => x.id === id); if (it) { found = it; break; } }
    if (!found) found = this.data.oItems.find(x => x.id === id);
    if (found) this.setData({ menuItem: { id, name: found.name, actions: found.actions } });
  },
  hideMenu() { this.setData({ menuItem: null }); },
  onMenuAction(e) {
    const { method, extra } = e.currentTarget.dataset;
    const id = this.data.menuItem.id;
    this.setData({ menuItem: null });
    if (method && this[method]) {
      this[method]({ currentTarget: { dataset: Object.assign({ id }, extra || {}) } });
    }
  },

  goEdit() { util.navTo({ url: '/pages/loss/edit?type=' + this.data.seg }); },
  goEditItem(e) { util.navTo({ url: '/pages/loss/edit?type=' + this.data.seg + '&id=' + e.currentTarget.dataset.id }); },

  // 耗材：开始使用 / 出库（按数量拆分）
  startUse(e) {
    const id = e.currentTarget.dataset.id;
    const item = store.getConsumable(id);
    const max = item ? Number(item.quantity) || 0 : 0;
    wx.showModal({
      title: '开始使用', editable: true,
      placeholderText: '本次数量（默认1，最多' + max + '）',
      success: (r) => {
        if (!r.confirm) return;
        const qty = r.content && Number(r.content) > 0 ? Number(r.content) : 1;
        try {
          if (qty >= max) store.startUseConsumable(id);
          else store.splitStartUseConsumable(id, qty);
          util.toast('已开始使用', 'success');
          this.reload();
        } catch (err) { util.toast(err.msg || '操作失败'); }
      }
    });
  },
  outStock(e) {
    const id = e.currentTarget.dataset.id;
    const item = store.getConsumable(id);
    const max = item ? Number(item.quantity) || 0 : 0;
    wx.showModal({
      title: '出库（用完）', editable: true,
      placeholderText: '本次数量（默认1，最多' + max + '）',
      success: (r) => {
        if (!r.confirm) return;
        const qty = r.content && Number(r.content) > 0 ? Number(r.content) : 1;
        try {
          if (qty >= max) store.outConsumable(id);
          else store.splitOutConsumable(id, qty);
          util.toast('已出库', 'success');
          this.reload();
        } catch (err) { util.toast(err.msg || '操作失败'); }
      }
    });
  },

  // 资产：维修 / 报废
  addRepair(e) {
    util.navTo({ url: '/pages/loss/edit?type=assetRepair&id=' + e.currentTarget.dataset.id });
  },
  scrapAsset(e) {
    store.scrapAsset(e.currentTarget.dataset.id);
    util.toast('已报废', 'success');
    this.reload();
  },

  // 工具：换新（弹层录新成本）
  replaceTool(e) {
    const id = e.currentTarget.dataset.id;
    const t = store.getTool(id);
    this.setData({
      sheetShow: true, sheetId: id,
      sheetName: t ? t.name : '',
      sheetPrice: '', sheetDate: util.today()
    });
  },
  onSheetName(e) { this.setData({ sheetName: e.detail.value }); },
  onSheetPrice(e) { this.setData({ sheetPrice: e.detail.value }); },
  onSheetDate(e) { this.setData({ sheetDate: e.detail.value }); },
  // 主题日期选择器开关（替代原生 picker mode="date"）
  openSheetDate() { this.setData({ dpSheet: true }); },
  closeDate() { this.setData({ dpSheet: false }); },
  hideSheet() { this.setData({ sheetShow: false }); },
  saveReplace() {
    const { sheetId, sheetName, sheetPrice, sheetDate } = this.data;
    const p = Number(sheetPrice);
    if (!(p > 0)) { util.toast('请填写新工具买价'); return; }
    try {
      store.replaceToolWith(sheetId, { name: sheetName, price: p, inDate: sheetDate });
      this.setData({ sheetShow: false });
      util.toast('已报废，新成本已计入', 'success');
      this.reload();
    } catch (err) { util.toast(err.msg || '操作失败'); }
  },

  // 资产维修：编辑单条 / 删除单条
  editRepair(e) {
    util.navTo({ url: '/pages/loss/edit?type=assetRepairEdit&assetId=' + e.currentTarget.dataset.id + '&idx=' + e.currentTarget.dataset.idx });
  },
  delRepair(e) {
    const { id, idx } = e.currentTarget.dataset;
    util.confirm('删除维修记录', '删除后该笔维修费不再计入折旧', '删除').then(ok => {
      if (!ok) return;
      try { store.deleteRepair(id, Number(idx)); util.toast('已删除', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  // 资产报废撤销：恢复为在用，折旧重新计算
  undoScrap(e) {
    const id = e.currentTarget.dataset.id;
    util.confirm('撤销报废', '恢复为在用，折旧重新计算', '撤销').then(ok => {
      if (!ok) return;
      store.unscrapAsset(id); util.toast('已恢复在用', 'success'); this.reload();
    });
  },
  // 工具换新撤销：删除新工具，旧件恢复能用（冲销当月工具支出）
  undoReplace(e) {
    const { id, newid } = e.currentTarget.dataset;
    util.confirm('撤销换新', '删除新工具，旧件恢复能用', '撤销').then(ok => {
      if (!ok) return;
      try { store.undoReplaceTool(id, newid); util.toast('已撤销换新', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  // 耗材：撤回开始使用 / 撤回出库
  undoUse(e) {
    const id = e.currentTarget.dataset.id;
    util.confirm('撤回开始使用', '该记录退回库存备用', '撤回').then(ok => {
      if (!ok) return;
      try { store.undoStartUseConsumable(id); util.toast('已退回库存', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  undoOut(e) {
    const id = e.currentTarget.dataset.id;
    util.confirm('撤回出库', '该记录恢复到出库前状态', '撤回').then(ok => {
      if (!ok) return;
      try { store.undoOutConsumable(id); util.toast('已撤回', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  del(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    util.confirm('删除', '删除后不可恢复', '删除').then(ok => {
      if (!ok) return;
      // ⚠️ 必须**按段显式分派**，不许用 `else` 兜底：
      //    原先写的是 `else store.removeTool(id)` —— 加「其它支出」段之后，
      //    删它会掉进 tool 分支、**静默删不掉**（点了"删除"、记录还在）。
      const seg = self.data.seg;
      if (seg === 'consumable') store.removeConsumable(id);
      else if (seg === 'asset') store.removeAsset(id);
      else if (seg === 'other') store.removeOtherExpense(id);
      else store.removeTool(id);
      util.toast('已删除', 'success');
      self.reload();
    });
  }
});
