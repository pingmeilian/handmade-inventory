// tests/photo-restore.test.js —— P5：换机恢复（把云端图片找回本机）
//
// 与 P4 上传是**反方向**，难点也完全不同：
//
// ① **单张失败不能拖垮整体**：换机时本地是空的，要下载几十张；
//    某一张坏了就整件事失败是说不通的 —— 但要**如实报告**几张成功、几张失败，
//    不能让用户以为"全好了"。
// ② **恢复回来的图必须标记为已同步**：否则 init 的本地扫描会把它们当成
//    "本地有、但没传过"，又原样传回云端一遍（幂等但白烧流量）。
// ③ **文件名必须保持原名**：数据里存的是本地路径，靠名字对上号。
//
// 平台事实（与 P3/P4 同源）：客户端不能列云存储目录 → 清单只能问云函数 photoIndex。

const fs = require('fs');
const path = require('path');
const { test, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const cloud = require('../services/cloud.js');
const ps = require('../services/photo-sync.js');
const storage = require('../services/storage.js');

const OPENID = 'oREAL_test_openid_A';
const LOCAL = stub.wx.env.USER_DATA_PATH;
const FN = 'photoIndex';

function cloudKey(name) { return 'photos/' + OPENID + '/' + name; }
function localPath(name) { return path.join(LOCAL, name); }

function putCloudPhoto(name, content) {
  stub.cloudFiles.set(cloudKey(name), { content: content == null ? 'IMG-' + name : content });
}

function record(name) {
  return {
    name: name,
    fileID: 'cloud://cloudbase-test-env/' + cloudKey(name),
    sizeBytes: 100,
    updatedAt: Date.now()
  };
}

// 本地图片目录是跨用例共享的真实临时目录，必须清干净（同 photo-sync.test.js）
function cleanLocalPhotos() {
  let files = [];
  try { files = fs.readdirSync(LOCAL); } catch (_) { return; }
  files.filter((n) => n.indexOf('photo_') === 0).forEach((n) => {
    try { fs.unlinkSync(path.join(LOCAL, n)); } catch (_) { /* 忽略 */ }
  });
}

function setup(opts) {
  const o = opts || {};
  stub.resetStorage();
  cleanLocalPhotos();
  ps.reset();
  if (o.cloud === false) stub.faults.cloudInitFail = true;
  stub.setCloudResult(FN, { ok: true, records: [] });
  cloud.init();
  ps.init({ debounceMs: 10000, maxRetry: 1, retryDelayMs: 5 });
}

// ---------- 清单为空 / 云不可用 ----------

test('恢复 · 云端一张图都没有 → 成功恢复 0 张（不是错误）', async () => {
  setup();
  const r = await ps.restorePhotos();
  equal(r.ok, true);
  equal(r.total, 0);
  equal(r.restored, 0);
});

test('恢复 · 云不可用 → 零云调用，明确返回 cloud-disabled', async () => {
  setup({ cloud: false });
  const r = await ps.restorePhotos();
  equal(r.ok, false);
  equal(r.reason, 'cloud-disabled');
  equal(stub.cloudDownloads.length, 0, '云不可用时连一次下载都不该发');
  equal(stub.cloudCalls.length, 0);
});

test('恢复 · 清单拉取失败 → 明确失败，不假装成功', async () => {
  setup();
  stub.setCloudResult(FN, { ok: false, msg: '读库失败' });
  const r = await ps.restorePhotos();
  equal(r.ok, false);
  equal(r.reason, 'index-fail');
});

// ---------- 正常恢复 ----------

test('恢复 · 云端 3 张 → 全部落到本地，且**保持原名**、内容一致', async () => {
  setup();
  putCloudPhoto('photo_a.jpg', 'AAA');
  putCloudPhoto('photo_b.jpg', 'BBB');
  putCloudPhoto('photo_c.jpg', 'CCC');
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg'), record('photo_b.jpg'), record('photo_c.jpg')] });

  const r = await ps.restorePhotos();
  equal(r.ok, true);
  equal(r.total, 3);
  equal(r.restored, 3);
  equal(r.failed, 0);
  ok(fs.existsSync(localPath('photo_a.jpg')), '文件名必须保持原名（数据里靠名字对上）');
  equal(fs.readFileSync(localPath('photo_b.jpg'), 'utf8'), 'BBB', '内容要与云端一致');
});

test('恢复 · 本地已有同名文件 → 以云端为准（覆盖）', async () => {
  setup();
  fs.writeFileSync(localPath('photo_a.jpg'), 'LOCAL-OLD');
  putCloudPhoto('photo_a.jpg', 'FROM-CLOUD');
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg')] });

  await ps.restorePhotos();
  equal(fs.readFileSync(localPath('photo_a.jpg'), 'utf8'), 'FROM-CLOUD');
});

// ---------- 部分失败 ----------

test('恢复 · 某张下载失败 → 其余照常恢复，failed 如实计数（不假装全好）', async () => {
  setup();
  putCloudPhoto('photo_a.jpg');
  putCloudPhoto('photo_c.jpg');
  // b 在清单里，但云盘里没有 → 下载会失败
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg'), record('photo_b.jpg'), record('photo_c.jpg')] });

  const r = await ps.restorePhotos();
  equal(r.ok, true, '部分失败不该让整体失败 —— 换机时"救回大部分"远好过"一张都不救"');
  equal(r.total, 3);
  equal(r.restored, 2, '能救的要救回来');
  equal(r.failed, 1, '失败的必须如实报出来');
  ok(fs.existsSync(localPath('photo_a.jpg')));
  ok(fs.existsSync(localPath('photo_c.jpg')));
});

// ---------- 与上传队列的配合（易漏点） ----------

test('恢复后的图被标记为已同步 —— 否则会被当成"没传过"又传回云端一遍', async () => {
  setup();
  putCloudPhoto('photo_a.jpg');
  putCloudPhoto('photo_b.jpg');
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg'), record('photo_b.jpg')] });

  await ps.restorePhotos();
  equal(ps.status().synced, 2, '恢复回来的图必须计入"已传"，否则白烧一遍流量');

  // 再模拟一次启动：init 的本地扫描不应把它们排进待传
  ps.reset();
  const pendingBefore = ps.status().pending;
  ps.init({ debounceMs: 10000, maxRetry: 1, retryDelayMs: 5 });
  equal(ps.status().pending, pendingBefore, '已同步的图不该被重新排进待传队列');
});

// ---------- 性能与进度 ----------

test('恢复 · 清单只拉一次（不逐张问云函数）', async () => {
  setup();
  putCloudPhoto('photo_a.jpg');
  putCloudPhoto('photo_b.jpg');
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg'), record('photo_b.jpg')] });

  await ps.restorePhotos();
  const indexCalls = stub.cloudCalls.filter((c) => c.name === FN).length;
  equal(indexCalls, 1, 'N 张图只该拉 1 次清单（逐张问会白烧云函数调用次数）');
});

test('恢复 · 进度回调按张推进，能报给界面用', async () => {
  setup();
  putCloudPhoto('photo_a.jpg');
  putCloudPhoto('photo_b.jpg');
  stub.setCloudResult(FN, { ok: true, records: [record('photo_a.jpg'), record('photo_b.jpg')] });

  const seen = [];
  await ps.restorePhotos({ onProgress: (done, total) => seen.push(done + '/' + total) });
  equal(seen.length, 2);
  equal(seen[0], '1/2');
  equal(seen[1], '2/2');
});
