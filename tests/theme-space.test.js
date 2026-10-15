// tests/theme-space.test.js —— V97 主题挂在手作空间上（换大类 = 换外观）
//
// 这一层盯的是「主题**真的存住、真的按大类隔离、真的会刷新**」——
// 光有 themes.js 的纯函数测试证明不了这些（V83 的教训：源码守卫全绿 ≠ 真机对）。
const { test, group, ok, equal } = require('./harness.js');
const F = require('./fixtures.js');
const store = require('../utils/store.js');
const themes = require('../utils/themes.js');
const state = require('../services/state.js');
const { loadPage } = require('./page-helper.js');
const stub = require('./wx-stub.js');            // 要断言「导航栏真的被设了」
const themePage = require('../utils/theme-page.js');

// 假的页面对象：apply() 只要求 setData；getTabBar 可选（tabBar 页才有）
function fakePage(tabBar) {
  return {
    data: {},
    setData(o) { Object.keys(o).forEach((k) => { this.data[k] = o[k]; }); },
    getTabBar: tabBar ? function () { return tabBar; } : undefined
  };
}

group('V97 主题挂在手作空间上');

test('① 大类没有 theme 字段 → 读出来是默认主题（这就是"不需要数据迁移"）', () => {
  F.reset();
  const bc = store.addBusinessCategory('测试空间');
  equal(bc.theme, undefined, '新建时不写 theme —— 保持"缺字段 = 默认主题"这唯一一条口径');
  equal(store.getBusinessCategoryTheme(bc.id), themes.DEFAULT, '老数据/新数据读出来都该是默认主题');
});

test('② 设置后读得回来；设成不存在的主题会兜底回默认（坏值不留在数据里）', () => {
  F.reset();
  const bc = store.addBusinessCategory('A');
  equal(store.setBusinessCategoryTheme(bc.id, 'retroTin'), true, '第一次设置应生效');
  equal(store.getBusinessCategoryTheme(bc.id), 'retroTin');
  store.setBusinessCategoryTheme(bc.id, '不存在的主题');
  equal(store.getBusinessCategoryTheme(bc.id), themes.DEFAULT,
    '坏值必须回默认 —— 否则渲染时取不到 token（微信里是静默失效）');
});

test('③ 重复设置同一个值 → 返回 false（不做无意义的写盘 + 广播）', () => {
  F.reset();
  const bc = store.addBusinessCategory('A');
  store.setBusinessCategoryTheme(bc.id, 'retroTin');
  equal(store.setBusinessCategoryTheme(bc.id, 'retroTin'), false);
});

test('④ currentTheme 跟着当前空间走（这才是"换大类 = 换外观"）', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  const b = store.addBusinessCategory('B');
  store.setBusinessCategoryTheme(a.id, 'seaSaltFoam');
  store.setBusinessCategoryTheme(b.id, 'retroTin');
  state.init(a.id);
  equal(store.currentTheme(), 'seaSaltFoam', 'A 空间用自己的主题');
  state.init(b.id);
  equal(store.currentTheme(), 'retroTin', 'B 空间用自己的主题');
});

test('⑤ 主题广播**必须含栈顶**（只改主题时，发起页就是栈顶）', () => {
  F.reset();
  const calls = [];
  const fakePages = [
    { onShow() { calls.push('栈顶'); } },
    { onShow() { calls.push('底下'); } }
  ];
  const orig = global.getCurrentPages;
  global.getCurrentPages = () => fakePages;
  try {
    state.notifyTheme();
    equal(calls.length, 2, '两个页面都要收到通知，实际收到：' + calls.join('/'));
    ok(calls.indexOf('栈顶') >= 0,
      '★ 栈顶必须收到 —— 用户点完主题若本页自己不换色，看着就像"没生效"。' +
      '（2026-10-04 起，切空间的那条广播也统一成"含栈顶"了：老口径排除栈顶、' +
      '理由是"栈顶自己会 reload"，但那个 reload 只刷数据不刷主题 —— 见 D148。）');
  } finally { global.getCurrentPages = orig; }
});

test('⑥ 页面级：在「手作空间管理」选主题 → 真的存进去', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  const b = store.addBusinessCategory('B');
  state.init(a.id);
  const page = loadPage('../pages/settings/categories.js');
  page.onShow();
  equal(page.data.themes.length, 6, '选择弹层里要有 6 套');

  page.pickTheme({ currentTarget: { dataset: { id: b.id } } });
  equal(page.data.themeFor, b.id, '弹层要记住"正在给哪个大类选"');
  equal(page.data.pickedTheme, themes.DEFAULT, '打开时高亮的是它当前的主题');

  page.chooseTheme({ currentTarget: { dataset: { key: 'retroTin' } } });
  equal(store.getBusinessCategoryTheme(b.id), 'retroTin', '选完必须落盘');
  equal(page.data.pickedTheme, 'retroTin', '选中态要跟着走');
});

test('⑦ ★ 只改被选中的那个大类 —— 其余大类**一个字都不能动**', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  const b = store.addBusinessCategory('B');
  store.setBusinessCategoryTheme(a.id, 'seaSaltFoam');
  state.init(a.id);
  const page = loadPage('../pages/settings/categories.js');
  page.onShow();

  page.pickTheme({ currentTarget: { dataset: { id: b.id } } });
  page.chooseTheme({ currentTarget: { dataset: { key: 'retroTin' } } });

  equal(store.getBusinessCategoryTheme(b.id), 'retroTin', '被选中的那个改对了');
  equal(store.getBusinessCategoryTheme(a.id), 'seaSaltFoam',
    '★ 没被选的那个必须原封不动（只验"改对了"抓不住"顺手把别的也改了"）');
});

test('⑧ 页面级：换完主题 themeStyle **立刻**跟着变（不是"存了但没刷"）', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  state.init(a.id);
  const page = loadPage('../pages/settings/categories.js');
  page.onShow();
  const before = page.data.themeStyle;
  ok(before && before.indexOf(themes.get(themes.DEFAULT).primary) >= 0,
    '进页面就该带上当前主题的变量，实际：' + before);

  page.pickTheme({ currentTarget: { dataset: { id: a.id } } });
  page.chooseTheme({ currentTarget: { dataset: { key: 'retroTin' } } });
  ok(page.data.themeStyle !== before, 'themeStyle 必须变');
  ok(page.data.themeStyle.indexOf(themes.get('retroTin').primary) >= 0,
    '新的 themeStyle 里要有「铁皮饼干盒」的主色');
  ok(page.data.themeStyle.indexOf('--color-accent') >= 0, 'accent 也要一起给（13 个 token 全给）');
});

// ---------------------------------------------------------------
// 2026-10-03（V98）用户真机反馈：
//   「换成姜饼小熊仁怎么还混着别的主题 你能不能行 换主题就要整个都换啊」
// 截图取证（取真实像素，不靠肉眼）：页面主体是姜饼（#deb075），
//   但底部 tabBar 与「快速记录」面板是 #f8819b（玫瑰可露丽的主色）
//   ⇒ tabBar **整条没跟着换**。它的两个色都是模块加载那一刻的快照。
// ---------------------------------------------------------------

test('⑨ ★ apply() 必须顺手把 tabBar 也刷一遍（它是独立组件树，够不着页面栈）', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  store.setBusinessCategoryTheme(a.id, 'retroTin');
  state.init(a.id);
  const got = [];
  const tb = { applyTheme(t) { got.push(t); } };
  themePage.apply(fakePage(tb));

  equal(got.length, 1, '★ 页面 onShow 时要把主题推给 tabBar');
  equal(got[0].primary, themes.get('retroTin').primary,
    '推过去的必须是**当前**主题 —— 真机表现就是"页面换了、底部还是上一个主题的颜色"');
  equal(got[0]['primary-soft'], themes.get('retroTin')['primary-soft'], '软底也要一起（快速记录面板用的就是它）');
});

test('⑩ ★ 导航栏缓存必须按**页面**记（每个页面的导航栏都从 app.json 的初始值起步）', () => {
  F.reset();
  const a = store.addBusinessCategory('A');
  store.setBusinessCategoryTheme(a.id, 'retroTin');
  state.init(a.id);
  stub.navBars.length = 0;

  const p1 = fakePage(null), p2 = fakePage(null);
  // 显式控制页面栈：这一条不该依赖"别的测试文件有没有把全局桩漏下来"
  const orig = global.getCurrentPages;
  try {
    global.getCurrentPages = () => [];        // 空栈 → 判断不了就当"在屏幕上"
    themePage.apply(p1);
    themePage.apply(p2);
    equal(stub.navBars.length, 2,
      '★ 两个页面各要设一次 —— 用模块级缓存的话，第 2 个页面会以为"设过了"而跳过，' +
      '它的导航栏就永远停在 app.json 的暖陶土色（真机截图里 管理页 顶上就是 #FAF6F0）');
    equal(stub.navBars[1].backgroundColor, themes.get('retroTin').bg, '设的要是当前主题的底色');

    themePage.apply(p1);
    equal(stub.navBars.length, 2, '同一个页面重复 apply → 不必再打原生调用（缓存的初衷仍然保留）');
  } finally { global.getCurrentPages = orig; }
});

test('⑪ ★ 主题读不到时 style 也不许为空（留空 = 13 个变量全丢 → 整页无色）', () => {
  F.reset();
  const orig = store.currentTheme;
  store.currentTheme = () => { throw new Error('storage 读挂了'); };
  try {
    const style = themePage.apply(fakePage(null));
    ok(style && style.indexOf('--color-primary') >= 0,
      '★ 取不到主题要兜到**默认主题的完整变量串**。留空串不是"用 app.wxss 的默认值"：' +
      'app.wxss 里写的是自引用（--color-primary: var(--color-primary)），空串会让整页没有颜色');
    ok(style.indexOf('--color-divider') >= 0 && style.indexOf('--color-accent') >= 0, '13 个变量一个都不能少');
  } finally { store.currentTheme = orig; }
});

test('⑫ ★ 广播叫醒"被盖住的页面"时，不许去设导航栏、更不许记缓存', () => {
  // 2026-10-03 真机（用户截图）：换成绿色主题后，页面主体是绿的、**顶上一整条还是玫瑰的粉**。
  // 根因：state.notifyTheme() 会把栈里**所有**页面都叫起来跑 apply（含盖在下面的），
  // 对看不见的页面调 setNavigationBarColor **不生效**，可缓存先记下了"设过了" ⇒
  // 等它真正回到屏幕时那一次被跳过 ⇒ 导航栏永远停在旧主题色。
  F.reset();
  const a = store.addBusinessCategory('A');
  store.setBusinessCategoryTheme(a.id, 'retroTin');
  state.init(a.id);
  stub.navBars.length = 0;

  const top = fakePage(null), hidden = fakePage(null);
  const orig = global.getCurrentPages;
  try {
    global.getCurrentPages = () => [hidden, top];        // hidden 在下面，top 在栈顶
    themePage.apply(hidden);
    equal(stub.navBars.length, 0, '★ 被盖住的页面不许去设导航栏（设了不生效，还会把缓存记脏）');
    equal(hidden.__navBg, undefined, '没生效的不许记成"设过了"');

    themePage.apply(top);
    equal(stub.navBars.length, 1, '栈顶这一页要正常设');
    equal(stub.navBars[0].backgroundColor, themes.get('retroTin').bg);

    global.getCurrentPages = () => [top, hidden];        // hidden 回到栈顶
    themePage.apply(hidden);
    equal(stub.navBars.length, 2, '★ 回到屏幕时必须补设 —— 这就是"顶上那条不跟着换"的修法');
  } finally { global.getCurrentPages = orig; }
});

test('⑬ ★ 切空间后，**当前页**的主题必须跟着变（D148 的对称守卫）', () => {
  // 用户原话：「点不同的空间时，当前的页面没有办法换到新的主题，只有切换到别的界面才能刷新」。
  // 根因：broadcast() **排除栈顶**（老约定"栈顶自己会 reload"）—— 而那只刷新了**数据**、
  //   没刷**主题**；主题挂在 onShow 里的 themePage.apply()，reload() 不触发 onShow。
  // ⇒ 这条把"用户在栈顶点胶囊"这个真实场景整条走一遍：
  //   栈里**只有它自己**（tab 页的真实情形）→ 广播必须叫到它 → 它的主题必须已经是新的。
  F.reset();
  const a = store.addBusinessCategory('A');
  const b = store.addBusinessCategory('B');
  store.setBusinessCategoryTheme(b.id, 'retroTin');
  state.init(a.id);

  // 模拟一个"会响应广播"的页面（onShow 里做全套：刷主题 + 刷数据）
  let shown = 0;
  const top = {
    data: {},
    setData(o) { Object.keys(o).forEach((k) => { this.data[k] = o[k]; }); },
    onShow() { shown++; themePage.apply(this); }
  };
  const orig = global.getCurrentPages;
  try {
    global.getCurrentPages = () => [top];        // ★ 单页栈：tab 页的真实情形
    state.setCurrentSpace(b.id);
    equal(shown, 1,
      '★ 栈顶必须收到广播 —— 老写法在单页栈里一次都不通知，这正是 bug 的根');
    ok(top.data.themeStyle && top.data.themeStyle.indexOf(themes.get('retroTin').primary) >= 0,
      '★ 收到广播后当前页的主题必须**已经是新空间的** —— 用户报的"点了没反应、' +
      '切走再回来才对"就是这一步没走到');
  } finally { global.getCurrentPages = orig; }
});
