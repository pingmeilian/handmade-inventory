// tests/clear-page.test.js —— 清空流程的「页面级」端到端测试
//
// 为什么需要它：服务层测试再好，也证明不了「页面按钮真的接对了、真的能点通」。
// 真机上我们又无法自动回归，所以用页面级测试兜住这条最容易断的链路：
//   关于页/数据体检页的「清空本地数据」（第一段）→「转发备份到微信」（第二段）
//
// 关键点：第二段必须放进 stub.simulateTap（模拟用户点击）里执行 ——
// stub 已忠实复刻微信约束（脱离 TAP 手势调 shareFileMessage 一律 fail），
// 因此「不小心又写成异步转发」会被这里直接抓出来。

const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const backupSvc = require('../services/backup.js');
const clearFlow = require('../utils/clear-flow.js');

function seedOne() {
  stub.resetStorage();
  store.ensureSeed();
  store.saveMaterial({ name: '页面级测试物料', materialCategoryId: 'mc_other' });
}

group('清空流程 · 页面级端到端（关于页）');

test('两步走通：点清空 → 生成备份（不清空）→ 点转发 → 清空并恢复出厂', async () => {
  seedOne();
  const page = loadPage('../pages/settings/about.js');
  page.data.pendingBackup = null;

  await page.reset();   // 第一段（确认框默认「确定」）
  ok(page.data.pendingBackup, '应生成待转发备份并交给页面展示');
  ok(page.data.pendingBackup.name, '待转发信息要带文件名');
  equal(store.getMaterials().length, 1, '第一段绝不清空数据');
  equal(stub.toasts.filter((t) => t.shareFileMessage).length, 0, '第一段绝不自动转发');

  let pend = null;
  stub.simulateTap(() => { pend = page.onShareBackup(); });   // 第二段：真实用户点击
  await pend;

  equal(page.data.pendingBackup, null, '成功后应清空待转发状态');
  equal(store.getMaterials().length, 0, '数据已清空');
  ok(storage.get(KEYS.UNITS, []).length >= 8, '预设已恢复出厂');
});

test('取消转发：数据不动，待转发信息保留（可再点一次）', async () => {
  seedOne();
  const page = loadPage('../pages/settings/about.js');
  page.data.pendingBackup = null;
  await page.reset();

  stub.faults.shareFail = true;
  let pend = null;
  stub.simulateTap(() => { pend = page.onShareBackup(); });
  await pend;

  equal(store.getMaterials().length, 1, '取消转发必须中止清空');
  ok(page.data.pendingBackup, '待转发信息要保留，用户可再点一次');
});

test('「暂不清空」：丢弃待转发状态，数据分毫不动', async () => {
  seedOne();
  const page = loadPage('../pages/settings/about.js');
  page.data.pendingBackup = null;
  await page.reset();
  ok(page.data.pendingBackup);

  page.cancelPending();
  equal(page.data.pendingBackup, null, '待转发状态已丢弃');
  equal(store.getMaterials().length, 1, '数据未变动');
});

group('清空流程 · 页面级端到端（数据体检页：第二条可用路径）');

test('数据体检页同样两步走通', async () => {
  seedOne();
  const page = loadPage('../pages/settings/checkup.js');
  page.data.pendingBackup = null;

  await page.doClear();
  ok(page.data.pendingBackup, '应生成待转发备份');
  equal(store.getMaterials().length, 1, '第一段不清空');

  let pend = null;
  stub.simulateTap(() => { pend = page.onShareBackup(); });
  await pend;

  equal(store.getMaterials().length, 0, '数据已清空');
  equal(page.data.pendingBackup, null);
});

test('数据体检页：未生成备份就点转发 → 友好拒绝，不抛异常', async () => {
  seedOne();
  const page = loadPage('../pages/settings/checkup.js');
  page.data.pendingBackup = null;
  const r = await page.onShareBackup();
  ok(r && r.ok === false, '应返回失败而不是崩溃');
  equal(store.getMaterials().length, 1, '数据未变动');
});

group('清空流程 · 清空前自动留快照（2026-09-26 补）');

// 背景：`_reasonText` 里一直有 'clear' → 「清空前自动保存」的映射，
// 但代码里**从没有生成点** —— 于是清空成了唯一"没有本地后路"的危险操作：
// 走的是"先把完整备份转发到微信"，可那份文件要靠用户自己保存好，丢了就真没了。
// 而清空比恢复更危险（恢复好歹是拿一份完整数据覆盖上来，清空是直接删）。
//
// 这里补上，并守住两条硬约束：
//   ① 快照写不进去 → **中止清空**（绝不带着"没有后路"去删数据）
//   ② 清空后快照必须还在（它不在 DATA_KEYS 里，所以能幸存）—— 否则补了也白补

test('清空前会先留一份快照，内容就是清空前的数据', () => {
  seedOne();
  const before = store.getMaterials().length;
  ok(before > 0, '前置：应有一个物料');

  const r = clearFlow.commitClear();
  equal(r.ok, true);

  const snaps = backupSvc.listInternalSnapshots();
  equal(snaps.length, 1, '应留了一份快照');
  equal(snaps[0].reason, 'clear', 'reason 必须是 clear（界面靠它显示「清空前自动保存」）');
  const saved = snaps[0].data[KEYS.MATERIALS] || [];
  equal(saved.length, before, '快照里应是清空前的完整数据');
});

test('清空后快照仍在，且能真的把数据恢复回来', () => {
  seedOne();
  const before = store.getMaterials().length;
  clearFlow.commitClear();
  equal(store.getMaterials().length, 0, '数据已清空');

  const snaps = backupSvc.listInternalSnapshots();
  equal(snaps.length, 1, '快照必须幸存于清空 —— 否则"恢复出厂"就真没退路了');

  const rr = backupSvc.restoreInternalSnapshot(snaps[0].id);
  equal(rr.ok, true);
  equal(store.getMaterials().length, before, '数据应完整回来');
});

test('快照写不进去 → 中止清空，数据分毫不动（绝不带"没后路"删数据）', () => {
  seedOne();
  const before = store.getMaterials().length;
  stub.faults.storageFull = true;          // 模拟存储已满、写不进去
  const r = clearFlow.commitClear();
  stub.faults.storageFull = false;

  equal(r.ok, false, '写不进快照就必须中止清空');
  equal(r.reason, 'snapshot-fail');
  equal(store.getMaterials().length, before, '数据必须分毫不动');
});

test('页面级：走完「转发」两步后快照已留好，且数据能退回来', async () => {
  seedOne();
  const before = store.getMaterials().length;
  const page = loadPage('../pages/settings/about.js');
  page.data.pendingBackup = null;
  await page.reset();

  let pend = null;
  stub.simulateTap(() => { pend = page.onShareBackup(); });
  await pend;
  equal(store.getMaterials().length, 0, '数据已清空');

  const snaps = backupSvc.listInternalSnapshots();
  ok(snaps.length >= 1, '页面路径（真实点击链路）也必须留快照');
  const rr = backupSvc.restoreInternalSnapshot(snaps[0].id);
  equal(rr.ok, true);
  equal(store.getMaterials().length, before, '能从快照把数据找回来');
});
