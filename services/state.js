// services/state.js —— 全局状态层（Day 3 任务 3.1）
//
// 职责：持有「当前手作空间」这唯一的全局状态，并在它变化时广播通知。
//
// 背景（为什么要有这个文件）：
//   之前这个状态存在 app.globalData.currentCategoryId 里，页面只在 onShow 时读一次。
//   结果就是用户在 A 页切换了大类，栈里的 B 页毫无察觉，要等用户退回 B 页才更新
//   —— 这就是「数据不同步」的根源。
//
// 行为约定（与改造前完全一致的部分）：
//   - 内存态，不持久化：冷启动重置为 'bc_default'（与原 globalData 行为相同）
//   - 恒为单个真实空间 id，绝不为 'all'

let currentSpaceId = 'bc_default';
const listeners = [];
// 当前手作空间的主题 key（V97）。
// 为什么放在这里：主题是**全局状态**（跟「当前空间」同一个层级），而且底层工具
// （utils/util.js 的弹窗确认色、图表工具）也要用它 —— 那些地方不能直接 require
// store（会形成 util ← store 的循环依赖），所以由 theme-page 每次 apply 时同步进来。
// 取不到时返回 null，调用方一律用 themes.get(null) 兜底到默认主题。
let themeKey = null;

function getCurrentSpace() {
  return currentSpaceId;
}

// 初始化（app.onLaunch 校验完有效性后调用）。不发广播。
function init(id) {
  if (id) currentSpaceId = id;
  themeKey = null;   // 换了空间 -> 缓存的主题作废，等页面 apply 时重新同步
}

// 切换手作空间。同值时静默返回 false；变化时广播并返回 true。
//
// 广播策略：通知栈内**所有**页面（含栈顶 —— 2026-10-04 修正，见 broadcast() 里的说明）。
// 优先调用页面自定义的 onSpaceChange，没有就退回 onShow，都 try/catch 包住
// —— 广播是「尽力而为」，任何一个页面刷新失败不能影响其他页面。
function setCurrentSpace(id) {
  if (!id || id === currentSpaceId) return false;
  currentSpaceId = id;
  broadcast();
  return true;
}

function broadcast() {
  let pages = [];
  try { pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []; } catch (e) { pages = []; }
  // ⚠️ 循环**包含栈顶**（`i < pages.length`，不是 `length - 1`）。
  //
  // 2026-10-04 修正（用户报的 bug：D148）：原写法排除栈顶，注释里的理由是
  //   "栈顶是发起切换的页面、**它自己会 reload**" —— 但那个 reload 只刷了**数据**，
  //   而**主题**挂在 onShow 里的 `themePage.apply()`，`reload()` 并不会触发 onShow
  //   ⇒ 在栈顶点空间胶囊时：**数据换了、颜色没换**，得切走再回来才对。
  // ⚠️ 还有个更隐蔽的退化情形：看板是 **tab 页**，微信里 tab 之间不叠栈
  //   ⇒ `getCurrentPages()` 里往往**只有它自己** ⇒ `length - 1 = 0` ⇒ **一个都不通知**。
  // ⇒ 现在与 notifyTheme() 口径统一：**只要"空间/外观"变了，栈里每一页都要收到**；
  //   同时发起页**自己也该显式刷一遍**作为保底（广播是"尽力而为"——拿不到页面栈时
  //   一个人都不通知）。两边都做，宁可多刷一次、不要漏。
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const fn = (typeof p.onSpaceChange === 'function') ? p.onSpaceChange
             : (typeof p.onShow === 'function') ? p.onShow : null;
    if (!fn) continue;
    try { fn.call(p); } catch (e) {
      console.error('[state] 广播刷新页面失败', e);
    }
  }
  // 模块级订阅者（非页面场景，如未来的组件/服务）
  listeners.forEach((fn) => {
    try { fn(currentSpaceId); } catch (e) { console.error('[state] 订阅者异常', e); }
  });
}

// 非页面订阅入口。返回取消订阅函数。
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// 主题变化：通知**所有**页面（含栈顶）。
//
// 为什么单独一条、不复用 broadcast()：**语义不同** ——
//   broadcast 说的是"空间换了"，这里说的是"外观（主题）换了"。
//   （2026-10-04 之前两者的口径也不同：broadcast 排除栈顶，理由是"栈顶自己会 reload"；
//     那次修正后已统一为"都含栈顶"—— 因为"自己 reload"只刷数据、不刷主题。）
//
// 调用哪个方法：优先页面的 onThemeChange，没有就退回 onShow
// （页面在 onShow 里统一调 utils/theme-page.js 的 apply —— 两条路都通）。
// 依旧是"尽力而为"：任何一个页面失败不能影响其他页面，也不能影响主题本身已保存的事实。
function notifyTheme() {
  let pages = [];
  try { pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []; } catch (e) { pages = []; }
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const fn = (typeof p.onThemeChange === 'function') ? p.onThemeChange
             : (typeof p.onShow === 'function') ? p.onShow : null;
    if (!fn) continue;
    try { fn.call(p); } catch (e) { console.error('[state] 主题广播刷新页面失败', e); }
  }
}

function getTheme() { return themeKey; }
function setTheme(key) { themeKey = key || null; }

// 测试专用：重置到初始态
function reset() {
  currentSpaceId = 'bc_default';
  themeKey = null;
  listeners.length = 0;
}

module.exports = { getCurrentSpace, setCurrentSpace, init, subscribe, reset, notifyTheme, getTheme, setTheme };
