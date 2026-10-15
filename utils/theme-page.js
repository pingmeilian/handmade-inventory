// utils/theme-page.js —— 页面接主题的统一入口（V97 · V98 修「只换了一半」）
//
// V141：这个入口顺手多管一件事 —— 注入 `--tabbar-h`（"这一页的底部禁区"）。
//   为什么放这儿：**只有它知道"这一页有没有 tabBar"**（applyTabBar 一直在用同一个判据），
//   而贴底元素必须避开 tabBar 那一条（自定义 tabBar 永远画在页面之上）。
//   详见下面 tabbarStyle 上方的注释。
//
// 一个页面只需要两件事：
//   ① wxml 首行加 <page-meta page-style="{{themeStyle}}"></page-meta>
//   ② js 的 onShow 里调 themePage.apply(this)
//
// 为什么要统一入口：如果每个页面各写各的（各自 require themes + store + 拼字符串），
// 迟早有人写错变量名或漏掉某几个 token —— 那在微信里是**静默失效**（不报错、只是颜色不对），
// 而"90% 换了"比"完全没换"更难发现。
//
// ⚠️ 为什么用 page-meta 的 page-style：变量落在**页面根节点**上，
//    所有后代（含 fixed 弹层）自然继承，不用关心包裹层级。
//    dashboard 的 page-meta 已用于「弹层时锁滚动」—— 那边需要**合并**样式，见其注释。
//
// 这一版（V98）把"换主题只换了一半"的三个漏口一起堵上：
//   ① **tabBar**：它是独立组件树，够不着页面栈 ⇒ 由页面 onShow 顺手推一次（见 applyTabBar）
//   ② **导航栏**：缓存原来挂在模块上（跨页面共享）⇒ 改成挂在**页面实例**上（见 applyNav）
//   ③ **空 style**：主题读挂时原来留空串 —— 那不是"用默认值"，是 13 个变量全丢（见 apply）
//
// 用户的原话是「换成姜饼小熊仁怎么还混着别的主题 你能不能行 换主题就要整个都换啊」。

const themes = require('./themes.js');
const store = require('./store.js');
const state = require('../services/state.js');

// 这一页此刻是不是"真的在屏幕上"（页面栈顶）。
//
// 为什么必须判断：主题广播（state.notifyTheme）会把**栈里所有页面**都叫起来重跑 apply ——
// 包括被盖在下面的页面。对看不见的页面调 setNavigationBarColor **不生效**，
// 而缓存一旦记下"设过了"，等它真正回到屏幕时那一次就会被跳过 ⇒
// 那条导航栏永远停在旧主题色（2026-10-03 真机：页面是绿的、顶上一整条还是玫瑰的粉）。
function isShownPage(page) {
  try {
    if (typeof getCurrentPages !== 'function') return true;
    const pages = getCurrentPages() || [];
    if (!pages.length) return true;                 // 拿不到栈（测试 / 异常）就不拦
    return pages[pages.length - 1] === page;
  } catch (e) { return true; }
}

// 设这一页的导航栏底色。颜色写在 app.json 里（打包时定死、运行时改不了），
// 只能靠 wx.setNavigationBarColor 动态设 —— 所以这件事必须在**每一页**都做一次。
//
// ⚠️ 缓存挂在**页面实例**上（page.__navBg），不能用模块级变量：
//    每个页面的导航栏都从 app.json 的初始值起步，模块级缓存会让"第二个页面"以为设过了
//    而跳过 ⇒ 它的导航栏永远停在 app.json 的暖陶土色。
// ⚠️ 而且**只有真的显示着才设**、**只有成功了才记**（见上面的 isShownPage 与 fail 回调）：
//    "记了但没设上"比"没记"更糟 —— 它会让后面每一次都跳过。
function applyNav(page, tokens, theme) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setNavigationBarColor !== 'function') return;
    // ⭐ 顶部有背景拼色的主题（bgSplit.side==='top'，V114a）：导航栏底色跟**色带**，
    //    不跟页面底 —— 色带含状态栏区（设计稿如此），导航栏还停在 --color-bg 就会
    //    "导航栏米黄 + 页面顶粉"断成两截（常驻元素配套教训第 4 次，同 tabBar/导航栏前三次）。
    //    它仍然只是**颜色**：换的是 setNavigationBarColor 的入参，没有任何结构改动。
    // V116：拼色改由顶部固定带承担（.pin-band 走 --color-band），导航栏跟它同色 ——
    //   否则导航栏米黄 + 固定带粉，会断成两截（常驻元素配套教训第 4 次）。
    const splitColor = theme && theme.bgSplit ? theme.bgSplit.color : null;
    const bg = splitColor || (tokens && tokens.bg);
    if (!bg || !isShownPage(page) || page.__navBg === bg) return;
    page.__navBg = bg;
    wx.setNavigationBarColor({
      // 浅色主题 → 黑字。微信只认 '#000000' / '#ffffff' 两个值。
      frontColor: '#000000',
      backgroundColor: bg,
      animation: { duration: 0, timingFunc: 'linear' },
      // 失败要撤掉缓存，否则永远不会重试（"设过了"其实是没生效）
      fail: () => { if (page.__navBg === bg) page.__navBg = ''; }
    });
  } catch (e) {
    page.__navBg = '';      // 抛异常同理：别把失败记成成功
  }
}

// 这一页有没有底部导航栏。
// 判定口径与 applyTabBar 完全一致：**只有 tab 页才有 getTabBar()** ——
// 两处共用一个函数，免得"是不是 tab 页"这件事有两个版本。
function hasTabBar(page) {
  try { return !!page && typeof page.getTabBar === 'function'; } catch (e) { return false; }
}

/* ---------- 底部导航栏高度：贴底元素必须避开的"禁区"（V141） ----------
   用户报（真机截图）：看板 → 趋势曲线 →「自定义」→ 选日期的弹层，"底下的确定按钮被挡住了"。

   根因：自定义 tabBar 是**独立组件树**，它永远画在页面内容之上（页面的 z-index 抬不过它）。
   所以凡是要贴到屏幕底部的元素（弹层 / 底部操作栏 / 列表末行），
   底部留白必须**同时**避开两块：安全区 + tabBar 那一条（110rpx）。
   而项目里原先各处只写了 `env(safe-area-inset-bottom)` ⇒ **在 4 个 tab 页上都会被压一截**。

   为什么做成「页面注入的 CSS 变量」而不是每个弹层自己写 110rpx：
     组件**不知道自己在哪一页**，而同一个弹层组件可能同时被 tab 页（看板）和
     非 tab 页（物料出入库 / 成品出入库）用着 ⇒ 写死 110rpx 会让非 tab 页凭空多出一截空白。
     页面注入 + 组件消费，两边都不用各写一套（变量本来就穿透进自定义组件 —— 主题色就是这么用的）。

   ⚠️ 这个数字与 `custom-tab-bar/index.wxss` 里 `.tabbar` 的 height **必须一致**，
      守卫 tests/guard-tabbar-overlap.test.js 盯着这两个数（改一处不改另一处就红）。
   ⚠️ 变量只含「导航栏本身」，**不含安全区** —— 各处原有的 `env(safe-area-inset-bottom)`
      一律保留，免得安全区被算两遍。非 tab 页给 0px ⇒ 那些页面视觉零变化。 */
const TABBAR_H_RPX = 110;

function tabbarStyle(page) {
  return hasTabBar(page) ? ('--tabbar-h: ' + TABBAR_H_RPX + 'rpx;') : '--tabbar-h: 0px;';
}

// 把主题推给这一页的 tabBar。
//
// 为什么不能让 tabBar 自己刷：它是**独立组件树** ——
//   · 不在 getCurrentPages() 里 ⇒ state.notifyTheme() 的广播够不着它
//   · 组件自己的 pageLifetimes.show 在真机上不可靠（用户实测：底部整条还是上一个主题的颜色）
// 而"页面 → getTabBar()"这条路是通的：各 tab 页本来就在 onShow 里用它设选中态。
function applyTabBar(page, tokens) {
  try {
    if (!hasTabBar(page)) return;                       // 非 tab 页没有 tabBar，正常
    const tb = page.getTabBar();
    if (tb && typeof tb.applyTheme === 'function') tb.applyTheme(tokens);
  } catch (e) {
    // tabBar 换色失败不能拖垮页面刷新（它会停在上一套色，但页面本身是对的）
  }
}

// 把当前主题的 CSS 变量写进页面 data（wxml 的 page-meta 读它），并同步原生导航栏与 tabBar。
// 返回 style 串（便于测试与调试）。
function apply(page) {
  if (!page || typeof page.setData !== 'function') return '';
  // 主题 key 读不到（storage 异常等）不往外抛，交给 styleOf/get 兜底到默认主题。
  // ⚠️ **绝不能留空串**：app.wxss 里写的是自引用（--color-primary: var(--color-primary)），
  //    留空不是"用 app.wxss 的默认值"，而是 13 个变量一起丢 —— 整页没颜色，比"用错主题"更糟。
  let key = null;
  try { key = store.currentTheme(); } catch (e) { key = null; }
  if (!themes.has(key)) key = themes.DEFAULT;      // 存坏了 / 老数据 → 默认主题
  // V141：主题色 + 「这一页的底部禁区」一起给（同一个注入点，页面不用管两件事）
  const style = themes.styleOf(key) + ' ' + tabbarStyle(page);
  const tokens = themes.get(key);

  try { page.setData({ themeStyle: style }); } catch (e) { /* 页面已销毁等场景，忽略 */ }
  applyNav(page, tokens, themes.has(key) ? themes.THEMES[key] : null);
  applyTabBar(page, tokens);
  // 把当前主题同步进全局状态：底层工具（util 的弹窗确认色、图表）要读它，
  // 而它们不能直接 require store（会形成 util ← store 循环依赖）。
  try { state.setTheme(key); } catch (e) { /* 忽略 */ }
  return style;
}

// showModal 的确认按钮色：跟随主题（原先 7 处写死成暖陶土色 —— 弹窗不跟主题变，
// 是那种"说不出哪里怪但就是怪"的脏）。
function modalColor() {
  return tokens().primary;
}

// 当前主题的 token 对象（画布 / 图表等 JS 里必须拿到**色值**、不能用 CSS 变量的地方）
function tokens() {
  try { return themes.get(state.getTheme()); } catch (e) { return themes.get(themes.DEFAULT); }
}

module.exports = { apply, modalColor, tokens, TABBAR_H_RPX, hasTabBar };
