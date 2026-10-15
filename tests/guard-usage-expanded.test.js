// tests/guard-usage-expanded.test.js —— 「这批实际用料」默认展开（2026-10-10 V130）
//
// 背景（用户原话）：「增加成品数量，这个界面的这批实际用料展开 让用户直接看到
//                    不要点可改之后再展开」。
// ⇒ 打开「增加成品数量」时，用料清单**默认就是展开状态**，用户一眼能看到这批要扣哪些料。
//
// 为什么要立守卫：这个列表**有两个入口**（成品列表页的操作菜单 / 成品详情页），
// 而本项目最贵的一类 bug 就是「同一件事在两处各写一遍、然后走偏」——
// 只改一处的话，另一个入口仍要"点可改"才展开，用户会以为功能没生效。
const fs = require('fs');
const path = require('path');
const { test, group, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 一律先剥注释再判定 —— 注释里引用旧写法会把守卫骗过去（V67/V68 踩过两次）
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

const PAGES = ['pages/products/list.js', 'pages/products/instances.js'];
const PANELS = ['pages/products/list.wxml', 'pages/products/instances.wxml'];

// 打开「增加成品数量」的那次 setData（以 `qtyMode: 'produce'` 为锚，取到该对象结尾）
// ⚠️ 「转为样品 / 转为商品」也是同一个面板，但它们的 qtyMode 不是 produce ⇒ 自动排除。
function produceOpenBlock(src) {
  const i = src.indexOf("qtyMode: 'produce'");
  if (i < 0) return null;
  const j = src.indexOf('}', i);
  return src.slice(i, j < 0 ? i + 400 : j);
}

group('这批实际用料 · 默认展开（2026-10-10 V130）');

test('★ ① 两个入口打开「增加成品数量」时，用料清单必须默认展开', () => {
  // 注入法自检：老写法（默认收起）必须能被抓出来 —— 否则这条守卫没有牙
  const oldWay = "setData({ showQty: true, qtyTitle: '增加成品数量', qtyValue: '1', qtyMode: 'produce', usageLines: [], usageExpanded: false })";
  const oldBlock = produceOpenBlock(oldWay);
  ok(!!oldBlock, '自检失败：连 produce 块都切不出来，锚点漂了');
  ok(/usageExpanded\s*:\s*false/.test(oldBlock),
    '自检失败：老写法（默认收起）没被检出 —— 这条守卫没有牙');

  PAGES.forEach((rel) => {
    const src = stripComments(read(rel));
    const block = produceOpenBlock(src);
    ok(!!block, rel + ' 里找不到 `qtyMode: \'produce\'` 的 setData —— 锚点漂了，请更新这条守卫');
    ok(/usageExpanded\s*:\s*true/.test(block),
      '★ ' + rel + ' 打开「增加成品数量」时没收起用料清单 ⇒ 用户仍要先点「可改」才能看到这一批的用量。' +
      ' 期望：usageExpanded: true。实际块：' + block);
  });
});

test('② 面板仍保留手动收起的能力（展开 ≠ 变成死板的一整块）', () => {
  // 默认展开之后，「收起」这个交互不该丢 —— 物料多的时候用户仍能把它叠起来看按钮。
  PANELS.forEach((rel) => {
    const wxml = stripWxml(read(rel));
    ok(wxml.indexOf('toggleUsage') >= 0,
      rel + ' 丢了 toggleUsage 绑定 —— 默认展开后仍要能手动收起');
    // 标签要跟着状态走：展开时显示「收起」，收起时才提示「可改」
    ok(/usageExpanded\s*\?\s*'收起'/.test(wxml),
      rel + ' 的展开标签不再随状态变化（展开时应显示「收起」）');
    ok(wxml.indexOf('usage-list') >= 0 && wxml.indexOf('onUsageInput') >= 0,
      rel + ' 的用料列表/输入框不见了');
  });
});
