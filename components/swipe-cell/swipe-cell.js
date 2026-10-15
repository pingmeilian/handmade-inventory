// components/swipe-cell/swipe-cell.js —— 通用「左滑露出操作区」组件
//
// 复用边界（刻意保持的"无知"）：
//   · 组件不认识任何业务数据。操作项由 actions 配置（文案/图标/主题色/是否确认），
//     用户点了只抛 action 事件（detail = { key, index, action }），怎么处理由宿主决定。
//   · 手势数学在 gesture.js（纯函数、可单测）；"同时只开一张 / 一键收起"在 registry.js
//     （页面也能 require，拿到的是同一份状态）。
//
// 三条硬要求是怎么满足的：
//   ① 不影响列表纵向滚动 —— 手势先判轴向：判为纵向就整串交还原生滚动（不 catchtouchmove，
//      因为小程序做不到"只在横滑时禁滚动"，用了它会连纵向滚动一起废掉）
//   ② 不影响卡片点击跳转 —— 组件全程不拦 tap；展开状态下点卡片由宿主用
//      registry.closeIfAny() 决定"只收起、不跳转"
//   ③ PC 鼠标可用 —— 手机走 touch 事件，PC 走官方 pointer 事件（bind:pointer*）
//
// 手势稳定性（2026-09-14 真机反馈"时灵时不灵"后逐条加固，复现测试见 tests/swipe-cell.test.js）：
//   A. 拖动中不许被外部 close 打断（列表滚动触发的"收起一切"会掐掉进行中的手势）
//   B. 双通路（touch/pointer）里"哪一路在动就跟哪一路"，但不允许没按下过的一路接管
//   C. 认准「起始的那根手指」（多指时 touches[0] 可能已经换人了）
//   D. 轴向判定"判不准就继续等"，并给出短窗口纠偏（起手的纵向漂移不该把整串手势判死）
//   E. 松手判定接入甩动速度（快速短滑也认，否则用户觉得"明明划了却缩回去"）
//
// 平台说明：微信官方文档明确「在 PC 上 pointer 事件也会被触发（类似 web 标准）」，
// 所以鼠标拖拽走 pointer 通路；tap/longpress 鼠标也能触发，但拖拽不会。
const util = require('../../utils/util.js');
const gesture = require('./gesture.js');
const registry = require('./registry.js');

// 「这串手势还活着」的时间窗（毫秒）：最后一次事件距现在不到它，就认为手指/鼠标还在上面。
// 一个常量管两件事，语义是同一句话：
//   · 新的 down 落在窗口内 → 是同一串手势的另一路（PC 双发），不重新基线
//   · 窗口内的 close() → 拒绝（别掐掉用户正在进行的拖动）
// 反过来，超出窗口说明末尾事件丢了（鼠标在元素外抬起等）→ 可以落位/收起，不留"卡住的半开卡片"。
const LIVE_MS = 800;

Component({
  externalClasses: ['ext-class'],   // 宿主想额外定制造型（间距/阴影）时用

  properties: {
    // 操作项：[{ key, text, icon?, iconSrc?, theme?, width?(rpx), confirm?, disabled? }]
    // confirm: true（用默认文案）| { title, content, confirmText }
    actions: { type: Array, value: [] },
    // 滑动方向：'left'（默认，左滑露出右侧操作区）| 'right'（RTL）| 'auto'（按系统语言自动判）
    direction: { type: String, value: 'left' },
    actionWidth: { type: Number, value: gesture.DEFAULT_ACTION_W_RPX },   // 单个操作项宽度（rpx）
    threshold: { type: Number, value: gesture.DEFAULT_THRESHOLD },        // 落位阈值（0~1）
    disabled: { type: Boolean, value: false }
  },

  data: {
    dir: 'left',       // 解析后的实际方向（视图据此决定操作区贴哪边）
    areaPx: 0,         // 操作区总宽（px），手势数学用；0 = 没有操作项，不挂手势
    translate: 0,      // 语义化位移：永远是正数，方向只体现在 bodyX 的符号上
    bodyX: 0,          // 真正用于 transform 的值（符号由 gesture.contentX 统一决定）
    open: false,
    dragging: false    // 跟手期间关掉过渡动画，否则会有"橡皮筋"延迟感
  },

  observers: {
    'actions, direction, actionWidth': function () { this._sync(); }
  },

  lifetimes: {
    attached() {
      registry.attach(this);
      this._sync();
    },
    detached() {
      this._g = null;
      registry.detach(this);   // 不留悬空引用（否则 registry 会一直以为有人在展开）
    }
  },

  pageLifetimes: {
    // 切后台/跳走：先丢掉进行中的手势再收起（close 本身会拒绝打断手势，见它的注释）
    hide() { this._g = null; this.close(); },
    resize() { gesture.clearCache(); this._sync(); }   // 屏宽变了：rpx→px 比例要重算
  },

  methods: {
    // ==================== 初始化 ====================
    _sync() {
      const dir = gesture.resolveDirection(this.data.direction, gesture.systemLang());
      const areaPx = gesture.areaPxOf(this.data.actions, this.data.actionWidth, gesture.systemWindowWidth());
      const patch = {};
      if (dir !== this.data.dir) patch.dir = dir;
      if (areaPx !== this.data.areaPx) patch.areaPx = areaPx;
      // 方向变了 → 已展开的位移方向要立刻跟着翻（不能等下一次手势）
      let translate = this.data.translate;
      if (translate > areaPx) translate = areaPx;
      const bodyX = gesture.contentX(translate, dir);
      if (translate !== this.data.translate) patch.translate = translate;
      if (bodyX !== this.data.bodyX) patch.bodyX = bodyX;
      if (Object.keys(patch).length) this.setData(patch);
    },

    // registry 用它判断"这张卡需不需要收"（半开的也算，不能只看 open）
    visible() { return this.data.open || this.data.translate > 0; },

    // ==================== 手势：双通路（touch / pointer） ====================
    onTouchStart(e) { this._start(e, 'touch'); },
    onTouchMove(e) { this._move(e, 'touch'); },
    onTouchEnd(e) { this._end(e, 'touch'); },
    onPointerDown(e) { this._start(e, 'pointer'); },
    onPointerMove(e) { this._move(e, 'pointer'); },
    onPointerUp(e) { this._end(e, 'pointer'); },
    // 鼠标移出元素/被系统打断时没有 pointerup —— 用它兜住，否则会停在半开状态。
    // 只处理"本来就是鼠标手势"的情况（touch 手势不该被一次无关的离开事件收尾）。
    onPointerLeave(e) {
      const g = this._g;
      if (g && g.src === 'pointer') this._end(e, 'pointer');
    },

    // 从事件里取坐标。
    // ⚠️ 必须认准「起始的那根手指」：屏幕上多一根手指（另一只手、手掌误触）时
    //    touches[0] 可能已经不是起始手指，拿它算 dx 会让位移乱跳 —— 真机"时灵时不灵"的来源之一。
    _point(e, id) {
      const list = (e && e.touches && e.touches.length) ? e.touches
        : ((e && e.changedTouches && e.changedTouches.length) ? e.changedTouches : null);
      if (list) {
        let t = null;
        if (id == null) {
          t = list[0];                       // 起手那一帧还不知道是谁，先记第一个
        } else {
          for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].identifier === id) { t = list[i]; break; }
          }
          if (!t) return null;               // 起始手指不在这批事件里 → 忽略这一帧（宁可不动，也别乱跳）
        }
        if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY, id: t.identifier };
      }
      // Pointer 事件（PC）：web 风格字段
      if (e && typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY, id: null };
      if (e && typeof e.pageX === 'number') return { x: e.pageX, y: e.pageY, id: null };
      return null;
    },

    _start(e, src) {
      if (this.data.disabled) return;
      if (!this.data.areaPx) return;                     // 没操作项（或还没初始化）：不挂手势
      const p = this._point(e, null);
      if (!p) return;                                    // 脏事件（没有坐标）

      const now = Date.now();
      let g = this._g;
      if (g) {
        g.seen[src] = true;                              // 这一路也是本手势的合法来源（PC 双发时拖动可能由另一路送来）
        const idle = now - (g.last || g.t);
        if (idle < LIVE_MS) { g.last = now; return; }    // 这串手势还活着 → 不重新基线（含 PC 双发与拖拽中）
        // 走到这里说明上一串手势已经断流（末尾事件丢失：鼠标在元素外抬起、来电打断…）→ 先给它落位
        this._settle(this._snapTarget(g));
        g = null;
      }

      this._g = {
        src: src,          // 当前主管这一路
        seen: {},          // 参与过本手势的来源集合（必须"按下过"才算数）
        id: p.id,          // 起始手指的 identifier（多指时靠它认人）
        x0: p.x, y0: p.y,
        axis: null,        // null=还没判出来 | 'h' | 'v'
        moved: false,      // 当前这一路是否已经真的拖动过
        base: this.data.translate,
        t: now,
        last: now,
        samples: gesture.pushSample(null, this.data.translate, now)
      };
      this._g.seen[src] = true;
    },

    _move(e, src) {
      const g = this._g;
      if (!g) return;                                    // 没按下（PC 的悬停 pointermove 也会走到这）
      // 另一路事件：只有"从没按下过"才算非法（鼠标划过）；本手势内按下过、且当前主路还没动过
      // （两路只来了一路的事件流）→ 允许接管，保证"哪一路在动就跟哪一路"。
      // 注意顺序：先取到有效坐标再决定接管，否则一次脏事件就会把"未动过"的状态吃掉。
      if (src !== g.src && (!g.seen[src] || g.moved)) return;

      const p = this._point(e, g.id);
      if (!p) return;
      if (src !== g.src) { g.src = src; g.id = p.id; }   // 接管：换成这一路，并认它的手指
      g.moved = true;

      const now = Date.now();
      g.last = now;
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;

      if (!g.axis) {
        const axis = gesture.axisOf(dx, dy, gesture.AXIS_SLOP);
        if (!axis) return;                               // 还没动够 / 势均力敌：再等等（宁可晚判，也别判错）
        g.axis = axis;
        if (axis === 'v') return;                        // 纵向：本帧起交还原生滚动（保留 _g，见下面的纠偏）
        if (!this.data.dragging) this.setData({ dragging: true });
        registry.closeOthers(this);                      // 别人开始横滑 → 先收起已展开的那张
      } else if (g.axis === 'v') {
        // ★ 纠偏：拇指起手常有一小段纵向漂移，会被判成"滚动"。若纵向还很浅、横向已明确占优、
        //   且还在起手窗口内 → 改判为横向，别把一整串手势判死。
        if (!gesture.canFixToHorizontal(dx, dy, now - g.t)) return;
        g.axis = 'h';
        if (!this.data.dragging) this.setData({ dragging: true });
        registry.closeOthers(this);
      }

      // 带上起始位移：已展开时再往开的方向拖，位移应停在边界而不是从 0 重新算
      const next = gesture.dragTranslate(g.base, dx, gesture.signOf(this.data.dir), this.data.areaPx);
      // 亚像素级的移动不值得过桥（setData 是有成本的）
      if (Math.abs(next - this.data.translate) >= 1) {
        gesture.pushSample(g.samples, next, now);
        this.setData({ translate: next, bodyX: gesture.contentX(next, this.data.dir) });
      }
    },

    _end(e, src) {
      const g = this._g;
      // 只认"当前主管这一路"的收尾：另一路的 up/leave 不该替它落位
      // （PC 双发时两路坐标来自同一个鼠标，所以先到的那一路收尾就够；多来的那一路此时 _g 已空）
      if (!g || src !== g.src) return;
      this._g = null;
      if (g.axis !== 'h') return;                        // 纵向 / 未判定：什么都不做
      this._settle(this._snapTarget(g));
    },

    // 松手该落到哪：距离阈值 + 甩动速度（"快速短滑"也认）
    _snapTarget(g) {
      return gesture.snapTranslate(
        this.data.translate,
        this.data.areaPx,
        this.data.threshold,
        (Number(g && g.base) || 0) > 0,
        gesture.velocityOf(g && g.samples)
      );
    },

    // 落位：0 = 收起，areaPx = 完全展开
    _settle(target) {
      const wasOpen = this.data.open;
      const open = target > 0;
      this.setData({
        translate: target,
        bodyX: gesture.contentX(target, this.data.dir),
        open: open,
        dragging: false
      });
      if (open) registry.notifyOpen(this); else registry.notifyClose(this);
      if (open !== wasOpen) this.triggerEvent('change', { open: open });
    },

    // ==================== 对外方法 ====================
    close() {
      // ⚠️ 手势"还活着"时不许被打断。列表滚动（宿主的"滚动即收起"）、别的卡片、宿主主动调用，
      //    都不该掐掉用户正在进行的手势 —— 真机现象就是"刚划一点就缩回去、之后也不跟手"
      //    （横滑时页面常会滚几个像素 → 触发收起 → 手势被清掉）。
      //    手势由 _end 自己按阈值落位；但若末尾事件丢了、已经断流（超过 LIVE_MS 没动静），
      //    这里就放行，免得留下"卡在半开、点空白也收不掉"的卡片。
      const g = this._g;
      if (g && (Date.now() - (g.last || g.t)) < LIVE_MS) return;
      this._g = null;
      if (!this.data.open && this.data.translate === 0) { registry.notifyClose(this); return; }
      const wasOpen = this.data.open;
      this.setData({ translate: 0, bodyX: gesture.contentX(0, this.data.dir), open: false, dragging: false });
      registry.notifyClose(this);
      if (wasOpen) this.triggerEvent('change', { open: false });
    },

    // ==================== 操作项 ====================
    // 可选：给操作项挂 JS 函数回调（"配置化回调"的 JS 侧注入通道）。
    //
    // 为什么不能直接写在 actions 里：组件属性是从 WXML 传进来的，跨渲染层必须可序列化
    // —— 函数会在传递中被丢掉，组件根本收不到。所以回调只能走 JS 侧注入（不经过 setData）。
    //
    // 用法（页面里拿到实例后调一次）：
    //   const c = this.selectComponent('#sc_' + id);
    //   c.setHandlers({ edit: (d) => {...}, del: (d) => {...} });
    //
    // 语义：某个 key 挂了 handler → **只调 handler，不再抛 action 事件**（避免同一个操作被处理两次）。
    //      没挂 handler 的 key 照旧抛事件 —— 两种方式可以在同一张卡上混用。
    // 传 null / 非对象 = 清空（回到纯事件模式）。非函数值会被过滤掉，不让它在点击时才炸。
    setHandlers(map) {
      const src = (map && typeof map === 'object') ? map : {};
      const out = {};
      Object.keys(src).forEach((k) => { if (typeof src[k] === 'function') out[k] = src[k]; });
      this._handlers = out;
      return this;   // 支持链式
    },

    onActionTap(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
      const i = Number(ds.i);
      const a = (this.data.actions || [])[i];
      if (!a || a.disabled) return;                      // 禁用项：连收起都不做（毫无反应才对）

      const fire = () => {
        this.close();   // 先收起：即使宿主随后把这一行删了，也不留"展开着的空卡片"
        const detail = { key: a.key, index: i, action: a };
        const h = this._handlers && this._handlers[a.key];
        if (typeof h === 'function') { h.call(this, detail); return; }   // 挂了 handler → 只走它
        this.triggerEvent('action', detail);
      };
      if (!a.confirm) { fire(); return; }

      // confirm 由组件统一走 util.confirm：它自带「按钮文字 ≤4 字」与「失败不挂起」两道保险
      const c = (typeof a.confirm === 'object' && a.confirm) ? a.confirm : {};
      util.confirm(c.title || '确认操作', c.content || (a.text + '？'), c.confirmText || '确定')
        .then((yes) => { if (yes) fire(); });
    },

    noop() {}
  }
});
