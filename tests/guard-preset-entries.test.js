// tests/guard-preset-entries.test.js —— 预设入口守卫（2026-09-27）
//
// ⚠️ 需求方向在这里**反了两次**，都记下来（否则下一个人会以为这是"历史遗留的怪代码"）：
//   [V65] 「我的」页 5 项预设光秃秃堆在一起、"不知道点进去会有什么"
//         → 新建「预设设置」页，分 3 组、每项带一行说明。
//   [V66] 「不需要加说明，看起来很乱」+ 标题与选项同字号同颜色分不清
//         → 删掉分组说明，分组标题降为小灰标签。
//   [V67] 「把说明去掉 标题也去掉」
//         → 分组标题与说明行**全部去掉**，回到纯入口列表；
//           并顺手清理各子页与导航栏标题重复的那一行。
//
// 所以本守卫**只锁"入口不许丢"，不再锁"必须有说明"** ——
// 装饰随用户口味变（已经变两次了），入口丢了才是真事故：那个功能就彻底没入口了。
//
// 这次改造有两个**静默失效**的风险，所以用守卫锁住：
//   ① 归并之后，若从「预设设置」页删掉某一项 → 那个功能就**没有入口**了。
//      而 guard-nav-targets 只检查"注册的页面有没有人跳"，页面上少一个入口它不管。
//   ② 「我的」页若又被人加回散落的预设入口 → 变成两处维护、文案迟早不一致。
//
// 本守卫因此做三件事：入口齐全 / 不再散落 / 顶部入口存在。

const path = require('path');
const fs = require('fs');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const PRESETS = path.join(ROOT, 'pages/settings/presets.wxml');
const MINE = path.join(ROOT, 'pages/mine/mine.wxml');

// ⭐ 一律先剥掉 wxml 注释再做判定。原因：改动的原因往往需要**引用旧写法**才讲得清
//    （例如"原来这里有 <view class="section-title">默认值与预警</view>，与导航栏重复"），
//    不剥注释的话，守卫会被自己的文档骗过去 —— 本次写 basic 注释时就真踩了。
//    两个方向都要防：① 不该有的东西出现在注释里 → 误报；② 该有的东西只出现在注释里
//    → 假通过（这个更危险：入口其实没了，守卫却说在）。
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// 「预设设置」页必须收纳的全部预设（缺一个 = 那个功能没入口）
// 注意：材料/成品"自定义属性"没有独立入口（是 listEditor 里未被使用的配置），故不在列
const REQUIRED = [
  { name: '物料分类', token: 'type=materialCategory' },
  { name: '品类', token: 'type=productCategory' },
  { name: '计量单位', token: 'type=unit' },
  { name: '排单平台', token: 'type=platform' },
  { name: '默认值与预警', token: '/pages/settings/basic' }
];

group('预设入口 · 归并后不丢入口、不散落');

test('① 预设设置页存在，且收纳了全部预设入口', () => {
  ok(fs.existsSync(PRESETS), '预设设置页 pages/settings/presets.wxml 必须存在');
  const src = stripComments(fs.readFileSync(PRESETS, 'utf8'));

  // 注入法自检（反向）：只写在注释里的入口不算入口 ——
  // 否则把入口删掉、只在注释里留个名字，守卫会假通过
  const onlyInComment = '<!-- type=materialCategory -->';
  ok(stripComments(onlyInComment).indexOf('type=materialCategory') < 0,
    '自检失败：注释里的入口被当成真入口（假通过）');

  const missing = REQUIRED.filter((r) => src.indexOf(r.token) < 0);
  equal(missing.length, 0,
    '预设设置页缺少入口（该功能将没有入口）：' + missing.map((m) => m.name).join('、'));
});

test('② 「我的」页不再散落预设入口（已归并，防止两处维护）', () => {
  const src = stripComments(fs.readFileSync(MINE, 'utf8'));
  const left = REQUIRED
    .map((r) => r.token)
    .filter((t) => t.indexOf('type=') === 0)      // 只检查 listEditor 那几项
    .filter((t) => src.indexOf(t) >= 0);
  equal(left.length, 0,
    '「我的」页仍在散落预设入口（应统一从「预设设置」进入）：' + left.join('、'));
});

test('③ 「我的」页必须有「预设设置」入口（否则整页都是孤岛）', () => {
  const src = fs.readFileSync(MINE, 'utf8');
  ok(src.indexOf('/pages/settings/presets') >= 0,
    '「我的」页缺少「预设设置」入口 —— 归并后没有入口，用户再也进不去');
});

// 判定抽成函数，方便注入法自检（stripComments 定义在文件上部的常量区）
const hasGroupTitle = (s) => stripComments(s).indexOf('class="section-title"') >= 0;
const hasNoteLine = (s) => stripComments(s).indexOf('class="t-min"') >= 0;

test('④ 预设设置页保持纯入口列表（无分组标题、无说明行）', () => {
  // 注入法自检：V65 / V66 的旧样板必须能被这两条判定抓出来
  const oldSample =
    '<view class="section-title">分类与属性</view><text class="t-min">面料 / 辅料 / 线材…</text>';
  ok(hasGroupTitle(oldSample), '自检失败：分组标题没被检出 —— 这条守卫没有牙');
  ok(hasNoteLine(oldSample), '自检失败：说明行没被检出 —— 这条守卫没有牙');

  // 反向自检：注释里的字样是"文档"，不是代码，不许误报
  ok(!hasGroupTitle('<!-- 原来：<view class="section-title">x</view> -->'),
    '自检失败：注释里的字样被误判为真实分组标题');
  ok(!hasNoteLine('<!-- 原来：<text class="t-min">说明</text> -->'),
    '自检失败：注释里的字样被误判为真实说明行');

  const src = fs.readFileSync(PRESETS, 'utf8');
  ok(!hasGroupTitle(src), '预设设置页又出现了分组标题 —— 用户 2026-09-27 明确「标题也去掉」');
  ok(!hasNoteLine(src), '预设设置页又出现了说明行 —— 用户 2026-09-27 明确「把说明去掉」');

  // 只删装饰，不许顺手把功能入口一起删了
  const rows = (src.match(/class="menu-row"/g) || []).length;
  ok(rows >= REQUIRED.length, '入口行数不足（' + rows + ' < ' + REQUIRED.length + '）');
});

test('⑤ 注入法自检：删掉一个入口必须能被抓出（守卫有牙）', () => {
  const src = stripComments(fs.readFileSync(PRESETS, 'utf8'));
  const broken = src.replace('type=materialCategory', 'type=removed');
  const missing = REQUIRED.filter((r) => broken.indexOf(r.token) < 0);
  equal(missing.length, 1, '自检失败：删掉入口后应恰好检出 1 项缺失');
  equal(missing[0].name, '物料分类', '自检失败：检出的应是"物料分类"');
});

test('⑥ listEditor 按 type 设置标题栏，且文案与入口一致（防两处打架）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'pages/settings/listEditor.js'), 'utf8');
  const wxml = fs.readFileSync(PRESETS, 'utf8');

  // 注入法自检：确认"文案一致性"的检查逻辑真的能抓出旧文案
  const stale = "unit: { label: '单位预设' }";
  ok(!/unit:\s*\{\s*label:\s*'计量单位'/.test(stale),
    '自检失败：旧文案「单位预设」应被判为不一致');

  ok(js.indexOf('setNavigationBarTitle') >= 0,
    'listEditor 没有按 type 设置标题栏 —— 用户看到的永远是「配置编辑」这种模糊标题');
  ok(/unit:\s*\{\s*label:\s*'计量单位'/.test(js), 'unit 的 label 应为「计量单位」');
  ok(/platform:\s*\{\s*label:\s*'排单平台'/.test(js), 'platform 的 label 应为「排单平台」');

  // 页面标题与入口文案必须一致（两处各写各的，迟早不一致）
  ok(wxml.indexOf('计量单位') >= 0, '「预设设置」页的入口文案应为「计量单位」');
  ok(wxml.indexOf('排单平台') >= 0, '「预设设置」页的入口文案应为「排单平台」');
});

// ---------------------------------------------------------------
// 2026-09-27（V67）追加：用户「把说明去掉 标题也去掉」。
//
// 除了「预设设置」页，还清掉一类**重复**：页面内的 section-title 与导航栏标题
// 一字不差 ——
//   · basic 页：顶部导航栏「默认值与预警」+ 内容里又一个「默认值与预警」
//   · listEditor：导航栏由 setNavigationBarTitle(cfg.label) 设置，
//                 内容里又打印一次 {{label}} ⇒ 必然重复
// 用户说的"标题"就是指这个：同一句话在一屏里出现两遍，第二遍纯属占地方。
// ---------------------------------------------------------------

group('预设设置 · 纯入口列表 + 标题去重（V67）');

test('⑦ 页面内不再重复导航栏标题（basic / listEditor）', () => {
  const readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

  // 判定：页面内存在与导航栏标题一字不差的 section-title（先剥注释）
  const dupTitle = (wxml, title) =>
    stripComments(wxml).indexOf('<view class="section-title">' + title + '</view>') >= 0;

  // 注入法自检：重复标题必须能被抓出，且同义不同名不得误报
  ok(dupTitle('<view class="section-title">默认值与预警</view>', '默认值与预警'),
    '自检失败：重复标题没被检出 —— 这条守卫没有牙');
  ok(!dupTitle('<view class="section-title">预警规则</view>', '默认值与预警'),
    '自检失败：不同名的标题被误判为重复');
  // 反向自检：注释里的旧写法是"文档"，不是真标题（本次写注释时踩过）
  ok(!dupTitle('<!-- 原来：<view class="section-title">默认值与预警</view> -->', '默认值与预警'),
    '自检失败：注释里的字样被误判为重复标题');

  // ---- basic 页 ----
  const basicJson = JSON.parse(readFile('pages/settings/basic.json'));
  const basicWxml = readFile('pages/settings/basic.wxml');
  equal(basicJson.navigationBarTitleText, '默认值与预警', 'basic 页导航栏标题应为「默认值与预警」');
  ok(!dupTitle(basicWxml, basicJson.navigationBarTitleText),
    '「' + basicJson.navigationBarTitleText + '」页又在页面内重复了一遍导航栏标题 —— ' +
    '顶部一行、内容里又一行，一字不差，纯冗余');

  // ---- listEditor ----
  const leJs = readFile('pages/settings/listEditor.js');
  const leWxml = readFile('pages/settings/listEditor.wxml');
  ok(leJs.indexOf('setNavigationBarTitle') >= 0,
    'listEditor 应按 type 动态设置导航栏标题（V65 的成果，别弄丢）');
  ok(stripComments(leWxml).indexOf('class="section-title"') < 0,
    'listEditor 页面内又出现了标题 —— 它的文案是 {{label}}，与导航栏标题必然重复');
});
