// utils/stat-chart.js —— 看板统计图表的「布局计算」层（纯 DOM / CSS 渲染，不依赖 canvas）
//
// 为什么不用 canvas：canvas 是微信原生组件 —— 层级最高（弹层盖不住会穿透）、
// 同层渲染有失败率（一旦失败就不随 scroll-view 滚动，图表"粘"在原地）。
// 转成图片能绕开，但会丢掉点击交互、文字也会被画布边界裁掉。
// 纯 DOM + CSS 渲染：跟随滚动、可点击、文字自然换行不被裁。
//
// 本文件只负责「算」：把数据算成角度 / 像素坐标 / 百分比，交给 WXML 渲染。

const util = require('./util.js');
// V97：图表里的兜底色跟随主题（分项自带 color 时仍以数据为准）。
const themes = require('./themes.js');
const tstate = require('../services/state.js');
function themePrimary() {
  try { return themes.get(tstate.getTheme()).primary; } catch (e) { return themes.get(themes.DEFAULT).primary; }
}

const THEME = {
  line: '#C8A98E',
  grid: '#EDE4D8',
  textSub: '#9C948B',
  area: 'rgba(200,169,142,0.10)'
};

// #RRGGBB → rgba(r,g,b,a)
function fade(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * 环形图：生成 conic-gradient 的色停靠点字符串
 * @param {Array} list 已装饰的分类明细（含 color / value）
 * @param {number} total 环上的分母（只统计正值项）
 * @param {number} highlight 高亮项下标（-1 表示无）；高亮时其余段淡出
 */
function ringGradient(list, total, highlight) {
  const items = (list || []).filter(x => x.value > 0);
  const n = items.length;
  if (!n || !(total > 0)) return '';
  // 段间留缝：超过一段才留（单段留缝会在环上开个口子）。
  // 3° 是「稳定可见」的下限 —— 更小的缝会被 conic-gradient 的渲染精度吃掉，
  // 表现为「有的段之间有缝、有的看着连在一起」。
  const gap = n > 1 ? Math.min(4.5, (360 / n) * 0.4) : 0;
  const stops = [];
  let acc = 0;
  items.forEach((item, i) => {
    const sweep = (item.value / total) * 360;
    const from = acc + (i === 0 ? 0 : gap / 2);
    const to = acc + sweep - (i === n - 1 ? 0 : gap / 2);
    if (i > 0) stops.push('transparent ' + acc.toFixed(2) + 'deg ' + from.toFixed(2) + 'deg');
    const dim = highlight >= 0 && highlight !== i;
    if (to > from) stops.push((dim ? fade(item.color, 0.28) : item.color) + ' ' + from.toFixed(2) + 'deg ' + to.toFixed(2) + 'deg');
    acc += sweep;
  });
  return stops.join(', ');
}

/* --------------------------------------------------------------------------
   扇区命中判断
   为什么不用 clip-path 热区：实测在小程序里不可靠 —— 热区被上层元素挡住就点不到，
   且部分环境不按裁剪形状做 hit-test，点哪都只会命中最后一个。
   改为页面把触摸坐标传进来，这里按「到圆心的距离 + 角度」直接算落点，稳妥。
   -------------------------------------------------------------------------- */
// 把角度归一化到 [-90, 270)，与扇区起止角的取值范围一致（-90 = 12 点方向）
function normAngle(deg) {
  let a = deg;
  while (a < -90) a += 360;
  while (a >= 270) a -= 360;
  return a;
}

// 命中哪一段扇区；-1 表示没落在环带上
function hitArc(arcs, angle) {
  for (let i = 0; i < (arcs || []).length; i++) {
    if (angle >= arcs[i].a0 && angle <= arcs[i].a1) return arcs[i].idx;
  }
  return -1;
}

// 触摸点 → 扇区下标。box 是 .ring-wrap 的 boundingClientRect（视口坐标），
// x/y 用 touch 的 clientX/clientY（同样是视口坐标，两者不能混用 pageX）。
// 环带上下各留 10px 容差，手指没那么准。
function hitRing(ring, box, x, y) {
  if (!ring || !box) return -1;
  const ox = x - box.left - ring.cx;
  const oy = y - box.top - ring.cy;
  const r = Math.sqrt(ox * ox + oy * oy);
  if (r < ring.inner - 8 || r > ring.R + 12) return -1;
  return hitArc(ring.arcs, normAngle(Math.atan2(oy, ox) * 180 / Math.PI));
}

// 同侧标签纵向防重叠：按理想位置排序后向下推，超出底部再整体上推。
// ⚠️ 必须先按 ly 排序 —— 标签数组是按「占比降序」生成的，并不是按位置排好的；
// 直接推会把上下顺序彻底打乱（出现过「环最上方的扇区，名字显示在最下面」）。
// 下限 28px = 标签实际行高（两行文字），再小就会叠字
function arrangeLabels(arr, top, bottom, minGap) {
  const n = arr.length;
  if (!n) return arr;
  arr.sort((a, b) => a.ly - b.ly);
  const gap = n > 1 ? Math.max(28, Math.min(minGap, (bottom - top) / (n - 1))) : minGap;

  for (let i = 0; i < n; i++) {
    arr[i].ly = i === 0 ? Math.max(arr[i].ly, top) : Math.max(arr[i].ly, arr[i - 1].ly + gap);
  }
  const over = arr[n - 1].ly - bottom;
  if (over > 0) {
    // 整体上推（而不是逐个 clamp），尽量保留标签与扇区的相对位置
    for (let i = n - 1; i >= 0; i--) {
      arr[i].ly = i === n - 1 ? bottom : Math.min(arr[i].ly, arr[i + 1].ly - gap);
    }
    for (let i = 0; i < n; i++) {
      arr[i].ly = i === 0 ? Math.max(arr[i].ly, top) : Math.max(arr[i].ly, arr[i - 1].ly + gap);
    }
  }
  return arr;
}

/**
 * 环形图完整布局：环几何 + 扇区热区 + 折线引线 + 环外标签（自动防重叠、不压环、不出界）
 *
 * 视觉约定（用户拍板）：
 *   - 环用**浅底色**（palette 的 bg），环带**细**（约半径的 30%）
 *   - 分类名 + 百分比必须保留，且**不能与环重叠、不能被遮挡/截断**
 *   - 引线用**折线**：从环外沿斜出一小段，再水平折到标签
 *   - 段间是直角切缝（不做圆头，conic-gradient 的天然限制，用户已接受）
 *
 * @param {Array} list  已装饰的分类明细（含 color / name / value / percentText）
 * @param {number} total 环分母（只统计正值项）
 * @param {number} w    容器宽（px，需先量）
 * @param {number} h    容器高（px）
 * @param {number} highlight 高亮项下标（-1 无）
 * @returns {Object|null} 供 WXML 直接内联的像素/百分比数据
 */
function ringLayout(list, total, w, h, highlight) {
  const items = (list || []).filter(x => x.value > 0);
  if (!items.length || !(total > 0) || !(w > 0) || !(h > 0)) return null;

  const pad = 6;
  const cx = w / 2, cy = h / 2;
  // 环要瘦：直径约容器高的 66%，同时给左右标签留出空间
  const R = Math.max(26, Math.min(h * 0.33, w * 0.20));
  const thick = Math.max(5, R * 0.30);
  const inner = R - thick;
  const elbow = 15;       // 引线斜出的径向长度
  const leadGap = 5;      // 引线末端到标签的间距

  // 扇形角（从 12 点方向顺时针）
  const n = items.length;
  const gapDeg = n > 1 ? Math.min(4.5, (360 / n) * 0.4) : 0;
  let acc = 0;
  const segs = items.map((item, i) => {
    const sweep = (item.value / total) * 360;
    const a0 = -90 + acc;
    const a1 = a0 + sweep;
    acc += sweep;
    return { item, idx: i, a0, a1, mid: (a0 + a1) / 2 };
  });

  // 标签可用宽（左右对称）
  const lw = Math.max(52, cx - R - elbow - leadGap - pad);

  // 先按环上位置给一个初始 y，再分侧防重叠
  const labels = segs.map(s => {
    const rad = s.mid * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const side = cos >= 0 ? 'right' : 'left';
    return {
      idx: s.idx,
      side: side,
      cos: cos, sin: sin,
      name: s.item.name,
      percentText: s.item.percentText,
      color: s.item.color || themePrimary(),
      ly: cy + sin * (R + elbow)
    };
  });

  // 分侧后各自排布。优先贴着环（引线短、角度感强）；标签多到放不下时才扩展到容器边界
  const bySide = { right: [], left: [] };
  labels.forEach(l => bySide[l.side].push(l));
  const LABEL_GAP = 34;
  const ringTop = cy - R * 0.92, ringBottom = cy + R * 0.92;
  const boxTop = pad + 14, boxBottom = h - pad - 14;
  Object.keys(bySide).forEach(side => {
    const arr = bySide[side];
    const need = Math.max(0, arr.length - 1) * LABEL_GAP;
    const fits = need <= (ringBottom - ringTop) - 1;
    arrangeLabels(arr, fits ? ringTop : boxTop, fits ? ringBottom : boxBottom, LABEL_GAP);
  });

  labels.forEach(l => {
    // 引线第一段（斜线）：环外沿 → 径向斜出 elbow、纵向对齐标签中心
    const x1 = cx + R * l.cos, y1 = cy + R * l.sin;
    const px = cx + (R + elbow) * l.cos;
    const dx = px - x1, dy = l.ly - y1;
    l.x1 = util.round(x1, 1);
    l.y1 = util.round(y1, 1);
    l.len1 = util.round(Math.sqrt(dx * dx + dy * dy), 1);
    l.deg1 = util.round(Math.atan2(dy, dx) * 180 / Math.PI, 2);

    // 引线第二段（水平）：折点 → 标签内侧边界（左右两侧锚点各自固定，标签才会整齐对齐）
    if (l.side === 'right') {
      const anchor = cx + R + elbow + leadGap;
      l.hx = util.round(px, 1);
      l.hw = util.round(Math.max(2, anchor - px), 1);
      l.lx = util.round(anchor, 1);
    } else {
      const anchor = cx - R - elbow - leadGap;   // 左侧的「标签右边界」
      l.hx = util.round(anchor, 1);
      l.hw = util.round(Math.max(2, px - anchor), 1);
      l.lx = util.round(anchor - lw, 1);
    }
    l.hy = util.round(l.ly, 1);
    l.ly = util.round(l.ly, 1);
    l.lw = Math.round(lw);
  });

  // 每段的角度区间（含段间留缝）：页面按触摸坐标判断点到了哪一段。
  // 只在「相邻处」缩缝：首段起点必须在 -90（12 点），末段终点必须在 270，否则环会缺口。
  const arcs = segs.map((s, i) => ({
    idx: s.idx,
    a0: util.round(s.a0 + (i > 0 ? gapDeg / 2 : 0), 2),
    a1: util.round(s.a1 - (i < n - 1 ? gapDeg / 2 : 0), 2),
    name: s.item.name
  }));

  return {
    cx: cx, cy: cy,
    R: util.round(R, 1),
    inner: util.round(inner, 1),
    thick: util.round(thick, 1),
    ringLeft: util.round(cx - R, 1),
    ringTop: util.round(cy - R, 1),
    ringSize: util.round(R * 2, 1),
    holeLeft: util.round(cx - inner, 1),
    holeTop: util.round(cy - inner, 1),
    holeSize: util.round(inner * 2, 1),
    gradient: ringGradient(list, total, highlight),
    arcs: arcs,
    labels: labels
  };
}

/* ---------- V142：量程与刻度 ----------
   用户报（真机截图）：趋势曲线"根本看不到有用的信息，为什么只有一个 2.0K，
   也不知道具体的哪天是哪天，上面那么多圆，点也点不了"。
   查实有两层原因：
     ① **算好的刻度没画**（`lineLayout` 一直在产出 yTicks / xTicks / showDot / tip，
        而 `components/line-chart` 的模板只画了"最后一个值"）—— 见该组件头部的注释；
     ② **量程把曲线压平**：改前"全正数就从 0 起画"，库存这种 2000 上下只动几十的数据
        ⇒ 被压成一条贴着顶部的直线。
   下面这个 `niceScale` 是 ② 的修法：量程贴着数据自身范围走，并把步长归一到 1/2/5×10^k，
   上下界取到步长的整数倍 ⇒ 三档刻度落在整数上（¥1.8k / ¥2.0k / ¥2.2k），一眼可比。 */
function niceScale(lo, hi, ticks) {
  const n = Math.max(2, ticks || 3);
  let a = Number(lo) || 0;
  let b = Number(hi) || 0;
  if (b < a) { const t = a; a = b; b = t; }
  let span = b - a;
  if (!(span > 0)) {                       // 全等值（一条平线）：给它一个以自己为中心的带子
    span = Math.abs(b) > 0 ? Math.abs(b) * 0.2 : 1;
    a = b - span / 2;
    b = b + span / 2;
    span = b - a;
  }
  const raw = span / (n - 1);
  const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  let max = Math.ceil(b / step) * step;
  let min = max - step * (n - 1);
  // ⚠️ 上界往上取整之后，下界可能反而**高于**数据最小值（例：数据 3~7、步长 2 ⇒ 量程 4~8，
  //    最小的那个点被挤到绘区外）。这时把步长放大一档重来 —— 宁可量程宽一点，
  //    也不能把数据画到绘区之外（那不是"不好看"，是"画错了"）。
  let guard = 0;
  while (min > a && guard < 6) {
    step = nextNiceStep(step);
    max = Math.ceil(b / step) * step;
    min = max - step * (n - 1);
    guard++;
  }
  return { min: util.round(min, 6), max: util.round(max, 6), step: util.round(step, 6), count: n };
}

// 1 → 2 → 5 → 10（再进位）
function nextNiceStep(s) {
  const mag = Math.pow(10, Math.floor(Math.log(s) / Math.LN10));
  const norm = Math.round((s / mag) * 100) / 100;
  if (norm < 2) return 2 * mag;
  if (norm < 5) return 5 * mag;
  return 10 * mag;
}

// 数量型数值（片 / cm² / m² / kg）：千分位 + 最多 2 位小数、**不强制补零**
// （`util.money` 一律两位小数，"12.00 片"这种读起来很怪）
function fmtQty(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

// 坐标轴数值的压缩档：**看步长决定要不要用 k / w**
// ⚠️ 踩过的坑：量程自适应之后步长可能只有 50（1,900 / 1,950 / 2,000 三档），
//    这时若一律走 fmtCompact ⇒ 三档全变成"¥2.0k / ¥2.0k / ¥1.9k"，刻度看不出差别、
//    比不画还糟。所以"≥1000 才用 k"必须再加一条"步长也 ≥1000"。
function fmtAxisNum(v, step) {
  const n = Number(v) || 0;
  const st = Math.abs(Number(step) || 0);
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (Math.abs(n) >= 1000 && st >= 1000) return (n / 1000).toFixed(1) + 'k';
  return fmtQty(n);
}

// 坐标轴上的数值串：金额走「前缀 + 压缩档」（¥2,000 / ¥1.2w），数量走「紧凑 + 后缀」（12 片）
// step 只影响金额压缩档；传 0/不传 = 走精确值（读数的气泡用这个）
function unitOfText(v, o, step) {
  if (o.unitPos === 'post') return fmtQty(v) + (o.unit || '');
  return (o.unit == null ? '¥' : o.unit) + fmtAxisNum(v, step);
}

// x 轴刻度：**4 档**（首 / 1⁄3 / 2⁄3 / 尾），位置直接给成内联 style ——
// ⚠️ 改前是 3 档 + 靠 `lc-x0/lc-xm/lc-x1` 三个类名定位（首左/中中/尾右），
//    4 档时两个"中"会叠在 50% 上 ⇒ 所以这里改成按像素坐标定位，模板只负责贴样式。
function xTicksOf(points, at, labelOf) {
  const n = points.length;
  const idxs = [];
  [0, 1 / 3, 2 / 3, 1].forEach((f) => {
    const i = Math.round((n - 1) * f);
    if (idxs.indexOf(i) < 0) idxs.push(i);
  });
  return idxs.map((i, k) => {
    const x = util.round(at(i).x, 1);
    const isFirst = k === 0;
    const isLast = k === idxs.length - 1;
    const tf = isFirst ? '' : (isLast ? 'transform:translateX(-100%);' : 'transform:translateX(-50%);');
    return { x: x, text: labelOf(points[i]), style: 'left:' + x + 'px;' + tf };
  });
}

/**
 * 折线图：按容器像素尺寸算出线段、数据点与面积填充的坐标
 * DOM 只能画直线段，所以每段单独一个旋转的细条；坐标必须是像素，需要先量容器尺寸。
 *
 * @param opts { unit, unitPos:'pre'|'post' } —— 单位与位置（默认 ¥ 前缀，看板沿用）
 */
function lineLayout(series, w, h, opts) {
  const o = opts || {};
  const labelOf = (p) => p.dateLabel || String(p.date || '').slice(5);
  const points = (series || []).filter(x => x && x.value != null && isFinite(Number(x.value)));
  if (!points.length || !(w > 0) || !(h > 0)) return null;

  const padL = 44, padR = 16, padT = 18, padB = 26;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  const vals = points.map(p => Number(p.value));
  // V142：**量程自适应**（贴着数据自身范围）—— 见本函数上方 niceScale 的说明
  const sc = niceScale(Math.min.apply(null, vals), Math.max.apply(null, vals), 3);
  const span = (sc.max - sc.min) || 1;

  const n = points.length;
  const at = (i) => ({
    x: padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1)),
    y: padT + plotH - ((vals[i] - sc.min) / span) * plotH
  });

  // 圆点：点太密时**只在"值有变化"的地方**画（加上首尾）——
  // ⚠️ 改前这条规则（showDot）算出来却没被模板用上，于是 30 天糊了 30 个圆点（用户："上面那么多圆"）。
  const dense = n > 14;
  const dots = points.map((p, i) => {
    const pos = at(i);
    const changed = i === 0 || i === n - 1 || Number(vals[i]) !== Number(vals[i - 1]);
    return {
      x: util.round(pos.x, 1), y: util.round(pos.y, 1),
      value: vals[i],
      dateLabel: labelOf(p),
      showDot: !dense || changed,
      tip: labelOf(p) + '  ' + unitOfText(vals[i], o)
    };
  });

  const segs = [];
  for (let i = 1; i < n; i++) {
    const a = at(i - 1), b = at(i);
    const dx = b.x - a.x, dy = b.y - a.y;
    segs.push({
      x: util.round(a.x, 1), y: util.round(a.y, 1),
      len: util.round(Math.sqrt(dx * dx + dy * dy), 1),
      deg: util.round(Math.atan2(dy, dx) * 180 / Math.PI, 2)
    });
  }

  // 面积填充：折线各点 + 右下 + 左下闭合（用百分比，容器缩放也跟得上）
  const pctX = (x) => util.round((x / w) * 100, 2) + '%';
  const pctY = (y) => util.round((y / h) * 100, 2) + '%';
  const poly = dots.map(d => pctX(d.x) + ' ' + pctY(d.y));
  const areaClip = 'polygon(' + poly.join(', ') + ', ' + pctX(dots[n - 1].x) + ' 100%, ' + pctX(dots[0].x) + ' 100%)';

  const last = points[n - 1];
  // y 轴 3 档刻度：从**上（大）到下（小）**给，读起来跟眼睛一致
  const yTicks = [0, 1, 2].map((k) => {
    const v = sc.max - sc.step * k;
    return {
      y: util.round(padT + (plotH * k) / 2, 1),
      value: v,
      text: unitOfText(v, o, sc.step)
    };
  });

  return {
    dots: dots,
    segs: segs,
    areaClip: areaClip,
    yTicks: yTicks,
    xTicks: xTicksOf(points, at, labelOf),
    // ⚠️ 这里**只放"有人用"的字段**：本轮 bug 的另一半就是"算了没人用 / 算了没画"——
    //    改前 firstLabel / lastLabel / lastValue / gridCount / summary 全都没有消费方
    //    （`scale` 也是同一个毛病，已删：量程从 yTicks 就能读出来，没必要再抛一份）。
    //    守卫 tests/guard-chart-axis.test.js ⑬ 扫这个 return：新增字段必须有消费方。
    // 绘区几何：模板（指示线高度）与触摸命中都用它 —— 别处不许再写死 44 / 18 / 26
    plot: { left: padL, right: padR, top: padT, bottom: padB, width: plotW, height: plotH }
  };
}

/**
 * 柱状图（像素版 · V142 新增）：**按天一根柱**，没有量的那天留空
 *
 * 为什么要新写一个（而不是用下面的 `barBars`）：
 *   `barBars` 给的是**容器高度百分比**，只能一根挨一根地铺满（它服务于看板统计弹窗里
 *   "连续 31 根"那种图）。而"入库 / 出库"要表达的是**哪天有动作、哪天没有** ——
 *   必须按 30 个**日期槽位**均分、空槽留空，还要跟折线图共用一套坐标与刻度。
 *
 * ⚠️ 柱状图**必须 0 基线**（截断基线会把"1.1 倍"看成"10 倍"）——
 *    这与折线图（存量，量程自适应）**刻意不同**，不是不一致。
 */
function barLayout(series, w, h, opts) {
  const o = opts || {};
  const labelOf = (p) => p.dateLabel || String(p.date || '').slice(5);
  const points = (series || []).filter(x => x && x.value != null && isFinite(Number(x.value)));
  if (!points.length || !(w > 0) || !(h > 0)) return null;

  const padL = 44, padR = 16, padT = 18, padB = 26;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  const vals = points.map(p => Math.max(0, Number(p.value) || 0));
  const hi = Math.max.apply(null, vals.concat([0]));
  const sc = niceScale(0, hi > 0 ? hi : 1, 4);
  const base = util.round(padT + plotH, 1);

  const n = points.length;
  const slot = plotW / n;
  const bw = util.round(Math.max(3, Math.min(12, slot * 0.55)), 1);

  let peakIdx = -1;
  vals.forEach((v, i) => { if (v > 0 && (peakIdx < 0 || v > vals[peakIdx])) peakIdx = i; });

  const bars = points.map((p, i) => {
    const v = vals[i];
    const span = (sc.max - sc.min) || 1;
    const bh = v > 0 ? util.round(((v - sc.min) / span) * plotH, 1) : 0;
    const cx = padL + slot * (i + 0.5);
    return {
      x: util.round(cx - bw / 2, 1),
      y: util.round(base - bh, 1),
      w: bw,
      h: bh,
      value: v,
      dateLabel: labelOf(p),
      empty: !(v > 0),
      peak: i === peakIdx,
      // V142b：读数里那句"另有 N 笔其他单位"已删 —— 出入库改成**金额**之后，
      //   跨单位不能相加这个问题不存在了（金额天然可加），那个字段再没人会传。
      tip: labelOf(p) + '  ' + unitOfText(v, o) +
        (p.count ? '（' + p.count + ' 笔）' : '')
    };
  });

  const at = (i) => ({ x: padL + slot * (i + 0.5) });

  return {
    bars: bars,
    baselineY: base,
    slot: util.round(slot, 2),
    plot: { left: padL, right: padR, top: padT, bottom: padB, width: plotW, height: plotH },
    // ⚠️ 刻度必须与**柱高同一口径**：柱高按 (v - sc.min)/(sc.max - sc.min) 映射，
    //    所以刻度也要按同一条线取值 —— 否则图上一根到顶的柱，刻度却写着别的数（画错了）。
    //    柱状图 sc.min 一定是 0（0 基线），下面这条也就是 0。
    yTicks: [0, 1, 2, 3].map((k) => {
      const v = util.round(sc.min + ((sc.max - sc.min) * (3 - k)) / 3, 4);
      return { y: util.round(padT + (plotH * k) / 3, 1), value: v, text: unitOfText(v, o, (sc.max - sc.min) / 3) };
    }),
    xTicks: xTicksOf(points, at, labelOf)
  };
}

/**
 * 柱状图：算每根柱占容器高度的百分比（纯 CSS 就能画，不需要容器尺寸）
 */
function barBars(series, maxBars) {
  const list = (series || []).filter(x => x.value != null);
  const capped = maxBars && list.length > maxBars ? list.slice(-maxBars) : list;
  if (!capped.length) return [];
  const max = Math.max.apply(null, capped.map(x => x.value).concat([1]));
  return capped.map((x, i) => ({
    value: x.value,
    dateLabel: x.dateLabel || (x.date || '').slice(5),
    // 最小 3% 高度，保证 0 值也能看到一条基座
    hPct: util.round(Math.max(3, (x.value / max) * 100), 2),
    // 标签太密就隔一个显示
    showLabel: capped.length <= 10 || i % 2 === 0 || i === capped.length - 1
  }));
}

function fmtCompact(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return util.money(n);
}

module.exports = { THEME, ringGradient, ringLayout, normAngle, hitArc, hitRing, lineLayout, barLayout, niceScale, barBars, fade, fmtCompact };
