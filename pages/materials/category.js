// pages/materials/category.js —— 手作空间（空间）切换 / 新建（M1-17 前置）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    list: [], currentId: 'bc_default'
  },

  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const current = state.getCurrentSpace();
    const cats = store.getBusinessCategories().map(c => ({
      id: c.id, name: c.name, active: c.id === current
    }));
    this.setData({ list: cats, currentId: current });
  },

  setActive(e) {
    const id = e.currentTarget.dataset.id;
    app.setCurrentCategory(id);
    this.reload();
    const name = (this.data.list.find(c => c.id === id) || {}).name || '';
    wx.showToast({ title: '已切换到「' + name + '」', icon: 'none' });
  },

  addCat() {
    wx.showModal({
      title: '新建手作空间',
      content: '如：钩针专区 / 娃衣定制',
      editable: true,
      placeholderText: '输入名称',
      confirmColor: themePage.modalColor(),
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        store.addBusinessCategory(name);
        this.reload();
      }
    });
  }
});
