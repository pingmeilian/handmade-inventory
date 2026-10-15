// utils/palette.js —— 大类/品类自动配色（无图占位块用）
// 12 组低饱和暖调色，bg 为底色、ink 为同色系深调（用于首字水印）
// 大类数量超过 12 时循环复用；物料与成品两套体系用 offset 错开，避免同屏观感雷同

const CATEGORY_PALETTE = [
  { bg: '#EBD8CB', ink: '#A9765C' }, // 1 米杏
  { bg: '#C9D6DE', ink: '#5C7A8C' }, // 2 灰蓝
  { bg: '#E7CFCF', ink: '#A97A7A' }, // 3 藕粉
  { bg: '#C9D6C4', ink: '#6E8A63' }, // 4 灰绿
  { bg: '#D4CFDC', ink: '#7A6F8C' }, // 5 淡紫灰
  { bg: '#DFCDB4', ink: '#9A7E52' }, // 6 沙棕
  { bg: '#C6D7D4', ink: '#5F8A85' }, // 7 雾青
  { bg: '#E3C6B0', ink: '#A2704C' }, // 8 肉桂
  { bg: '#CBD3C0', ink: '#6F7F5C' }, // 9 苔绿
  { bg: '#E0C3BA', ink: '#A06B5E' }, // 10 陶土
  { bg: '#C4CDD8', ink: '#64748C' }, // 11 雾霾蓝
  { bg: '#DED3C0', ink: '#8A7A5C' }  // 12 燕麦
];

// 成品体系（品类）从第 5 组开始取色，与物料分类错开
const PRODUCT_OFFSET = 4;

// hex → rgba，用于「首字淡印」：同色系深调 + 半透明
function inkToSoft(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha == null ? 0.5 : alpha) + ')';
}

// 兜底：分类不在列表里（历史数据/已删除）时，用 id 稳定散列取色，避免全部撞到同色
function hashIndex(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h % CATEGORY_PALETTE.length;
}

/**
 * 取某个分类的配色
 * @param {Array} list 分类列表（物料分类 / 成品品类），元素需含 id
 * @param {string} categoryId 当前分类 id
 * @param {number} offset 体系偏移（物料 0 / 成品 PRODUCT_OFFSET）
 * @returns {{bg: string, ink: string}}
 */
function colorOf(list, categoryId, offset) {
  const arr = Array.isArray(list) ? list : [];
  let idx = arr.findIndex(c => c && c.id === categoryId);
  if (idx < 0) idx = hashIndex(categoryId);
  const i = (idx + (offset || 0)) % CATEGORY_PALETTE.length;
  const c = CATEGORY_PALETTE[i];
  // inkSoft：首字淡印用的半透明墨色（同屏多张卡片也不会抢眼）
  return { bg: c.bg, ink: c.ink, inkSoft: inkToSoft(c.ink, 0.5) };
}

module.exports = { CATEGORY_PALETTE, PRODUCT_OFFSET, colorOf, inkToSoft };
