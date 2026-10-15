// components/picker-sheet/picker-sheet.js —— 主题样式选择器（替代原生 picker）
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '请选择' },
    options: { type: Array, value: [] },
    value: { type: Number, value: 0 },
    rangeKey: { type: String, value: '' }
  },

  data: {
    selected: 0
  },

  observers: {
    'value': function (v) {
      if (typeof v === 'number') this.setData({ selected: v });
    },
    'show': function (v) {
      if (v) this.setData({ selected: typeof this.data.value === 'number' ? this.data.value : 0 });
    }
  },

  methods: {
    onCancel() {
      this.triggerEvent('cancel');
    },
    onConfirm() {
      this.triggerEvent('confirm', { value: this.data.selected });
    },
    onSelect(e) {
      this.setData({ selected: Number(e.currentTarget.dataset.idx) });
    },
    noop() {}
  }
});
