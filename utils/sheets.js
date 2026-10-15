// utils/sheets.js —— 布料几何内核（纯函数，零依赖）
//
// 为什么要换模型（2026-09-29 · D88~D93）：
//   旧模型把布料存成一堆**互不相干的矩形**，裁一刀就把剩下的 **L 形**硬拆成两个矩形分开记账
//   （宽度还等于幅宽的那块叫「整布」、窄的那块叫「碎料」）。于是**物理上连着的一整块布，在账上成了两块**，
//   想取一条横跨分界线的长条（例如 230×20）两片都装不下 —— 用户真机反馈：「整布和碎布可能是连在一起的」。
//
// 新模型：**一块布 = 外框 base − 若干镂空 holes（已经裁走的部分）**
//   · 可用区域 = base − Σholes，永远精确、永远连着
//   · 挖料 = 往 holes 里加一个矩形（**不需要重新拆分余料**，所以形状不会失真）
//   · 「整布 / 碎料」= 没挖过 / 挖过（正好就是用户说的「裁没裁过」）
//   · 库存面积 = base.area − Σholes.area（口径不变，账不会动）
//
// ⚠️ 坐标系：x 沿「长」方向、y 沿「宽」方向，(0,0) 在**左下角**，单位 cm。
//    页面渲染时 y 轴需要翻转（SVG/BMI 的 y 朝下），翻转只在页面做，内核不掺和。
//    所有长度按 cm 保留 2 位小数；比较用 EPS 容差，避免浮点误差把"贴边"误判成"越过"。

const EPS = 0.011;                    // cm；2 位小数下的容差
const NUM = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const r2 = (v) => Math.round(NUM(v) * 100) / 100;

/** 归一化一个矩形；无效（长或宽 ≤ 0）返回 null */
function rect(o) {
  if (!o) return null;
  const length = r2(o.length), width = r2(o.width);
  if (!(length > 0) || !(width > 0)) return null;
  return { x: r2(o.x), y: r2(o.y), length: length, width: width };
}

function area(r) { const n = rect(r); return n ? r2(n.length * n.width) : 0; }

/** 是否完全在 outer 内（贴边允许） */
function inside(outer, r) {
  const o = rect(outer), n = rect(r);
  if (!o || !n) return false;
  return n.x >= o.x - EPS && n.y >= o.y - EPS &&
    n.x + n.length <= o.x + o.length + EPS &&
    n.y + n.width <= o.y + o.width + EPS;
}

/** 是否相交（**贴边不算相交** —— 现实中紧挨着裁是合法的） */
function overlap(a, b) {
  const p = rect(a), q = rect(b);
  if (!p || !q) return false;
  const xOver = p.x < q.x + q.length - EPS && q.x < p.x + p.length - EPS;
  const yOver = p.y < q.y + q.width - EPS && q.y < p.y + p.width - EPS;
  return xOver && yOver;
}

const norm = (sheet) => ({
  base: rect(sheet && sheet.base),
  holes: ((sheet && sheet.holes) || []).map(rect).filter(Boolean)
});

/** 这个位置能不能放料：在 base 内、且不碰任何镂空 */
function free(sheet, r) {
  const s = norm(sheet), n = rect(r);
  if (!s.base || !n) return false;
  if (!inside(s.base, n)) return false;
  return !s.holes.some((h) => overlap(h, n));
}

function holesArea(holes) {
  return r2(((holes || []).map(rect).filter(Boolean)).reduce((s, h) => s + area(h), 0));
}

/** 可用面积 = 外框 − 镂空（旧口径的面积一点不变） */
function freeArea(sheet) {
  const s = norm(sheet);
  if (!s.base) return 0;
  return r2(area(s.base) - holesArea(s.holes));
}

/** 「裁没裁过」：有镂空、或裁过但刚好整边取走（不留镂空）→ 都算裁过
 *  ⚠️ 仅作参考信息（页面上标「裁过」）。**「整布 / 碎布」不用它判定** ——
 *     口径见 keepsFullWidth（用户 2026-09-29 D97：看"宽还等不等于幅宽"，不看裁没裁过）。 */
function used(sheet) {
  const s = norm(sheet);
  return s.holes.length > 0 || NUM(sheet && sheet.cuts) > 0;
}

/** 可用区域（base − holes）的包围盒；全被裁光时返回 null */
function freeBounds(sheet) {
  const s = norm(sheet);
  if (!s.base) return null;
  const parts = subtractAll(s.base, s.holes);
  return bbox(parts);
}

/**
 * 「整布 / 碎布」判定（2026-09-29 D97 定稿）：
 *   这块布的**可用区域还等不等于幅宽** —— 等于 ⇒ 整布（还能横着取一条整幅宽的长条）；
 *   窄了 ⇒ 碎布（取不出整幅宽的长条了，只能从上面捡小料）。
 *
 * 例：240×150 裁掉左下角一块 ⇒ 形状不规则，但可用区域包围盒仍 240×150 ⇒ **整布**；
 *     沿长边裁掉 20 宽的一条 ⇒ 只剩 130 宽 ⇒ **碎布**。
 */
function keepsFullWidth(sheet, fabricWidth) {
  const fw = NUM(fabricWidth);
  if (!(fw > 0)) return false;                 // 未设幅宽 → 不判定（调用方按"整布"处理）
  const b = freeBounds(sheet);
  if (!b) return false;                        // 一片不剩
  return b.width >= fw - EPS;
}

/** 一个矩形减去另一个矩形 → 剩下的矩形集合（标准四段切分，过滤退化块） */
function subtractRect(base, cut) {
  const b = rect(base), c = rect(cut);
  if (!b) return [];
  if (!c || !overlap(b, c)) return [b];
  const bx2 = b.x + b.length, by2 = b.y + b.width;
  const cx1 = Math.max(b.x, c.x), cx2 = Math.min(bx2, c.x + c.length);
  const cy1 = Math.max(b.y, c.y), cy2 = Math.min(by2, c.y + c.width);
  const out = [];
  const push = (x, y, l, w) => { const p = rect({ x: x, y: y, length: l, width: w }); if (p) out.push(p); };
  push(b.x, b.y, cx1 - b.x, b.width);                 // 左
  push(cx2, b.y, bx2 - cx2, b.width);                 // 右
  push(cx1, b.y, cx2 - cx1, cy1 - b.y);               // 下
  push(cx1, cy2, cx2 - cx1, by2 - cy2);               // 上
  return out;
}

/** 一个矩形减去一堆矩形 → 剩下的矩形集合 */
function subtractAll(base, cuts) {
  let parts = rect(base) ? [rect(base)] : [];
  (cuts || []).forEach((c) => {
    const next = [];
    parts.forEach((p) => { subtractRect(p, c).forEach((q) => next.push(q)); });
    parts = next;
  });
  return parts;
}

/** 一组矩形的包围盒 */
function bbox(rects) {
  const list = (rects || []).map(rect).filter(Boolean);
  if (!list.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  list.forEach((p) => {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x + p.length); y2 = Math.max(y2, p.y + p.width);
  });
  return rect({ x: x1, y: y1, length: x2 - x1, width: y2 - y1 });
}

// ---------- 老数据迁移：把「拆开的矩形」还原成「一整块布」 ----------
//
// 老数据里存着一堆只带"长×宽"、没有位置的矩形（旧模型根本不存位置）。还原规则来自旧代码的裁剪几何：
//   旧 cut 总是从某个矩形的**左下角**挖掉 rl×rw，产出 (L−rl)×W（右侧整列）+ rl×(W−rw)（左上那块）。
//   多次裁切后，剩下的必是一条**阶梯形**，据此可以唯一反推出位置：
//     按宽度从大到小排（w1 > w2 > …），第 i 块放在 x = Σ_{j>i} 长度_j、y = w1 − w_i
//   于是外框 = (Σ长度) × w1，镂空 = 外框 − 这些块 ⇒ **面积与形状都与原数据等价**。
//
// 只在能确定是同一条阶梯时才合并（恰好一个矩形的宽度 = 幅宽、其余都更窄、宽度互不相同）；
// 判不准就**每块各算一块布**（保守，不猜），宁可少合、不可合错。
function sheetsFromRects(rects, fabricWidth) {
  const list = (rects || []).map(rect).filter(Boolean);
  if (!list.length) return [];
  const alone = (p) => ({ base: rect({ x: 0, y: 0, length: p.length, width: p.width }), holes: [], cuts: 0 });

  if (list.length === 1) {
    const only = alone(list[0]);
    only.cuts = (rects[0] && rects[0].source === 'remnant') ? 1 : 0;
    return [only];
  }

  const fw = NUM(fabricWidth);
  const isFull = (p) => fw > 0 && Math.abs(p.width - fw) <= EPS;
  const full = list.filter(isFull);
  const narrow = list.filter((p) => !isFull(p));
  const widths = list.map((p) => p.width);
  const distinct = new Set(widths).size === widths.length;

  if (full.length === 1 && narrow.length === list.length - 1 && distinct) {
    const sorted = list.slice().sort((a, b) => b.width - a.width);
    const w1 = sorted[0].width;
    const total = r2(sorted.reduce((s, p) => s + p.length, 0));
    let acc = 0;
    const placed = [];
    for (let i = sorted.length - 1; i >= 0; i--) {      // 从最窄的排起：x = 它右边所有块的长度之和
      placed.push(rect({ x: acc, y: r2(w1 - sorted[i].width), length: sorted[i].length, width: sorted[i].width }));
      acc = r2(acc + sorted[i].length);
    }
    const base = rect({ x: 0, y: 0, length: total, width: w1 });
    const parts = subtractAll(base, placed);
    if (parts.length) {
      const cuts = rects.some((p) => p && p.source === 'remnant') ? 1 : 0;
      return [{ base: base, holes: parts, cuts: cuts }];
    }
  }
  return list.map((p) => {
    const s = alone(p);
    const src = (rects || []).find((q) => q && r2(q.length) === p.length && r2(q.width) === p.width);
    s.cuts = (src && src.source === 'remnant') ? 1 : 0;
    return s;
  });
}

// ---------- 找位置 / 数件数 ----------

/** 候选坐标：base 两端 + 每个镂空的边（左/右/上/下），足矣覆盖"贴着障碍放"的全部必要位置 */
function candidates(sheet, length, width) {
  const s = norm(sheet);
  if (!s.base) return [];
  const xs = new Set([0, r2(s.base.length - length)]);
  const ys = new Set([0, r2(s.base.width - width)]);
  s.holes.forEach((h) => {
    [h.x, r2(h.x + h.length), r2(h.x - length)].forEach((v) => xs.add(r2(v)));
    [h.y, r2(h.y + h.width), r2(h.y - width)].forEach((v) => ys.add(r2(v)));
  });
  const xl = Array.from(xs).filter((v) => v >= -EPS && v <= s.base.length - length + EPS).sort((a, b) => a - b);
  const yl = Array.from(ys).filter((v) => v >= -EPS && v <= s.base.width - width + EPS).sort((a, b) => a - b);
  return { x: xl, y: yl };
}

/**
 * 找第一个放得下的位置（靠下、靠左优先）。找不到返回 null。
 *
 * ⚠️ **默认不旋转**（rotate 只在你明确要求时开）：布有纹理/织向，把料转 90° 是**用户的决定**，
 *    不该由系统悄悄替他转（用户 2026-09-29 要的是「我自己定怎么摆」）。旋转入口在页面上的「转 90°」。
 */
function placeNext(sheet, length, width, opts) {
  const l = r2(length), w = r2(width);
  if (!(l > 0) || !(w > 0)) return null;
  const allowRotate = !!(opts && opts.allowRotate === true);
  const tries = allowRotate && Math.abs(l - w) > EPS
    ? [[l, w], [w, l]]                       // 先正着，再转 90°
    : [[l, w]];
  for (let t = 0; t < tries.length; t++) {
    const L = tries[t][0], W = tries[t][1];
    const c = candidates(sheet, L, W);
    for (let i = 0; i < c.y.length; i++) {
      for (let j = 0; j < c.x.length; j++) {
        const cand = rect({ x: c.x[j], y: c.y[i], length: L, width: W });
        if (free(sheet, cand)) return cand;
      }
    }
  }
  return null;
}

/**
 * 这一块布最多还能排下几件（**实测**：真的往里塞一遍，不是数学最优）。
 * 用途：排不下时告诉用户「这块布最多排得下 N 件，还差几件」。
 */
function maxPlacable(sheet, length, width, cap, opts) {
  if (!(NUM(length) > 0) || !(NUM(width) > 0)) return 0;
  const limit = NUM(cap) > 0 ? NUM(cap) : 200;
  let cur = norm(sheet);
  if (!cur.base) return 0;
  let n = 0;
  while (n < limit) {
    const p = placeNext(cur, length, width, opts);
    if (!p) break;
    cur.holes.push(p);
    n++;
  }
  return n;
}

/** 两个矩形的交集；不相交（或无效）返回 null */
function intersect(a, b) {
  const p = rect(a), q = rect(b);
  if (!p || !q) return null;
  const x1 = Math.max(p.x, q.x), x2 = Math.min(p.x + p.length, q.x + q.length);
  const y1 = Math.max(p.y, q.y), y2 = Math.min(p.y + p.width, q.y + q.width);
  return rect({ x: x1, y: y1, length: x2 - x1, width: y2 - y1 });
}

/**
 * 把一个矩形按「放不放得下」拆成两块（2026-09-30 V83 · 用户 D105 定的语义）。
 *
 *   green = 这块料在布上**确实存在**的部分（= 矩形 ∩ 可用区域）
 *   red   = 矩形里**放不下**的部分（越出布边 + 压在镂空上）
 *   ok    = 没有红（整块都放得下）
 *
 * 好处：页面不是"整块换色"，而是**按块标色** —— 一眼看得出**是哪一截**越界了
 *（用户原话：「放不下的部分是红色，能放下的那部分还是绿色」）。
 * 不变量：green 面积 + red 面积 ≡ 矩形面积（有单测盯着，拖到哪都成立）。
 */
function splitByFree(sheet, r) {
  const s = norm(sheet), n = rect(r);
  if (!n) return { ok: false, green: [], red: [] };
  if (!s.base) return { ok: false, green: [], red: [n] };     // 连布都没有 → 整块红
  const inside = intersect(n, s.base);
  const green = inside ? subtractAll(inside, s.holes) : [];
  const red = green.length ? subtractAll(n, green) : [n];
  return { ok: red.length === 0, green: green, red: red };
}

/**
 * 两个矩形是不是**同一个洞**（2026-10-02 V95）。
 *
 * 为什么要它：把一块布上挖走的料"填回去"时（退料），必须认出当初挖的是哪一个洞 ——
 * 认错了就会填错位置，而面积一样、金额一样，**账面完全看不出来**。
 * 比较带容差（默认 EPS），因为坐标在链路上会被 round 到两位小数。
 */
function sameRect(a, b, eps) {
  const x = rect(a), y = rect(b);
  if (!x || !y) return false;
  const e = (eps == null ? EPS : Number(eps) || 0) + 1e-9;
  return Math.abs(x.x - y.x) <= e && Math.abs(x.y - y.y) <= e &&
    Math.abs(x.length - y.length) <= e && Math.abs(x.width - y.width) <= e;
}

module.exports = {
  rect, area, inside, overlap, free, holesArea, freeArea, used, freeBounds, keepsFullWidth,
  subtractRect, subtractAll, intersect, splitByFree, bbox, sheetsFromRects,
  candidates, placeNext, maxPlacable, sameRect,
  EPS
};
