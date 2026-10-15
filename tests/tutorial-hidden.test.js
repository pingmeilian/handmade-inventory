// tests/tutorial-hidden.test.js —— 「图文教程」暂不上架期间的隐藏状态守卫（V126，2026-10-09）
//
// 背景：用户决定「图文教程」**先不上架**、之后再优化再上架。所以它不是删掉，而是**遮住**：
//   · 两页（成品详情 detail / 成品编辑 edit）各有一个 `data.showTutorial` 开关，默认 false；
//   · 两块 UI 都挂在 `wx:if="{{showTutorial}}"` 上；
//   · 教程数据、导出页、utils/tutorial-export.js 全部原样保留。
//
// 为什么必须有个守卫盯着（三处都会**静默**出事）：
//   ① **开关是摆设**：某次改动把 wx:if 弄丢、或挂到别的变量上 ⇒ 教程又冒出来了，没人会发现；
//   ② **半隐**：只遮了详情页没遮编辑页（或反过来）⇒ 用户"能编却看不到"或"看得到却编不了"；
//   ③ **最危险的一条**：遮 UI 时顺手把数据链路也"清理"了 —— edit.js 的 `buildProduct()`
//      一旦不再写回 `tutorial`，用户**保存任何成品都会把已有教程清空**，
//      而且完全静默（同 V122 那个"白名单漏字段"的坑）。这条与"隐不隐"无关，是长期护栏。
//
// ⚠️ 恢复教程功能时（把两处 showTutorial 改回 true），本文件的 ①② 会变红 —— 那是**有意的**，
//    提醒你"这次是有意识地恢复了"，改完守卫再提交即可。③④⑤ 任何时刻都不该红。
const fs = require('fs');
const path = require('path');
const { test, group, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');

group('图文教程 · 暂不上架期间的隐藏状态（V126）');

test('① 两页各有一个 showTutorial 开关，隐藏期间默认 false', () => {
  // 注入法自检：把开关写成 true 的"反例"必须能被判出来，否则这条守卫没有牙
  ok(!/showTutorial\s*:\s*false/.test('showTutorial: true,'), '自检失败：判据没有牙');

  [['pages/products/detail.js', '成品详情'], ['pages/products/edit.js', '成品编辑']].forEach((row) => {
    const js = stripComments(read(row[0]));
    ok(/showTutorial\s*:/.test(js), row[1] + ' 必须留着 showTutorial 开关（恢复就靠它翻一个值）');
    ok(/showTutorial\s*:\s*false/.test(js),
      row[1] + ' 隐藏期间必须是 false —— 改回 true 说明你要恢复教程功能了，记得同步更新本守卫');
  });
});

test('★ ② 两块 UI 都真的挂在开关上（否则开关是摆设）', () => {
  [['pages/products/detail.wxml', '成品详情 · 图文教程卡片', 'class="card tut"'],
   ['pages/products/edit.wxml', '成品编辑 · 图文教程编辑区', 'section-title tut-head']].forEach((row) => {
    const wxml = stripComments(read(row[0]));
    const i = wxml.indexOf(row[2]);
    ok(i >= 0, row[1] + '：找不到这块 UI 的锚点（锚点漂了就更新本守卫）');
    // 往锚点**前面**找那个开标签上的 wx:if（两页的锚点深度不同，所以取一段区间来找）
    const seg = wxml.slice(Math.max(0, i - 600), i);
    ok(/wx:if="\{\{showTutorial\}\}"/.test(seg),
      row[1] + ' 必须挂在 `wx:if="{{showTutorial}}"` 上 —— 否则开关关不严，教程会自己冒出来');
    // 自检：一段没有开关的模板必须判为"没挂"
    ok(!/wx:if="\{\{showTutorial\}\}"/.test('<view class="card"><text>图文教程</text></view>'),
      '自检失败：判据没有牙');
  });
});

test('★★ ③ 数据链路必须完好：遮 UI 不许把用户已有的教程清空', () => {
  const js = stripComments(read('pages/products/edit.js'));

  const iSave = js.indexOf('buildProduct');
  ok(iSave >= 0, '找不到 buildProduct（锚点漂了就更新本守卫）');
  const save = js.slice(iSave, iSave + 8000);
  ok(/tutorial\s*:\s*\{/.test(save),
    '★ buildProduct() 必须把 tutorial **写回成品** —— 少了它，用户保存任何成品都会静默清空已有教程' +
    '（同 V122 那个"白名单漏字段"的坑）');
  ok(/title/.test(save.slice(save.indexOf('tutorial'))), '写回时要带 title');
  ok(/steps/.test(save.slice(save.indexOf('tutorial'))), '写回时要带 steps');

  const iLoad = js.indexOf('loadProduct');
  ok(iLoad >= 0, '找不到 loadProduct（锚点漂了就更新本守卫）');
  const load = js.slice(iLoad, iLoad + 8000);
  ok(/p\.tutorial/.test(load), 'loadProduct() 必须把已存的教程**读回来**（读不回来就等于每次都从零开始）');
});

test('④ 隐藏 ≠ 删除：导出页、逻辑、两页入口实现都要还在', () => {
  ['pages/products/tutorial-export.js', 'pages/products/tutorial-export.wxml',
   'pages/products/tutorial-export.json', 'utils/tutorial-export.js'].forEach((f) => {
    ok(fs.existsSync(path.join(ROOT, f)), f + ' 不该被删 —— 隐藏期间原样保留，恢复才不用重写');
  });
  const app = JSON.parse(read('app.json'));
  ok(app.pages.indexOf('pages/products/tutorial-export') >= 0,
    'app.json 里仍要注册（只是 UI 被遮住而已，别把页面摘掉）');
  ok(/openTutorialPreview/.test(read('pages/products/detail.js')), '详情页的入口实现要留着');
  ok(/openTutorialExport/.test(read('pages/products/edit.js')), '编辑页的入口实现要留着');
});

test('⑤ 数据模型与教程卡逻辑没被顺手清掉', () => {
  ok(/tutorial/.test(read('utils/store.js')),
    'store 里的 tutorial 处理要保留（例如复制成品时把教程一起带走）');
  const exp = read('utils/tutorial-export.js');
  ok(exp.length > 800, 'utils/tutorial-export.js 应仍是完整实现，不是空壳');
});
