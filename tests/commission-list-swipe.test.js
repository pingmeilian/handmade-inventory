// tests/commission-list-swipe.test.js —— 排单列表左滑操作（页面接入层）
//
// 组件本身在 swipe-cell.test.js 里测；这里测「接入是否接对了」：
// 四个操作项按状态怎么给、每个操作真的落到 store 上了没、确认策略对不对、
// 以及「不影响点击跳转 / 不影响列表滚动」这两条硬要求。
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const F = require('./fixtures.js');
const H = require('./page-helper.js');
const CH = require('./component-helper.js');
const registry = require('../components/swipe-cell/registry.js');
const store = F.store;
const util = F.util;

function setup() {
  F.reset();
  stub.resetStorage();
  registry.reset();
  const p = F.product({ name: '发夹' });
  F.seedProducts([p]);
  const today = util.today();
  const act = store.saveCommission({ productId: p.id, productName: '发夹', client: '小美', qty: 3, deadline: util.addDays(today, 5) });
  const done = store.saveCommission({ productId: p.id, productName: '胸针', client: '阿强', qty: 2, deadline: util.addDays(today, 1) });
  done.deliveredQty = 2; done.status = 'done';
  store.saveCommission(done);
  const page = H.loadPage('../pages/commission/list.js');
  page.onShow();
  return { page, p, act: store.getCommission(act.id), done: store.getCommission(done.id) };
}

// 把某个组件实例标记为「已展开」，用来验证「有展开项时的行为」
function openOneCell() {
  const cell = CH.loadComponent('../components/swipe-cell/swipe-cell.js');
  cell.$mount();
  cell.setData({ translate: 260, open: true });
  registry.notifyOpen(cell);
  return cell;
}

function lastModal() { return stub.modals[stub.modals.length - 1]; }
// ⚠️ 别直接摸 stub.toasts 的末尾：那个数组混着 toast 与导航记录，而且别的测试
// 残留的"延迟返回"定时器会在本测试的 await 窗口里插一条 navigateBack（实测跑 5 次挂 2 次）。
// 统一走 stub.lastToast() / stub.navs(kind)。
function navs() { return stub.navs('navigateTo'); }
function lastToast() { return stub.lastToast(); }

group('排单列表 · 左滑操作接入');

// ---------- 操作项配置 ----------
test('进行中：四个操作项，文案与顺序按需求（交付 / 取消 / 编辑 / 删除）', () => {
  const { page } = setup();
  const acts = page.data.cmActionsActive;
  equal(acts.length, 4);
  // V149：第一项由「快速交付」改名「交付」—— 它现在会开弹窗，不再是一键交完
  equal(acts.map((a) => a.text).join('/'), '交付/取消/编辑/删除');
  equal(acts.map((a) => a.key).join('/'), 'deliver/cancel/edit/del');
});

test('已完成 / 已取消：只留「编辑 / 删除」（交付与取消对它们无意义）', () => {
  const { page } = setup();
  const acts = page.data.cmActionsEnded;
  equal(acts.map((a) => a.key).join('/'), 'edit/del');
  equal(acts.map((a) => a.text).join('/'), '编辑/删除');
});

test('每一行带 ended 标记，视图据此切换操作项', () => {
  const { page, act, done } = setup();
  const rowAct = page.data.list.find((r) => r.id === act.id);
  equal(rowAct.ended, false, '进行中：操作项给全套');
  page.data.filter = 'done';
  page.reload();
  const rowDone = page.data.list.find((r) => r.id === done.id);
  ok(rowDone, '已完成筛选下应能看到这条');
  equal(rowDone.ended, true, '已完成：只给编辑/删除');
});

test('每个操作项都配了图标（图标在上、文字在下）与主题色', () => {
  const { page } = setup();
  page.data.cmActionsActive.forEach((a) => {
    ok(a.iconSrc || a.icon, a.text + ' 应有图标');
    ok(a.theme, a.text + ' 应有主题色');
  });
});

// ---------- 确认策略 ----------
test('确认策略：删除、取消要二次确认；编辑、交付不要', async () => {
  const { page } = setup();
  const map = {};
  page.data.cmActionsActive.forEach((a) => { map[a.key] = !!a.confirm; });
  equal(map.del, true, '删除不可逆 → 必须确认');
  equal(map.cancel, true, '取消是状态变更 → 与详情页保持一致，也确认');
  equal(map.edit, false);
  equal(map.deliver, false, 'V149：弹窗本身就是确认（要选来源 + 填数量），不必再叠一层');
});

test('删除的确认文案必须写明后果（已交付部分不回补物料）', () => {
  const { page } = setup();
  const del = page.data.cmActionsActive.find((a) => a.key === 'del');
  const content = del.confirm.content || '';
  ok(content.indexOf('不回补') >= 0 || content.indexOf('不可恢复') >= 0,
    '数据安全：删除会留下已出库的物料流水，必须在确认文案里讲清楚，实际：' + content);
});

// ---------- 四个操作各自落库 ----------
test('编辑：跳转排单编辑页并带上 id', () => {
  const { page, act } = setup();
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'edit' } });
  const n = navs();
  equal(n.length, 1);
  equal(n[0].url, '/pages/commission/edit?id=' + act.id);
});

test('删除：二次确认通过后真的删掉，并给出反馈', async () => {
  const { page, act } = setup();
  stub.modals.answerQueue.push({ confirm: true });
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'del' } });
  await stub.flush();
  equal(store.getCommission(act.id), undefined, '排单应从存储里消失');
  ok(page.data.list.every((r) => r.id !== act.id), '列表应立即刷新');
  ok(lastToast().title, '应有操作反馈');
});

test('取消：状态置为已取消，并按「已取消」筛选可见', async () => {
  const { page, act } = setup();
  stub.modals.answerQueue.push({ confirm: true });
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'cancel' } });
  await stub.flush();
  equal(store.getCommission(act.id).status, 'cancelled');
  ok(page.data.list.every((r) => r.id !== act.id), '进行中列表里应不再出现');
});

// ---------- 交付（V149：先开交付弹窗问「货从哪来」，再落账） ----------
// ⚠️ V149 之前这里是「一键交完」；现在**必须**先选来源 —— 两路扣账方式不同，不能替用户决定。
//    详情页「交付出库」走的是同一个组件 + utils/deliver-flow.js，两边口径必须一致。
test('交付：打开交付弹窗（只问不扣账），默认交付量 = 剩余量', async () => {
  const { page, act } = setup();
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  equal(page.data.showDeliver, true, '应打开交付弹窗');
  equal(page.data.deliverId, act.id);
  equal(page.data.deliverRemain, 3, '默认交付量 = 剩余量');
  equal(page.data.deliverStock, 0, '成品在库要带给弹窗显示（这单在库为 0）');
  equal(store.getCommission(act.id).deliveredQty, 0, '★ 只打开弹窗，绝不能先动账');
});

test('交付弹窗 · 选「从物料出」→ 交完、转已完成、来源记进交付记录', async () => {
  const { page, act } = setup();
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  page.onDeliverSubmit({ detail: { qty: 3, fromStock: 'material' } });
  await stub.flush();
  const after = store.getCommission(act.id);
  equal(after.deliveredQty, 3, '应全额交付');
  equal(after.status, 'done', '交完后自动置为已完成');
  equal(after.deliverLogs[0].fromStock, 'material', '★ 来源要记下来 —— 撤销靠它走对反向路径');
  equal(page.data.showDeliver, false, '提交后弹窗要关');
  equal(lastModal().title, '交付完成');
});

test('交付弹窗 · 选「从成品在库出」但在库为 0 → 拦住、数据不动', async () => {
  const { page, act } = setup();
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  page.onDeliverSubmit({ detail: { qty: 3, fromStock: 'product' } });
  await stub.flush();
  const after = store.getCommission(act.id);
  equal(after.deliveredQty, 0, '在库不足时绝不能记账');
  equal(after.status, 'active');
  ok(lastToast().title.indexOf('在库') >= 0, '要说清是在库不够，实际：' + lastToast().title);
});

test('交付弹窗 · 选「从成品在库出」且在库够 → 在库扣减、排单减量', async () => {
  const { page, p } = setup();
  const list = store.getProducts();
  list[0].sellableStock = 5;
  store.set(store.KEYS.PRODUCTS, list);
  const c = store.saveCommission({ productId: p.id, productName: '发夹', client: '小美', qty: 3, deadline: util.addDays(util.today(), 3) });
  page.reload();
  page.onCardAction({ currentTarget: { dataset: { id: c.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  equal(page.data.deliverStock, 5, '弹窗要显示真实在库');
  page.onDeliverSubmit({ detail: { qty: 2, fromStock: 'product' } });
  await stub.flush();
  const after = store.getCommission(c.id);
  equal(after.deliveredQty, 2, '按本次交付量减排单');
  equal(store.getProduct(p.id).sellableStock, 3, '★ 在库 5 − 2 = 3');
  equal(after.deliverLogs[0].fromStock, 'product');
});

test('交付弹窗 · 只交剩余部分（不是把 qty 再加一遍）', async () => {
  const { page, p } = setup();
  const c = store.saveCommission({ productId: p.id, productName: '发夹', client: '小美', qty: 5, deadline: util.addDays(util.today(), 3) });
  c.deliveredQty = 2; store.saveCommission(c);
  page.reload();
  page.onCardAction({ currentTarget: { dataset: { id: c.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  equal(page.data.deliverRemain, 3, '弹窗默认给的是剩余量 3');
  page.onDeliverSubmit({ detail: { qty: 3, fromStock: 'material' } });
  await stub.flush();
  const after = store.getCommission(c.id);
  equal(after.deliveredQty, 5, '2 已交 + 3 剩余 = 5');
  equal(after.status, 'done');
});

test('快速交付：余量为 0（脏数据）→ 不打开弹窗，只提示', async () => {
  const { page, p } = setup();
  const c = store.saveCommission({ productId: p.id, productName: '发夹', client: '小美', qty: 2, deadline: util.addDays(util.today(), 3) });
  c.deliveredQty = 2; store.saveCommission(c);     // status 仍是 active（历史脏数据）
  page.reload();
  page.onCardAction({ currentTarget: { dataset: { id: c.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  equal(lastToast().title, '已全部交付');
  equal(page.data.showDeliver, false, '脏数据不该进弹窗');
});

// 基建回归：上面那条用例曾经偶发失败（跑 5 次挂 2 次），根因见 wx-stub.js 的 lastToast 注释。
// 这里把它钉住，免得以后有人又去直接摸 stub.toasts 的末尾。
test('测试基建：断言 toast 时不会被残留的「导航记录」顶掉', () => {
  stub.resetStorage();
  util.toast('提示一下');
  wx.navigateBack({});                       // 模拟别的测试残留的"延迟返回"定时器落地
  equal(stub.toasts.length, 2, '数组里同时躺着 toast 与导航记录');
  equal(stub.lastToast().title, '提示一下', 'lastToast 必须按 title 过滤');
  equal(stub.navs('navigateBack').length, 1);
});

test('快速交付：未关联成品 → 提示到位，不抛错（而不是「点了没反应」）', async () => {
  const { page } = setup();
  const c = store.saveCommission({ productName: '散单', client: '客户', qty: 1, deadline: util.addDays(util.today(), 3) });
  page.reload();
  page.onCardAction({ currentTarget: { dataset: { id: c.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  ok(lastToast().title.indexOf('成品') >= 0, '应说明原因，实际：' + lastToast().title);
  equal(page.data.showDeliver, false);
});

test('交付弹窗 · 物料不够 → 在进裁剪页之前说清楚，且排单数据不被破坏', async () => {
  F.reset();
  registry.reset();
  const m = F.simpleMaterial({ name: '合金配件', quantity: 0, unitPrice: 1 });
  F.seedMaterials([m]);
  const p2 = F.product({ name: '缺料成品', bom: [{ materialId: m.id, usage: 1 }] });
  F.seedProducts([p2]);
  const c = store.saveCommission({ productId: p2.id, productName: '缺料成品', client: '客户', qty: 2, deadline: util.addDays(util.today(), 3) });
  const page = H.loadPage('../pages/commission/list.js');
  page.onShow();
  page.onCardAction({ currentTarget: { dataset: { id: c.id } }, detail: { key: 'deliver' } });
  await stub.flush();
  page.onDeliverSubmit({ detail: { qty: 2, fromStock: 'material' } });
  await stub.flush();
  const modal = lastModal();
  equal(modal.title, '物料不够，先补货');
  ok(modal.content.indexOf('合金配件') >= 0, '要点出缺哪个料，实际：' + modal.content);
  equal(store.getCommission(c.id).deliveredQty, 0, '交付失败绝不能改数据');
  equal(store.getCommission(c.id).status, 'active');
  equal(store.getCommission(c.id).status, 'active');
});

test('未知操作 key（脏配置/旧缓存）→ 不炸、不动任何数据', () => {
  const { page, act } = setup();
  const before = page.data.list.length;
  page.onCardAction({ currentTarget: { dataset: { id: act.id } }, detail: { key: 'nonexistent' } });
  equal(page.data.list.length, before);
  ok(store.getCommission(act.id), '排单还在');
});

test('操作项事件里没有 id（脏事件）→ 静默忽略', () => {
  const { page } = setup();
  page.onCardAction({ currentTarget: { dataset: {} }, detail: { key: 'del' } });
  ok(!stub.faults.modalFail);
});

// ---------- 不影响点击跳转 ----------
test('没有展开项时，点卡片正常进详情', () => {
  const { page, act } = setup();
  page.goDetail({ currentTarget: { dataset: { id: act.id } } });
  const n = navs();
  equal(n.length, 1);
  equal(n[0].url, '/pages/commission/detail?id=' + act.id);
});

test('有展开项时，点卡片只收起、不跳转（避免误触进详情）', () => {
  const { page, act } = setup();
  const cell = openOneCell();
  page.goDetail({ currentTarget: { dataset: { id: act.id } } });
  equal(navs().length, 0, '这一次点击的用途是「收起」，不该同时跳转');
  equal(cell.data.open, false, '并且真的收起了');
});

test('点空白处收起已展开项', () => {
  const { page } = setup();
  const cell = openOneCell();
  page.onBlankTap();
  equal(cell.data.open, false);
});

// ---------- 不影响纵向滚动 ----------
test('列表滚动时自动收起已展开项', () => {
  const { page } = setup();
  const cell = openOneCell();
  page.onPageScroll({ scrollTop: 120 });
  equal(cell.data.open, false);
});

test('没有任何展开项时，滚动不做多余工作（不白白 setData）', () => {
  const { page } = setup();
  page.onPageScroll({ scrollTop: 10 });
  equal(registry.current(), null);
  ok(page.data.list.length > 0);
});

// ---------- 视图层约定 ----------
test('列表接入：用 swipe-cell 包住卡片，并传 data-id 与方向配置', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'commission', 'list.wxml'), 'utf8');
  ok(/<swipe-cell[^>]*data-id="\{\{item\.id\}\}"/.test(wxml), '每张卡片要能被识别出是哪一行（data-id）');
  ok(/bind:action="onCardAction"/.test(wxml), '要接上 action 事件');
  ok(/actions="\{\{item\.ended \?/.test(wxml), '操作项要随行状态切换（进行中 / 已结束）');
  ok(/direction="\{\{/.test(wxml), '方向要可配置（auto 支持 RTL）');
});

test('页面注册了 swipe-cell 组件', () => {
  const fs = require('fs');
  const path = require('path');
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pages', 'commission', 'list.json'), 'utf8'));
  ok(json.usingComponents && json.usingComponents['swipe-cell'], 'list.json 里应注册 swipe-cell');
});
