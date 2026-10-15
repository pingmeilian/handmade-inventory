// pages/commission/detail.js —— 排单详情（M1-21，实际出库制交付）
const app = getApp();
const store = require('../../utils/store.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const deliverFlow = require('../../utils/deliver-flow.js');   // V149：交付流程（与列表页快速交付**共用同一处**）

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    id: '', c: null, ddlStatus: '', daysLeft: 0, remain: 0,
    isDone: false, isCancelled: false, canDeliver: false, deliverExpanded: false,
    // V149 交付弹窗：要把「成品在库几件」摆给用户看 —— 选「从成品在库出」时他心里有数
    showDeliver: false, stock: 0, deliverNeedCut: false
  },

  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const c = store.getCommissions().find(x => x.id === this.data.id);
    if (!c) { util.toast('数据不存在'); setTimeout(() => wx.navigateBack(), 500); return; }
    const remain = util.round((c.qty || 0) - (c.deliveredQty || 0), 2);
    const isDone = c.status === 'done';
    const isCancelled = c.status === 'cancelled';
    // V149：交付弹窗要显示成品在库、以及「这一单要不要裁剪」
    const prod = c.productId ? store.getProduct(c.productId) : null;
    this.setData({
      c: {
        id: c.id, productId: c.productId, productName: c.productName || '未关联成品',
        client: c.client || '客户', qty: c.qty || 0, deliveredQty: c.deliveredQty || 0,
        deadline: c.deadline || '—', price: c.price || 0, remark: c.remark || '',
        statusText: isDone ? '已完成' : (isCancelled ? '已取消' : '进行中'),
        deliverLogs: (c.deliverLogs || []).map((l, i) => ({ idx: i, qty: util.round(l.qty, 2), date: l.date, fromStock: l.fromStock || '' }))
      },
      remain, isDone, isCancelled,
      ddlStatus: isDone ? 'done' : (isCancelled ? 'cancelled' : calc.commissionDDLStatus(c.deadline)),
      daysLeft: calc.commissionDaysLeft(c.deadline),
      canDeliver: !isDone && !isCancelled && remain > 0,
      stock: prod ? util.round(prod.sellableStock || 0, 2) : 0,
      deliverNeedCut: false   // 打开弹窗时再算（按当时填的数量）
    });
  },

  goProduct() {
    if (this.data.c.productId) util.navTo({ url: '/pages/products/detail?id=' + this.data.c.productId });
  },

  // 交付记录折叠展开
  toggleDeliver() { this.setData({ deliverExpanded: !this.data.deliverExpanded }); },

  // 交付出库（V149）：先问「货从哪来」—— 两条路的扣账方式不同，不替用户决定
  deliver() {
    if (!this.data.canDeliver) return;
    if (!this.data.c.productId) { util.toast('排单未关联成品，无法交付'); return; }
    this.setData({ showDeliver: true, deliverNeedCut: deliverFlow.needsCut(this.data.c.productId, this.data.remain) });
  },

  closeDeliver() { this.setData({ showDeliver: false }); },

  // 弹窗确认：交给公共流程（会不会进裁剪页由它判断）
  onDeliverSubmit(e) {
    const d = e.detail || {};
    this.setData({ showDeliver: false });
    deliverFlow.deliver({
      commissionId: this.data.id,
      productId: this.data.c.productId,
      qty: d.qty,
      fromStock: d.fromStock,
      onSuccess: (n) => { util.toast('已交付 ' + n, 'success'); this.reload(); }
    });
  },

  // 撤销某次交付：按记录里的来源反向（在库出 → 撤销售；现做现交 → 再退产返还物料）
  undoDeliver(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const log = (this.data.c.deliverLogs || [])[idx] || {};
    const tip = log.fromStock === 'product'
      ? '这次是从成品在库出的：将撤销销售记录（在库加回），物料不动'
      : '这次是现做现交：将撤销销售记录，并退产返还所耗物料，恢复排单余量';
    util.confirm('撤销交付', tip, '撤销').then(ok => {
      if (!ok) return;
      try { store.undoDeliver(this.data.id, idx); util.toast('已撤销交付', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  async cancel() {
    if (this.data.isCancelled || this.data.isDone) return;
    const ok = await util.confirm('取消排单', '确认取消该排单？已交付部分保留记录', '取消排单');
    if (!ok) return;
    // 口径收口在 store.cancelCommission（列表左滑也用同一个，避免两处各写一遍）
    try { store.cancelCommission(this.data.id); }
    catch (err) { util.toast((err && err.msg) || '取消失败'); this.reload(); return; }
    util.toast('已取消', 'success'); this.reload();
  },

  resume() {
    const c = store.getCommissions().find(x => x.id === this.data.id);
    if (!c) return;
    c.status = 'active'; store.saveCommission(c);
    util.toast('已恢复', 'success'); this.reload();
  },

  goEdit() { util.navTo({ url: '/pages/commission/edit?id=' + this.data.id }); },

  async remove() {
    const ok = await util.confirm('删除', '删除后不可恢复；已交付部分不回补物料，流水保留', '删除');
    if (!ok) return;
    store.removeCommission(this.data.id);
    util.toast('已删除', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
