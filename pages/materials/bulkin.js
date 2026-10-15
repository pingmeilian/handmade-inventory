// pages/materials/bulkin.js —— 批量入库（M1-04 第 5 条）：一次录入多个物料，统一提交生成 N 条入库流水
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    curName: '全部空间',
    keyword: '',
    list: [],        // 仅非面料（面料需长×宽，单独入库）
    amounts: {}      // { materialId: { qty: '', total: '' } }
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    const curName = (cats.find(c => c.id === cur) || {}).name || '';
    const kw = (this.data.keyword || '').trim();
    const amounts = this.data.amounts || {};
    const list = store.getMaterials()
      .filter(m => ((m.categoryId || 'bc_default') === cur) && !store.isMaterialFabric(m))
      .filter(m => !kw || (m.name || '').indexOf(kw) >= 0)
      .map(m => {
        const a = amounts[m.id] || { qty: '', total: '' };
        return {
          id: m.id, name: m.name, unit: m.unit || '',
          stock: util.round(m.quantity || 0, 2),
          qty: a.qty || '',
          total: a.total || ''
        };
      });
    this.setData({ curName, list });
  },

  onSearch(e) { this.setData({ keyword: e.detail.value }); this.reload(); },
  onQty(e) {
    const id = e.detail.ds.id;
    const amounts = Object.assign({}, this.data.amounts);
    amounts[id] = amounts[id] || { qty: '', total: '' };
    amounts[id] = Object.assign({}, amounts[id], { qty: e.detail.value });
    this.setData({ amounts });
    this.updateRow(id);
  },
  onTotal(e) {
    const id = e.detail.ds.id;
    const amounts = Object.assign({}, this.data.amounts);
    amounts[id] = amounts[id] || { qty: '', total: '' };
    amounts[id] = Object.assign({}, amounts[id], { total: e.detail.value });
    this.setData({ amounts });
    this.updateRow(id);
  },
  updateRow(id) {
    const a = (this.data.amounts || {})[id] || { qty: '', total: '' };
    const list = this.data.list.map(item => {
      if (item.id !== id) return item;
      return Object.assign({}, item, { qty: a.qty || '', total: a.total || '' });
    });
    this.setData({ list });
  },

  submit() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const amounts = this.data.amounts;
    const mats = store.getMaterials();
    let count = 0;
    mats.forEach(m => {
      const a = amounts[m.id] || { qty: '', total: '' };
      const q = Number(a.qty || 0);
      if (q > 0) {
        const total = a.total === '' || a.total == null ? null : Number(a.total);
        try { store.inbound(m.id, q, total, '批量入库'); count++; }
        catch (err) { util.toast((m.name || '') + ' 入库失败'); }
      }
    });
    if (count === 0) { util.toast('请先填写至少一项入库数量'); return; }
    util.toast('已入库 ' + count + ' 项', 'success');
    this.setData({ amounts: {} });
    this.reload();
  }
});
