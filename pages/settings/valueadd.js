// pages/settings/valueadd.js —— 二期功能说明（M2，本期未开发，仅展示）
const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    features: [
      { name: 'AI 物料识别', desc: '拍照自动识别面料/辅料并归类、估算面积' },
      { name: '智能定价建议', desc: '结合成本与市场同类给出定价区间' },
      { name: '灵感图转成品', desc: '上传灵感图，AI 推荐 BOM 与教程' },
      { name: '销量预测', desc: '基于历史销售预测下月热点' }
    ]
  }
});
