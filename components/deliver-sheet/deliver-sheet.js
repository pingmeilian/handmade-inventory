// components/deliver-sheet/deliver-sheet.js —— 排单交付弹窗（V149）
//
// 排单交付有**两个入口**（详情页「交付出库」、列表页左滑「快速交付」）。
// 界面收口在这一个组件里，流程收口在 utils/deliver-flow.js —— 两处入口共用同一套，
// 免得又变成「同一个功能两种行为」（2026-09-14 的「快速交付」口径就是这么定下来的）。
//
// 组件只负责「把话问清楚」：① 本次交付多少 ② 货从哪来。
//   · **不预选来源** —— 用户自己选。V149 修的就是「系统直接替你扣了」。
//   · 怎么落账、要不要进裁剪页，全在 utils/deliver-flow.js。
const util = require('../../utils/util.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '交付出库' },
    remain: { type: Number, value: 0 },        // 排单剩余量
    stock: { type: Number, value: 0 },         // 成品在库（可售）
    needCut: { type: Boolean, value: false }   // 这一单含需裁剪面料（选「从物料出」会先进裁剪页）
  },

  data: {
    qty: '',
    mode: ''    // '' 未选 | 'product' 从成品在库出 | 'material' 从物料出（现做现交）
  },

  observers: {
    // 每次打开都从**干净状态**开始：来源不预选（用户自己选），数量默认本次剩余量
    show(v) {
      if (v) this.setData({ qty: String(this.data.remain), mode: '' });
    }
  },

  methods: {
    noop() {},

    onQty(e) {
      this.setData({ qty: (e.detail && e.detail.value != null) ? String(e.detail.value) : '' });
    },

    // 用户自己选：系统不预选、不替他决定
    pick(e) {
      const m = e.currentTarget.dataset.m;
      if (m === 'product' && !(this.data.stock > 0)) {
        util.toast('成品在库为 0，只能选「从物料出」');
        return;
      }
      this.setData({ mode: m });
    },

    onMaskTap() { this.triggerEvent('close'); },
    onCancel() { this.triggerEvent('close'); },

    onConfirm() {
      const qty = util.round(Number(this.data.qty) || 0, 2);
      if (!(qty > 0)) { util.toast('交付数量需大于 0'); return; }
      if (qty > this.data.remain) { util.toast('超过排单剩余量（' + this.data.remain + '）'); return; }
      if (!this.data.mode) { util.toast('请先选「货从哪来」'); return; }
      this.triggerEvent('submit', { qty: qty, fromStock: this.data.mode });
    }
  }
});
