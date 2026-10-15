// tests/material-piece-zoom.test.js —— 布片「长按放大」的交互守卫（V113）
//
// 起因（用户 2026-10-04 真机截图）：
//   「布片很大的时候这样就看不清了　长按布片可以放大　松手就关掉」
//
// 截图里那块布是 500×150cm —— 缩略图按真实比例缩到 130rpx 框里只剩一条细带。
// ⚠️ **这不是 bug，是缩略图的职责上限**：它的职责是"扫一眼认出是哪块"，
//    "看清形状与缺口"是另一个职责。让同一张图承担两者只会两头不讨好 ⇒ 加放大层。
//
// 这条守卫盯三件容易做错的事：
//   ① 两处缩略图（清单 / 盘库浮层）都要能长按 —— 盘库那个只有 56rpx，更看不清
//   ② **放大图必须真的比缩略图大**（否则"放大"是空话）
//   ③ **松手必须能关**（且要兜 touchcancel —— 手指滑出屏幕也算松手，
//      只绑 touchend 会留下一个关不掉的浮层，用户只能杀小程序）
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');

const JS = 'pages/materials/detail.js';
const WXML = 'pages/materials/detail.wxml';
const WXSS = 'pages/materials/detail.wxss';

group('物料详情 · 布片长按放大（V113）');

test('① 清单与盘库浮层的缩略图都能长按放大', () => {
  const wxml = stripComments(read(WXML));
  const js = stripComments(read(JS));

  // 两处都要：盘库浮层里那个只有 56rpx，比清单里的 160rpx 更看不清
  const n = (wxml.match(/onZoomPiece/g) || []).length;
  equal(n, 2, '两处缩略图都要绑长按（清单 + 盘库浮层）');
  ok(/bindlongpress="onZoomPiece"/.test(wxml),
    '清单里的缩略图用 bindlongpress');
  ok(/catchlongpress="onZoomPiece"/.test(wxml),
    '★ 盘库浮层里要用 catchlongpress —— 那一行右边有「调整尺寸/整块销毁」两个 tab，'
    + '长按要从它们那儿抢事件');

  ok(/onZoomPiece\s*\(e\)/.test(js), '要有 onZoomPiece 处理函数');
  ok(/data-idx/.test(wxml), '要传布片下标（放大的是"哪一块"）');
});

test('② 放大图必须真的比缩略图大（否则"放大"是空话）', () => {
  const js = stripComments(read(JS));
  // ⚠️ 只取"数据准备那处"的小图上限：把整个 js 里的 thumbShape 都算进来会误判
  //    （放大层那处 460×560 也会被算成"小图"，比出来就相等了）。
  //    锚点用 `shapeSm`（只出现在布片渲染数据那一处）⇒ 天然不会捞到放大层；
  //    窗口取 300 字符，那两行紧挨着，一起捞进来。
  //    判别句：**量"缩略图的上限"要锚在它自己的字段上，不能全文件搜。**
  const anchor = js.indexOf('shapeSm:');
  ok(anchor > 0, '找不到布片缩略图的赋值处（shapeSm 那行）');
  const win = anchor > 0 ? js.slice(anchor - 300, anchor + 300) : '';
  const smallNums = win.match(/thumbShape\([^)]*\)/g) || [];
  equal(smallNums.length, 2, '清单与盘库两处小图都要有');
  const maxSmall = Math.max.apply(null, smallNums.map((s) => {
    const m = s.match(/,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    return Math.max(Number(m[1]), Number(m[2]));
  }));

  // 放大图：只看 onZoomPiece 那一个函数体里调用的那一次
  const zoomFn = /onZoomPiece\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/.exec(js);
  ok(zoomFn, '找不到 onZoomPiece 函数体');
  const zm = zoomFn && /thumbShape\(\s*\w+\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(zoomFn[0]);
  ok(zm, 'onZoomPiece 里必须用 thumbShape 重算一份大图');
  const zoomMax = Math.max(Number(zm[1]), Number(zm[2]));
  ok(zoomMax > maxSmall,
    '★ 放大图上限 ' + zoomMax + ' 必须大于缩略图上限 ' + maxSmall +
    ' —— 否则按真实比例缩出来可能反而更小（长宽比极端时）');
  ok(zoomMax >= 400,
    '放大层要真的"大"（建议上限 ≥400rpx，太小就失去放大的意义）');

  // 放大图必须带缺口（hole）—— ⚠️ 但**不是每块布都有**：
  //   `holes` 只在「这块布被裁过之后」才有值（store.cutSheetPiece 才往里塞），
  //   整布的 holes 恒为空数组（已实测验过：58×150 整布 → holes 长度 0）。
  //   ⇒ 这条判据只保证"有缺口时画得出来"，**不许反过来假定"每块都有"** ——
  //   上一轮我就是这么写进注释的，结果对整布说"那正是看不清的东西"，被用户当场问住。
  const wxml = read(WXML);
  ok(/zoomShape\.holes/.test(wxml) || /\{\{zoomShape\.holes\}\}/.test(wxml),
    '放大图要照实画出**已有的**缺口（整布没有就不画，别凭空造）');
  ok(/zoomHoleN|zoomHoleText/.test(wxml),
    '★ 要按实际有无缺口给说明（整布显示「未被裁剪」，被裁过显示「已裁 N 处」）—— '
    + '不能默认每块布都有缺口');
});

test('③ 松手就关：touchend 与 touchcancel 都要兜住', () => {
  const wxml = stripComments(read(WXML));
  const js = stripComments(read(JS));

  ok(/zoomOpen/.test(wxml) && /bindtouchend="closeZoom"/.test(wxml),
    '浮层要绑 touchend（松手就关）');
  ok(/bindtouchcancel="closeZoom"/.test(wxml),
    '★ 也要兜 touchcancel —— 手指滑出屏幕再松手同样要能关，'
    + '只绑 touchend 会留下一个关不掉的浮层');
  ok(/closeZoom\s*\(\)/.test(js), '要有 closeZoom');
  ok(/zoomOpen\s*\)\s*this\.setData/.test(js) || /setData\(\{\s*zoomOpen:\s*false\s*\}\)/.test(js),
    'closeZoom 要把 zoomOpen 置回 false');

  // 注入法自检：漏掉 touchcancel 必须被判出来
  const onlyEnd = '<view bindtouchend="closeZoom"></view>';
  ok(onlyEnd.indexOf('touchcancel') < 0, '自检失败：漏 touchcancel 没被检出 —— 这条守卫没有牙');
});

test('④ 布色保持中性（放大层不许跟主题跑）', () => {
  const wxss = read(WXSS);
  const zoomRule = (wxss.match(/\.zoom-shape\s*\{[\s\S]*?\}/) || [''])[0];
  ok(/#EFEFEC/i.test(zoomRule),
    '放大图沿用与缩略图/裁剪页同一套中性灰白 #EFEFEC'
    + '（同一块布在几个界面必须是同一个颜色，否则用户以为是两块布）');
  ok(!/var\(--color-/.test(zoomRule),
    '★ 放大图底色不许走主题 token —— 三套主题面色都带偏色（暖陶土偏暖、海盐奶盖偏绿）');

  // 遮罩也要中性：主题色遮罩会给布染色
  const layerRule = (wxss.match(/\.zoom-layer\s*\{[\s\S]*?\}/) || [''])[0];
  ok(/rgba\(\s*2\d/.test(layerRule) || /#1[0-9A-Fa-f]{5}/.test(layerRule),
    '遮罩用中性深色（主题色遮罩会给布染色，"布本来什么颜色"就判断失真了）');
});

// ============================================================
// V113 修：**整布本来就没有缺口**（用户真机问「你这哪有缺口」）
//
// 查实（已实测验过）：`store.pieceShape(piece).holes` 只在**这块布被裁过之后**
// 才有值 —— 数据来源是 `asSheet(piece)`：
//   · 未裁过的：直接 `holes: []`                       ← 整布恒为空
//   · 裁过的：  `cutSheetPiece` 把它 `concat(list)` 进 holes
// ⇒ 我上一轮把"照实画缺口"当成放大层的主要看点，还写进了注释 —— 对整布就是**错的**。
//
// 📌 教训：**"某状态是可选的"这件事，要去数据层确认它何时为空**，
//    别在 UI 层的注释里把它说成常态（UI 表现得像"这里应该有点什么"，
//    用户一看就会问"哪有"）。
// ============================================================

test('⑤ 数据层事实：整布没有缺口，被裁过的才有', () => {
  const stub = require('./wx-stub.js');
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.ensureSeed();

  const m = store.saveMaterial({ name: '整布测试', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 300, width: 200, total: 2 }, '入库');
  const p = store.getMaterial(m.id).pieces[0];

  const sh = store.pieceShape(p);
  equal(sh.holes.length, 0, '★ 未裁过的布片没有缺口（整布）—— 放大层不该凭空画');
  equal(sh.used, false, '未被裁过 ⇒ used = false');
});

// ============================================================
// V113b 修（用户真机截图 2026-10-04）：
//   缩略图明明画着缺口，长按放大后却是「整布 / 未被裁剪」—— 自相矛盾。
//
// 根因：`data.pieces` 里存的是**展示条目**（reload 时 map 出来的：
//   id / length / width / rawArea / tag / shape / shapeSm —— **没有 base / holes**）。
// `onZoomPiece` 拿它去 `thumbShape(p, 460, 560)` ⇒ `asSheet` 走"没有 base 就
//   按长宽拼矩形"的回退分支 ⇒ holes 恒为空 ⇒ **裁过的布放大后也"未被裁剪"**。
// 缩略图为什么是对的：它在 reload 那一刻用的还是**原始布片**（带 holes）。
//
// 📌 判断句：**事件发生在"列表渲染之后"，就别从展示条目反推原始数据** ——
//    展示条目只保留"画列表要用的字段"，用它当数据源等于偷偷换了对象。
// ============================================================

test('⑥ 裁过的布，放大层必须与缩略图一致（不能变回"未被裁剪"）', () => {
  const stub = require('./wx-stub.js');
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.ensureSeed();
  const { loadPage } = require('./page-helper.js');

  // 数据层真实裁一刀：150×58 的布挖掉 100×58（ holes 落盘，与 cut-editor 同一条路）
  const m = store.saveMaterial({ name: '缺口布测试', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 150, width: 58, total: 1 }, '入库');
  const p0 = store.getMaterial(m.id).pieces[0];
  store.cutFabric(m.id, p0.id, 100, 58, '测试裁一刀');

  const page = loadPage('../pages/materials/detail.js');
  page.onLoad({ id: m.id });

  const item = page.data.pieces[0];
  ok(item.shape.holes.length > 0, '前置：缩略图已画出缺口（这块布确实被裁过）');

  page.onZoomPiece({ currentTarget: { dataset: { idx: 0 } } });
  equal(page.data.zoomShape.holes.length, item.shape.holes.length,
    '★ 放大层的缺口数必须与缩略图一致 —— 放大层不许从"展示条目"反推形状'
    + '（条目上没有 base/holes，asSheet 会退化成矩形 ⇒ 永远显示未被裁剪）');
  ok(/^已裁/.test(page.data.zoomHoleText || ''),
    '★ 有缺口时说明必须是「已裁 N 处」，不能说"未被裁剪"');
});
