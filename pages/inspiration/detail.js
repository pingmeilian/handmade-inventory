// pages/inspiration/detail.js —— 灵感详情（草图多图、面料辅料、转成品）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: { id: '', it: null, done: false },

  onLoad(options) { this.setData({ id: options.id }); },
  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const it = store.getInspirations().find(x => x.id === this.data.id);
    if (!it) { util.toast('灵感不存在'); setTimeout(() => wx.navigateBack(), 400); return; }
    this.setData({ it, done: it.status === 'done' });
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    wx.previewImage({ urls: this.data.it.photos || [], current: url });
  },

  goEdit() { util.navTo({ url: '/pages/inspiration/edit?id=' + this.data.id }); },

  // 转为成品（V137 用户拍板改法）：**不在这里建成品**、也**不问**「样品 / 待售」——
  //   直接带着本记录跳到成品编辑页，把名称 / 图片 / 教程填进去，由用户自己选物料再保存。
  //   （旧实现立即 saveProduct({bom:[]}) ⇒ 成品物料栏全空，已按用户反馈改掉。）
  //   本记录变「已填坑」的时机：成品**保存成功**后由编辑页回填。
  openConvert() {
    if (this.data.done) { util.toast('该灵感已填坑'); return; }
    util.navTo({ url: '/pages/products/edit?from=inspiration&sid=' + this.data.id });
  },

  async del() {
    const ok = await util.confirm('删除灵感', '确认删除这条灵感？原始记录将被移除', '删除');
    if (!ok) return;
    store.removeInspiration(this.data.id);
    util.toast('已删除', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
