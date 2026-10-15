// tests/backup.test.js —— Day 4 备份/恢复（services/backup.js）
// 规格来源：03-实施计划.md 第七节（任务 4.2/4.3/4.4/4.6）
// 出口条件：「导出 → 清空 → 导入 → 完全恢复（含图片）」这条路必须走得通
const { test, group, ok, equal, deepEqual } = require('./harness.js');
const stub = require('./wx-stub.js');
const nodeFs = require('fs');
const path = require('path');

const storage = require('../services/storage.js');
const { KEYS, DATA_KEYS, PRESERVED_ON_CLEAR, ALL_KEYS } = require('../services/keys.js');
const backup = require('../services/backup.js');

// ---------- 测试脚手架 ----------

// 造一份有代表性的数据：两个业务键 + 一个迁移标记（迁移标记不应进备份）
// ⚠️ stub 的临时目录全进程共享，必须先清掉前面用例留下的图片/备份文件，否则计数会串
function seedData() {
  stub.resetStorage();
  nodeFs.readdirSync(stub.dataPath)
    .filter((n) => n.indexOf('photo_') === 0 || n.indexOf('pin-backup-') === 0 || n === 'other.txt')
    .forEach((n) => nodeFs.unlinkSync(path.join(stub.dataPath, n)));
  storage.set(KEYS.MATERIALS, [{ id: 'm1', name: '棉布', totalValue: 100 }]);
  storage.set(KEYS.PRODUCTS, [{ id: 'p1', name: '布包', productions: [] }]);
  storage.set(KEYS.FLOWS, [{ id: 'f1', materialId: 'm1', totalPrice: 100 }]);
  storage.set(KEYS.SETTINGS, { defaultThreshold: 5 });
  storage.set(KEYS.MIGRATED_V1, true); // 元数据
}

function dataPath(name) { return path.join(stub.dataPath, name); }
function writePhoto(name, content) { nodeFs.writeFileSync(dataPath(name), content); }
function readPhoto(name) { return nodeFs.readFileSync(dataPath(name), 'utf8'); }
function photoExists(name) { return nodeFs.existsSync(dataPath(name)); }

group('备份 · 构建与导出');

test('轻量 payload：自描述（kind/version/mode/createdAt），data 只含非空 DATA_KEYS', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  equal(payload.kind, 'pin-backup');
  equal(payload.version, backup.VERSION);
  equal(payload.mode, 'light');
  ok(payload.createdAt > 0, 'createdAt 应为时间戳');
  deepEqual(payload.data[KEYS.MATERIALS], [{ id: 'm1', name: '棉布', totalValue: 100 }]);
  equal(payload.data[KEYS.MIGRATED_V1], undefined, '迁移标记不进备份');
  equal(payload.data[backup.SNAPSHOT_KEY], undefined, '内部快照键不进备份（避免自我嵌套）');
});

test('data 覆盖全部非空业务键（DATA_KEYS 逐键核对）', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  let present = 0;
  DATA_KEYS.forEach((k) => {
    const v = storage.get(k, null);
    if (v !== null) { ok(payload.data[k] !== undefined, '非空业务键应在备份里: ' + k); present++; }
  });
  equal(Object.keys(payload.data).length, present, '备份键数应与当前非空业务键数一致');
});

test('counts 记录数组长度（自检报告用）', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  equal(payload.counts[KEYS.MATERIALS], 1);
  equal(payload.counts[KEYS.FLOWS], 1);
});

test('空值业务键不写入备份（undefined 会丢，避免恢复时误判）', async () => {
  stub.resetStorage();
  storage.set(KEYS.MATERIALS, []);
  const { payload } = await backup.buildPayload('light');
  equal(payload.data[KEYS.MATERIALS], undefined, '空数组也不写（恢复时按「缺失=删除」语义处理）');
  equal(payload.data[KEYS.PRODUCTS], undefined);
});

test('完整模式：photo_* 文件以 base64 内嵌，mime 按扩展名推断', async () => {
  seedData();
  writePhoto('photo_a.jpg', 'jpg-bytes');
  writePhoto('photo_b.png', 'png-bytes');
  nodeFs.writeFileSync(dataPath('other.txt'), 'not-a-photo');
  const { payload } = await backup.buildPayload('full');
  equal(payload.mode, 'full');
  equal(payload.images['photo_a.jpg'].data, Buffer.from('jpg-bytes').toString('base64'));
  equal(payload.images['photo_a.jpg'].mime, 'image/jpeg');
  equal(payload.images['photo_b.png'].mime, 'image/png');
  equal(payload.images['other.txt'], undefined, '非 photo_ 前缀的文件不收');
});

test('estimateBackupSize 与 payload 实际序列化字节数一致', async () => {
  seedData();
  const size = await backup.estimateBackupSize('light');
  const { payload } = await backup.buildPayload('light');
  equal(size, Buffer.byteLength(JSON.stringify(payload), 'utf8'));
});

test('体积超限 → 写文件被拒绝（code TOO_LARGE），且不留半截文件', async () => {
  seedData();
  writePhoto('photo_big.jpg', 'x'.repeat(2048));
  let caught = null;
  await backup.writeBackupFile('full', { maxBytes: 100 }).catch((e) => { caught = e; });
  ok(caught, '超限应拒绝');
  equal(caught.code, 'TOO_LARGE');
  ok(nodeFs.readdirSync(stub.dataPath).every((f) => f.indexOf('pin-backup-') !== 0), '不应写出备份文件');
});

test('writeBackupFile：文件落地、可被 JSON.parse、内容与 payload 一致', async () => {
  seedData();
  const r = await backup.writeBackupFile('light');
  ok(r.path.indexOf(stub.dataPath) === 0, '应写在 USER_DATA_PATH');
  ok(/pin-backup-.*\.json$/.test(r.path), '文件名应为 pin-backup-*.json');
  ok(r.name.indexOf('别针手作库备份') === 0, '转发显示名应是中文');
  const onDisk = JSON.parse(nodeFs.readFileSync(r.path, 'utf8'));
  equal(onDisk.kind, 'pin-backup');
  deepEqual(onDisk.data[KEYS.MATERIALS], [{ id: 'm1', name: '棉布', totalValue: 100 }]);
  equal(r.sizeBytes, nodeFs.statSync(r.path).size);
});

group('备份 · 导入校验');

test('损坏的 JSON → 拒绝导入，且现有数据分毫不动', () => {
  seedData();
  const r = backup.parseBackup('{{{ 不是 JSON');
  equal(r.ok, false);
  ok(r.error, '应有可读错误说明');
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'm1', name: '棉布', totalValue: 100 }], '现有数据完好');
});

test('kind 不符（不是本程序的备份）→ 拒绝', () => {
  const r = backup.parseBackup(JSON.stringify({ kind: 'other-app', version: 1, data: { a: 1 } }));
  equal(r.ok, false);
});

test('版本高于当前程序 → 拒绝并说明（防止旧程序读坏新数据）', () => {
  const r = backup.parseBackup(JSON.stringify({ kind: 'pin-backup', version: backup.VERSION + 1, data: { a: 1 } }));
  equal(r.ok, false);
});

test('data 为空或缺失 → 拒绝', () => {
  equal(backup.parseBackup(JSON.stringify({ kind: 'pin-backup', version: backup.VERSION })).ok, false);
  equal(backup.parseBackup(JSON.stringify({ kind: 'pin-backup', version: backup.VERSION, data: {} })).ok, false);
});

test('合法 payload → ok:true 且带出 payload', () => {
  const p = { kind: 'pin-backup', version: backup.VERSION, mode: 'light', createdAt: 1, counts: {}, data: { x: 1 } };
  const r = backup.parseBackup(JSON.stringify(p));
  equal(r.ok, true);
  deepEqual(r.payload.data, { x: 1 });
});

group('备份 · 恢复');

test('轻量恢复：导出 → 改乱 → 恢复 → 逐 key 相等', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  // 改乱当前数据
  storage.set(KEYS.MATERIALS, [{ id: 'wrong', name: '被改乱' }]);
  storage.set(KEYS.FLOWS, []);
  const report = await backup.restoreFromPayload(payload);
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'm1', name: '棉布', totalValue: 100 }]);
  deepEqual(storage.get(KEYS.FLOWS, null), [{ id: 'f1', materialId: 'm1', totalPrice: 100 }]);
  equal(report.keysRestored, 4, 'materials/products/flows/settings 四键');
});

test('恢复语义 = 完全回到备份时点：备份中缺失的键被清掉', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  storage.set(KEYS.TOOLS, [{ id: 't1' }]); // 备份之后新买的工具
  await backup.restoreFromPayload(payload);
  equal(storage.get(KEYS.TOOLS, null), null, '备份里没有的键应被删除，否则旧账新账混在一起');
});

test('完整恢复：图片文件被还原（内容与备份时一致）', async () => {
  seedData();
  writePhoto('photo_keep.jpg', 'original-content');
  const { payload } = await backup.buildPayload('full');
  nodeFs.unlinkSync(dataPath('photo_keep.jpg')); // 模拟清空/丢图
  ok(!photoExists('photo_keep.jpg'));
  const report = await backup.restoreFromPayload(payload);
  equal(report.imagesRestored, 1);
  equal(readPhoto('photo_keep.jpg'), 'original-content', '文件内容应与备份时一致');
});

test('轻量恢复不动图片文件（轻量模式不含图片）', async () => {
  seedData();
  writePhoto('photo_stay.jpg', 'stay');
  const { payload } = await backup.buildPayload('light');
  const report = await backup.restoreFromPayload(payload);
  equal(report.imagesRestored, 0);
  equal(readPhoto('photo_stay.jpg'), 'stay');
});

test('恢复前自动生成内部快照（自救底线）', async () => {
  seedData();
  const { payload } = await backup.buildPayload('light');
  const before = backup.listInternalSnapshots().length;
  await backup.restoreFromPayload(payload);
  const list = backup.listInternalSnapshots();
  equal(list.length, before + 1);
  equal(list[0].reason, 'restore');
});

test('importBackupFile：读文件 → 校验 → 恢复 全链路', async () => {
  seedData();
  const r = await backup.writeBackupFile('light');
  storage.set(KEYS.MATERIALS, [{ id: 'wrong' }]);
  const report = await backup.importBackupFile(r.path);
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'm1', name: '棉布', totalValue: 100 }]);
  ok(report.keysRestored > 0);
});

test('importBackupFile：损坏文件 → 拒绝且数据不动', async () => {
  seedData();
  const bad = dataPath('pin-backup-bad.json');
  nodeFs.writeFileSync(bad, 'not json at all');
  let caught = null;
  await backup.importBackupFile(bad).catch((e) => { caught = e; });
  ok(caught, '损坏文件应拒绝');
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'm1', name: '棉布', totalValue: 100 }]);
});

group('三保险 · 内部快照');

test('快照键：在 ALL_KEYS、不在 DATA_KEYS、在清空保留白名单', () => {
  ok(ALL_KEYS.indexOf(backup.SNAPSHOT_KEY) >= 0, '应在 KEYS 体系内（接受重复值检查）');
  ok(DATA_KEYS.indexOf(backup.SNAPSHOT_KEY) === -1, '不进备份（避免自我嵌套）');
  ok(PRESERVED_ON_CLEAR.indexOf(backup.SNAPSHOT_KEY) >= 0, '清空数据后快照必须还在（最后的自救手段）');
});

test('连续创建 4 份快照 → 只保留最近 3 份，最新在前', () => {
  stub.resetStorage();
  backup.createInternalSnapshot('s1');
  backup.createInternalSnapshot('s2');
  backup.createInternalSnapshot('s3');
  backup.createInternalSnapshot('s4');
  const list = backup.listInternalSnapshots();
  equal(list.length, 3);
  equal(list[0].reason, 's4');
  equal(list[2].reason, 's2');
});

test('restoreInternalSnapshot：恢复到快照时点；恢复前当前状态也被快照', () => {
  stub.resetStorage();
  storage.set(KEYS.MATERIALS, [{ id: 'A' }]);
  const snap = backup.createInternalSnapshot('阶段A');
  storage.set(KEYS.MATERIALS, [{ id: 'B' }]);
  const report = backup.restoreInternalSnapshot(snap.id);
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'A' }]);
  const list = backup.listInternalSnapshots();
  ok(list.some((s) => s.reason === 'before-restore-snapshot'), '恢复前状态应有快照');
  deepEqual(list.find((s) => s.reason === 'before-restore-snapshot').data[KEYS.MATERIALS], [{ id: 'B' }]);
});

test('clearAll 之后快照仍在（清空不是绝路）', () => {
  stub.resetStorage();
  storage.set(KEYS.MATERIALS, [{ id: 'm1' }]);
  backup.createInternalSnapshot('清空前');
  storage.clearAll();
  ok(backup.listInternalSnapshots().length === 1, '快照应幸存');
  const s = backup.listInternalSnapshots()[0];
  equal(s.data[KEYS.MATERIALS][0].id, 'm1', '快照内容可用');
});

test('快照存储损坏 → list 返回空数组，不崩', () => {
  stub.resetStorage();
  storage.set(backup.SNAPSHOT_KEY, 'corrupted-string');
  equal(backup.listInternalSnapshots().length, 0);
  storage.set(backup.SNAPSHOT_KEY, 42);
  equal(backup.listInternalSnapshots().length, 0);
});

group('任务 4.7 · 清空前强制备份（本层只负责「生成」，转发由页面 TAP 触发）');

test('prepareClearBackup：生成完整备份（中文文件名）、不转发、不动业务数据', async () => {
  seedData();
  const r = await backup.prepareClearBackup();
  equal(r.ok, true);
  ok(r.name.indexOf('别针手作库备份') === 0, '转发文件名应可识别');
  ok(r.path.indexOf(stub.dataPath) === 0);
  equal(stub.toasts.filter((t) => t.shareFileMessage).length, 0,
    '生成阶段绝不转发 —— 微信要求 shareFileMessage 必须由 TAP 手势同步触发，异步调用必被拒绝');
  // 生成≠清空：业务数据必须还在
  ok(storage.get(KEYS.MATERIALS, null) !== null, '生成备份本身不动数据');
});

test('备份文件写不出来 → { ok:false, stage:write } 并带出可读错误，数据分毫不动', async () => {
  seedData();
  stub.faults.writeFileFail = true;
  const r = await backup.prepareClearBackup();
  equal(r.ok, false);
  equal(r.stage, 'write');
  ok(r.error, '应带出错误信息供页面提示');
  deepEqual(storage.get(KEYS.MATERIALS, null), [{ id: 'm1', name: '棉布', totalValue: 100 }]);
});

group('真机修复 · 空间预检 / 错误文案 / 备份时压缩旧图');

test('TOO_LARGE 错误必须带可读 msg（含出路建议），不能再吐笼统文案', async () => {
  seedData();
  writePhoto('photo_big.jpg', 'x'.repeat(2048));
  let caught = null;
  await backup.writeBackupFile('full', { maxBytes: 100 }).catch((e) => { caught = e; });
  ok(caught && caught.msg, '错误要带 msg 字段');
  ok(caught && caught.message, '错误要带 message 字段（页面两处读法都要能取到）');
  ok(caught && caught.msg.indexOf('轻量') >= 0, 'msg 里要给出「轻量模式」这条出路');
});

test('9MB 大图完整备份不再被过时配额误伤（真机回归 2026-09-12）', async () => {
  seedData();
  cleanupPhotos();
  nodeFs.writeFileSync(dataPath('photo_huge.jpg'), 'x'.repeat(9 * 1024 * 1024));
  const r = await backup.writeBackupFile('full'); // 不传 maxBytes，走真实默认
  ok(r.sizeBytes > 9 * 1024 * 1024, '9MB 原图内嵌后应能成功写出（base64 膨胀 ~33%）');
  ok(nodeFs.existsSync(r.path), '备份文件真实存在');
});

test('轻量备份不受「剩余空间收紧」影响（真机回归：小 JSON 也曾被拒）', async () => {
  seedData();
  cleanupPhotos();
  nodeFs.writeFileSync(dataPath('photo_filler.jpg'), 'x'.repeat(199 * 1024 * 1024)); // 剩余空间趋近 0
  const r = await backup.writeBackupFile('light'); // 轻量不含图片，JSON 极小
  ok(r.sizeBytes > 0 && r.sizeBytes < 1024 * 1024);
  ok(nodeFs.existsSync(r.path), '轻量备份必须能正常写出');
});

test('超过 200KB 的旧图：备份时先压缩再内嵌（原图文件不动）', async () => {
  seedData();
  cleanupPhotos();
  writePhoto('photo_old.jpg', 'o'.repeat(300 * 1024)); // 300KB 旧图
  writePhoto('photo_small.jpg', 's'.repeat(1024));     // 1KB 小图
  const { payload } = await backup.buildPayload('full');
  const compressCalls = stub.toasts.filter((t) => t.compressImage);
  ok(compressCalls.length === 1, '只有大图触发压缩，实际 ' + compressCalls.length + ' 次');
  ok(payload.images['photo_old.jpg'] && payload.images['photo_small.jpg'], '两张图都要进备份');
  ok(nodeFs.existsSync(dataPath('photo_old.jpg')), '原图文件必须保持不动');
});

function cleanupPhotos() {
  nodeFs.readdirSync(stub.dataPath)
    .filter((n) => n.indexOf('photo_') === 0 || n.indexOf('pin-backup-') === 0 || n === 'other.txt')
    .forEach((n) => nodeFs.unlinkSync(path.join(stub.dataPath, n)));
}

group('真机修复 · 孤儿图片清理 + 备份文件清理');

test('findOrphanPhotos：被数据引用的图算在用，没被引用的是孤儿', async () => {
  seedData();
  cleanupPhotos();
  writePhoto('photo_used.jpg', 'u');
  writePhoto('photo_orphan.jpg', 'o');
  storage.set(KEYS.MATERIALS, [{ id: 'm1', name: '棉布', photos: [stub.dataPath + '/photo_used.jpg'] }]);
  const r = await backup.findOrphanPhotos();
  equal(r.referencedCount, 1);
  equal(r.orphans.length, 1);
  equal(r.orphans[0].name, 'photo_orphan.jpg');
});

test('deleteOrphanPhotos：删除指定图片并统计释放量；非 photo_ 前缀拒绝删除', async () => {
  seedData();
  cleanupPhotos();
  writePhoto('photo_a.jpg', 'aaaa');
  nodeFs.writeFileSync(dataPath('pin-backup-x.json'), '{}');
  const r = await backup.deleteOrphanPhotos(['photo_a.jpg', 'pin-backup-x.json', '../evil.jpg']);
  equal(r.deleted, 1, '只删 photo_ 前缀');
  equal(r.freedBytes, 4);
  ok(!photoExists('photo_a.jpg'));
  ok(nodeFs.existsSync(dataPath('pin-backup-x.json')), '备份文件不在删除名单内');
});

test('cleanupBackupFiles：转发后清理历史备份，保留刚生成的这份', async () => {
  seedData();
  cleanupPhotos();
  nodeFs.writeFileSync(dataPath('pin-backup-old1.json'), '1');
  nodeFs.writeFileSync(dataPath('pin-backup-old2.json'), '22');
  nodeFs.writeFileSync(dataPath('pin-backup-keep.json'), '333');
  const r = await backup.cleanupBackupFiles(dataPath('pin-backup-keep.json'));
  equal(r.deleted, 2);
  equal(r.freedBytes, 3);
  ok(nodeFs.existsSync(dataPath('pin-backup-keep.json')), '当前份保留');
});
