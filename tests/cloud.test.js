// tests/cloud.test.js —— 云能力封装 + 真实微信身份接入（P1）
//
// 为什么这两块要一起测：它们是整个云备份的**地基**——
//   · 云封装若"静默失败"，上层会以为上传成功，其实数据没上去（比报错更糟）
//   · 身份若没切到真实 openid，换手机后云端认不出你 → 备份白存（方案直接失效）
// 所以：云调用失败必须**明确 reject 且带 code**，身份获取失败必须**优雅回退本地**且不阻塞。

const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const cloud = require('../services/cloud.js');
const store = require('../utils/store.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');

group('云能力封装 · 基本契约');

test('云初始化失败时，调用要明确拒绝（code=cloud-disabled），绝不静默', async () => {
  stub.resetStorage();
  stub.faults.cloudInitFail = true;
  equal(cloud.init(), false, 'init 应返回 false');
  equal(cloud.isReady(), false, '未就绪');
  let err = null;
  await cloud.callFunction('getOpenid', {}).catch((e) => { err = e; });
  ok(err, '应 reject，不能静默 resolve');
  equal(err.code, 'cloud-disabled', '要带 code，调用方据此降级为纯本地');
  stub.faults.cloudInitFail = false;
});

test('callFunction 成功 → 返回 result', async () => {
  stub.resetStorage();
  cloud.init();
  const r = await cloud.callFunction('getOpenid', {});
  equal(r.openid, 'oREAL_test_openid_A');
  equal(stub.cloudCalls.length, 1, '应记录到一次云函数调用');
  equal(stub.cloudCalls[0].name, 'getOpenid');
});

test('callFunction 平台失败 → reject 且带平台原因（不静默）', async () => {
  stub.resetStorage();
  cloud.init();
  stub.faults.cloudFail = true;
  let err = null;
  await cloud.callFunction('getOpenid', {}).catch((e) => { err = e; });
  ok(err, '应 reject');
  ok(String(err.msg || '').indexOf('callFunction') >= 0, '要带上平台原因，便于排查：' + JSON.stringify(err));
  stub.faults.cloudFail = false;
});

test('uploadFile 成功 → 返回 fileID，且云端真的有这个文件', async () => {
  stub.resetStorage();
  cloud.init();
  const fileID = await cloud.uploadFile('backups/oA/bk-1.json', '/tmp/x.json');
  ok(fileID.indexOf('cloud://') === 0, 'fileID 应以 cloud:// 开头：' + fileID);
  equal(stub.cloudFiles.size, 1, '云端应存在 1 个文件');
});

test('uploadFile 平台失败 → reject（上层才知道要不要重试）', async () => {
  stub.resetStorage();
  cloud.init();
  stub.faults.cloudUploadFail = true;
  let err = null;
  await cloud.uploadFile('backups/oA/bk-1.json', '/tmp/x.json').catch((e) => { err = e; });
  ok(err, '应 reject');
  ok(String(err.msg || '').indexOf('uploadFile') >= 0);
  stub.faults.cloudUploadFail = false;
});

test('下载不存在的文件 → reject（不能静默返回空路径）', async () => {
  stub.resetStorage();
  cloud.init();
  let err = null;
  await cloud.downloadFile('cloud://nope/xxx.json').catch((e) => { err = e; });
  ok(err, '应 reject');
});

test('deleteFile 会真正从云端移除', async () => {
  stub.resetStorage();
  cloud.init();
  const id = await cloud.uploadFile('photos/oA/a.jpg', '/tmp/a.jpg');
  await cloud.deleteFile([id]);
  equal(stub.cloudFiles.size, 0, '删除后云端应为空');
});

group('真实身份接入 · ensureRealOpenid');

test('拿到真实 openid → 写入并替换本地随机码', async () => {
  stub.resetStorage();
  cloud.init();
  store.ensureSeed();
  const before = store.getOpenid();
  ok(before.indexOf('oid_') === 0, '初始应是本机随机码：' + before);

  const real = await store.ensureRealOpenid();
  equal(real, 'oREAL_test_openid_A', '应返回云函数给的真实身份');
  equal(store.getOpenid(), 'oREAL_test_openid_A', '之后一律用真实身份（换手机才认得出你）');
  equal(storage.get(KEYS.REAL_OPENID, ''), 'oREAL_test_openid_A', '真实身份要落盘');
});

test('云不可用 → 保持本地身份，不阻塞也不抛错（纯本地模式照常用）', async () => {
  stub.resetStorage();
  stub.faults.cloudInitFail = true;
  cloud.init();
  store.ensureSeed();
  const real = await store.ensureRealOpenid();
  ok(real.indexOf('oid_') === 0, '应回退到本地随机码：' + real);
  stub.faults.cloudInitFail = false;
});

test('云函数没返回 openid → 回退本地身份（不抛错、不写入脏值）', async () => {
  stub.resetStorage();
  cloud.init();
  store.ensureSeed();
  stub.setCloudOpenid(null);
  const real = await store.ensureRealOpenid();
  ok(real.indexOf('oid_') === 0, '应回退到本地随机码：' + real);
  equal(storage.get(KEYS.REAL_OPENID, ''), '', '失败时不应写入脏的真实身份');
  stub.setCloudOpenid('oREAL_test_openid_A');
});

test('已有真实身份 → 直接用缓存，不再打云函数（省启动开销）', async () => {
  stub.resetStorage();
  cloud.init();
  store.ensureSeed();
  await store.ensureRealOpenid();
  const callsAfterFirst = stub.cloudCalls.length;
  const again = await store.ensureRealOpenid();
  equal(again, 'oREAL_test_openid_A');
  equal(stub.cloudCalls.length, callsAfterFirst, '第二次不应再调云函数');
});
