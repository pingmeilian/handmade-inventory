// components/line-chart/line-chart.js —— 纯 DOM / CSS 折线 / 柱状图（零依赖）
//
// 为什么不用 canvas：canvas 是微信原生组件 —— 层级最高（弹层盖不住会穿透）、
// 同层渲染有失败率（一旦失败就不随页面/scroll-view 滚动，线就"粘"在原地）。
// 转成图片可以绕开，但会丢掉点击交互。这里改用 DOM：每段线是一条旋转的细条，
// 坐标由 utils/stat-chart.js 的 lineLayout / barLayout 按容器像素尺寸算好。
//
// ⚠️ 2026-10-11（V142）**这个组件的模板此前是残缺的** —— 用户真机报
//    「趋势曲线太丑了，根本看不到有用的信息，为什么只有一个 2.0K，也不知道具体的哪天是哪天，
//      上面那么多圆，点也点不了」。
//    查实：布局层一直算好了四样 —— 纵轴刻度（`yTicks`）、横轴刻度（`xTicks`）、
//    圆点稀疏化（`dots[].showDot`）、每点读数（`dots[].tip`），**而本组件只画了"最后一个值"**。
//    （同一套算法，看板统计弹窗那份模板四样都画了 ⇒ 同一份数据长出了两种观感。）
//    ⇒ 本轮补齐四样 + 再加"按住吸附读数"。**今后改图：布局层加字段，两个模板一起跟上。**
//
// 交互（用户拍板：按住任意位置，不用点准小圆点）：
//   touchstart / touchmove → 吸附到最近的日期 → 竖虚线 + 高亮 + 顶部读数行
//   touchend → 2.2 秒后自动收起（这样"点一下"也看得到）
const statChart = require('../../utils/stat-chart.js');

Component({
  properties: {
    points: { type: Array, value: [], observer() { this.schedule(); } },
    color: { type: String, value: '#C8A98E' },
    unit: { type: String, value: '' },          // '¥' 走前缀；'片' 走后缀
    unitPos: { type: String, value: 'post' },   // pre（金额）| post（数量）
    type: { type: String, value: 'line' },      // line | bar
    height: { type: Number, value: 320 },
    hint: { type: String, value: '按住图上看每天数值' },
    emptyText: { type: String, value: '暂无数据' }
  },

  data: {
    layout: null,      // lineLayout / barLayout 的结果
    tip: '',           // 顶部读数行
    tipIndex: -1,
    mark: null         // 指示线 / 高亮点的坐标
  },

  lifetimes: {
    attached() { this.schedule(); },
    detached() { this.clearTimer(); }
  },

  methods: {
    // 等布局稳定后再量（attached 瞬间节点可能还没有尺寸）
    schedule() {
      this.clearTimer();
      this.setData({ tip: '', tipIndex: -1, mark: null });
      wx.nextTick(() => this.measure());
    },

    measure() {
      this.createSelectorQuery().select('.bm-plot').boundingClientRect().exec((res) => {
        const r = res && res[0];
        if (!r || !r.width || !r.height) return;
        // 触摸命中要用它：clientX 是视口坐标，得减去容器左边界
        this._box = r;
        const w = Math.round(r.width), h = Math.round(r.height);
        const opts = { unit: this.data.unit, unitPos: this.data.unitPos };
        const pts = this.data.points || [];
        let layout = null;
        if (this.data.type === 'bar') {
          layout = statChart.barLayout(pts, w, h, opts);
          // 一根柱都没有（这段时间没有流水）⇒ 交给空态，别画一张"有坐标轴但没有内容"的图
          if (layout && !layout.bars.some((b) => !b.empty)) layout = null;
        } else {
          layout = statChart.lineLayout(pts, w, h, opts);
        }
        this.setData({ layout: layout });
      });
    },

    clearTimer() { if (this._t) { clearTimeout(this._t); this._t = 0; } },

    // 手指位置 → 最近的索引（**吸附**：不用点准）
    // ⚠️ padL / slot 一律从 layout 里取，不在模板或这里另写一份 —— 否则改一处漏一处
    pick(clientX) {
      const L = this.data.layout;
      const box = this._box;
      if (!L || !box) return -1;
      const x = clientX - box.left;
      if (this.data.type === 'bar') {
        if (!L.slot || !L.bars || !L.bars.length) return -1;
        const i = Math.floor((x - L.plot.left) / L.slot);
        return Math.max(0, Math.min(L.bars.length - 1, i));
      }
      const dots = L.dots || [];
      if (!dots.length) return -1;
      if (dots.length === 1) return 0;
      const step = (dots[dots.length - 1].x - dots[0].x) / (dots.length - 1);
      const i = Math.round((x - dots[0].x) / (step || 1));
      return Math.max(0, Math.min(dots.length - 1, i));
    },

    onTouch(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const i = this.pick(t.clientX);
      if (i < 0 || i === this.data.tipIndex) return;   // 只在换了一天才 setData（手指滑动时别刷爆）
      const L = this.data.layout;
      const item = this.data.type === 'bar' ? L.bars[i] : L.dots[i];
      if (!item) return;
      this.clearTimer();
      this.setData({
        tipIndex: i,
        tip: item.tip || '',
        mark: {
          x: this.data.type === 'bar' ? Math.round((item.x + item.w / 2) * 10) / 10 : item.x,
          y: item.y
        }
      });
    },

    onTouchEnd() {
      this.clearTimer();
      this._t = setTimeout(() => {
        this._t = 0;
        this.setData({ tip: '', tipIndex: -1, mark: null });
      }, 2200);
    }
  }
});
