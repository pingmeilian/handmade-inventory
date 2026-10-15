// pages/commission/edit.js —— 排单新增 / 编辑（M1-21，实际出库制）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    id: '', isEdit: false,
    products: [], productIndex: 0,
    productId: '', productName: '',
    client: '', qty: '', deadline: '', price: '', remark: '',
    // 主题选择器（替代原生 picker / date）
    picker: { show: false, title: '', options: [], rangeKey: '', value: 0, field: '' },
    dpShow: false
  },

  onLoad(options) {
    const cur = state.getCurrentSpace();
    const products = store.getProducts().filter(p => (p.categoryId || 'bc_default') === cur);
    const data = { products };
    // 从成品页「关联排单」带入成品时，预选该成品
    if (options.productId) {
      const idx = Math.max(0, products.findIndex(p => p.id === options.productId));
      if (idx >= 0) {
        const p = products[idx];
        data.productIndex = idx; data.productId = p.id; data.productName = p.name;
      }
    }
    if (options.id) {
      const c = store.getCommissions().find(x => x.id === options.id);
      if (c) {
        const idx = Math.max(0, products.findIndex(p => p.id === c.productId));
        Object.assign(data, {
          id: c.id, isEdit: true,
          productIndex: idx, productId: c.productId || '', productName: c.productName || '',
          client: c.client || '', qty: String(c.qty || ''), deadline: c.deadline || '',
          price: String(c.price || ''), remark: c.remark || ''
        });
      }
    }
    this.setData(data);
  },

  onProduct(e) {
    const i = Number(e.detail.value);
    const p = this.data.products[i];
    this.setData({ productIndex: i, productId: p ? p.id : '', productName: p ? p.name : '' });
  },
  onClient(e) { this.setData({ client: e.detail.value }); },
  onQty(e) { this.setData({ qty: e.detail.value }); },
  onDeadline(e) { this.setData({ deadline: e.detail.value }); },
  onPrice(e) { this.setData({ price: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  // ===== 主题选择器（替代原生 picker / mode="date"） =====
  openPicker(field, title, options, rangeKey, value) {
    this.setData({ picker: { show: true, field, title, options, rangeKey, value: value || 0 } });
  },
  closePicker() { this.setData({ 'picker.show': false }); },
  onPickerConfirm(e) {
    this.setData({ 'picker.show': false });
    if (this.data.picker.field === 'product') this.onProduct({ detail: { value: e.detail.value } });
  },
  openProductPicker() { this.openPicker('product', '选择关联成品', this.data.products, 'name', this.data.productIndex); },
  openDeadline() { this.setData({ dpShow: true }); },
  closeDate() { this.setData({ dpShow: false }); },

  save() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const qty = Number(this.data.qty);
    if (!this.data.productId) { util.toast('请选择关联成品'); return; }
    if (!this.data.client.trim()) { util.toast('请填写客户'); return; }
    if (!(qty > 0)) { util.toast('请填写有效数量'); return; }
    if (!this.data.deadline) { util.toast('请选择交付截止日'); return; }
    const cur = state.getCurrentSpace();
    const prev = this.data.isEdit ? (store.getCommissions().find(x => x.id === this.data.id) || {}) : {};
    store.saveCommission({
      id: this.data.id,
      productId: this.data.productId, productName: this.data.productName,
      client: this.data.client.trim(), qty,
      deadline: this.data.deadline,
      price: Number(this.data.price) || 0,
      remark: this.data.remark,
      categoryId: cur,
      // 编辑时保留已交付与状态；新建默认 active
      deliveredQty: prev.deliveredQty || 0,
      status: prev.status || 'active'
    });
    util.toast('已保存', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
