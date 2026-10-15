// pages/settings/presets.js —— 预设设置（纯入口页，无自身状态）
//
// 2026-09-27 新增：把原先散落在「我的」页的 5 项预设归并到这里，
// 目的是让每项都有**分组**和**一行说明**（解决"不知道点进去有什么"）。
// 本页不做任何数据读写，只是导航 —— 所以逻辑只有 go() 一个方法。
const util = require('../../utils/util.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  go(e) {
    util.navTo({ url: e.currentTarget.dataset.url });
  }
});
