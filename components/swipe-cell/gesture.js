// components/swipe-cell/gesture.js —— 左滑组件的手势数学（纯函数，无副作用）
//
// 为什么单独抽出来：跟手位移、阈值吸附、轴向判定这些式子出错时的表现是
// 「滑不动 / 滑一半缩回去 / 方向反了」——真机上最难定位的那一类。收口成纯函数后
// 可以在 Node 里穷举边界（NaN / 超界 / 反向 / RTL / 已展开时再拖 / 甩动），见 tests/swipe-gesture.test.js。
//
// 坐标单位说明：触摸/鼠标事件给的坐标是 px；操作项宽度配置用 rpx（与 WXSS 一致），
// 所以 areaPxOf 负责 rpx → px 的换算（依赖屏幕宽度）。

const AXIS_SLOP = 10;             // 轴向判定阈值（px）：小于它不判方向，避免手抖误判
const AXIS_DOMINANCE = 1.2;       // 主轴要压过副轴这么多倍才算"判得准"（否则继续等）
const AXIS_FIX_MS = 260;          // 误判纵向后的纠偏窗口（起手那一小段纵向漂移）
const AXIS_FIX_MAX_PX = 30;       // 纵向位移超过它就不再纠偏（页面已经在滚了，别去抢）
const DEFAULT_THRESHOLD = 0.3;    // 落位阈值：朝目标方向拖过「操作区宽度 × 它」就落位
const DEFAULT_ACTION_W_RPX = 130; // 单个操作项默认宽度（rpx），与组件 WXSS 的默认值一致
const DEFAULT_WINDOW_WIDTH = 375;
const SAMPLE_WINDOW_MS = 150;     // 只用最近这段时间的位移采样算速度
const SAMPLE_MIN_DT_MS = 8;       // 两帧间隔小于它测不出可靠速度（当"没甩"处理）
const FLICK_V = 0.35;             // 甩动判定（px/ms ≈ 350px/s）：短促一甩即使距离不够也认

// 从右往左书写的语言（RTL）。direction=auto 时据此决定滑动方向。
const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'ug', 'dv', 'ps', 'sd', 'yi'];

// 语言与窗宽在一次运行内不会变，缓存住 —— 否则长列表里每张卡片都会同步问一次系统
let _lang = null;
let _ww = null;

// 方向 → 位移符号（这是 RTL 的唯一判定点，视图侧不许再算一遍）
//   'left' ：手指左滑（dx<0）→ 内容左移、露出右侧操作区 → 位移取正 → 符号 -1
//   'right'：RTL，手指右滑（dx>0）→ 内容右移、露出左侧操作区 → 位移取正 → 符号 +1
function signOf(direction) {
  return direction === 'right' ? 1 : -1;
}

function resolveDirection(direction, language) {
  if (direction === 'left' || direction === 'right') return direction;
  if (direction === 'auto') {
    const lang = String(language || '').toLowerCase();
    return RTL_LANGS.some((p) => lang.indexOf(p) === 0) ? 'right' : 'left';
  }
  return 'left';   // 脏配置兜底：绝不能两边都不响应（那才是最难查的）
}

// 主轴判定：'h'（横向）| 'v'（纵向）| null（势均力敌，判不准）
// ⚠️ 这里刻意不"二选一硬判"：手指起手那一小段往往是斜的，硬判一半概率判错，
//    一旦判错整串手势就废了 → 用户看到的就是"时灵时不灵"。判不准就返回 null 继续等。
function dominance(dx, dy, factor) {
  const f = Number(factor) > 0 ? Number(factor) : AXIS_DOMINANCE;
  const ax = Math.abs(Number(dx) || 0);
  const ay = Math.abs(Number(dy) || 0);
  if (ax > ay * f) return 'h';
  if (ay > ax * f) return 'v';
  return null;
}

function axisOf(dx, dy, slop) {
  const s = slop == null ? AXIS_SLOP : Number(slop);
  const ax = Math.abs(Number(dx) || 0);
  const ay = Math.abs(Number(dy) || 0);
  if (ax < s && ay < s) return null;      // 还没动够，别急着下结论
  return dominance(dx, dy);
}

// 已被判成纵向之后，是否允许纠正为横向。
// 为什么需要：拇指起手常有一小段向下的漂移，会被判成"滚动"；若就此把整串手势判死，
// 用户明明在横滑却怎么都划不出来（真机"有时能划出来有时不能"的主因之一）。
// 约束：只在起手一小段时间内、且纵向还没滚开时才允许改判，免得跟页面的滚动抢。
function canFixToHorizontal(dx, dy, elapsedMs) {
  const e = Number(elapsedMs);
  if (!(e >= 0 && e < AXIS_FIX_MS)) return false;
  if (Math.abs(Number(dy) || 0) >= AXIS_FIX_MAX_PX) return false;
  return dominance(dx, dy) === 'h';
}

// 跟手位移：baseTranslate（手势开始时就有的位移）+ 本次拖动量 → [0, maxPx]
// ⚠️ 必须带 base：已经展开的卡片再"往开的方向"拖一点，若只算本次 dx，位移会从
//    maxPx 瞬间掉到几像素（视觉上"跳回去"）。
function dragTranslate(baseTranslate, dx, sign, maxPx) {
  const m = Number(maxPx);
  if (!(m > 0)) return 0;      // 操作区宽度未知 → 不位移（绝不能把 NaN 写进样式）
  const base = Number(baseTranslate) || 0;
  const v = base + (Number(dx) || 0) * (sign === 1 ? 1 : -1);
  if (!(v > 0)) return 0;      // 反向拖到底：夹在 0，不把卡片往反侧推
  return v > m ? m : v;
}

// ---------- 甩动（速度）采样 ----------
// 采样的是「语义化位移」而不是手指坐标：这样速度天然带上"朝打开/朝收合"的符号，
// 且对 RTL 无需任何额外判断。
function pushSample(samples, v, t, windowMs) {
  const arr = samples || [];
  arr.push({ v: Number(v) || 0, t: Number(t) || 0 });
  const w = windowMs == null ? SAMPLE_WINDOW_MS : Number(windowMs);
  const last = arr[arr.length - 1].t;
  while (arr.length > 1 && (last - arr[0].t) > w) arr.shift();
  return arr;
}

// 速度（px/ms）。测不出来就返回 0 —— 宁可当"没甩"按距离判，也不要瞎判。
function velocityOf(samples) {
  const arr = samples || [];
  if (arr.length < 2) return 0;
  const a = arr[0];
  const b = arr[arr.length - 1];
  const dt = b.t - a.t;
  if (!(dt >= SAMPLE_MIN_DT_MS)) return 0;
  return (b.v - a.v) / dt;
}

// 松手落位：0（收合）或 maxPx（展开）
// startedOpen：手势开始时是否已展开 —— 决定"往哪边算阈值"：
//   从收合开始：朝开的方向拖过 maxPx×threshold → 展开
//   从展开开始：朝关的方向拖过 maxPx×threshold → 收合（对"想关掉"的人同样宽容）
// velocity：朝打开方向为正。快速短滑（距离不够）也认，否则用户会觉得"明明划了却缩回去"。
function snapTranslate(translate, maxPx, threshold, startedOpen, velocity) {
  const m = Number(maxPx);
  if (!(m > 0)) return 0;
  const t = Number(translate) || 0;
  if (!(t > 0)) return 0;   // 完全没动过 → 永不展开（否则 threshold=0 时"点一下就展开"）
  const v = Number(velocity) || 0;
  const th = (threshold == null || isNaN(Number(threshold))) ? DEFAULT_THRESHOLD : Number(threshold);
  if (v >= FLICK_V) return m;      // 朝打开方向甩：距离不够也展开
  if (v <= -FLICK_V) return 0;     // 朝收合方向甩：距离够也收合
  if (startedOpen) return t > m * (1 - th) ? m : 0;
  return t >= m * th ? m : 0;
}

// 操作区总宽（rpx → px）。单个操作项可用 width 覆盖默认宽度。
function areaPxOf(actions, defaultWidthRpx, windowWidth) {
  const list = actions || [];
  const ww = Number(windowWidth) > 0 ? Number(windowWidth) : DEFAULT_WINDOW_WIDTH;
  const def = Number(defaultWidthRpx) > 0 ? Number(defaultWidthRpx) : DEFAULT_ACTION_W_RPX;
  let sumRpx = 0;
  list.forEach((a) => {
    const w = a && a.width != null ? Number(a.width) : def;
    sumRpx += (w > 0 ? w : def);
  });
  return Math.round(sumRpx * (ww / 750) * 100) / 100;
}

// 内容实际用于 transform 的值（符号与方向配套）。语义化位移 translate 始终是正数。
function contentX(translate, direction) {
  return (Number(translate) || 0) * signOf(direction);
}

function systemLang() {
  if (_lang == null) {
    try {
      _lang = String((wx.getSystemInfoSync() || {}).language || '');
    } catch (e) {
      _lang = '';   // 拿不到语言不是错误，兜底 left
    }
  }
  return _lang;
}

function systemWindowWidth() {
  if (_ww == null) {
    try {
      _ww = Number((wx.getSystemInfoSync() || {}).windowWidth) || DEFAULT_WINDOW_WIDTH;
    } catch (e) {
      _ww = DEFAULT_WINDOW_WIDTH;
    }
  }
  return _ww;
}

// 测试钩子；组件在页面 resize 时也会调它（屏宽变了，rpx→px 的比例要重算）
function clearCache() { _lang = null; _ww = null; }

module.exports = {
  AXIS_SLOP, AXIS_DOMINANCE, AXIS_FIX_MS, AXIS_FIX_MAX_PX,
  DEFAULT_THRESHOLD, DEFAULT_ACTION_W_RPX, DEFAULT_WINDOW_WIDTH,
  SAMPLE_WINDOW_MS, SAMPLE_MIN_DT_MS, FLICK_V, RTL_LANGS,
  signOf, resolveDirection, dominance, axisOf, canFixToHorizontal,
  dragTranslate, pushSample, velocityOf, snapTranslate, areaPxOf, contentX,
  systemLang, systemWindowWidth, clearCache
};
