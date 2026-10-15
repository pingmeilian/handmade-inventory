// tests/storage.test.js —— 存储内核（services/storage.js）
// 重点：验证「写失败不再静默」这条加固真的生效
const { test, group, ok, equal, near } = require('./harness.js');
const stub = require('./wx-stub.js');

const storage = require('../services/storage.js');
const { KEYS, ALL_KEYS, PRESERVED_ON_CLEAR, DATA_KEYS } = require('../services/keys.js');

group('storage · 键定义');

test('KEYS 无重复值', () => {
  const seen = {};
  ALL_KEYS.forEach((k) => {
    equal(seen[k], undefined, '重复的 storage key: ' + k);
    seen[k] = true;
  });
});

test('所有业务 key 都带 bm_ 前缀（便于识别归属）', () => {
  ALL_KEYS.forEach((k) => {
    ok(k.indexOf('bm_') === 0, 'key 缺前缀: ' + k);
  });
});

test('清空时保留的键在白名单里，且不含业务数据键与种子标记', () => {
  // 3 个：本机标识 + 真实微信身份 + 内部快照
  equal(PRESERVED_ON_CLEAR.length, 3);
  ok(PRESERVED_ON_CLEAR.indexOf(KEYS.OPENID) >= 0);
  // REAL_OPENID 必须保留（2026-09-21 云备份）：清空后仍要认得出「云端哪份备份是我的」，
  // 否则用户清空 → 想从云端恢复时认不出身份，方案直接失效。
  ok(PRESERVED_ON_CLEAR.indexOf(KEYS.REAL_OPENID) >= 0, '真实身份必须幸存于清空，否则清空后无法从云端恢复');
  ok(PRESERVED_ON_CLEAR.indexOf(KEYS.BACKUP_SNAPSHOTS) >= 0, '内部快照必须幸存于清空（最后的自救手段）');
  ok(PRESERVED_ON_CLEAR.indexOf(KEYS.SEEDED) === -1, 'SEEDED 不保留：清空 = 恢复出厂，预设必须重发');
  DATA_KEYS.forEach((k) => {
    equal(PRESERVED_ON_CLEAR.indexOf(k), -1, '业务数据键不应在保留白名单里: ' + k);
  });
});

test('DATA_KEYS 是 ALL_KEYS 的子集（迁移标记等元数据不进备份）', () => {
  DATA_KEYS.forEach((k) => {
    ok(ALL_KEYS.indexOf(k) >= 0, 'DATA_KEYS 含未定义的 key: ' + k);
  });
  ok(DATA_KEYS.length < ALL_KEYS.length, '迁移标记类 key 不应算业务数据');
});

group('storage · 读写');

test('读写往返正常', () => {
  stub.resetStorage();
  equal(storage.set('k_a', { n: 1 }), true, '写入应返回 true');
  equal(storage.get('k_a', null).n, 1);
});

test('读不到时返回默认值', () => {
  stub.resetStorage();
  equal(storage.get('k_missing', 'def'), 'def');
  equal(storage.get('k_missing', 0), 0);
});

test('remove 删除后可读回默认值', () => {
  stub.resetStorage();
  storage.set('k_b', 1);
  storage.remove('k_b');
  equal(storage.get('k_b', 'gone'), 'gone');
});

group('storage · ⚠️ 写失败不再静默（本次加固的核心）');

test('⚠️ 写入失败返回 false，且不抛异常', () => {
  stub.resetStorage();
  stub.faults.storageFull = true;
  let threw = false;
  let ret;
  try { ret = storage.set('k_c', 1); } catch (e) { threw = true; }
  equal(threw, false, '不应抛异常（否则页面会崩）');
  equal(ret, false, '应返回 false 告知失败');
});

test('⚠️ 写入失败会通知订阅者，并带上出错的 key', () => {
  stub.resetStorage();
  storage.resetLastError();
  const seen = [];
  storage.onWriteError((e) => seen.push(e));

  stub.faults.storageFull = true;
  storage.set(KEYS.MATERIALS, []);

  equal(seen.length, 1, '订阅者应被调用一次');
  equal(seen[0].key, KEYS.MATERIALS);
  ok(typeof seen[0].at === 'number', '应带时间戳');
  ok(String(seen[0].message).length > 0, '应带可读错误信息');
});

test('lastWriteError 记录最近一次失败', () => {
  stub.resetStorage();
  storage.resetLastError();
  equal(storage.lastWriteError(), null);

  stub.faults.storageFull = true;
  storage.set('k_d', 1);
  ok(storage.lastWriteError() !== null, '应记录失败');
  equal(storage.lastWriteError().key, 'k_d');
});

test('订阅者自身抛错不影响写入流程与返回值', () => {
  stub.resetStorage();
  storage.onWriteError(() => { throw new Error('订阅者炸了'); });
  stub.faults.storageFull = true;
  let threw = false;
  let ret;
  try { ret = storage.set('k_e', 1); } catch (e) { threw = true; }
  equal(threw, false);
  equal(ret, false);
});

test('恢复正常后写入成功，不再报错', () => {
  stub.resetStorage();
  storage.resetLastError();
  stub.faults.storageFull = true;
  storage.set('k_f', 1);
  stub.faults.storageFull = false;
  equal(storage.set('k_f', 2), true, '恢复后应写入成功');
  equal(storage.get('k_f', null), 2);
});

group('storage · 容量');

test('usage 返回用量与上限', () => {
  stub.resetStorage();
  storage.set('k_g', 'x'.repeat(1024));
  const u = storage.usage();
  ok(u.currentSize > 0, '应统计到用量');
  equal(u.limitSize, 10240, '默认上限 10MB');
  ok(u.ratio > 0 && u.ratio < 1);
});

test('isNearFull：低于 80% 为 false，超过为 true', () => {
  stub.resetStorage();
  storage.set('k_h', 'x'.repeat(1000));
  equal(storage.isNearFull(), false, '占用极低时不应告警');

  // 把上限压到 1KB，当前占用已超过 → 应告警
  stub.faults.limitSizeKB = 1;
  equal(storage.isNearFull(), true, '超过 80% 应告警');
});

test('canFit 判断追加数据是否放得下', () => {
  stub.resetStorage();
  stub.faults.limitSizeKB = 10;          // 上限 10KB
  storage.set('k_i', 'x'.repeat(7 * 1024)); // 已用约 7KB

  const small = storage.canFit(1024);    // 再加 1KB → 放得下
  equal(small.ok, true);
  ok(small.freeKB <= 3 && small.freeKB > 0, '剩余空间约 3KB');

  const big = storage.canFit(8 * 1024);  // 再加 8KB → 放不下
  equal(big.ok, false);
});

group('storage · ⚠️ 数据损坏护栏（本次加固）');

test('⚠️ 期望数组但存的是字符串 → 安全降级为空数组，不崩页', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  stub.storage.set('bm_materials', '这不是数组');   // 直接塞坏数据，绕过 set 的类型一致假设

  const arr = storage.get('bm_materials', []);
  equal(Array.isArray(arr), true, '必须返回数组，否则调用方 .filter 会抛错');
  equal(arr.length, 0);
});

test('⚠️ 期望数组但存的是对象 → 同样降级为空数组', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  stub.storage.set('bm_materials', { oops: true });
  const arr = storage.get('bm_materials', []);
  equal(Array.isArray(arr), true);
  equal(arr.length, 0);
});

test('损坏时留下记录（含 key、期望类型、实际类型、时间戳）', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  stub.storage.set('bm_flows', 12345);

  storage.get('bm_flows', []);

  const c = storage.lastCorruptionInfo();
  ok(c !== null, '应记录损坏事件');
  equal(c.key, 'bm_flows');
  equal(c.expected, 'array');
  equal(c.actual, 'number');
  ok(typeof c.at === 'number');
});

test('损坏事件可订阅（供排查与提示）', () => {
  stub.resetStorage();
  const seen = [];
  storage.onCorruption((e) => seen.push(e));
  stub.storage.set('bm_products', 'bad');
  storage.get('bm_products', []);
  equal(seen.length, 1);
});

test('期望对象但存的是数组 → 降级为默认对象', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  stub.storage.set('bm_settings', ['not', 'an', 'object']);
  const obj = storage.get('bm_settings', { defaultUnit: '个' });
  equal(Array.isArray(obj), false);
  equal(obj.defaultUnit, '个');
});

test('类型正确时原样返回，不误报损坏', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  storage.set('bm_materials', [{ id: 'm1' }]);
  equal(storage.get('bm_materials', []).length, 1);
  equal(storage.lastCorruptionInfo(), null, '类型正确不应报损坏');
});

test('原始类型（数字/布尔/字符串）不做护栏，原样返回', () => {
  stub.resetStorage();
  storage.resetLastCorruption();
  storage.set('bm_seeded', true);
  equal(storage.get('bm_seeded', false), true, '布尔原样返回');
  storage.set('k_num', 42);
  equal(storage.get('k_num', 0), 42, '数字原样返回');
  equal(storage.lastCorruptionInfo(), null);
});

group('storage · 清空');

test('clearAll 清掉业务数据，但保留种子标记与本地标识', () => {
  stub.resetStorage();
  storage.set(KEYS.MATERIALS, [{ id: 'm1' }]);
  storage.set(KEYS.FLOWS, [{ id: 'f1' }]);
  storage.set(KEYS.SEEDED, true);
  storage.set(KEYS.OPENID, 'local_abc');

  storage.clearAll();

  equal(storage.get(KEYS.MATERIALS, null), null, '物料应被清空');
  equal(storage.get(KEYS.FLOWS, null), null, '流水应被清空');
  equal(storage.get(KEYS.SEEDED, null), null, '种子标记不保留：清空 = 恢复出厂，下次 ensureSeed 重发预设');
  equal(storage.get(KEYS.OPENID, null), 'local_abc', '本地标识应保留');
});
