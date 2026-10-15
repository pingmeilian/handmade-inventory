// pages/settings/privacy.js —— 隐私保护 / 用户协议说明（合规-1）
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: { agreed: false },

  onLoad() {
    this.setData({ agreed: !!wx.getStorageSync('bm_privacy_agreed') });
  },

  agree() {
    wx.setStorageSync('bm_privacy_agreed', true);
    this.setData({ agreed: true });
    util.toast('已同意隐私政策', 'success');
    setTimeout(() => { if (getCurrentPages().length > 1) wx.navigateBack(); }, 400);
  },

  // 跳转微信官方隐私协议（若后台已配置《隐私保护指引》）
  openOfficial() {
    wx.openPrivacyContract({
      fail: () => util.toast('未配置官方隐私协议，可查看本页说明')
    });
  }
});
