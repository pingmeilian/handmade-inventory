// tests/swipe-cell.test.js —— 左滑组件的行为（手势序列 → 状态 → 事件）
//
// 这一层测的是「用户真的一划，组件到底怎么反应」：
// 跟手位移、横向/纵向分流、松手吸附、同时只开一张、点操作项、二次确认、跨端（触摸/鼠标）。
const { test: rawTest, group, ok, equal, near } = require('./harness.js');
const stub = require('./wx-stub.js');
const H = require('./component-helper.js');
const registry = require('../components/swipe-cell/registry.js');
const gesture = require('../components/swipe-cell/gesture.js');

// 每个用例前重置「跨用例共享」的东西：registry 是模块级单例（同时只开一张），
// gesture 缓存了语言与窗宽。不重置会互相污染 —— 曾经的坑：一条用例里挂两个组件，
// 第二个组件初始化时重置 registry，把第一个从"挂载中"名单里弄丢了，
// 于是"开 B 收 A"不再成立（表现为莫名其妙的偶发失败）。
function it(name, fn) {
  rawTest(name, function () {
    registry.reset();
    gesture.clearCache();
    stub.resetStorage();
    return fn.apply(this, arguments);
  });
}

const ACTIONS = [
  { key: 'deliver', text: '快速交付' },
  { key: 'cancel', text: '取消', confirm: { title: '取消排单', content: '确认取消？', confirmText: '取消排单' } },
  { key: 'edit', text: '编辑' },
  { key: 'del', text: '删除', confirm: true }
];

// 一个挂好的组件：4 个 130rpx 按钮 @375px 屏 → 操作区 260px，阈值 0.3 → 78px
// （前置重置统一由上面的 it() 做）
function mk(over) {
  const inst = H.loadComponent('../components/swipe-cell/swipe-cell.js');
  Object.assign(inst.data, { actions: ACTIONS }, over || {});
  inst.$mount();
  return inst;
}

group('左滑组件 · 行为（手势 / 状态 / 事件）');

// ---------- 初始化 ----------
it('挂载即算好：方向、操作区宽度（rpx→px）、位移归零', () => {
  const inst = mk();
  equal(inst.data.dir, 'left');
  equal(inst.data.areaPx, 260);
  equal(inst.data.translate, 0);
  equal(inst.data.open, false);
  equal(inst.data.dragging, false);
});

it('没有操作项 → 操作区宽度为 0（页面据此不挂手势，省开销）', () => {
  const inst = mk({ actions: [] });
  equal(inst.data.areaPx, 0);
});

// ---------- 跟手位移 ----------
it('跟手位移：左滑多少，卡片就移多少（1:1）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[280, 100]], to: [280, 100], end: false });
  equal(inst.data.translate, 20);
  equal(inst.data.dragging, true, '横向手势期间处于 dragging（关掉过渡动画，才能跟手）');
});

it('跟手位移：连续移动按最终位置算，不累加抖动', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[280, 100], [250, 100], [240, 100]], to: [240, 100], end: false });
  equal(inst.data.translate, 60, '最终 dx = -60');
});

it('跟手位移：反方向滑不位移（不会把卡片往反侧推出去）', () => {
  const inst = mk();
  H.swipe(inst, { from: [100, 100], path: [[200, 100]], to: [200, 100], end: false });
  equal(inst.data.translate, 0);
});

it('跟手位移：超过操作区宽度就夹紧在 260', () => {
  const inst = mk();
  H.swipe(inst, { from: [370, 100], path: [[10, 100]], to: [10, 100], end: false });
  equal(inst.data.translate, 260);
});

it('setData 去抖：亚像素级的移动不重复发 setData（跨端通信是有成本的）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[280, 100]], to: [280, 100], end: false });   // 轴已锁定
  inst.$reset();
  inst.onTouchMove(H.touchEvt(279.6, 100));     // 只挪 0.4px
  equal(inst.setDataCalls, 0, '0.4px 的变化不值得过桥');
  inst.onTouchMove(H.touchEvt(270, 100));       // 挪 10px
  ok(inst.setDataCalls >= 1, '明显位移必须更新');
  inst.onTouchEnd(H.touchEvt(270, 100));
});

// ---------- 纵向滚动不受影响 ----------
it('纵向手势：判为纵向后立刻放手，位移保持 0（纵向滚动交还原生）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[302, 200]], to: [302, 200], end: false });
  equal(inst.data.translate, 0);
  equal(inst.data.dragging, false, '纵向不该进入 dragging（否则滚动会顿）');
});

it('纵向手势：一旦判为纵向，同一次手势后续的横向移动也不再接管', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[302, 200], [200, 200]], to: [200, 200], end: false });
  equal(inst.data.translate, 0, '手势中途改方向不应被"追认"为左滑，否则滚动会突然被吃掉');
});

it('纵向手势结束后，下一次手势仍能正常左滑（不是一次性失效）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[302, 200]], to: [302, 200] });
  H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  ok(inst.data.translate > 0, '下一次横滑应正常跟手');
});

// ---------- 松手吸附 ----------
it('松手吸附：未超阈值 → 回弹收合，且不发多余的 change 事件', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100] });
  equal(inst.data.translate, 0);
  equal(inst.data.open, false);
  equal(inst.$eventsOf('change').length, 0, '状态没变就不该打扰宿主');
});

it('松手吸附：超阈值 → 吸附到完全展开，并广播 change', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.translate, 260);
  equal(inst.data.open, true);
  equal(inst.data.dragging, false);
  const ev = inst.$lastEvent('change');
  ok(ev && ev.detail.open === true, 'change 应带 open:true');
});

it('已展开时右滑一点就收（跟手方向自然反向）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.open, true);
  H.swipe(inst, { from: [100, 100], path: [[180, 100]], to: [180, 100] });
  equal(inst.data.translate, 0, '右滑 80px → 位移被夹到 0');
  equal(inst.data.open, false);
});

it('★ 已展开时继续左滑：过程中就停在边界，不会跳变（评审抓到的 Critical）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.translate, 260);
  // 手指再往左挪 8px（很常见：展开了还想再推一点点）
  H.swipe(inst, { from: [100, 100], path: [[92, 100]], to: [92, 100], end: false });
  equal(inst.data.translate, 260, '只算本次 dx 的实现会掉到 8（视觉上"跳回去"），这里必须仍是 260');
});

it('★ 已展开时往回拖一点（不到阈值）松手 → 保持展开', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  H.swipe(inst, { from: [100, 100], path: [[80, 100]], to: [80, 100] });   // 往回 20px
  equal(inst.data.translate, 260, '只往回拖 20px（<30%）→ 仍展开');
  equal(inst.data.open, true);
});

it('★ 已展开时往回拖超过阈值 → 收合', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  H.swipe(inst, { from: [100, 100], path: [[200, 100]], to: [200, 100] });  // 往回 100px
  equal(inst.data.translate, 0);
  equal(inst.data.open, false);
});

// ---------- 同时只允许一张 ----------
it('同一时间只允许一张展开：开 B 会自动收 A，且 A 收到 change', () => {
  const a = mk();
  const b = mk();
  H.swipe(a, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(registry.current(), a);
  H.swipe(b, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(a.data.open, false, 'A 应被收起');
  equal(a.data.translate, 0);
  ok(a.$lastEvent('change'), 'A 收起时要广播 change，宿主好做联动');
  equal(registry.current(), b);
});

it('别人开始横向滑动就收起（不用等它松手）——「其他卡片滑动时自动收起」', () => {
  const a = mk();
  const b = mk();
  H.swipe(a, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(a.data.open, true);
  H.swipe(b, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  equal(a.data.open, false, 'B 刚开始横滑，A 就该收');
  equal(b.data.translate, 50, 'B 自己正常跟手');
});

it('close() 幂等：连调两次不报错、不发重复事件', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  inst.close();
  inst.close();
  equal(inst.data.open, false);
  equal(inst.$eventsOf('change').length, 1, '第二次调用不该再发事件');
  equal(registry.current(), null);
});

it('组件销毁 → 释放「当前展开」占用（不留悬空引用）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(registry.current(), inst);
  inst.$detach();
  equal(registry.current(), null);
});

it('页面切后台（onHide）→ 收起，避免回到前台看到残留的展开态', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$pageHide();
  equal(inst.data.open, false);
  equal(inst.data.translate, 0);
  equal(registry.current(), null);
});

// ---------- 点操作项 ----------
it('点操作项：先收起再抛 action 事件（顺序固定，宿主删了行也不留残影）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  H.tapAction(inst, 2);                       // 第 3 项 = 编辑（无需确认）
  const ev = inst.$lastEvent('action');
  ok(ev, '应抛出 action 事件');
  equal(ev.detail.key, 'edit');
  equal(ev.detail.index, 2);
  equal(inst.data.open, false);
  equal(inst.events[0].name, 'change', 'change（收起）必须排在 action 之前');
});

it('点操作项：不把业务数据塞进事件（组件不耦合排单）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  H.tapAction(inst, 2);                       // 编辑（无需确认，同步抛事件）
  const ev = inst.$lastEvent('action');
  ok(ev, '应抛出 action 事件');
  equal(ev.detail.key, 'edit');
  ok(!('id' in ev.detail) && !('commission' in ev.detail), '事件里只该有 key/index/action');
});

it('禁用的操作项：点了不发事件、不收起', () => {
  const inst = mk({ actions: [{ key: 'x', text: '不可用', disabled: true }] });
  H.swipe(inst, { from: [300, 100], path: [[200, 100]], to: [200, 100] });
  ok(inst.data.open, '先确保是展开的');
  inst.$reset();
  H.tapAction(inst, 0);
  equal(inst.$eventsOf('action').length, 0);
  ok(inst.data.open, '禁用项点了应当毫无反应（连收起都不该）');
});

it('越界的下标（脏数据）→ 静默忽略，不抛错', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  H.tapAction(inst, 99);
  H.tapAction(inst, -1);
  equal(inst.$eventsOf('action').length, 0);
});

// ---------- 二次确认 ----------
it('需确认的操作项：用户取消 → 不发 action，且保持展开（还能改主意）', async () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  stub.modals.answerQueue.push({ confirm: false, cancel: true });
  H.tapAction(inst, 1);                       // 取消排单（带 confirm）
  await stub.flush();
  equal(inst.$eventsOf('action').length, 0);
  ok(inst.data.open, '取消确认后应保持展开');
});

it('需确认的操作项：用户确认 → 抛 action 并收起', async () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  stub.modals.answerQueue.push({ confirm: true, cancel: false });
  H.tapAction(inst, 3);                       // 删除（confirm: true，用默认文案）
  await stub.flush();
  const ev = inst.$lastEvent('action');
  ok(ev && ev.detail.key === 'del', '确认后应抛 action');
  equal(inst.data.open, false);
  const modal = stub.modals[stub.modals.length - 1];
  ok(modal && modal.confirmText.length <= 4, '弹窗按钮文字必须 ≤4 字（微信硬约束）');
});

it('二次确认弹窗本身失败（平台拒绝）→ 不发 action，也不静默卡死', async () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  stub.faults.modalFail = true;
  H.tapAction(inst, 3);
  await stub.flush();
  equal(inst.$eventsOf('action').length, 0, '弹窗失败时按「用户没确认」处理');
  stub.faults.modalFail = false;
});

// ---------- RTL / 方向 ----------
it('RTL（direction=right）：向右滑才是展开，反方向不位移', () => {
  const inst = mk({ direction: 'right' });
  equal(inst.data.dir, 'right');
  // 反方向（往左）先试：不位移
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100], end: false });
  equal(inst.data.translate, 0, 'RTL 下往左滑不位移');
  inst.onTouchEnd(H.touchEvt(100, 100));
  equal(inst.data.translate, 0, '收尾后仍是 0（未超阈值，回弹）');
  // 正方向（往右）：跟手 + 吸附展开
  H.swipe(inst, { from: [100, 100], path: [[300, 100]], to: [300, 100] });
  equal(inst.data.translate, 260);
  equal(inst.data.open, true);
});

it('RTL：内容位移（bodyX）符号与方向配套，操作区宽度不受方向影响', () => {
  const ltr = mk({ direction: 'left' });
  H.swipe(ltr, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(ltr.data.bodyX, -260, 'LTR：内容向左移，露出右侧操作区');
  const rtl = mk({ direction: 'right' });
  H.swipe(rtl, { from: [100, 100], path: [[300, 100]], to: [300, 100] });
  equal(rtl.data.bodyX, 260, 'RTL：内容向右移，露出左侧操作区');
  equal(rtl.data.areaPx, ltr.data.areaPx, '方向不该影响操作区宽度');
});

it('direction=auto：按系统语言自动判 RTL（阿拉伯语环境自动右滑展开）', () => {
  wx.__nextSystemInfo = { language: 'ar' };
  const inst = mk({ direction: 'auto' });
  equal(inst.data.dir, 'right');
  wx.__nextSystemInfo = null;
});

it('direction=auto：中文环境仍是左滑展开', () => {
  wx.__nextSystemInfo = { language: 'zh_CN' };
  const inst = mk({ direction: 'auto' });
  equal(inst.data.dir, 'left');
  wx.__nextSystemInfo = null;
});

it('方向写错（脏配置）→ 兜底 left，绝不能两边都不响应', () => {
  const inst = mk({ direction: 'diagonal' });
  equal(inst.data.dir, 'left');
  H.swipe(inst, { from: [300, 100], path: [[200, 100]], to: [200, 100], end: false });
  ok(inst.data.translate > 0, '兜底方向上必须能滑');
});

it('运行中改 direction → 位移与内容位移重新配套（不是等下一次手势才生效）', () => {
  const inst = mk({ direction: 'left' });
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.bodyX, -260);
  inst.data.direction = 'right';
  inst.$runObserver('actions, direction, actionWidth');
  equal(inst.data.dir, 'right');
  equal(inst.data.bodyX, 260, '方向一变，已展开的位移方向要立刻跟着翻');
});

// ---------- 跨端：PC 鼠标（pointer） ----------
it('PC 鼠标：pointer 事件同样跟手、同样吸附展开', () => {
  const inst = mk();
  H.swipe(inst, { kind: 'pointer', from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  equal(inst.data.translate, 50, '鼠标拖拽也要跟手');
  H.swipe(inst, { kind: 'pointer', from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.open, true);
});

it('PC 鼠标：悬停产生的 pointermove（没按下）不得被当成拖拽', () => {
  const inst = mk();
  inst.onPointerMove({ clientX: 10, clientY: 10 });
  inst.onPointerMove({ clientX: 200, clientY: 10 });
  equal(inst.data.translate, 0, '没有 pointerdown 的 pointermove 是「划过」，必须忽略');
  equal(inst.data.dragging, false);
});

it('跨端去重：touch 手势进行中，同一手势的 pointer 事件被忽略（PC 可能双发）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  inst.onPointerDown({ clientX: 300, clientY: 100 });
  inst.onPointerMove({ clientX: 10, clientY: 100 });
  inst.onPointerUp({ clientX: 10, clientY: 100 });
  equal(inst.data.translate, 50, 'pointer 不该抢走正在进行的 touch 手势');
  inst.onTouchEnd(H.touchEvt(250, 100));
  equal(inst.data.translate, 0, 'touch 正常收尾（50 < 78 → 回弹）');
});

it('跨端去重：pointer 手势进行中，touch 事件被忽略并最终正确收尾', () => {
  const inst = mk();
  H.swipe(inst, { kind: 'pointer', from: [300, 100], path: [[100, 100]], to: [100, 100], end: false });
  equal(inst.data.translate, 200, '鼠标拖了 200px');
  inst.onTouchStart(H.touchEvt(300, 100));
  inst.onTouchMove(H.touchEvt(10, 100));
  inst.onTouchEnd(H.touchEvt(10, 100));
  equal(inst.data.translate, 200, 'touch 不该干扰 pointer 手势（更不该把位移换成 touch 的坐标差）');
  inst.onPointerUp({ clientX: 100, clientY: 100 });
  equal(inst.data.open, true, 'pointer 正常收尾 → 展开');
});

// ---------- 防御 ----------
it('组件整体禁用 → 手势完全无响应', () => {
  const inst = mk({ disabled: true });
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.translate, 0);
  equal(inst.data.open, false);
});

it('手势事件里没有坐标（脏事件）→ 忽略，不产生 NaN 位移', () => {
  const inst = mk();
  inst.onTouchStart({ touches: [], changedTouches: [] });
  inst.onTouchMove({ touches: [], changedTouches: [] });
  inst.onTouchEnd({ touches: [], changedTouches: [] });
  equal(inst.data.translate, 0);
  ok(!Number.isNaN(inst.data.translate));
});

it('未挂载（areaPx 还是 0）时滑动 → 不动，也不会把 NaN 写进样式', () => {
  registry.reset();
  const inst = H.loadComponent('../components/swipe-cell/swipe-cell.js');
  inst.data.actions = ACTIONS;   // 故意不调用 $mount，模拟属性已到但尚未初始化
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.translate, 0);
  ok(!Number.isNaN(inst.data.bodyX));
});

// ===================== 真机「时灵时不灵」的五个根因（2026-09-14） =====================
// 现象：有时能划出来、有时刚划一点就缩回去、拖动过程也不跟手。
// 这一组把每个根因钉成一条复现测试 —— 改之前它们是红的。
group('左滑组件 · 手势稳定性（真机"时灵时不灵"的复现）');

it('★ 根因①：拖动过程中外部"收起一切"（如列表滚动触发）不许打断手势', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  equal(inst.data.translate, 50, '先划出 50');
  ok(inst.data.dragging);

  // 真机上横滑时页面常会滚几个像素 → onPageScroll → registry.closeAll()；这里直接模拟那一下
  registry.closeAll();
  equal(inst.data.translate, 50, '拖动中不许被外部 close 打断（否则就是"刚划一点就缩回去"）');
  equal(inst.data.dragging, true, '跟手状态必须保持');

  inst.onTouchMove(H.touchEvt(200, 100));      // 手指继续
  equal(inst.data.translate, 100, '继续拖动仍要跟手 —— 这才是"跟手"的意义');
  inst.onTouchEnd(H.touchEvt(200, 100));
  equal(inst.data.open, true, '松手后按阈值落位（100 > 78 → 展开）');
  equal(registry.current(), inst);
});

it('★ 根因①：手指抬起之后，"收起一切"必须照旧生效（不能把"不打断"做成"收不掉"）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.open, true);
  registry.closeAll();
  equal(inst.data.open, false, '手势结束后，点空白/滚动收起必须仍然生效');
  equal(inst.data.translate, 0);
});

it('★ 根因②：两路事件都到达时（PC 双发），拖动由哪一路送来都要跟手', () => {
  const inst = mk();
  inst.onPointerDown({ clientX: 300, clientY: 100 });   // pointer 先到，成为本手势的主来源
  inst.onTouchStart(H.touchEvt(300, 100));              // touch 紧随其后（双发）：不重新基线，但这一路算有效
  inst.onTouchMove(H.touchEvt(250, 100));               // 实际拖动由 touch 送来
  equal(inst.data.translate, 50, '同一串手势：哪一路在动就跟哪一路（不许因为"来源不符"整串丢掉）');
  inst.onTouchEnd(H.touchEvt(250, 100));
  equal(inst.data.translate, 0, '50 < 78 → 回弹（说明正常收尾，不是死在那儿）');

  // 状态没被搞坏：下一次手势照旧
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  equal(inst.data.open, true);
});

it('★ 根因②：没按下过的来源发来的 move 不许接管（PC 鼠标"划过"也会发 pointermove）', () => {
  const inst = mk();
  H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
  inst.onPointerMove({ clientX: 10, clientY: 400 });    // 只是划过，从没 pointerdown
  equal(inst.data.translate, 50, '不能一拿到鼠标坐标就把位移带跑');
});

it('★ 根因③：多指时认准"起始的那根手指"，别被另一根手指带跑', () => {
  const inst = mk();
  inst.onTouchStart({ touches: [{ identifier: 0, clientX: 300, clientY: 100 }], changedTouches: [{ identifier: 0, clientX: 300, clientY: 100 }] });
  // 第二根手指落在别处 —— 此时 touches[0] 已经不是起始手指了
  inst.onTouchMove({
    touches: [{ identifier: 7, clientX: 520, clientY: 400 }, { identifier: 0, clientX: 250, clientY: 100 }],
    changedTouches: [{ identifier: 0, clientX: 250, clientY: 100 }]
  });
  equal(inst.data.translate, 50, '要按起始手指算位移（取 touches[0] 会算出一根完全反方向的位移）');
});

it('★ 根因③：找不到起始手指的那一帧就忽略，宁可不动也不要乱跳', () => {
  const inst = mk();
  inst.onTouchStart({ touches: [{ identifier: 0, clientX: 300, clientY: 100 }], changedTouches: [{ identifier: 0, clientX: 300, clientY: 100 }] });
  inst.onTouchMove({ touches: [{ identifier: 9, clientX: 100, clientY: 100 }], changedTouches: [{ identifier: 9, clientX: 100, clientY: 100 }] });
  equal(inst.data.translate, 0);
});

it('★ 根因④：起手先纵向漂移、随后明确横滑 → 仍能划出来（纠偏窗口）', () => {
  const inst = mk();
  const realNow = Date.now;
  let now = 500000;
  Date.now = () => now;
  try {
    inst.onTouchStart(H.touchEvt(300, 100));
    now += 100; inst.onTouchMove(H.touchEvt(301, 112));   // 先往下 12px → 这一刻确实像滚动
    equal(inst.data.translate, 0, '此刻不动是对的（交给原生滚动）');
    now += 100; inst.onTouchMove(H.touchEvt(250, 116));   // 紧接着横滑 50px、纵向仅 16px
    equal(inst.data.translate, 50, '纠偏后应能划出来（否则用户看到的就是"时灵时不灵"）');
    now += 100; inst.onTouchEnd(H.touchEvt(250, 116));
    equal(inst.data.translate, 0, '50 < 78 且是慢速拖动 → 回弹');
  } finally { Date.now = realNow; }
});

it('★ 根因④：纵向已经滚了很多就彻底交还滚动，不许中途抢过来', () => {
  const inst = mk();
  const realNow = Date.now;
  let now = 600000;
  Date.now = () => now;
  try {
    inst.onTouchStart(H.touchEvt(300, 100));
    now += 100; inst.onTouchMove(H.touchEvt(301, 140));   // 纵向 40px → 判纵向
    now += 100; inst.onTouchMove(H.touchEvt(260, 145));   // 之后才横滑
    equal(inst.data.translate, 0, '纵向已超纠偏上限（30px）→ 不抢，交给页面滚');
  } finally { Date.now = realNow; }
});

it('★ 根因⑤：快速短促一甩（距离不到阈值）也展开 —— "跟手手感"的另一半', () => {
  const inst = mk();
  const realNow = Date.now;
  let now = 700000;
  Date.now = () => now;
  try {
    inst.onTouchStart(H.touchEvt(300, 100));
    now += 16; inst.onTouchMove(H.touchEvt(285, 100));    // 位移 15
    now += 16; inst.onTouchMove(H.touchEvt(265, 100));    // 位移 35
    now += 16; inst.onTouchMove(H.touchEvt(250, 100));    // 位移 50（< 78 阈值）
    now += 16; inst.onTouchEnd(H.touchEvt(250, 100));
    equal(inst.data.translate, 260, '甩动 → 展开（否则用户会觉得"明明划了却缩回去"）');
    equal(inst.data.open, true);
  } finally { Date.now = realNow; }
});

it('★ 根因⑤：慢速拖到同样距离则按阈值回弹（速度只在真甩动时生效）', () => {
  const inst = mk();
  const realNow = Date.now;
  let now = 800000;
  Date.now = () => now;
  try {
    inst.onTouchStart(H.touchEvt(300, 100));
    now += 200; inst.onTouchMove(H.touchEvt(285, 100));   // 间隔 200ms：采样窗口外的都过期了
    now += 200; inst.onTouchMove(H.touchEvt(250, 100));
    now += 200; inst.onTouchEnd(H.touchEvt(250, 100));
    equal(inst.data.translate, 0, '慢慢挪到 50px 不算甩动 → 回弹');
  } finally { Date.now = realNow; }
});

group('左滑组件 · 手势丢失与"收起一切"的兜底（评审加固）');

it('PC 手势没收尾（鼠标在元素外抬起）→ 断流后下一次按下先给上一串落位，不留"半开且无人管"的卡片', () => {
  const realNow = Date.now;
  let now = 400000;
  Date.now = () => now;
  try {
    const inst = mk();
    H.swipe(inst, { kind: 'pointer', from: [300, 100], path: [[150, 100]], to: [150, 100], end: false });
    equal(inst.data.translate, 150);
    equal(inst.data.open, false, '没收尾就不算展开（registry 里没有它）');
    equal(inst.data.dragging, true);

    now += 900;                                   // 超过 LIVE_MS：这串手势已经断流（鼠标早就离开元素了）
    inst.onPointerDown({ clientX: 300, clientY: 100 });
    equal(inst.data.open, true, '残留手势先按阈值落位（150 > 78 → 展开）');
    equal(inst.data.dragging, false, '残留状态必须被清掉');
    equal(registry.current(), inst, '落位后重新受 registry 管辖（滚动/点空白都能收起它）');
  } finally { Date.now = realNow; }
});

it('鼠标移出元素（pointerleave）→ 手势立即落位，不留半开态', () => {
  const inst = mk();
  H.swipe(inst, { kind: 'pointer', from: [300, 100], path: [[150, 100]], to: [150, 100], end: false });
  inst.onPointerLeave({ clientX: 150, clientY: 100 });
  equal(inst.data.open, true, '按阈值落位');
  equal(inst.data.dragging, false);
  equal(registry.current(), inst);
});

it('pointerleave 在没有进行中手势时是空操作（悬停划过不该有任何反应）', () => {
  const inst = mk();
  inst.onPointerLeave({ clientX: 10, clientY: 10 });
  equal(inst.data.translate, 0);
  equal(inst.$eventsOf('change').length, 0);
});

it('★ 半开卡片分两种情况：手势还活着不许打断；已经断流必须能收掉', () => {
  const realNow = Date.now;
  let now = 900000;
  Date.now = () => now;
  try {
    const inst = mk();
    H.swipe(inst, { from: [300, 100], path: [[250, 100]], to: [250, 100], end: false });
    equal(inst.data.open, false);
    ok(inst.data.translate > 0, '半开');
    equal(registry.closeIfAny(), false, '手势刚还在动 → 不许打断，也不能算成"这次点击用来收起"（否则会误判成不跳转）');
    equal(inst.data.translate, 50, '位移必须保持');
    now += 2000;                                   // 末尾事件彻底丢了 → 这串手势已经死了
    equal(registry.closeIfAny(), true, '断流的半开卡片必须能被收起（否则就"卡在那儿没人管"）');
    equal(inst.data.translate, 0);
    equal(inst.data.dragging, false, '拖动标记也要清掉（否则过渡一直是关的）');
  } finally { Date.now = realNow; }
});

it('★ 两张都半开时，"收起一切"把它们都收掉（不只收后一张）', () => {
  const a = mk();
  const b = mk();
  a.setData({ translate: 120 });
  b.setData({ translate: 80 });
  equal(registry.anyOpen(), true);
  registry.closeAll();
  equal(a.data.translate, 0, '先开的也要收（双指同时滑两张的场景）');
  equal(b.data.translate, 0);
});

it('registry：挂载登记 / 销毁注销（收起入口不会指向已销毁的实例）', () => {
  const inst = mk();
  equal(registry.anyOpen(), false);
  inst.setData({ translate: 100 });
  equal(registry.anyOpen(), true);
  inst.$detach();
  equal(registry.anyOpen(), false, '销毁后不该再被算进来');
  equal(registry.current(), null);
});

it('没有任何卡片时，closeAll 返回 false（页面据此决定"这次点击是否只用来收起"）', () => {
  mk();
  equal(registry.closeAll(), false);
});

// ============================================================================
group('配置化回调（setHandlers）· 与事件通路可混用');

// 为什么要有 setHandlers：组件属性（actions）是从 WXML 传进来的，跨渲染层必须可序列化
// —— 函数会被丢掉。所以"配置化回调"只能走 JS 侧注入（不经过 setData）。
it('★ 挂了 handler 的 key：点击直接调 handler（拿到 key/index/action），且不再抛 action 事件', () => {
  const inst = mk();
  const calls = [];
  inst.setHandlers({ edit: (d) => calls.push(d) });

  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  H.tapAction(inst, 2);                                   // 第 3 项 = 编辑

  equal(calls.length, 1, 'handler 应被调用一次');
  equal(calls[0].key, 'edit');
  equal(calls[0].index, 2);
  equal(calls[0].action.text, '编辑');
  equal(inst.$eventsOf('action').length, 0, '挂了 handler 就不该再抛事件（否则同一个操作会被处理两次）');
  equal(inst.data.open, false, '无论走哪条通路，都要先收起');
});

it('没挂 handler 的 key：照旧抛 action 事件（两条通路可在同一张卡上混用）', () => {
  const inst = mk();
  const calls = [];
  inst.setHandlers({ edit: (d) => calls.push(d) });

  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  H.tapAction(inst, 0);                                   // 快速交付（没挂 handler）

  equal(calls.length, 0);
  const ev = inst.$lastEvent('action');
  ok(ev && ev.detail.key === 'deliver', '没挂 handler 的 key 仍走事件');
});

it('setHandlers 只收函数：非函数值被过滤（否则点击时会抛"x is not a function"）', () => {
  const inst = mk();
  inst.setHandlers({ edit: '不是函数', del: null, cancel: undefined });
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  H.tapAction(inst, 2);                                   // 编辑（handler 值非法 → 应回落到事件）
  ok(inst.$lastEvent('action'), '非法 handler 不该把操作吞掉，也不能炸');
});

it('setHandlers(null) 清空后回到事件模式（可动态切换通路）', () => {
  const inst = mk();
  const calls = [];
  inst.setHandlers({ edit: (d) => calls.push(d) }).setHandlers(null);
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  H.tapAction(inst, 2);
  equal(calls.length, 0, '清空后不该再调 handler');
  ok(inst.$lastEvent('action'), '应回落到事件通路');
});

it('需确认的项：确认通过才调 handler（确认框在 handler 之前）', async () => {
  const inst = mk();
  const calls = [];
  inst.setHandlers({ del: (d) => calls.push(d) });
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  stub.modals.answerQueue.push({ confirm: true, cancel: false });
  H.tapAction(inst, 3);                                   // 删除（confirm: true）
  await stub.flush();
  equal(calls.length, 1, '确认后才调 handler');
  equal(calls[0].key, 'del');
});

it('需确认的项：用户取消 → handler 不调，且卡片保持展开（什么都没发生）', async () => {
  const inst = mk();
  const calls = [];
  inst.setHandlers({ del: (d) => calls.push(d) });
  H.swipe(inst, { from: [300, 100], path: [[100, 100]], to: [100, 100] });
  inst.$reset();
  stub.modals.answerQueue.push({ confirm: false, cancel: true });
  H.tapAction(inst, 3);
  await stub.flush();
  equal(calls.length, 0);
  ok(inst.data.open, '取消后应保持展开，等用户下一步操作');
});

it('★ 复用性：换一套完全非排单语义的 actions（置顶/归档/分享）+ handler，行为完全一致', () => {
  const OTHER = [
    { key: 'top', text: '置顶', theme: 'primary' },
    { key: 'archive', text: '归档', theme: 'warning' },
    { key: 'share', text: '分享', theme: 'default' }
  ];
  const inst = mk({ actions: OTHER });
  const calls = [];
  inst.setHandlers({ top: (d) => calls.push(d.key), archive: (d) => calls.push(d.key) });

  // 1) 手势/吸附照旧：3 个 130rpx @375px 屏 → 操作区 195px，阈值 0.3 → 58.5px
  equal(inst.data.areaPx, 195);
  H.swipe(inst, { from: [300, 100], path: [[180, 100]], to: [180, 100] });
  equal(inst.data.open, true, '换业务语义不影响吸附');

  // 2) 两条通路都落在新的 key 上
  H.tapAction(inst, 0);
  equal(calls[0], 'top');
  H.tapAction(inst, 2);
  equal(inst.$lastEvent('action').detail.key, 'share', '没挂 handler 的走事件');

  // 3) 组件全程不认识"排单"：源码里不该出现任何业务词（解耦自检）
  //    注意用词边界：源码里的 clientX/clientY 是手势 API，不该被误判成业务字段 client
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../components/swipe-cell/swipe-cell.js'), 'utf8');
  [/commission/, /排单/, /deliver/, /\bclient\b/, /productName/, /\bqty\b/].forEach((re) => {
    ok(!re.test(src), '组件源码不该出现业务词：' + re);
  });
});
