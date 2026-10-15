// pages/commission/list.js —— 排单列表（M1-21）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const deliverFlow = require('../../utils/deliver-flow.js');   // V149：交付流程（与详情页「交付出库」共用）
// 左滑组件的「同时只开一张」登记表：组件与页面 require 到的是同一份模块实例（按路径缓存）
const registry = require('../../components/swipe-cell/registry.js');
const ACTIONS = require('./list-actions.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    spaceName: '',
    filter: 'active',
    list: [],
    // 左滑操作项（配置化，见 list-actions.js）：进行中给全套，已结束只留编辑/删除
    cmActionsActive: ACTIONS.ACTIVE,
    cmActionsEnded: ACTIONS.ENDED,
    // 滑动方向交给组件自判：'auto' 会读系统语言，阿拉伯语等 RTL 环境自动变成"右滑露出左侧操作区"
    swipeDir: 'auto',
    // V149 快速交付弹窗（与详情页共用 deliver-sheet 组件）
    showDeliver: false, deliverId: '', deliverProductId: '',
    deliverRemain: 0, deliverStock: 0, deliverNeedCut: false
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    const spaceName = (cats.find(c => c.id === cur) || {}).name || '';
    let arr = store.getCommissions().filter(c => (c.categoryId || 'bc_default') === cur);
    if (this.data.filter === 'active') arr = arr.filter(c => c.status !== 'done' && c.status !== 'cancelled');
    else if (this.data.filter === 'done') arr = arr.filter(c => c.status === 'done');
    else if (this.data.filter === 'cancelled') arr = arr.filter(c => c.status === 'cancelled');
    arr.sort((a, b) => util.diffDays(util.today(), a.deadline) - util.diffDays(util.today(), b.deadline));

    const list = arr.map(c => {
      const status = c.status === 'done' ? 'done' : (c.status === 'cancelled' ? 'cancelled' : calc.commissionDDLStatus(c.deadline));
      const ended = c.status === 'done' || c.status === 'cancelled';
      return {
        id: c.id,
        productName: c.productName || '未关联成品',
        client: c.client || '客户',
        deadline: c.deadline || '—',
        qty: c.qty || 0,
        deliveredQty: c.deliveredQty || 0,
        remain: util.round((c.qty || 0) - (c.deliveredQty || 0), 2),
        ddlStatus: status,
        ended,                 // 已结束（完成/取消）：左滑只留「编辑/删除」
        daysLeft: calc.commissionDaysLeft(c.deadline),
        price: c.price || 0
      };
    });
    this.setData({ spaceName, list });
  },

  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.f }); this.reload(); },

  // 点卡片进详情。
  // ⚠️ 已有卡片展开时，这一次点击只用来「收起」，不跳转 —— 与微信会话列表一致，防误触。
  goDetail(e) {
    if (registry.closeIfAny()) return;
    util.navTo({ url: '/pages/commission/detail?id=' + e.currentTarget.dataset.id });
  },

  goEdit() { util.navTo({ url: '/pages/commission/edit' }); },

  // 点空白处收起已展开项
  onBlankTap() { registry.closeAll(); },

  // 列表滚动 → 收起已展开项。只在真有"开着/半开"的卡片时才动手，滚动帧里不做多余工作
  onPageScroll() { if (registry.anyOpen()) registry.closeAll(); },

  // ==================== 左滑操作项 ====================
  // 组件只抛 { key }；业务语义全在这一层（组件本身不耦合排单数据）
  onCardAction(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    const key = (e && e.detail) ? e.detail.key : '';
    if (!id || !key) return;                      // 脏事件：静默忽略
    if (key === 'deliver') return this.quickDeliver(id);
    if (key === 'cancel') return this.cancelCommission(id);
    if (key === 'edit') return util.navTo({ url: '/pages/commission/edit?id=' + id });
    if (key === 'del') return this.delCommission(id);
    // 未知 key（脏配置/旧缓存）：什么都不做。绝不能落到"默认删除"上
  },

  // 快速交付：打开交付弹窗 —— 先问「货从哪来」，再按用户选的路落账（V149）
  // ⚠️ 与详情页「交付出库」是**同一个组件 + 同一套流程**（utils/deliver-flow.js），
  //    两处只有"从哪触发"不同，扣账口径必须完全一致。
  quickDeliver(id) {
    const c = store.getCommission(id);
    if (!c) { util.toast('排单不存在'); this.reload(); return; }
    const remain = util.round((c.qty || 0) - (c.deliveredQty || 0), 2);
    if (!(remain > 0)) { util.toast('已全部交付'); return; }   // 脏数据（余量已为 0）不该报错
    if (!c.productId) { util.toast('排单未关联成品，无法交付'); return; }
    const p = store.getProduct(c.productId);
    this.setData({
      showDeliver: true, deliverId: id, deliverProductId: c.productId,
      deliverRemain: remain,
      deliverStock: p ? util.round(p.sellableStock || 0, 2) : 0,
      deliverNeedCut: deliverFlow.needsCut(c.productId, remain)
    });
  },

  closeDeliver() { this.setData({ showDeliver: false }); },

  onDeliverSubmit(e) {
    const d = e.detail || {};
    this.setData({ showDeliver: false });
    deliverFlow.deliver({
      commissionId: this.data.deliverId,
      productId: this.data.deliverProductId,
      qty: d.qty,
      fromStock: d.fromStock,
      onSuccess: (n) => {
        this.reload();
        util.alert('交付完成', '已交付 ' + n + ' 件').then(() => {});
      }
    });
  },

  // 取消：与详情页同口径 —— 只改状态，已交付记录与物料流水都保留（判定收口在 store）
  cancelCommission(id) {
    try {
      store.cancelCommission(id);
    } catch (err) {
      util.toast((err && err.msg) || '取消失败');
      this.reload();
      return;
    }
    util.toast('已取消', 'success');
    this.reload();
  },

  // 删除：只删排单记录（已出库的物料不回补 —— 确认弹窗里已讲清楚）
  delCommission(id) {
    try {
      store.removeCommission(id);
    } catch (err) {
      util.toast((err && err.msg) || '删除失败');
      return;
    }
    util.toast('已删除', 'success');
    this.reload();
  }
});
