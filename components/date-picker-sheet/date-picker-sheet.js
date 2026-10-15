// components/date-picker-sheet/date-picker-sheet.js —— 主题化日期选择器（替代原生 mode="date"）
// 对齐原生语义：confirm / change 事件均抛出 { value: 'YYYY-MM-DD' }，页面已有 handler 无需改动
const MIN_YEAR = 1970;

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// 闰年判断：能被 4 整除且不能被 100 整除，或能被 400 整除
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

function daysInMonth(y, m) {
  if (m === 2) return isLeap(y) ? 29 : 28;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

// 解析 'YYYY-MM-DD'，失败则返回今天
function parse(v) {
  const now = new Date();
  const fallback = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  if (!v || typeof v !== 'string') return fallback;
  const parts = v.split('-');
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return fallback;
  return { y, m, d };
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    value: { type: String, value: '' },
    title: { type: String, value: '选择日期' }
  },

  data: {
    years: [], months: [], days: [],
    yi: 0, mi: 0, di: 0
  },

  lifetimes: {
    attached() {
      this._buildColumns(this.data.value);
    }
  },

  observers: {
    // 每次打开（或外部值变化）都以当前 value 为基准重建/对齐三列
    'show, value': function (show, value) {
      if (show) this._buildColumns(value);
    }
  },

  methods: {
    _buildColumns(v) {
      const now = new Date();
      const maxYear = now.getFullYear() + 10;
      const years = [];
      for (let y = maxYear; y >= MIN_YEAR; y--) years.push(y);

      const months = [];
      for (let m = 1; m <= 12; m++) months.push(m);

      const { y, m, d } = parse(v);
      // 年份必须在生成范围内，否则回退到当年
      let yi = years.indexOf(y);
      if (yi < 0) yi = years.indexOf(now.getFullYear());
      if (yi < 0) yi = 0;
      const selYear = years[yi];

      let mi = months.indexOf(m);
      if (mi < 0) mi = now.getMonth();
      const selMonth = months[mi];

      const total = daysInMonth(selYear, selMonth);
      const days = [];
      for (let i = 1; i <= total; i++) days.push(i);
      // 日超出当月天数（如 2 月 31 日）时收敛到该月最后一天
      let di = days.indexOf(d);
      if (di < 0) di = total - 1;

      this.setData({ years, months, days, yi, mi, di });
    },

    onPick(e) {
      const col = e.currentTarget.dataset.col;
      const idx = Number(e.currentTarget.dataset.idx);
      if (col === 'y') {
        this._setYear(idx);
      } else if (col === 'm') {
        this._setMonth(idx);
      } else {
        this.setData({ di: idx });
      }
    },

    _setYear(i) {
      const patch = { yi: i };
      // 年变了要重算 2 月天数
      const y = this.data.years[i];
      const m = this.data.months[this.data.mi];
      const total = daysInMonth(y, m);
      const days = [];
      for (let k = 1; k <= total; k++) days.push(k);
      patch.days = days;
      if (this.data.di >= total) patch.di = total - 1;
      this.setData(patch);
    },

    _setMonth(i) {
      const patch = { mi: i };
      const y = this.data.years[this.data.yi];
      const m = this.data.months[i];
      const total = daysInMonth(y, m);
      const days = [];
      for (let k = 1; k <= total; k++) days.push(k);
      patch.days = days;
      if (this.data.di >= total) patch.di = total - 1;
      this.setData(patch);
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const y = this.data.years[this.data.yi];
      const m = this.data.months[this.data.mi];
      const d = this.data.days[this.data.di];
      const value = y + '-' + pad2(m) + '-' + pad2(d);
      // change 与原生 bindchange 同形：e.detail.value
      this.triggerEvent('change', { value });
      this.triggerEvent('confirm', { value });
    },

    noop() {}
  }
});
