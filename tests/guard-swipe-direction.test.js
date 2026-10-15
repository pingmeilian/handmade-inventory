// tests/guard-swipe-direction.test.js —— 守卫：左滑组件的「方向一致性」（含 RTL）
//
// 为什么需要单独守一道：
//   "往哪边滑"和"操作区露在哪边"必须永远配套。这层关系一旦被破坏（比如有人加了 RTL 支持
//   却只写了单边样式、或把内容位移的符号写死在 WXML 里），表现是「滑了但操作区在反侧」
//   或者「RTL 环境下完全滑不动」——都不报错，只能靠肉眼在阿拉伯语环境下才看得出来。
//
// 本守卫从三个角度钉住它：
//   ① 方向必须是配置驱动的（WXML 里不能写死单边）
//   ② 两套定位必须都实现（WXSS 里 --left / --right 缺一不可）
//   ③ 行为上两个方向的位移符号必须相反且大小相同（纯函数层钉死）
const { test, group, ok, equal } = require('./harness.js');
require('./wx-stub.js');
const fs = require('fs');
const path = require('path');

const g = require('../components/swipe-cell/gesture.js');

const COMP = path.join(__dirname, '..', 'components', 'swipe-cell');
const wxml = fs.readFileSync(path.join(COMP, 'swipe-cell.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(COMP, 'swipe-cell.wxss'), 'utf8');

group('守卫 · 左滑组件方向一致性（RTL / 视觉一致性）');

test('WXML：操作区的露出侧必须由 dir 驱动，不能写死单边', () => {
  ok(/swipe-actions--\{\{dir\}\}/.test(wxml),
    '操作区容器必须写成 class="swipe-actions--{{dir}}"，否则加 direction=right 也只会露在右边');
});

test('WXML：内容位移必须用方向无关的 bodyX（符号只允许由 gesture 决定）', () => {
  ok(/translateX\(\{\{bodyX\}\}px\)/.test(wxml),
    '内容位移必须取 bodyX（已在 gesture.contentX 里按方向算好符号），' +
    '不要在 WXML 里写死负号 —— 那样 RTL 会滑反');
  ok(!/translateX\(-\{\{/.test(wxml), '不得出现写死的负号位移');
});

test('WXSS：--left 与 --right 两套定位必须都实现（RTL 不是"只改 JS 就完事"）', () => {
  ok(/\.swipe-actions--left\s*\{[^}]*\}/.test(wxss), '缺少 .swipe-actions--left（左滑露出右侧操作区）');
  ok(/\.swipe-actions--right\s*\{[^}]*\}/.test(wxss), '缺少 .swipe-actions--right（RTL：右滑露出左侧操作区）');
  const leftBlock = wxss.match(/\.swipe-actions--left\s*\{[^}]*\}/)[0];
  const rightBlock = wxss.match(/\.swipe-actions--right\s*\{[^}]*\}/)[0];
  ok(/right\s*:\s*0/.test(leftBlock), '.swipe-actions--left 应贴在右侧（right: 0）');
  ok(/left\s*:\s*0/.test(rightBlock), '.swipe-actions--right 应贴在左侧（left: 0）');
});

test('WXSS：RTL 下按钮顺序必须镜像（否则两个方向"最先露出的按钮"相反）', () => {
  const rightBlock = wxss.match(/\.swipe-actions--right\s*\{[^}]*\}/)[0];
  ok(/row-reverse/.test(rightBlock),
    '.swipe-actions--right 需要 flex-direction: row-reverse —— RTL 下不镜像的话，' +
    '左滑最先露出的是最后一个按钮，右滑最先露出的却是第一个，手感不一致');
});

test('行为：两个方向的位移符号相反、大小相同（RTL 镜像的正确性）', () => {
  equal(g.contentX(260, 'left'), -260);
  equal(g.contentX(260, 'right'), 260);
  equal(Math.abs(g.contentX(260, 'left')), Math.abs(g.contentX(260, 'right')));
});

test('行为：跟手位移在两个方向下也互为镜像', () => {
  // LTR：手指左移 → 正向位移；RTL：手指右移 → 同样大小的正向位移
  equal(g.dragTranslate(0, -120, g.signOf('left'), 260), 120);
  equal(g.dragTranslate(0, 120, g.signOf('right'), 260), 120);
  equal(g.dragTranslate(0, 120, g.signOf('left'), 260), 0, 'LTR 下右滑不位移');
  equal(g.dragTranslate(0, -120, g.signOf('right'), 260), 0, 'RTL 下左滑不位移');
});

test('行为：阈值吸附与操作区宽度不带方向偏好（不允许某个方向"更难滑开"）', () => {
  ['left', 'right'].forEach((dir) => {
    equal(g.snapTranslate(260, 260, 0.3), 260, dir + '：超阈值应展开');
    equal(g.snapTranslate(77, 260, 0.3), 0, dir + '：未超阈值应回弹');
    equal(g.areaPxOf([{ key: 'a', width: 130 }, { key: 'b', width: 130 }], 130, 375), 130, dir + '：宽度与方向无关');
  });
});

test('组件源码：手势分支里不得出现"只针对某一侧"的写死判断', () => {
  const js = fs.readFileSync(path.join(COMP, 'swipe-cell.js'), 'utf8');
  ok(!/direction\s*===\s*'left'\s*\?[^:]*:\s*-/.test(js),
    '不要在组件里手写方向三元表达式 —— 方向语义应集中在 gesture.js，避免多处口径不一致');
});

test('接入方（排单列表）：direction 必须是配置（或 auto），不能把 left 写死', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'commission', 'list.wxml'), 'utf8');
  if (/<swipe-cell/.test(page)) {
    ok(/direction="\{\{/.test(page), '排单列表里的 direction 应该来自页面数据（auto 可随系统语言走 RTL），而不是硬编码 left');
  }
});
