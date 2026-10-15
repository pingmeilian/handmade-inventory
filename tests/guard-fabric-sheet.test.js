// tests/guard-fabric-sheet.test.js —— 布料几何模型的反向规格（2026-09-29 V81）
//
// 这一组不是测"功能对不对"（那是 geometry-model.test.js 的活），而是**钉住几条不许回退的铁律**。
// 背景：布料模型这一天之内被推翻重来过三回（用户 D88 → D96 → D97），每次都是因为
// 把"用户的操作方式"理解成了"数据结构的另一种写法"。铁律写在测试里，改回去就报红。
const { test, group, ok, equal } = require('./harness.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 先剥掉注释再判定：改动的原因往往要引用旧写法才讲得清，不剥注释守卫会被自己的文档骗过去
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '\n');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

group('布料几何模型 · 铁律（不许回退）');

test('① 裁剪**永远不拆块** —— 一块布裁过之后还是一块', () => {
  const src = stripComments(read('utils/store.js'));
  // 注入法自检：旧的"拆成两片"写法（把原片删掉、concat 新片）必须抓得出来
  const oldStyle = 'return rest.filter(p => p.id !== pieceId).concat(remnants);';
  ok(/\.concat\(remnants\)/.test(oldStyle), '自检失败：旧的拆分写法没被检出 —— 这条守卫没有牙');

  const cut = /function cutFabric\s*\([\s\S]*?\n\}/.exec(src);
  ok(!!cut, 'utils/store.js 里找不到 cutFabric');
  ok(/m\.pieces\[idx\]\s*=/.test(cut[0]),
    'cutFabric 必须**原地替换**那一块（m.pieces[idx] = …）—— 用户 D96：' +
    '「只有我明确要求把一块布拆成两块的时候，才把它变成两块布，要不然就是一个整体的几何图形」');
  ok(!/pieces\s*=\s*\(m\.pieces \|\| \[\]\)\.filter\(p => p\.id !== pieceId\)/.test(cut[0]),
    'cutFabric 又在"删掉原片 + 加余料片"了 —— 那会把一块布拆成两片');
});

test('② 余料规则只有一处定义（cutFabric 与影子预览必须同源）', () => {
  const src = stripComments(read('utils/store.js'));
  // applyCutToPieces 与 cutFabric 都要走 cutSheetPiece —— 否则选片页的"影子预览"会骗人
  ok(/all\[i\]\s*=\s*cutSheetPiece\(/.test(src),
    'applyCutToPieces 必须走 cutSheetPiece（影子预览与落盘同源）');
  ok(/cutSheetPiece\(piece,\s*\[target\]/.test(src),
    'cutFabric 必须走 cutSheetPiece（与影子预览同源）');
});

test('③ 「整布 / 碎布」判定必须走几何，不许退回「宽 < 幅宽」的旧口径（D97）', () => {
  const src = stripComments(read('utils/store.js'));
  const body = /function isPieceOffcut\s*\([\s\S]*?\n\}/.exec(src);
  ok(!!body, '找不到 isPieceOffcut');
  ok(/keepsFullWidth/.test(body[0]),
    'isPieceOffcut 必须调 sheets.keepsFullWidth —— 用户 D97 定的口径是' +
    '「这块布的**可用区域**还等不等于幅宽」（裁掉一角、形状不规则，但宽仍=幅宽 ⇒ **整布**）');
  ok(!/piece\.width\s*<\s*fw/.test(body[0]),
    'isPieceOffcut 又退回"直接比宽度"了 —— 那会把带缺口但仍是整幅宽的布误标成碎布');
});

test('④ 页面文案不许再出现「源片」「余料两片」的说法', () => {
  // 2026-09-30 V89：旧的方案卡片选择器（cut-picker）已删，检查对象换成唯一在用的裁剪排版页
  const wxml = stripWxml(read('pages/cut-editor/cut-editor.wxml'));
  ok(wxml.indexOf('源片') < 0,
    '裁剪页又出现「源片」—— 用户手上本来就只有一块布，没有"源片"这回事（D96/D97）');
  ok(wxml.indexOf('remainWhole') < 0 && wxml.indexOf('offcutText') < 0,
    '裁剪页又在预览「整布 + 碎料」两块 —— 一块布裁过之后**还在一块上**');
});

test('⑤ 迁移必须存在且幂等（老数据要被合回一块，账不许动）', () => {
  const mig = stripComments(read('services/migrations.js'));
  ok(/function migrateFabricSheets/.test(mig), '缺少 migrateFabricSheets —— 老用户的布永远合不回来');
  ok(/MIGRATED_FABRIC_SHEETS/.test(mig), '迁移缺少幂等标记');
  ok(/migrateFabricSheets,/.test(mig), '迁移函数没登记进 STEPS（等于不存在）');
  ok(/sheetsFromRects/.test(mig),
    '迁移必须走 sheets.sheetsFromRects（判不准就各算一块，不许猜）');

  const keys = read('services/keys.js');
  ok(/MIGRATED_FABRIC_SHEETS/.test(keys), 'services/keys.js 缺少 MIGRATED_FABRIC_SHEETS');
});

test('⑥ 面积口径只有一处：fabricArea 仍然只是「在库布片的 area 之和」', () => {
  const src = stripComments(read('utils/store.js'));
  const body = /function fabricArea\s*\(material\)\s*\{[\s\S]*?\n\}/.exec(src);
  ok(!!body, '找不到 fabricArea');
  ok(/p\.area/.test(body[0]),
    'fabricArea 必须仍按 p.area 求和 —— 面积口径一个字都不许动（这是"账不动"的根据）');
  ok(!/holes/.test(body[0]), 'fabricArea 里不该出现镂空计算（面积是存下来的权威值）');
});

test('⑦ 注入法自检：旧模型的两条特征写法必须能被上面几条抓出来', () => {
  // 反证守卫有牙：若把它们塞回源码，①③④ 会红
  const splitStyle = 'm.pieces = (m.pieces || []).filter(p => p.id !== pieceId).concat(remnants);';
  ok(/pieces\s*=\s*\(m\.pieces \|\| \[\]\)\.filter\(p => p\.id !== pieceId\)/.test(splitStyle),
    '自检失败：拆分写法没被检出');
  const widthRule = 'return piece.width < fw;';
  ok(/piece\.width\s*<\s*fw/.test(widthRule), '自检失败：旧判定没被检出');
  const oldCopy = '碎料源片 40×100';
  ok(/源片/.test(oldCopy), '自检失败：旧文案没被检出');
  void equal;
});


group('布片形状必须照实显示（2026-09-30 V82）');

test('⑧ 物料详情的布片不许再画「卷筒」插画 —— 一律画真实形状', () => {
  const wxml = stripWxml(read('pages/materials/detail.wxml'));
  const js = stripComments(read('pages/materials/detail.js'));
  // 注入法自检：旧的卷筒写法必须抓得出来
  const oldStyle = "<view wx:if=\"{{item.kind==='roll'}}\" class=\"piece-icon roll\">";
  ok(/piece-icon roll/.test(oldStyle), '自检失败：卷筒插画写法没被检出 —— 这条守卫没有牙');

  ok(wxml.indexOf('piece-icon roll') < 0, '布片清单又出现「卷筒」插画 —— 用户要求「不要这种整卷了，变成实际几何图形」');
  ok(js.indexOf("kind: isOffcut ? 'rect' : 'roll'") < 0, 'detail.js 又按「整布=卷筒」分叉了');
  ok(js.indexOf('pieceShape') >= 0, 'detail.js 必须用 store.pieceShape 拿真实形状');
  ok(wxml.indexOf('piece-shape') >= 0 && wxml.indexOf('piece-hole') >= 0,
    '布片缩略图必须画出「外框 + 已有缺口」');
});

test('⑨ 裁剪页的画布要画出**已有的缺口**（不能只画一个完整矩形）', () => {
  // 2026-09-30 V89：检查对象换成唯一在用的裁剪排版页（旧选择器已删）
  const wxml = stripWxml(read('pages/cut-editor/cut-editor.wxml'));
  const js = stripComments(read('pages/cut-editor/cut-editor.js'));
  // 注入法自检：只画外框+裁片（旧写法）必须抓得出来
  const oldStyle = '<view class="cloth"><view class="cut-red"></view></view>';
  ok(oldStyle.indexOf('cloth-hole') < 0, '自检失败：旧的只有外框+裁片写法没被检出');

  ok(js.indexOf('pieceShape') >= 0, '裁剪页必须用 store.pieceShape 拿这块布的形状');
  ok(/holes/.test(js), '裁剪页要把已有缺口算出来给页面');
  // V90/V91：剪裁区是**多块布**（用到的每块各画一块），所以缺口按每块布自己的来画
  ok(wxml.indexOf('bd.holes') >= 0 && wxml.indexOf('cloth-hole') >= 0,
    '画布要画出已有缺口 —— 用户真机反馈「这块布应该左上角缺了一块，怎么没有显示出来」');
  // ⚠️ 2026-10-04 V111：剪裁区改成**按物料分屏**（swiper 一屏一个物料），
  //    布块挂在 `grp.boards` 上 ⇒ 判据认两种写法（旧的 `boards` / 新的 `grp.boards`）。
  //    意图不变：用到几块布就画几块，每块各画自己的缺口。
  ok(/wx:for="\{\{(grp\.)?boards\}\}"/.test(wxml), '用到几块布就画几块（每块各自画自己的缺口）');
});
