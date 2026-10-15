// tests/material-spec-height.test.js —— 「规格区四类控件必须一样高，且高度只有一个来源」（V128 → V129）
//
// 背景（2026-10-09，用户连续三轮反馈，值得完整记下来）：
//   · V127 用户：「按钮和输入框高度还是不一致啊」→ 我以为差在原生 <switch>（62rpx）；
//   · V128 用户又说「还是不一致」→ 量准了：真凶是 **ph-input 组件默认 styleIsolation: isolated**，
//     页面传的 `ph-class="spec-input"` **一个属性都进不去**，输入框实高由组件内 `.ph-control`
//     决定 = **80rpx**；而同排的 `.unit-toggle` / `.quick-btn` 是页面 `height: var(--input-lg)` = 96rpx。
//     ⇒ 当时把输入框加到 `tall`（96rpx）来对齐。
//   · V129 用户：「宽度太高了改窄点」→ 对齐是齐了，但整块太胖 ⇒ **统一降到 80rpx**（组件默认档），
//     并把高度**收口成一个变量** `--spec-h`，避免以后再出现"两边各写一个数字"。
//
// 本守卫盯四件事：
//   ① 规格区的输入框**不许标 `tall`**（那是 96rpx 档），必须用组件默认档（= `--spec-h`）；
//   ② `--spec-h` 只能定义一处（在 `.spec-block` 上），页面三个类都必须 `var(--spec-h)`；
//   ③ **口径一致**：`--spec-h` 的数值必须等于组件 `.ph-control` 的 `min-height`
//      （跨组件边界、两处独立定义 ⇒ 最容易悄悄跑偏，必须用测试钉住）；
//   ④ 组件样式隔离保持默认（改它 = 一次性改全项目约 100 处输入框外观）。

const path = require('path');
const fs = require('fs');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const rx = (s, re) => (s.match(re) || []);

// 取某条 CSS 规则块（从选择器起，到配对的 } 止）
function ruleBlock(wxss, selectorRe) {
  const m = wxss.match(selectorRe);
  if (!m) return '';
  const i = wxss.indexOf(m[0]);
  return wxss.slice(i, wxss.indexOf('}', i) + 1);
}

group('规格与价格 · 控件同高且高度只有一个来源');

test('★★ 规格区的输入框不许标 tall（tall = 96rpx，会与 --spec-h 打架）', () => {
  const wxml = read('pages/materials/edit.wxml');
  const tags = rx(wxml, /<ph-input[^>]*ph-class="spec-input"[^>]*>/g);
  ok(tags.length > 0, '找不到规格区的输入框（锚点漂了：应带 ph-class="spec-input"）');
  const bad = tags.filter((t) => /\btall\b/.test(t));
  equal(bad.length, 0,
    '★ 这些输入框标了 tall ⇒ 它们会是 96rpx，而 m|cm 切换与快捷按钮取的是 --spec-h（80rpx），\n' +
    '   "高度不一致"会立刻复发。规格区的输入框应当用**组件默认档**（80rpx）：\n' +
    bad.map((t) => '  ' + t.slice(0, 96)).join('\n'));
});

test('★★ --spec-h 只能定义一个地方，且页面三个类都必须用它（不许再各写数字）', () => {
  const wxss = read('pages/materials/edit.wxss');
  const defs = rx(wxss, /--spec-h\s*:\s*\d+rpx/g);
  equal(defs.length, 1,
    '★ `--spec-h` 应当**只定义一处**（在 .spec-block 上），实际定义了 ' + defs.length + ' 处：' + defs.join(' / '));

  const uses = [
    ['\\.spec-input\\s*\\{', '输入框（单位选择框 / 均价只读框）'],
    ['\\.unit-toggle\\s*\\{', 'm|cm 切换'],
    ['\\.quick-btn\\s*\\{', '快捷按钮（1.5 / 其他）']
  ];
  const missing = [];
  uses.forEach((pair) => {
    const block = ruleBlock(wxss, new RegExp(pair[0]));
    ok(block, '找不到 ' + pair[1] + ' 的规则块（锚点漂了）');
    if (!/var\(--spec-h\)/.test(block)) missing.push(pair[1]);
  });
  equal(missing.length, 0,
    '★ 这些控件没有用 --spec-h，而是自己写了个高度 ⇒ 迟早和输入框不一致：\n' + missing.join('\n'));
});

test('★★ 口径一致：--spec-h 必须等于组件输入框的实高（.ph-control 的 min-height）', () => {
  const page = read('pages/materials/edit.wxss');
  const comp = read('components/ph-input/ph-input.wxss');
  const a = page.match(/--spec-h\s*:\s*(\d+)rpx/);
  // 组件默认档：`.ph-control { min-height: 80rpx; … }`（不带 .ph-tall / .ph-sz-* 前缀的那条）
  const b = comp.match(/\n\.ph-control\s*\{[^}]*min-height\s*:\s*(\d+)rpx/);
  ok(a, '页面里找不到 --spec-h');
  ok(b, '组件里找不到 .ph-control 的 min-height（锚点漂了）');
  equal(a[1], b[1],
    '★ 跨组件边界的同一口径必须相等：页面 --spec-h = ' + a[1] + 'rpx，' +
    '组件 .ph-control 的 min-height = ' + b[1] + 'rpx ——\n' +
    '   两者不等就会出现"输入框比按钮高/矮一截"。要改高度请**两处一起改**。');
});

test('★ 带边框的两个控件必须 box-sizing: border-box（否则隐性多 2rpx）', () => {
  const wxss = read('pages/materials/edit.wxss');
  ['\\.unit-toggle\\s*\\{', '\\.quick-btn\\s*\\{'].forEach((sel) => {
    const block = ruleBlock(wxss, new RegExp(sel));
    ok(/box-sizing\s*:\s*border-box/.test(block),
      '★ ' + sel.replace(/\\\\/g, '') + ' 有边框却没写 box-sizing ⇒ 实高 = height + 2rpx');
  });
});

test('★ 组件样式隔离必须保持默认（改它等于一次性改全项目约 100 处输入框外观）', () => {
  const cfg = JSON.parse(read('components/ph-input/ph-input.json'));
  ok(!/apply-shared|shared/.test(String(cfg.styleIsolation || '')),
    '★ ph-input 不要改成 apply-shared/shared：那会让全项目那些 `ph-class="field-control input"`、\n' +
    '   `spec-input`… 里的 height/padding **突然全部生效**，一次性改变约 100 处输入框的外观。\n' +
    '   要调尺寸请用组件自己的 tall / size 档（本守卫就是为拦住"顺手改隔离"而立的）。');
  ok(cfg.styleIsolation === undefined,
    '★ 本项目刻意不声明 styleIsolation（保持默认 isolated）；若确有需要，必须同时重核全部 ph-input 用法');
});

test('★ 守着自己：上面两条检查确实抓得住"标 tall"与"另写一个高度"的写法', () => {
  const badTag = '<ph-input ph-class="spec-input" tall type="digit" />';
  const goodTag = '<ph-input ph-class="spec-input" type="digit" />';
  ok(/\btall\b/.test(badTag), '自检失败：标了 tall 的写法没被检出 —— 守卫没有牙');
  ok(!/\btall\b/.test(goodTag), '自检失败：没标 tall 的写法被误判');

  const badRule = '.spec-input { height: 96rpx; }';
  const goodRule = '.spec-input { height: var(--spec-h); }';
  ok(!/var\(--spec-h\)/.test(badRule), '自检失败：自己写死高度的写法没被检出');
  ok(/var\(--spec-h\)/.test(goodRule), '自检失败：用变量的写法被误判');
});
