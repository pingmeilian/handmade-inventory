// pages/settings/basic.js —— 基础设置（M1-15）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: { defaultUnit: '个', defaultThreshold: '5' },

  onLoad() {
    const s = store.getSettings();
    this.setData({ defaultUnit: s.defaultUnit || '个', defaultThreshold: String(s.defaultThreshold == null ? 5 : s.defaultThreshold) });
  },

  onUnit(e) { this.setData({ defaultUnit: e.detail.value }); },
  onThreshold(e) { this.setData({ defaultThreshold: e.detail.value }); },

  save() {
    const threshold = Number(this.data.defaultThreshold);
    if (isNaN(threshold) || threshold < 0) { util.toast('阈值需为非负数字'); return; }
    store.saveSettings({ defaultUnit: (this.data.defaultUnit || '个').trim() || '个', defaultThreshold: threshold });
    util.toast('已保存', 'success');
  }
});
