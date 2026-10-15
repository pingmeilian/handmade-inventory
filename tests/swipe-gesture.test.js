// tests/swipe-gesture.test.js —— 左滑组件的「手势数学」
//
// 为什么单独测这些纯函数：跟手位移 / 阈值吸附 / 方向判定，全靠这几个式子。
// 它们在真机上出错的表现是「滑不动」「滑一半卡住」「方向反了」，肉眼很难定位到某一行；
// 但在纯函数层面可以穷举边界（NaN、超界、反向、RTL）。
const { test, group, ok, equal, near } = require('./harness.js');
require('./wx-stub.js');

const g = require('../components/swipe-cell/gesture.js');

group('左滑组件 · 手势纯函数');

// ---------- 轴向判定 ----------
test('轴向判定：位移不够（小于 slop）时不判定方向（避免手抖误判）', () => {
  equal(g.axisOf(0, 0, 8), null);
  equal(g.axisOf(3, 4, 8), null);
  equal(g.axisOf(-5, 5, 8), null);
});

test('轴向判定：横向分量更大 → h；纵向更大 → v（取绝对值比较）', () => {
  equal(g.axisOf(10, 4, 8), 'h');
  equal(g.axisOf(-10, 4, 8), 'h', '向左也是横向');
  equal(g.axisOf(4, 10, 8), 'v');
  equal(g.axisOf(4, -10, 8), 'v');
});

test('轴向判定：严格相等时不再硬判纵向 —— 势均力敌就"再等等"（宁可晚判，不可判错）', () => {
  equal(g.axisOf(20, 20, 8), null, '45° 斜滑：判哪边都是赌，继续等下一帧');
  equal(g.axisOf(30, 28, 8), null, '接近 45° 也要等它明确下来');
});

test('轴向判定：主轴要明显占优（1.2 倍）才下结论，避免"手指起点那点纵向漂移"被判成滚动', () => {
  equal(g.axisOf(20, 4, 8), 'h');
  equal(g.axisOf(20, 18, 8), null, '打得有来有回时不判');
  equal(g.axisOf(4, 20, 8), 'v');
});

test('轴向判定：非数字输入按 0 处理，不抛错', () => {
  equal(g.axisOf(undefined, undefined, 8), null);
  equal(g.axisOf(NaN, NaN, 8), null);
  equal(g.axisOf('30', 2, 8), 'h', '字符串数字可被 Number 化');
});

// ---------- 方向与符号（RTL 的核心） ----------
test('方向符号：left（左滑露出右侧操作区）→ -1；right（RTL）→ +1', () => {
  equal(g.signOf('left'), -1);
  equal(g.signOf('right'), 1);
  equal(g.signOf('乱填'), -1, '非法值兜底为 left，绝不返回 0 或 NaN');
  equal(g.signOf(undefined), -1);
});

test('方向解析：显式 left / right 原样返回', () => {
  equal(g.resolveDirection('left', 'ar'), 'left', '显式指定优先于语言');
  equal(g.resolveDirection('right', 'zh_CN'), 'right');
});

test('方向解析：auto 时按系统语言判 RTL（阿拉伯语/希伯来语等）', () => {
  equal(g.resolveDirection('auto', 'ar'), 'right');
  equal(g.resolveDirection('auto', 'ar-SA'), 'right');
  equal(g.resolveDirection('auto', 'he'), 'right');
  equal(g.resolveDirection('auto', 'zh_CN'), 'left');
  equal(g.resolveDirection('auto', 'en'), 'left');
  equal(g.resolveDirection('auto', 'AR_eg'), 'right', '大小写不敏感');
});

test('方向解析：auto 但语言拿不到时兜底 left（不能因为拿不到语言就反向）', () => {
  equal(g.resolveDirection('auto', ''), 'left');
  equal(g.resolveDirection('auto', undefined), 'left');
  equal(g.resolveDirection(undefined, 'ar'), 'left', 'direction 缺省是 left，不是 auto');
});

test('内容位移：方向只改符号，不改大小', () => {
  equal(g.contentX(100, 'left'), -100);
  equal(g.contentX(100, 'right'), 100);
  equal(g.contentX(0, 'left'), 0);
  equal(Math.abs(g.contentX(260, 'left')), Math.abs(g.contentX(260, 'right')));
});

// ---------- 跟手位移 ----------
test('跟手位移：从收合状态左滑，手指左移多少就位移多少（1:1 跟手）', () => {
  equal(g.dragTranslate(0, -50, -1, 260), 50);
  equal(g.dragTranslate(0, -200, -1, 260), 200);
});

test('跟手位移：反方向不位移（夹在 0，不会把卡片往反侧推）', () => {
  equal(g.dragTranslate(0, 80, -1, 260), 0);
  equal(g.dragTranslate(0, 0, -1, 260), 0);
});

test('跟手位移：超过操作区宽度就夹紧（不会把卡片滑出屏幕）', () => {
  equal(g.dragTranslate(0, -999, -1, 260), 260);
  equal(g.dragTranslate(0, -260, -1, 260), 260, '刚好到边界');
});

test('★ 跟手位移必须叠加「手势开始时的位移」：已展开时再往开的方向拖，应停在边界', () => {
  // 这是评审抓到的 Critical：只算本次 dx 的话，展开着（260）再左拖 8px，
  // 位移会从 260 掉到 8 —— 视觉上"跳回去"，几乎全关
  equal(g.dragTranslate(260, -8, -1, 260), 260, '已展开时继续往开的方向拖 → 停在 260');
  equal(g.dragTranslate(260, -100, -1, 260), 260);
});

test('★ 已展开时往回拖：位移跟着手指线性减少（跟手关闭）', () => {
  equal(g.dragTranslate(260, 50, -1, 260), 210);
  equal(g.dragTranslate(260, 130, -1, 260), 130);
  equal(g.dragTranslate(260, 260, -1, 260), 0);
  equal(g.dragTranslate(260, 400, -1, 260), 0, '拖过头也不会变负');
});

test('★ 半开状态下继续拖：从当前位移继续，不从 0 重来', () => {
  equal(g.dragTranslate(130, -50, -1, 260), 180, '半开 130，再左拖 50 → 180');
  equal(g.dragTranslate(130, 50, -1, 260), 80);
});

test('跟手位移：RTL 方向下右移为正位移', () => {
  equal(g.dragTranslate(0, 120, 1, 260), 120);
  equal(g.dragTranslate(0, -120, 1, 260), 0);
  equal(g.dragTranslate(260, 40, 1, 260), 260, 'RTL 下已展开时继续右拖也停在边界');
});

test('跟手位移：异常输入（NaN / 缺参）一律当作 0 位移，不把 NaN 传到样式里', () => {
  equal(g.dragTranslate(0, NaN, -1, 260), 0);
  equal(g.dragTranslate(0, undefined, -1, 260), 0);
  equal(g.dragTranslate(NaN, -100, -1, 260), 100, '起始位移是 NaN 时按 0 处理（关键是结果不能是 NaN）');
  ok(!Number.isNaN(g.dragTranslate(NaN, -100, -1, 260)));
  equal(g.dragTranslate(0, -100, -1, NaN), 0, '操作区宽度未知 → 不位移（而不是 NaN）');
  equal(g.dragTranslate(0, -100, -1, 0), 0);
});

// ---------- 松手吸附 ----------
test('松手吸附：位移超过「操作区宽度 × 阈值」→ 吸附到完全展开', () => {
  equal(g.snapTranslate(78, 260, 0.3), 260, '刚好到阈值（260×0.3=78）→ 展开');
  equal(g.snapTranslate(200, 260, 0.3), 260);
});

test('松手吸附：未超阈值 → 回弹到 0', () => {
  equal(g.snapTranslate(77, 260, 0.3), 0);
  equal(g.snapTranslate(1, 260, 0.3), 0);
  equal(g.snapTranslate(0, 260, 0.3), 0);
});

test('松手吸附：阈值缺省 0.3；非法阈值兜底 0.3（否则会变成"怎么滑都不开"）', () => {
  equal(g.DEFAULT_THRESHOLD, 0.3);
  equal(g.snapTranslate(78, 260, undefined), 260);
  equal(g.snapTranslate(78, 260, NaN), 260);
  equal(g.snapTranslate(78, 260, 0), 260, '阈值 0 是合法值（一碰就开），不该被当成缺省 0.3');
});

test('松手吸附：完全没动过就松手 → 永不展开（哪怕阈值配成 0）', () => {
  equal(g.snapTranslate(0, 260, 0), 0, '否则"点一下"会变成"展开"');
  equal(g.snapTranslate(0, 260, 0.3), 0);
  equal(g.snapTranslate(-5, 260, 0), 0, '非法负位移同样不展开');
});

// startedOpen：判定方向随"手势开始时是否已展开"而变 —— 对"想关掉"的人同样宽容
test('★ 从已展开状态开始的收势：往回拖过阈值比例就收合（不必拖到只剩 30%）', () => {
  equal(g.snapTranslate(260, 260, 0.3, true), 260, '没往回拖 → 保持展开');
  equal(g.snapTranslate(234, 260, 0.3, true), 260, '只拖回 10% → 保持展开');
  equal(g.snapTranslate(183, 260, 0.3, true), 260, '拖回 29.6%（不到阈值）→ 保持展开');
  equal(g.snapTranslate(182, 260, 0.3, true), 0, '拖回满 30%（78px）→ 收合（边界）');
  equal(g.snapTranslate(130, 260, 0.3, true), 0, '拖回一半 → 收合');
  equal(g.snapTranslate(0, 260, 0.3, true), 0);
});

test('从收合状态开始的张势：判定方向相反（拖开超过阈值才展开）', () => {
  equal(g.snapTranslate(78, 260, 0.3, false), 260);
  equal(g.snapTranslate(77, 260, 0.3, false), 0);
  equal(g.snapTranslate(78, 260, 0.3), 260, '不传就是 false');
});

test('松手吸附：操作区宽度为 0（没有操作项）→ 永远回弹 0', () => {
  equal(g.snapTranslate(100, 0, 0.3), 0);
  equal(g.snapTranslate(100, NaN, 0.3), 0);
});

// ---------- 操作区宽度（rpx → px） ----------
test('操作区宽度：4 个 130rpx 的按钮在 375px 屏上 = 260px', () => {
  const actions = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  equal(g.areaPxOf(actions, 130, 375), 260);
});

test('操作区宽度：支持每个操作项自定义宽度（rpx）', () => {
  const actions = [{ key: 'a', width: 100 }, { key: 'b', width: 200 }];
  equal(g.areaPxOf(actions, 130, 375), 150, '(100+200)×0.5 = 150');
});

test('操作区宽度：随屏幕宽度等比换算（小屏不会溢出）', () => {
  const actions = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  near(g.areaPxOf(actions, 130, 320), 221.87, 0.01, '520×320/750');
  near(g.areaPxOf(actions, 130, 414), 287.04, 0.01, '520×414/750');
});

test('操作区宽度：空 / 非法输入 → 0（页面据此跳过手势绑定）', () => {
  equal(g.areaPxOf([], 130, 375), 0);
  equal(g.areaPxOf(null, 130, 375), 0);
  equal(g.areaPxOf(undefined, 130, 375), 0);
  equal(g.areaPxOf([{ key: 'a' }], 130, undefined), 65, '拿不到窗口宽度时按 375 兜底');
  equal(g.areaPxOf([{ key: 'a', width: 0 }], 130, 375), 65, '非法宽度回落到默认宽度');
});

// ---------- 语言读取 ----------
test('语言读取：能拿到系统语言，且结果被缓存（不会每张卡片都同步问一次系统）', () => {
  g.clearCache();
  wx.__nextSystemInfo = { language: 'ar' };
  equal(g.systemLang(), 'ar');
  wx.__nextSystemInfo = { language: 'zh_CN' };
  equal(g.systemLang(), 'ar', '第二次读的是缓存（同一进程内语言不会变）');
  g.clearCache();
  equal(g.systemLang(), 'zh_CN', 'clearCache 后可重新读取（测试钩子）');
  g.clearCache();
});

test('窗宽读取：同样缓存（长列表里 N 张卡片只问系统一次）', () => {
  g.clearCache();
  equal(g.systemWindowWidth(), 375);
  wx.__nextSystemInfo = { windowWidth: 414 };
  equal(g.systemWindowWidth(), 375, '第二次读缓存');
  g.clearCache();
  equal(g.systemWindowWidth(), 414, '清缓存后能读到新值（页面 resize 时组件会清）');
  wx.__nextSystemInfo = null;
  g.clearCache();
});

test('窗宽读取：getSystemInfoSync 抛错时兜底 375，不打崩组件', () => {
  g.clearCache();
  const orig = wx.getSystemInfoSync;
  wx.getSystemInfoSync = function () { throw new Error('boom'); };
  try {
    equal(g.systemWindowWidth(), 375);
    equal(g.systemLang(), '');
  } finally {
    wx.getSystemInfoSync = orig;
    g.clearCache();
  }
});

test('语言读取：getSystemInfoSync 抛错时兜底空串，不把组件打崩', () => {
  g.clearCache();
  const orig = wx.getSystemInfoSync;
  wx.getSystemInfoSync = function () { throw new Error('boom'); };
  try {
    equal(g.systemLang(), '');
    equal(g.resolveDirection('auto', g.systemLang()), 'left');
  } finally {
    wx.getSystemInfoSync = orig;
    g.clearCache();
  }
});

test('常量：轴向阈值 10px（太小学生手抖就误判，太大滑不动）', () => {
  equal(g.AXIS_SLOP, 10);
});

// ===================== 真机"时灵时不灵"的四个根因（2026-09-14） =====================
// 现象：有时能划出来、有时刚划一点就缩回去、拖动过程也不跟手。
// 这里只测"手势数学"这一层；组件层的四条复现测试见 tests/swipe-cell.test.js 的同名分组。
group('左滑组件 · 手势稳定性（四个根因的数学部分）');

test('根因④ · 纠偏窗口：刚起手纵向漂移被判成滚动后，若很快变得明确横向 → 允许改判', () => {
  // 拇指起手常常先往下走几个像素（dy=12）→ 这一刻确实像"滚动"
  equal(g.axisOf(2, 12, 10), 'v');
  // 但紧接着横向明确占优、且纵向还很浅、时间也还在窗口内 → 应该能改判为横向，别把整串手势判死
  equal(g.canFixToHorizontal(-50, 16, 80), true, '横滑 50px、纵向才 16px、起手 80ms → 应纠偏');
  equal(g.canFixToHorizontal(-50, 16, 400), false, '超出时间窗口 → 不再纠偏（页面多半已经在滚了）');
  equal(g.canFixToHorizontal(-50, 40, 80), false, '纵向已经滚了 40px → 不再纠偏');
  equal(g.canFixToHorizontal(-14, 12, 80), false, '横向还没明显占优 → 不纠偏');
  equal(g.canFixToHorizontal(-50, 16, 0), true, '时间戳相同（同一帧）也算在窗口内');
});

test('根因⑤ · 甩动：速度能从采样算出来（正数=朝打开方向，负=朝收合方向）', () => {
  const s = [];
  g.pushSample(s, 0, 1000);
  g.pushSample(s, 30, 1016);
  g.pushSample(s, 60, 1032);
  near(g.velocityOf(s), 60 / 32, 0.01, '(60-0)/(1032-1000)');
  const back = [];
  g.pushSample(back, 60, 1000);
  g.pushSample(back, 30, 1016);
  ok(g.velocityOf(back) < 0, '往回拖是负速度');
});

test('根因⑤ · 甩动的两个边界：采样窗口过期 / 帧间隔太短，都算"没甩"（不能瞎判）', () => {
  const old = [];
  g.pushSample(old, 0, 1000);
  g.pushSample(old, 60, 1400);            // 400ms 前的采样不算数
  equal(g.velocityOf(old), 0, '只有一条有效采样 → 测不出速度');
  const sameFrame = [];
  g.pushSample(sameFrame, 0, 1000);
  g.pushSample(sameFrame, 60, 1002);      // dt 只有 2ms（测试里连续调用就是这种）
  equal(g.velocityOf(sameFrame), 0, '帧间隔太短测不出可靠速度 → 当 0，避免误判成甩动');
  equal(g.velocityOf([]), 0);
  equal(g.velocityOf(null), 0);
});

test('根因⑤ · 松手判定接入速度：快速短滑（距离不够）也展开；往回甩即使距离够也收合', () => {
  // 距离只拖到 50px（不到 30% 阈值 78px），但速度是"朝打开"的甩动 → 展开
  equal(g.snapTranslate(50, 260, 0.3, false, 1.2), 260, '甩动应展开');
  // 已经拖到 200px（超过阈值），但松手瞬间在往回甩 → 收合
  equal(g.snapTranslate(200, 260, 0.3, false, -1.2), 0, '往回甩应收合');
  // 没有速度信息时，仍按距离判（老行为不变）
  equal(g.snapTranslate(50, 260, 0.3, false, 0), 0);
  equal(g.snapTranslate(200, 260, 0.3, false, 0), 260);
  equal(g.snapTranslate(200, 260, 0.3, true, 0), 260, '已展开时距离够 → 保持展开');
  equal(g.snapTranslate(50, 260, 0.3, true, 1.2), 260, '已展开时朝开的方向甩 → 保持展开');
});
