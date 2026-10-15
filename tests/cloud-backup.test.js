// tests/cloud-backup.test.js —— P3：把备份同步到云端（**云端保留 2 份**）
//
// 这块的重点不是「能传上去」，而是**别把好备份传坏**：
// 如果新版传到一半失败、却覆盖了云端唯一那份，用户想恢复都没得恢复 ——
// 那是"为了防丢数据，反而制造了一种新的丢法"。所以下面大半用例在测失败路径。
//
// 另一个关键设计：客户端**不能列云存储目录**（平台没给这个能力），
// 所以「云端有哪些备份」必须靠云函数里的一张索引表来查 —— 否则换机后根本不知道
// 自己的备份文件叫什么、在哪儿。索引存的是元数据（fileID/时间/大小），不是业务数据。

const fs = require('fs');
const path = require('path');
const { test, ok, equal, deepEqual } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const cloud = require('../services/cloud.js');
const cb = require('../services/cloud-backup.js');
const backupSvc = require('../services/backup.js');

const OPENID = 'oREAL_test_openid_A';
const PATH_A = 'backups/' + OPENID + '/slot-a.json';
const PATH_B = 'backups/' + OPENID + '/slot-b.json';

// 每个用例一套干净地基：清存储 → 复位模块 → 初始化云
function setup(opts) {
  const o = opts || {};
  stub.resetStorage();
  cb.reset();
  // ⚠️ 每次都必须调 cloud.init()：它是「复位 + 重新判定」。
  // 而 cloud.js 里的 inited 是模块级单例，不调就会残留上一个用例的"云可用"状态，
  // 于是"云不可用"的用例实际走了正常路径 —— 这类隔离缺陷最容易骗过眼睛。
  if (o.cloud === false) stub.faults.cloudInitFail = true;
  cloud.init();
  cb.init();
}

// ⚠️ fileID 前缀必须与桩的 CLOUD_ENV（'cloudbase-test-env'）一致：
// 桩靠前缀把 fileID 还原成云盘 key，前缀不符时下载会莫名失败 ——
// 那时测出来的就不是你想测的那件事了。
function slotRecord(slot, updatedAt) {
  return {
    slot: slot,
    fileID: 'cloud://cloudbase-test-env/backups/' + OPENID + '/slot-' + slot + '.json',
    updatedAt: updatedAt
  };
}

// ---------- 选槽规则（2 份轮转的核心） ----------

test('选槽 · 云端一张备份都没有 → 写 a', () => {
  equal(cb.pickTargetSlot([]), 'a');
});

test('选槽 · 只有 a → 写 b（绝不覆盖刚存的那份）', () => {
  equal(cb.pickTargetSlot([slotRecord('a', 100)]), 'b');
});

test('选槽 · 只有 b → 写 a', () => {
  equal(cb.pickTargetSlot([slotRecord('b', 100)]), 'a');
});

test('选槽 · a、b 都有 → 覆盖较旧的那个', () => {
  equal(cb.pickTargetSlot([slotRecord('a', 100), slotRecord('b', 200)]), 'a');
  equal(cb.pickTargetSlot([slotRecord('a', 300), slotRecord('b', 100)]), 'b');
});

test('选槽 · 云端返回脏数据（null/undefined/空对象）也要给出确定结果，不能返 undefined', () => {
  equal(cb.pickTargetSlot(null), 'a');
  equal(cb.pickTargetSlot(undefined), 'a');
  equal(cb.pickTargetSlot([{}]), 'a');
});

test('选槽 · 结果只可能是 a 或 b（永远只有两个槽）', () => {
  const cases = [[], [slotRecord('a', 1)], [slotRecord('b', 1)],
    [slotRecord('a', 1), slotRecord('b', 2)], [slotRecord('a', 9), slotRecord('b', 2)]];
  cases.forEach((c) => {
    const s = cb.pickTargetSlot(c);
    ok(s === 'a' || s === 'b', '必须是 a 或 b，实际：' + s);
  });
});

// ---------- 上传 ----------

test('上传 · 首次：写 slot-a，路径按真实微信身份隔离', async () => {
  setup();
  stub.setCloudResult('backupIndex', (d) => (d.action === 'get' ? { ok: true, records: [] } : { ok: true }));

  const r = await cb.uploadNow();
  equal(r.ok, true);
  equal(r.slot, 'a');
  equal(stub.cloudUploads.length, 1);
  equal(stub.cloudUploads[0].cloudPath, PATH_A);
});

test('上传 · 已有 a 时写 b（保住最新的那份）', async () => {
  setup();
  stub.setCloudResult('backupIndex', (d) => (d.action === 'get'
    ? { ok: true, records: [slotRecord('a', 100)] }
    : { ok: true }));

  const r = await cb.uploadNow();
  equal(r.slot, 'b');
  equal(stub.cloudUploads[0].cloudPath, PATH_B);
});

test('上传 · 传上去的内容就是可解析的备份（不是空文件）', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [] }));

  await cb.uploadNow();
  const f = stub.cloudFiles.get(PATH_A);
  ok(f, '云端应存在 slot-a.json');
  const parsed = JSON.parse(f.content);
  equal(parsed.kind, 'pin-backup', '云端存的必须是备份格式，否则恢复时解不开');
});

test('上传 · 索引写入要带上 fileID 与时间戳（云端靠它判新旧）', async () => {
  setup();
  const puts = [];
  stub.setCloudResult('backupIndex', (d) => {
    if (d.action === 'get') return { ok: true, records: [] };
    puts.push(d);
    return { ok: true };
  });

  await cb.uploadNow();
  equal(puts.length, 1);
  equal(puts[0].slot, 'a');
  ok(String(puts[0].fileID).indexOf('slot-a.json') >= 0, 'put 必须带上刚上传的 fileID');
  ok(puts[0].updatedAt > 0, 'put 必须带 updatedAt');
});

test('上传 · 云端保留 2 份：连续三次上传应落在 a → b → a', async () => {
  setup();
  const records = [];
  const paths = [];
  stub.setCloudResult('backupIndex', (d) => {
    if (d.action === 'get') return { ok: true, records: records.slice() };
    records.push({ slot: d.slot, fileID: d.fileID, updatedAt: d.updatedAt });
    paths.push(d.slot);
    return { ok: true };
  });

  await cb.uploadNow();
  await cb.uploadNow();
  await cb.uploadNow();
  equal(paths.join(','), 'a,b,a', '应当是两槽轮转，实际：' + paths.join(','));
  equal(stub.cloudUploads.length, 3);
});

// ---------- 失败路径：旧备份必须完好 ----------

test('失败 · 上传失败 → 不写索引（旧备份原封不动）', async () => {
  setup();
  stub.faults.cloudUploadFail = true;
  const calls = [];
  stub.setCloudResult('backupIndex', (d) => { calls.push(d); return { ok: true, records: [] }; });

  const r = await cb.uploadNow();
  equal(r.ok, false);
  equal(r.reason, 'upload-fail');
  equal(r.notified, true, '失败必须让上层能提示用户，不许静默');
  const putCalls = calls.filter((c) => c.action === 'put');
  equal(putCalls.length, 0, '文件都没传成，绝不能让索引指向一个不存在的文件');
});

test('失败 · 索引写入失败 → 明确报 index-fail，不假装成功', async () => {
  setup();
  stub.setCloudResult('backupIndex', (d) => (d.action === 'get' ? { ok: true, records: [] } : { ok: false, msg: 'db down' }));

  const r = await cb.uploadNow();
  equal(r.ok, false);
  equal(r.reason, 'index-fail');
});

test('失败 · 索引云函数直接抛错 → 也报 index-fail，不静默', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => { throw new Error('boom'); });

  const r = await cb.uploadNow();
  equal(r.ok, false);
  equal(r.reason, 'index-fail');
});

test('失败 · 上传后必须清理临时文件（不能越传越占空间）', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [] }));

  await cb.uploadNow();
  const leftover = stub.cloudUploads
    .map((u) => u.filePath)
    .filter((p) => p && require('fs').existsSync(p));
  equal(leftover.length, 0, '上传用的临时文件应被删掉，残留：' + leftover.join(','));
});

// ---------- 云不可用：完整降级为纯本地 ----------

test('降级 · 云没初始化时上传返回 cloud-disabled，且不发起任何云调用', async () => {
  setup({ cloud: false });
  const r = await cb.uploadNow();
  equal(r.ok, false);
  equal(r.reason, 'cloud-disabled');
  equal(stub.cloudUploads.length, 0);
  equal(stub.cloudCalls.length, 0, '云不可用时不该去打云函数');
});

test('降级 · 云不可用时调度上传不抛异常（绝不能比纯本地更差）', () => {
  setup({ cloud: false });
  let threw = false;
  try { cb.scheduleUpload('offline'); } catch (e) { threw = true; }
  equal(threw, false);
});

test('降级 · fetchIndex 在云不可用时返回 ok:false 而不是抛错', async () => {
  setup({ cloud: false });
  const r = await cb.fetchIndex();
  equal(r.ok, false);
  equal(r.reason, 'cloud-disabled');
});

// ---------- 自动触发与去抖 ----------

test('触发 · 业务数据写入 → 登记待传', () => {
  setup();
  storage.set(KEYS.MATERIALS, [{ id: 'm1' }]);
  equal(cb.status().pending, true);
});

test('触发 · 写非业务键（例如云备份自身的状态）不该触发 —— 否则会自己叫自己', () => {
  setup();
  storage.set('bm_cloud_backup_state', { at: 1 });
  equal(cb.status().pending, false);
});

test('触发 · 连续三次调度只上传一次（去抖合并，省流量）', async () => {
  setup();
  let puts = 0;
  stub.setCloudResult('backupIndex', (d) => {
    if (d.action === 'get') return { ok: true, records: [] };
    puts++;
    return { ok: true };
  });

  cb.scheduleUpload('a');
  cb.scheduleUpload('b');
  cb.scheduleUpload('c');
  await cb.flush();

  equal(stub.cloudUploads.length, 1, '三次调度应合并成一次上传');
  equal(puts, 1);
});

test('触发 · init 可重复调用而不重复挂钩子（否则一次写入会触发多次上传）', async () => {
  setup();
  cb.init();
  cb.init();
  stub.setCloudResult('backupIndex', (d) => (d.action === 'get' ? { ok: true, records: [] } : { ok: true }));

  cb.scheduleUpload('x');
  await cb.flush();
  equal(stub.cloudUploads.length, 1);
});

// ---------- 索引读取（换机恢复的地基） ----------

test('索引 · fetchIndex 返回云端记录（含 fileID，换机后靠它找回备份）', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('b', 999)] }));

  const r = await cb.fetchIndex();
  equal(r.ok, true);
  equal(r.records.length, 1);
  equal(r.records[0].slot, 'b');
  ok(r.records[0].fileID, '必须带上 fileID');
});

// ---------- 界面支撑：状态展示 / 备份点列表 / 从云端恢复 ----------

test('状态 · 「重启」后仍能读到上次同步时间（必须落盘，否则界面会谎报"从未同步"）', async () => {
  setup();
  stub.setCloudResult('backupIndex', (d) => (d.action === 'get' ? { ok: true, records: [] } : { ok: true }));
  await cb.uploadNow();
  const before = cb.status().lastUploadAt;
  ok(before > 0, '上传成功后应留下时间戳');

  // 模拟重启：只清内存状态，storage 保留
  cb.reset();
  cloud.init();
  cb.init();
  equal(cb.status().lastUploadAt, before, '重启后必须还能读到上次同步时间');
});

test('状态 · 云不可用时 enabled 为 false（界面据此显示"未开启"）', () => {
  setup({ cloud: false });
  equal(cb.status().enabled, false);
});

test('备份点 · 按时间倒序返回（界面要显示"最新 / 上一个"）', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100), slotRecord('b', 300)] }));

  const r = await cb.cloudBackups();
  equal(r.ok, true);
  equal(r.list.length, 2);
  equal(r.list[0].slot, 'b', '最新的排前面');
  equal(r.list[1].slot, 'a');
});

test('备份点 · 云不可用 → ok:false（不抛错）', async () => {
  setup({ cloud: false });
  const r = await cb.cloudBackups();
  equal(r.ok, false);
});

test('恢复 · 云不可用 → 明确失败，不假装成功', async () => {
  setup({ cloud: false });
  const r = await cb.restoreFromCloud();
  equal(r.ok, false);
  equal(r.reason, 'cloud-disabled');
});

test('恢复 · 云端一个备份都没有 → reason 为 no-backup', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [] }));

  const r = await cb.restoreFromCloud();
  equal(r.ok, false);
  equal(r.reason, 'no-backup');
});

test('恢复 · 下载失败 → 明确失败，且本地数据分毫未动', async () => {
  setup();
  storage.set(KEYS.MATERIALS, [{ id: 'keep-me' }]);
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));
  stub.faults.cloudDownloadFail = true;

  const r = await cb.restoreFromCloud();
  equal(r.ok, false);
  equal(r.reason, 'download-fail');
  deepEqual(storage.get(KEYS.MATERIALS, []), [{ id: 'keep-me' }], '恢复失败绝不能动本地数据');
});

test('恢复 · 下载到的不是备份文件 → 明确失败，本地数据仍不动', async () => {
  setup();
  storage.set(KEYS.MATERIALS, [{ id: 'keep-me' }]);
  stub.cloudFiles.set('backups/' + OPENID + '/slot-a.json', { content: '这不是 JSON' });
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));

  const r = await cb.restoreFromCloud();
  equal(r.ok, false);
  deepEqual(storage.get(KEYS.MATERIALS, []), [{ id: 'keep-me' }], '校验没过就绝不能动数据');
});

test('恢复 · 成功 → 数据回来了，且自动留了本地快照（万一恢复错了还能退）', async () => {
  setup();
  // 造一份合法的「云端备份文件」
  const payload = {
    kind: 'pin-backup', version: 1, mode: 'lite', createdAt: Date.now(),
    counts: {}, data: {}
  };
  payload.data[KEYS.MATERIALS] = [{ id: 'from-cloud', name: '云端物料' }];
  stub.cloudFiles.set('backups/' + OPENID + '/slot-a.json', { content: JSON.stringify(payload) });
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));

  // 本地是另一副样子（模拟"换了台手机"/数据被改乱）
  storage.set(KEYS.MATERIALS, [{ id: 'local-changed' }]);
  const snapBefore = backupSvc.listInternalSnapshots().length;

  const r = await cb.restoreFromCloud();
  equal(r.ok, true);
  const list = storage.get(KEYS.MATERIALS, []);
  equal(list.length, 1);
  equal(list[0].id, 'from-cloud', '应当恢复成云端那一版');
  ok(backupSvc.listInternalSnapshots().length > snapBefore, '恢复前必须自动留一份快照');
});

// ---------- 指定还原点恢复（2026-09-26 新增） ----------
//
// 背景：界面上一直只显示"云端有 2 个还原点"，但恢复函数写死取最新的那份 ——
// 用户看着两条一模一样的记录，既分不清又选不了。
// 于是补上"指定恢复哪一份"。⚠️ 这是**覆盖全部数据**的动作，所以拒绝一切含糊输入：
// 指定的槽不存在、或取值非法，都必须明确失败并**分毫不动本地数据**。

function mkPayload(tag) {
  const p = { kind: 'pin-backup', version: 1, mode: 'lite', createdAt: Date.now(), counts: {}, data: {} };
  p.data[KEYS.MATERIALS] = [{ id: tag }];
  return p;
}

test('恢复 · 指定 slot=b → 拿的就是 b，绝不用更新的 a 糊弄', async () => {
  setup();
  // a 更新（160）、b 较旧（100）—— 若不看 slot 只挑最新，就会错拿 a
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 160), slotRecord('b', 100)] }));
  stub.cloudFiles.set('backups/' + OPENID + '/slot-a.json', { content: JSON.stringify(mkPayload('from-A')) });
  stub.cloudFiles.set('backups/' + OPENID + '/slot-b.json', { content: JSON.stringify(mkPayload('from-B')) });

  const r = await cb.restoreFromCloud({ slot: 'b' });
  equal(r.ok, true);
  equal(r.slot, 'b');
  equal(storage.get(KEYS.MATERIALS, [])[0].id, 'from-B', '指定 b 就必须拿到 b 的内容');
});

test('恢复 · 不指定 slot → 仍取最新那份（默认行为不变）', async () => {
  setup();
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100), slotRecord('b', 160)] }));
  stub.cloudFiles.set('backups/' + OPENID + '/slot-a.json', { content: JSON.stringify(mkPayload('old-A')) });
  stub.cloudFiles.set('backups/' + OPENID + '/slot-b.json', { content: JSON.stringify(mkPayload('new-B')) });

  const r = await cb.restoreFromCloud();
  equal(r.ok, true);
  equal(r.slot, 'b', 'b 更新，不指定时应恢复 b');
  equal(storage.get(KEYS.MATERIALS, [])[0].id, 'new-B');
});

test('恢复 · 指定的 slot 云端并没有 → 明确失败，本地数据分毫不动', async () => {
  setup();
  storage.set(KEYS.MATERIALS, [{ id: 'keep-me' }]);
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));

  const r = await cb.restoreFromCloud({ slot: 'b' });
  equal(r.ok, false);
  equal(r.reason, 'no-such-slot');
  deepEqual(storage.get(KEYS.MATERIALS, []), [{ id: 'keep-me' }], '找不到那份就绝不能动数据');
});

test('恢复 · slot 取值非法 → 直接拒绝（绝不做"猜一个"的危险动作）', async () => {
  setup();
  storage.set(KEYS.MATERIALS, [{ id: 'keep-me' }]);
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));

  const r = await cb.restoreFromCloud({ slot: 'x' });
  equal(r.ok, false);
  equal(r.reason, 'bad-slot');
  deepEqual(storage.get(KEYS.MATERIALS, []), [{ id: 'keep-me' }]);
});

// ---------- 数据 + 图片一起回家（P5 换机恢复的完整链路） ----------

test('恢复 · 数据回来后接着把图片也找回来（换机时"记录和图一起回家"）', async () => {
  setup();
  const photoName = 'photo_restore_me.jpg';
  const localPhoto = path.join(stub.wx.env.USER_DATA_PATH, photoName);

  // 云端：一份合法备份 + 一张图
  stub.cloudFiles.set('backups/' + OPENID + '/slot-a.json', { content: JSON.stringify(mkPayload('from-cloud')) });
  stub.setCloudResult('backupIndex', () => ({ ok: true, records: [slotRecord('a', 100)] }));
  stub.cloudFiles.set('photos/' + OPENID + '/' + photoName, { content: 'PIC' });
  stub.setCloudResult('photoIndex', () => ({
    ok: true,
    records: [{
      name: photoName,
      fileID: 'cloud://cloudbase-test-env/photos/' + OPENID + '/' + photoName,
      sizeBytes: 3,
      updatedAt: 1
    }]
  }));

  try {
    const r = await cb.restoreFromCloud();
    equal(r.ok, true);
    equal(storage.get(KEYS.MATERIALS, [])[0].id, 'from-cloud', '数据要回来');
    ok(r.photos, '结果里必须带上图片恢复情况（页面要据此如实告知用户）');
    equal(r.photos.restored, 1, '图片也要找回来 —— 否则换机后记录在、图全丢，等于只找回一半');
    ok(fs.existsSync(localPhoto), '图片应落到本地原名位置');
  } finally {
    try { fs.unlinkSync(localPhoto); } catch (_) { /* 清理，避免影响其它用例 */ }
  }
});
