// tests/deliver-sheet.test.js —— 交付弹窗（组件级，V149）
//
// 这个弹窗要守住用户拍板的那句话：「**1 用户自己选**」。
// 具体就是：**不许预选来源**（每次打开都从"未选"开始），选不全 / 数量不合法一律不放行。
// 静态守卫（guard-deliver-source ⑦）盯的是"源码里有没有把 mode 写成具体值"；
// 这里盯的是"跑起来以后，用户看到的状态和事件对不对"——两层都要有。
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const CH = require('./component-helper.js');

const SHEET = '../components/deliver-sheet/deliver-sheet.js';

function open(over) {
  const inst = CH.loadComponent(SHEET);
  inst.$mount();
  const o = over || {};
  inst.setData({ remain: o.remain != null ? o.remain : 3, stock: o.stock != null ? o.stock : 0 });
  inst.$runObserver('show', true);      // 页面把 show 置 true ⇒ 观察器复位状态
  inst.$reset();                        // 复位之后清计数，录的是"用户操作"这一段
  return inst;
}
function pick(inst, m) { inst.pick({ currentTarget: { dataset: { m: m } } }); }
function lastToast() { return stub.lastToast(); }

group('交付弹窗 · 货从哪来（V149）');

test('★ ① 打开时：数量默认剩余量，**来源不预选**（用户自己选）', () => {
  const inst = open({ remain: 3 });
  equal(inst.data.qty, '3', '数量默认给剩余量（少点一次）');
  equal(inst.data.mode, '', '★ 来源必须是"未选" —— 系统不替用户决定');
});

test('★ ② 再打开一次：上一轮选的来源不许留下来', () => {
  const inst = open({ remain: 3 });
  pick(inst, 'material');                           // 用户这轮选了"从物料出"
  equal(inst.data.mode, 'material', '前置：确实选上了');
  inst.setData({ show: false });
  inst.$runObserver('show', true);                  // 关掉再打开
  equal(inst.data.mode, '', '★ 每次打开都要复位成"未选"（不能沿用上次）');
});

test('★ ③ 没选来源点确认 → 只提示，绝不抛 submit', () => {
  const inst = open({ remain: 3 });
  inst.onConfirm();
  ok(lastToast().title.indexOf('货从哪来') >= 0, '要说清是"没选来源"，实际：' + lastToast().title);
  equal(inst.$eventsOf('submit').length, 0, '★ 没选来源，一个 submit 都不许抛');
});

test('④ 选「从成品在库出」但在库为 0 → 拦一下，且选不上', () => {
  const inst = open({ remain: 3, stock: 0 });
  pick(inst, 'product');
  equal(inst.data.mode, '', '★ 在库为 0 时不该让他选这条路');
  ok(lastToast().title.indexOf('在库') >= 0, '要说明为什么，实际：' + lastToast().title);
});

test('⑤ 在库够时，「从成品在库出」可以选上', () => {
  const inst = open({ remain: 3, stock: 5 });
  pick(inst, 'product');
  equal(inst.data.mode, 'product');
});

test('⑥ 数量不合法一律拦住：空 / 0 / 超剩余量', () => {
  const inst = open({ remain: 3, stock: 5 });
  pick(inst, 'material');

  inst.setData({ qty: '' });
  inst.onConfirm();
  ok(lastToast().title.indexOf('大于 0') >= 0, '空数量：' + lastToast().title);

  inst.setData({ qty: '0' });
  inst.onConfirm();
  ok(lastToast().title.indexOf('大于 0') >= 0, '0 也拦住：' + lastToast().title);

  inst.setData({ qty: '4' });
  inst.onConfirm();
  ok(lastToast().title.indexOf('剩余量') >= 0, '超剩余量：' + lastToast().title);

  equal(inst.$eventsOf('submit').length, 0, '★ 三次都不许抛 submit');
});

test('★ ⑦ 选齐了才抛 submit，载荷就是「多少 + 从哪来」', () => {
  const inst = open({ remain: 3, stock: 5 });
  pick(inst, 'product');
  inst.setData({ qty: '2' });
  inst.onConfirm();
  const ev = inst.$lastEvent('submit');
  ok(ev, '要把 submit 抛出去（页面接它去落账）');
  equal(ev.detail.fromStock, 'product', '来源原样传下去');
  equal(ev.detail.qty, 2, '数量按数字传（不是字符串）');
});

test('⑧ 点遮罩 / 点取消 → 抛 close（不改任何数据）', () => {
  const inst = open({ remain: 3 });
  inst.onMaskTap();
  equal(inst.$eventsOf('close').length, 1, '点遮罩关上');
  inst.onCancel();
  equal(inst.$eventsOf('close').length, 2, '点取消也关上');
  equal(inst.$eventsOf('submit').length, 0, '★ 全程一个 submit 都不许抛');
});
