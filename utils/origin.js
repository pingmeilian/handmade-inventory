// utils/origin.js —— 面料「出处」的唯一口径（2026-10-02 V95）
//
// 用户立的规矩（原话）：
//   「有面积肯定就有形状，我需要的是不管用不用到几何，哪怕面积只算一个数字，
//     都要关联到它的形状和来自哪片布的哪个位置。所有的布不管在哪里都要这样要求，
//     这样才能从头到尾所有的流程能追溯」。
//
// 于是任何一笔面积变动（裁剪 / 扣料 / 退回 / 销毁 / 盘点 / 出库）都必须能回答三件事：
//   ① 什么形状     → rect（布内坐标的矩形，cm）；整片被用掉时 rect = null + way='whole'
//   ② 哪片布       → pieceId（刀口布没有"片"，用 lots 批次明细）
//   ③ 布上哪个位置 → rect.x / rect.y（原点左下，与 utils/sheets.js 的内核约定一致）
//
// 为什么是"一个对象"而不是"一个 id"或"一个数"：这三件事必须**成对存在、一起传递**。
// 拆开传就会重演 V87 / V90 / V94 —— 那三次都是"用户给的东西在传递途中被丢掉一半"，
// 而且**账面完全看不出来**（面积一样、金额一样）。
//
// way（这一笔是怎么发生的；界面与导出靠它决定怎么说话）：
//   'cut'    按形状裁 —— 在布上挖了一个**用户确定**的矩形（裁剪排版走这条）
//   'area'   按面积扣 —— 只填了面积没有形状 ⇒ 系统替它挖了一个等面积的矩形
//   'batch'  按批估量 —— 刀口布，出处是批次明细 lots
//   'whole'  整片    —— 用掉/退回的是这一片的全部可用区域（rect = null）
//   'detach' 脱片    —— 原片已不在，只能另造一片（兜底，会**明说**不是填回原洞）
//   'legacy' 历史    —— 老记录没有出处，**不假装有**
//
// ⚠️ 本模块是**纯函数**（零依赖、不改数据），与 utils/sheets.js 同一施工标准：
//    所有裁剪/记账路径都通过它构造出处，保证全项目只有一个口径。

const WAYS = ['cut', 'area', 'batch', 'whole', 'detach', 'legacy'];

function r2(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// 矩形（布内坐标，原点左下，单位 cm）。
// 形状非法一律返回 null —— **宁可如实说"没有形状"，也不编一个出来**。
function rect(r) {
  if (!r) return null;
  const length = r2(r.length), width = r2(r.width);
  if (!(length > 0) || !(width > 0)) return null;
  return { x: r2(r.x), y: r2(r.y), length: length, width: width };
}

// 构造一处出处（归一化：坐标/尺寸两位小数；面积缺省时按矩形算）
function mk(o) {
  const src = o || {};
  const r = rect(src.rect);
  const way = WAYS.indexOf(src.way) >= 0 ? src.way : (r ? 'area' : 'legacy');
  const a = Number(src.area);
  const out = {
    materialId: String(src.materialId || ''),
    pieceId: String(src.pieceId || ''),
    way: way,
    rect: r,
    area: r2(isFinite(a) && a > 0 ? a : (r ? r.length * r.width : 0))
  };
  if (src.lots && src.lots.length) {
    out.lots = src.lots.map(function (l) {
      return { lotId: String((l && l.lotId) || ''), qty: r2(l && l.qty) };
    }).filter(function (l) { return l.lotId && l.qty > 0; });
  }
  // 整片被用掉/移除时，片本身已经不在 pieces 里了 —— 不带整片快照就**还原不回来**
  if (src.pieceBefore) out.pieceBefore = src.pieceBefore;
  if (src.note) out.note = String(src.note);
  return out;
}

// 一处出处是否"说全了"。判据按 way 分档 —— 不允许"只有一个面积"就冒充有出处。
function isValid(o) {
  if (!o || typeof o !== 'object') return false;
  if (!o.materialId) return false;
  if (WAYS.indexOf(o.way) < 0) return false;
  if (o.way === 'batch') return !!(o.lots && o.lots.length);
  if (o.way === 'whole') return Number(o.area) > 0 && !!o.pieceBefore;
  if (o.way === 'legacy') return Number(o.area) > 0;      // 明说"没有出处"，面积得有
  // cut / area / detach：必须**指到片、指到位置** —— 形状就是这一笔的本体
  return !!o.pieceId && !!rect(o.rect);
}

function areaOf(o) { return r2(o && o.area); }

function sameRect(a, b) {
  const x = rect(a), y = rect(b);
  if (!x || !y) return false;
  return x.x === y.x && x.y === y.y && x.length === y.length && x.width === y.width;
}

// 两处出处是不是"同一处"（同一片布的同一个位置）
function same(a, b) {
  if (!a || !b) return false;
  return a.materialId === b.materialId && a.pieceId === b.pieceId &&
    a.way === b.way && sameRect(a.rect, b.rect);
}

function fmtRect(r) {
  const n = rect(r);
  return n ? (n.length + '×' + n.width + ' cm') : '';
}

// 给人看的说明（界面 / 导出用）。**不夸张也不含糊**：要能说出是哪一片、哪个位置。
function label(o) {
  if (!o) return '';
  if (o.way === 'batch') return '按批（' + ((o.lots || []).length) + ' 个批次）';
  if (o.way === 'whole') return '整片';
  if (o.way === 'legacy') return '历史记录 · 无出处';
  if (o.way === 'detach') return '原片已不在 · ' + (fmtRect(o.rect) || '按面积退回');
  const r = rect(o.rect);
  if (!r) return '无形状';
  return fmtRect(r) + ' @ (' + r.x + ', ' + r.y + ')';
}

module.exports = { mk, rect, isValid, areaOf, same, sameRect, label, fmtRect, WAYS };
