// tests/sheets.test.js —— 布料几何内核（utils/sheets.js）
//
// 背景（D88~D93）：布料在实物上是**连着的一整块**，小程序却把它拆成「整布 + 碎料」两片分开记账，
// 导致跨分界的长条取不出来。新模型：一块布 = **外框 base − 若干镂空 holes（已经裁走的部分）**。
//   · 可用区域 = base − Σholes
//   · 「整布 / 碎料」= holes 空 / 不空（正好就是用户说的「裁没裁过」）
//   · 挖料 = 往 holes 里加一个矩形（不需要把余料重新拆成矩形，形状永远真实）
//
// ⚠️ 坐标系：x 沿「长」方向、y 沿「宽」方向，(0,0) 在左下角，单位 cm。
//    页面渲染时 y 轴要翻转（SVG 的 y 朝下），翻转只在页面做，内核不掺和。

const H = require('./harness.js');
const { test, group, ok, equal, near } = H;
const sheets = require('../utils/sheets.js');

const R = (x, y, length, width) => ({ x: x, y: y, length: length, width: width });

group('sheets · 基本判定');

test('① 完全在内 / 越界 / 贴边', () => {
  const base = R(0, 0, 100, 50);
  ok(sheets.inside(base, R(0, 0, 100, 50)), '与 base 完全重合 → 在内');
  ok(sheets.inside(base, R(10, 10, 90, 40)), '贴到右上角 → 仍在内（贴边允许）');
  ok(!sheets.inside(base, R(10, 10, 91, 40)), '超出右边界 1cm → 不在内');
  ok(!sheets.inside(base, R(-1, 0, 10, 10)), '左边越界 → 不在内');
});

test('② 相交判定：贴边不算相交（现实中紧挨着裁是合法的）', () => {
  ok(sheets.overlap(R(0, 0, 10, 10), R(5, 5, 10, 10)), '叠在一起 → 相交');
  ok(!sheets.overlap(R(0, 0, 10, 10), R(10, 0, 10, 10)), '右边紧挨着 → 不算相交');
  ok(!sheets.overlap(R(0, 0, 10, 10), R(0, 10, 10, 10)), '上边紧挨着 → 不算相交');
  ok(!sheets.overlap(R(0, 0, 10, 10), R(10, 10, 5, 5)), '只碰到一个角 → 不算相交');
});

test('③ free：在 base 内、且不碰任何镂空', () => {
  const base = R(0, 0, 240, 150);
  const holes = [R(0, 0, 38, 83)];
  ok(sheets.free({ base: base, holes: holes }, R(38, 0, 60, 83)), '避开镂空 → 可以放');
  ok(!sheets.free({ base: base, holes: holes }, R(0, 0, 60, 83)), '压在镂空上 → 不行');
  ok(!sheets.free({ base: base, holes: holes }, R(0, 100, 40, 60)), '越出 base 上边 → 不行');
});

group('sheets · 挖料（base 减矩形）');

test('④ 从角落挖掉一块 → 剩下两块（这正是现在被拆成「整布+碎料」的那个形状）', () => {
  const parts = sheets.subtractRect(R(0, 0, 240, 150), R(0, 0, 38, 83));
  equal(parts.length, 2, '挖一角 → 2 块');
  const area = parts.reduce((s, p) => s + sheets.area(p), 0);
  equal(area, 240 * 150 - 38 * 83, '面积必须守恒');
  // 按「剩下的两块」拼回去，与真实剩余面积一致
  ok(parts.some(p => p.length === 202 && p.width === 150), '应含 202×150 那一块');
  ok(parts.some(p => p.length === 38 && p.width === 67), '应含 38×67 那一块');
});

test('⑤ 从中间横着挖通 → 断成两块（现实中你就是把它剪成两段了）', () => {
  const parts = sheets.subtractRect(R(0, 0, 240, 150), R(100, 0, 40, 150));
  equal(parts.length, 2, '中间挖通 → 分成两块');
  equal(parts.reduce((s, p) => s + sheets.area(p), 0), 240 * 150 - 40 * 150, '面积守恒');
});

test('⑥ 挖穿整块 → 什么都不剩；挖到只剩一条 0 宽 → 不产生退化块', () => {
  equal(sheets.subtractRect(R(0, 0, 100, 50), R(0, 0, 100, 50)).length, 0, '整块挖走 → 空');
  const parts = sheets.subtractRect(R(0, 0, 100, 50), R(0, 0, 100, 20));
  equal(parts.length, 1, '只该剩下面那条');
  near(sheets.area(parts[0]), 100 * 30, 1e-9, '剩 100×30');
});

test('⑦ 【D88 的关键案例】一趟长条横跨原来的「分界线」也取得出来', () => {
  // 240×150 的布，先裁掉一角 38×83 → 旧模型里变成「整布 202×150」+「碎料 38×67」，
  // 想取 230×20 长条时两片都装不下（canCutTimes = 0），但物理上明明放得下。
  const sheet = { base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] };
  ok(sheets.free(sheet, R(0, 83, 230, 20)), '新模型：贴在上面那条完整横带上 → 放得下');
  ok(sheets.maxPlacable(sheet, 230, 20) >= 1, '而且确实取得出来（旧模型这里是 0）');
  ok(!sheets.free(sheet, R(0, 0, 230, 20)), '但同时它不能压在缺口上 —— 判定没有变松，只是不再被分界线卡住');
});

group('sheets · 找位置与数件数');

test('⑧ placeNext：靠左下角找第一个放得下的位置（贴着缺口边也算）', () => {
  const sheet = { base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] };
  const p = sheets.placeNext(sheet, 60, 83);
  ok(p, '应该找得到');
  equal(p.x, 38, 'x 贴着缺口右边（x=0~38 被缺口占掉）');
  equal(p.y, 0, 'y 贴着底边');
  equal(sheets.placeNext({ base: R(0, 0, 50, 50), holes: [] }, 60, 10), null, '放不下 → null');
});

test('⑨ maxPlacable：一块带缺口的布最多能排几件', () => {
  // base 240×150，左下缺口 38×83；每件 60×83
  const sheet = { base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] };
  equal(sheets.maxPlacable(sheet, 60, 83), 3, '(240-38)=202 宽只能并排 3 件；高度只够一排');
  // 130×90 的小碎布，同样每件 60×83 → 只能 2 件
  equal(sheets.maxPlacable({ base: R(0, 0, 130, 90), holes: [] }, 60, 83), 2, '130/60 = 2 件');
  equal(sheets.maxPlacable({ base: R(0, 0, 50, 50), holes: [] }, 60, 83), 0, '放不下 → 0');
});

test('⑩ 面积口径：可用面积 = base − 镂空，和旧模型算出来的完全一样', () => {
  const sheet = { base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] };
  equal(sheets.freeArea(sheet), 240 * 150 - 38 * 83, '面积不能因为换了模型而变');
  equal(sheets.freeArea({ base: R(0, 0, 240, 150), holes: [] }), 36000, '没裁过 = 整块面积');
});

test('⑪ 整布 / 碎料：按「裁没裁过」分（用户 2026-09-29 定的口径）', () => {
  ok(!sheets.used({ base: R(0, 0, 240, 150), holes: [] }), '没挖过 → 整布');
  ok(sheets.used({ base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] }), '挖过 → 碎料（余料）');
});

test('⑫ 老数据迁移：把一堆矩形还原成「外框 + 镂空」，面积与形状都不能变', () => {
  // 老数据里存的是拆开的矩形：整布 202×150 + 碎料 38×67
  const pieces = [
    { length: 202, width: 150, source: 'purchase' },   // 旧模型里的「整布」
    { length: 38, width: 67, source: 'remnant' }       // 旧模型里的「碎料」
  ];
  const list = sheets.sheetsFromRects(pieces, 150);
  equal(list.length, 1, '这两片在实物上是一块布 → 应还原成一块');
  const sheet = list[0];
  equal(sheets.area(sheet.base), 240 * 150, '外框复原成 240×150（= 两片的包围盒）');
  equal(sheets.freeArea(sheet), 202 * 150 + 38 * 67, '可用面积与原数据逐 cm² 一致');
  ok(sheets.used(sheet), '含裁出来的片 → 判为碎料');
  // 复原出来的形状必须真的等价：原来放得下的，现在也放得下；原来放不下的，现在也放不下
  ok(sheets.free(sheet, R(0, 83, 230, 20)), '旧的「取不出来的长条」现在能取');
});

test('⑬ 脏数据不许炸：缺字段 / 负数 / 空数组', () => {
  equal(sheets.area(null), 0);
  equal(sheets.area({}), 0);
  equal(sheets.freeArea(null), 0);
  equal(sheets.freeArea({ base: R(0, 0, 100, 50), holes: null }), 5000, 'holes 为空 → 整块可用');
  equal(sheets.maxPlacable({ base: R(0, 0, 100, 50), holes: [] }, 0, 10), 0, '尺寸为 0 → 0 件');
  equal(sheets.maxPlacable({ base: R(0, 0, 100, 50), holes: [] }, -5, 10), 0, '负数 → 0 件');
  equal(sheets.subtractRect(null, R(0, 0, 1, 1)).length, 0, 'base 无效 → 空数组，不抛');
  equal(sheets.sheetsFromRects([], 150).length, 0, '空数组 → 没有布');
  equal(sheets.sheetsFromRects(null, 150).length, 0, 'null → 没有布（不抛）');
});

test('⑭ 旋转：**默认不转**；明确要求时才转 90°', () => {
  const rotated = { base: R(0, 0, 40, 90), holes: [] };
  equal(sheets.placeNext(rotated, 80, 30), null,
    '默认不许自动旋转 —— 布有织向，转 90° 是用户的决定，系统不能悄悄替他转');
  const p = sheets.placeNext(rotated, 80, 30, { allowRotate: true });
  ok(p, '明确要求旋转时 → 找得到位置');
  near(p.length * p.width, 80 * 30, 1e-9, '旋转不改变面积');
  ok((p.length === 80 && p.width === 30) || (p.length === 30 && p.width === 80), '要么正着要么转 90°');
  equal(sheets.maxPlacable(rotated, 80, 30), 0, '不旋转 → 一件也放不下');
  ok(sheets.maxPlacable(rotated, 80, 30, 0, { allowRotate: true }) >= 1, '允许旋转 → 放得下');
});
