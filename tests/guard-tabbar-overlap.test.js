// tests/guard-tabbar-overlap.test.js —— V141：贴底元素不许被**底部导航栏**压住
//
// 用户报（真机截图，看板 → 趋势曲线 →「自定义」）：
//   「看板趋势曲线自定义时间这里下边的确定按钮被挡住了」，
//   并追问「查一下整个小程序，还有多少这种情况存在」。
//
// 根因：自定义 tabBar（`app.json` 的 `tabBar.custom = true`）是**独立组件树**，
//   它永远画在页面内容之上 —— 页面里 z-index 写多大都盖不过它（看板那个 `.dps-mask`
//   z-index 是 1000，照样被 z-index 200 的底栏压在下面）。
//   ⇒ 凡是"贴到屏幕底"的东西（弹层 / 底部操作栏 / 滚动区末行），
//      底部留白必须**同时**避开两块：安全区 + tabBar 那一条（110rpx）。
//   而项目里原先各处只写了 `env(safe-area-inset-bottom)` ⇒ **在 4 个 tab 页上都会被压一截**。
//
// 做法：`utils/theme-page.js` 按"这一页有没有 tabBar"注入 `--tabbar-h`
//   （tab 页 = 110rpx，非 tab 页 = 0px）⇒ 非 tab 页视觉零变化，tab 页自动让开。
//
// ⚠️ 本文件用**机械扫描**而不是登记表：判据只有一条 ——
//    「底部留白吃了 safe-area，却没吃 --tabbar-h」。
//    这样以后新写的弹层一漏就会被抓住，不需要有人记得来登记。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const F = require('./fixtures.js');

const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

// 解析 wxss 里的规则（够用即可：本项目没有嵌套写法）
function rulesOf(wxss) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const src = strip(wxss);
  while ((m = re.exec(src))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), decl: m[2] });
  return out;
}

// wxml 里出现的类名（去掉 {{}} 动态拼接的，取不到的就不当锚点）
function classesOf(wxml) {
  const set = new Set();
  const re = /class="([^"]*)"/g;
  let m;
  const src = strip(wxml);
  while ((m = re.exec(src))) {
    m[1].split(/\s+/).forEach((c) => { if (c && c.indexOf('{{') < 0) set.add(c); });
  }
  return set;
}

// 规则选择器的"最后一段"类名（`.a .b` → b）
function tailClasses(sel) {
  return sel.split(',').map((s) => s.trim().split(/[\s>]+/).pop().replace(/^\./, ''));
}

// ---------- 判据本体（纯函数，方便注入法自检） ----------
// 返回 'ok' | 'miss' | 'skip'
function auditDecl(decl) {
  if (!/env\(safe-area-inset-bottom\)/.test(decl)) return 'skip';   // 不贴底，不管
  if (/--tabbar-h/.test(decl)) return 'ok';                        // 已经避开 tabBar
  return 'miss';
}

// 从 `bottom: calc(140rpx + …)` / `padding: … calc(160rpx + …)` 里抠出**贴底那一段的 rpx 数**。
// 用途：白名单（比如 .fab 用 140rpx）要能证明"这个数确实够大"，而不是靠嘴说。
function bottomRpx(decl) {
  const nums = [];
  const re = /(\d+(?:\.\d+)?)rpx/g;
  let m;
  while ((m = re.exec(decl))) nums.push(Number(m[1]));
  return nums.length ? Math.max.apply(null, nums) : NaN;
}

// 「tab 页可达」的文件集合 = 页面自己的 wxml/wxss + app.wxss + 它 usingComponents 的 wxml/wxss
function reachableWxss(pagePath) {
  const json = JSON.parse(R(pagePath + '.json') || '{}');
  const comps = Object.values(json.usingComponents || {}).map((c) => c.replace(/^\//, ''));
  const list = [
    { file: pagePath + '.wxss', text: R(pagePath + '.wxss') },
    { file: 'app.wxss', text: R('app.wxss') }
  ];
  comps.forEach((c) => list.push({ file: c + '.wxss', text: R(c + '.wxss') }));
  let classes = classesOf(R(pagePath + '.wxml'));
  comps.forEach((c) => { classesOf(R(c + '.wxml')).forEach((x) => classes.add(x)); });
  return { list, classes };
}

// 允许不写 --tabbar-h 的例外：必须给出**为什么够**（数字要能自证）
const ALLOW = [
  { file: 'app.wxss', sel: '.fab', minRpx: 110,
    why: 'FAB 抬 140rpx，本来就大于 tabBar 的 110rpx（还留 30rpx）；且当前只用在非 tab 页' }
];

function allowHit(file, sel) {
  return ALLOW.filter((a) => a.file === file && a.sel === sel)[0] || null;
}

/* ===================== 守卫 ===================== */

group('V141 贴底元素 × 底部导航栏 · 结构守卫');

test('★ ① 4 个 tab 页可达的贴底留白，必须同时避开安全区与 tabBar', () => {
  const app = JSON.parse(R('app.json'));
  const tabPages = app.tabBar.list.map((t) => t.pagePath);
  equal(tabPages.length, 4, 'tab 页应当有 4 个（看板 / 物料库 / 作品集 / 我的）');

  const miss = [];
  let audited = 0;
  tabPages.forEach((pg) => {
    const { list, classes } = reachableWxss(pg);
    list.forEach((f) => {
      rulesOf(f.text).forEach((r) => {
        if (!tailClasses(r.sel).some((n) => classes.has(n))) return;   // 本页用不到这类名，跳过
        const verdict = auditDecl(r.decl);
        if (verdict === 'skip') return;
        audited++;
        if (verdict === 'ok') return;
        const a = allowHit(f.file, tailClasses(r.sel)[0]);
        if (a && !(bottomRpx(r.decl) < a.minRpx)) return;              // 白名单且数字确实够大
        miss.push(pg + ' ← ' + f.file + ' ' + r.sel +
          (a ? '（白名单已不成立：只有 ' + bottomRpx(r.decl) + 'rpx < ' + a.minRpx + 'rpx）' : ''));
      });
    });
  });

  ok(audited >= 5, '扫到的贴底留白太少（' + audited + ' 条）—— 锚点漂了就更新本文件');
  equal(miss.join(' ｜ '), '',
    '★ 这些贴底元素的留白没避开底部导航栏 ⇒ 在 tab 页上会被 tabBar 压住（用户报的正是这个）。' +
    '修法：底部留白里加 `+ var(--tabbar-h, 0px)`（该变量由 utils/theme-page.js 注入，非 tab 页为 0px）');
});

test('★ ② custom-tab-bar 的高度 与 theme-page 注入的 --tabbar-h 必须一致（防两个数各走各的）', () => {
  const themePage = require('../utils/theme-page.js');
  const css = R('custom-tab-bar/index.wxss');
  // .tabbar 的 height: calc(110rpx + env(safe-area-inset-bottom))
  const m = /\.tabbar\s*\{[^}]*height:\s*calc\((\d+(?:\.\d+)?)rpx/.exec(css);
  ok(!!m, 'custom-tab-bar/index.wxss 里没找到 .tabbar 的 height —— 锚点漂了就更新这条');
  equal(Number(m[1]), themePage.TABBAR_H_RPX,
    '★ 底栏自己的高度（' + m[1] + 'rpx）与 theme-page 的 TABBAR_H_RPX（' + themePage.TABBAR_H_RPX +
    'rpx）不一致 —— 只改一处的话，"让开多少"就与现实不符（少了照样被压、多了白留一条）');
});

test('★ ③ theme-page 按"这一页有没有 tabBar"注入：tab 页 110rpx / 非 tab 页 0px', () => {
  F.reset();
  const themePage = require('../utils/theme-page.js');

  function fakePage(withTab) {
    const p = {
      data: {},
      setData(o) { Object.keys(o).forEach((k) => { p.data[k] = o[k]; }); }
    };
    if (withTab) p.getTabBar = () => ({ applyTheme() {} });
    return p;
  }

  const tabPage = fakePage(true);
  const style = themePage.apply(tabPage);
  ok(style.indexOf('--tabbar-h: ' + themePage.TABBAR_H_RPX + 'rpx') >= 0,
    '★ tab 页必须拿到 --tabbar-h（否则贴底元素仍然被压住），实际：' + style.slice(-60));
  ok(style.indexOf('--color-') >= 0, '主题变量照旧要一起给（不能因为加了新变量就丢了老变量）');
  ok(tabPage.data.themeStyle === style, 'style 要落到 page-meta 读的那个 data 上');

  const plainPage = fakePage(false);
  const style2 = themePage.apply(plainPage);
  ok(style2.indexOf('--tabbar-h: 0px') >= 0,
    '★ 非 tab 页必须是 0px —— 那些页面本来就没有底栏，多留一条就是凭空多出一块空白，实际：' + style2.slice(-60));

  // 注入法自检：老口径（只写 safe-area、不提 tabBar）必须能被判出来
  equal(auditDecl('padding: 0 28rpx calc(160rpx + env(safe-area-inset-bottom));'), 'miss',
    '自检失败：老的 160rpx 写法没被判为"缺 --tabbar-h"（这条守卫就没有牙）');
  equal(auditDecl('padding: 0 28rpx calc(50rpx + env(safe-area-inset-bottom) + var(--tabbar-h, 0px));'), 'ok',
    '自检失败：新写法应当被认作达标');
  equal(auditDecl('background: var(--color-mask);'), 'skip', '不贴底的规则不该被算进统计');
});

test('④ 本次实修的三处（真 bug）+ 两处（口径统一）都点名钉住', () => {
  // 真 bug（会被 tabBar 压住，用户能看见）：
  //   ① 看板「自定义日期」弹层 —— 用户报的那一个
  //   ② 看板「选择月份」面板 —— 最后几项落在 tabBar 底下，点不着
  //   ③ 作品集长按菜单 —— 最下面的「取消」被压住
  // 口径统一（数值本来就够，改成变量免得数字散落）：
  //   ④ 看板统计弹窗滚动区（原 160rpx）⑤ 看板明细弹窗滚动区（原 160rpx）
  const spots = [
    ['components/date-picker-sheet/date-picker-sheet.wxss', '.dps-sheet', '看板 → 自定义日期弹层（用户报的）'],
    ['pages/dashboard/dashboard.wxss', '.month-panel', '看板 → 选择月份面板'],
    ['pages/products/list.wxss', '.action-sheet', '作品集 → 长按菜单'],
    ['pages/dashboard/dashboard.wxss', '.stat-scroll', '看板 → 统计弹窗滚动区'],
    ['pages/dashboard/dashboard.wxss', '.dt-scroll', '看板 → 明细弹窗滚动区']
  ];
  const bad = [];
  spots.forEach(([file, sel, why]) => {
    const hit = rulesOf(R(file)).filter((r) => tailClasses(r.sel).indexOf(sel.replace(/^\./, '')) >= 0)[0];
    if (!hit) { bad.push(file + ' ' + sel + '（找不到这个选择器）'); return; }
    if (auditDecl(hit.decl) !== 'ok') bad.push(file + ' ' + sel + '（' + why + '：留白仍没避开 tabBar）');
  });
  equal(bad.join(' ｜ '), '', '★ 这几处是"会被底栏压住"的实锤位置，改回去就是让用户再看见一次');

  // 白名单必须还活着（防止名单里留着早被删掉的选择器，日后看着像"已处理"）
  ALLOW.forEach((a) => {
    ok(R(a.file).indexOf(a.sel) >= 0, '白名单里的 ' + a.sel + ' 在 ' + a.file + ' 里已不存在，请删掉这条（并确认它的理由仍成立）');
  });
});

test('⑤ 反例：这套判据不该误伤"本来就不贴底"的东西', () => {
  // 顶部固定带 / 顶边吸附的筛选面板：不贴底 ⇒ 不需要避开 tabBar
  equal(auditDecl('position: fixed; left: 0; right: 0; top: 0; z-index: 40;'), 'skip',
    '顶部固定带不该被要求写 --tabbar-h');
  equal(auditDecl('position: absolute; top: 0; left: 0; right: 0; max-height: 80vh;'), 'skip',
    '顶边吸附的筛选面板（物料库排序 / 作品集筛选）同样不该被要求');
  // 居中弹窗（有 20vh 上抬避让键盘）：底部不贴屏幕底
  equal(auditDecl('margin-bottom: 20vh;'), 'skip', '居中弹窗不该被算作贴底');
});
