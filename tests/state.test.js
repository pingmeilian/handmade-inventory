// 状态层测试：全局手作空间 + 广播（Day 3 任务 3.1）
const state = require('../services/state.js');
const { group, test, ok, equal, near } = require('./harness.js');

// 让 store 也加载进来（验证 currentSpace 跟随）
const store = require('../utils/store.js');

group('state · 基本行为');

test('初始为 bc_default（与改造前冷启动行为一致）', () => {
  state.reset();
  equal(state.getCurrentSpace(), 'bc_default');
  equal(store.currentSpace(), 'bc_default', 'store.currentSpace 跟随状态层');
});

test('切换生效且 store 同步跟随', () => {
  state.reset();
  state.setCurrentSpace('bc_2');
  equal(state.getCurrentSpace(), 'bc_2');
  equal(store.currentSpace(), 'bc_2');
});

test('同值重复设置：不广播，返回 false', () => {
  state.reset();
  let calls = 0;
  state.subscribe(() => calls++);
  state.setCurrentSpace('bc_1');
  equal(calls, 1);
  ok(state.setCurrentSpace('bc_1') === false, '同值返回 false');
  equal(calls, 1, '同值不重复广播');
});

test('非法 id（空串/undefined）被拒绝', () => {
  state.reset();
  ok(state.setCurrentSpace('') === false);
  ok(state.setCurrentSpace(undefined) === false);
  equal(state.getCurrentSpace(), 'bc_default');
});

group('state · 广播（跨页立即同步的核心）');

test('★ 栈内**所有**页面 onShow 都被立即调用（含栈顶）', () => {
  // 2026-10-04 修正（D148）：原先这条断言的是 `A,B` —— 即"栈顶被排除"。
  // 那条老约定（"栈顶是发起页、**它自己会 reload**"）漏了一半：
  //   **reload 刷数据、不刷主题** ⇒ 用户在栈顶点空间胶囊时，数据换了、颜色没变
  //   （要切走再回来才对）。现在与 notifyTheme 口径统一：**栈里每一页都要通知**。
  state.reset();
  const calls = [];
  global.getCurrentPages = () => [
    { onShow() { calls.push('A'); } },
    { onShow() { calls.push('B'); } },
    { onShow() { calls.push('C-top'); } }
  ];
  state.setCurrentSpace('bc_x');
  equal(calls.join(','), 'A,B,C-top',
    '★ 栈顶也必须收到 —— 否则当前页的主题不会跟着变（用户报的就是这个）');

  // 注入法自检：老写法（排除栈顶）在**单页栈**（tab 页的真实情形）里一个人都不通知
  const oldCount = (n) => { let c = 0; for (let i = 0; i < n - 1; i++) c++; return c; };
  ok(oldCount(1) === 0, '自检失败：旧写法在单页栈里应该一次都不通知 —— 这条守卫才有牙');
});

test('页面自定义 onSpaceChange 优先于 onShow', () => {
  state.reset();
  const calls = [];
  global.getCurrentPages = () => [
    { onSpaceChange() { calls.push('hook'); }, onShow() { calls.push('onshow'); } },
    {}
  ];
  state.setCurrentSpace('bc_y');
  equal(calls.join(','), 'hook');
});

test('某个页面刷新抛错不影响其他页面', () => {
  state.reset();
  const calls = [];
  global.getCurrentPages = () => [
    { onShow() { throw new Error('这页坏了'); } },
    { onShow() { calls.push('B-OK'); } },
    {}
  ];
  state.setCurrentSpace('bc_z');   // 不应向外抛
  equal(calls.join(','), 'B-OK');
});

test('subscribe 返回取消函数', () => {
  state.reset();
  let calls = 0;
  const off = state.subscribe(() => calls++);
  state.setCurrentSpace('bc_a');
  off();
  state.setCurrentSpace('bc_b');
  equal(calls, 1, '取消后不再收到通知');
});

test('订阅者抛错不影响其他订阅者与状态', () => {
  state.reset();
  let okCalls = 0;
  state.subscribe(() => { throw new Error('坏订阅者'); });
  state.subscribe(() => okCalls++);
  state.setCurrentSpace('bc_c');
  equal(okCalls, 1);
  equal(state.getCurrentSpace(), 'bc_c');
});

test('init 不触发广播', () => {
  state.reset();
  let calls = 0;
  state.subscribe(() => calls++);
  state.init('bc_init');
  equal(calls, 0);
  equal(state.getCurrentSpace(), 'bc_init');
});

// 还原 stub 默认
global.getCurrentPages = () => [];

group('util.navTo · 页面栈满兜底');

const util = require('../utils/util.js');

test('栈未满：正常走 navigateTo', () => {
  let nav = 0, redir = 0;
  global.getCurrentPages = () => [ {}, {} ];
  global.wx.redirectTo = () => { redir++; };
  global.wx.navigateTo = () => { nav++; };
  util.navTo({ url: '/pages/x/x' });
  equal(nav, 1, 'navigateTo 被调用');
  equal(redir, 0, 'redirectTo 不应被调用');
});

test('栈满 10 层：自动降级 redirectTo，不再静默失败', () => {
  let nav = 0, redir = 0;
  global.getCurrentPages = () => new Array(10).fill({});
  global.wx.navigateTo = () => { nav++; };
  global.wx.redirectTo = () => { redir++; };
  util.navTo({ url: '/pages/x/x' });
  equal(nav, 0, '栈满时不走 navigateTo（会静默失败）');
  equal(redir, 1, '改走 redirectTo（必有响应）');
});

// ⚠️ 收尾必须把**全局桩**还原：这一文件把 getCurrentPages 换成了各种假页面栈，
//    漏出去会让后面的测试文件拿到一个"假的、非空"的栈 ——
//    2026-10-03 就被撞到过：主题测试里「这一页是不是在屏幕上」的判断因此恒为假，
//    导航栏断言莫名变红，查了半天才发现是这里漏的。
//    （教训：**全局桩用完要还原**，否则下一个人会以为是自己的 bug。）
test('收尾：还原页面栈桩（别把假栈漏给后面的测试文件）', () => {
  global.getCurrentPages = () => [];
  equal((global.getCurrentPages() || []).length, 0, '页面栈桩已还原成空栈');
});
