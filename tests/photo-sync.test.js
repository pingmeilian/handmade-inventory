// tests/photo-sync.test.js —— P4：图片上云
//
// 这块的难点不是"把文件传上去"（那是 cloud.uploadFile 的事），而是三件容易做错的事：
//
// ① **别重复传**：图片是流量大头。已传过的必须认得出来，换一批就重传一遍属于白烧流量。
// ② **别把待传清单卡死**：本地图被删掉后，它若还留在待传清单里，就会每次重试都失败、
//    永远排在最前面 —— 一张幽灵图能把整条图片同步拖停。
// ③ **别拖慢本地**：传图是后台的事，用户存图必须立刻成功，绝不能等网络。
//
// 平台事实（与 P3 同源）：客户端**不能列云存储目录** → 上传后必须由云函数登记清单，
// 否则换机后不知道云端有哪些图，等于白传。

const fs = require('fs');
const path = require('path');
const { test, ok, equal, deepEqual } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const cloud = require('../services/cloud.js');
const ps = require('../services/photo-sync.js');

const OPENID = 'oREAL_test_openid_A';
const LOCAL = stub.wx.env.USER_DATA_PATH;
const FN = 'photoIndex';

// ---------- 工具 ----------

function tick(ms) {
  return new Promise((r) => setTimeout(r, ms == null ? 5 : ms));
}

// 等条件成立（比固定 sleep 稳：慢机器上不会假红）
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 800)) {
    if (fn()) return true;
    await tick(5);
  }
  return false;
}

function makePhoto(name, content) {
  const p = path.join(LOCAL, name);
  fs.writeFileSync(p, content == null ? 'IMG-' + name : content);
  return p;
}

// 本地图片目录是**跨用例共享**的真实临时目录：不清理的话，前一个用例造的图
// 会被下一个用例的 init() 扫描到并自动入队 —— 于是"入队 1 张应传 1 张"变成传 N 张。
function cleanLocalPhotos() {
  let files = [];
  try { files = fs.readdirSync(LOCAL); } catch (_) { return; }
  files.filter((n) => n.indexOf('photo_') === 0).forEach((n) => {
    try { fs.unlinkSync(path.join(LOCAL, n)); } catch (_) { /* 忽略 */ }
  });
}

function cloudKey(name) {
  return 'photos/' + OPENID + '/' + name;
}

function uploadPaths() {
  return stub.cloudUploads.map((u) => u.cloudPath);
}

// 每个用例一套干净地基
function setup(opts) {
  const o = opts || {};
  stub.resetStorage();
  cleanLocalPhotos();
  ps.reset();
  // 每次都必须 cloud.init()：它是「复位 + 重新判定」，而 inited 是模块级单例，
  // 不复位就会残留上一个用例的"云可用"状态（这类隔离缺陷最容易骗过眼睛）
  if (o.cloud === false) stub.faults.cloudInitFail = true;
  // 索引登记默认返回成功；个别用例会覆盖它
  stub.setCloudResult(FN, { ok: true });
  cloud.init();
  // 去抖设得远大于用例等待时间：这样"攒批期间不该上传"才测得准；
  // 重试延迟设小，否则失败用例要等 3 秒退避
  ps.init({ debounceMs: 10000, maxRetry: 1, retryDelayMs: 5 });
}

// ---------- 云端路径：保持原文件名 ----------

test('云端路径 · 用原名，不含路径（数据结构零改动的前提）', () => {
  equal(ps.photoCloudPath(OPENID, 'photo_1.jpg'), 'photos/' + OPENID + '/photo_1.jpg');
});

test('云端路径 · 空身份时返回空串，绝不拼出半截路径', () => {
  equal(ps.photoCloudPath('', 'photo_1.jpg'), '');
});

// ---------- 攒批 ----------

test('攒批 · 只入队 1 张（未达阈值）不会立刻上传', async () => {
  setup();
  makePhoto('photo_a.jpg');
  ps.enqueue('photo_a.jpg');
  await tick(30);
  equal(stub.cloudUploads.length, 0, '攒批期间不该有上传');
});

test('攒批 · 手动 flush 后立刻上传，路径与内容都对', async () => {
  setup();
  makePhoto('photo_a.jpg', 'AAA');
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(stub.cloudUploads.length, 1);
  equal(uploadPaths()[0], cloudKey('photo_a.jpg'));
  const f = stub.cloudFiles.get(cloudKey('photo_a.jpg'));
  ok(f, '云端应出现该文件');
  equal(f.content, 'AAA', '传上去的必须是文件真实内容');
});

test('攒批 · 攒够阈值后自动开传，不用手动 flush', async () => {
  setup();
  for (let i = 1; i <= ps.DEFAULT_BATCH; i++) makePhoto('photo_b' + i + '.jpg');
  for (let i = 1; i <= ps.DEFAULT_BATCH; i++) ps.enqueue('photo_b' + i + '.jpg');
  const done = await waitFor(() => stub.cloudUploads.length >= ps.DEFAULT_BATCH);
  ok(done, '攒够 ' + ps.DEFAULT_BATCH + ' 张应自动开传（实际 ' + stub.cloudUploads.length + ' 张）');
});

// ---------- 去重 ----------

test('去重 · 已传过的不再传（第二次入队零上传）', async () => {
  setup();
  makePhoto('photo_a.jpg');
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(stub.cloudUploads.length, 1);

  ps.enqueue('photo_a.jpg');       // 同一张再来一次
  await ps.flush();
  equal(stub.cloudUploads.length, 1, '已传过的不该重复上传');
});

test('去重 · 空文件名 / 非字符串入队被忽略（不污染清单）', async () => {
  setup();
  ps.enqueue('');
  ps.enqueue(null);
  ps.enqueue(undefined);
  ps.enqueue(123);
  await ps.flush();
  equal(stub.cloudUploads.length, 0);
  equal(ps.status().pending, 0);
});

// ---------- 失败与兜底 ----------

test('失败 · 上传失败留在待传清单，不假装成功', async () => {
  setup();
  makePhoto('photo_a.jpg');
  stub.faults.cloudUploadFail = true;
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(ps.status().pending, 1, '失败的那张必须留在待传清单里等下次');
  equal(ps.status().synced, 0, '不许登记进"已传"—— 否则永远不再重试');
});

test('重试 · 恢复后 flush 能补传成功，待传清空', async () => {
  setup();
  makePhoto('photo_a.jpg');
  stub.faults.cloudUploadFail = true;
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(ps.status().pending, 1);

  stub.faults.cloudUploadFail = false;
  await ps.flush();
  equal(ps.status().pending, 0);
  equal(ps.status().synced, 1);
  ok(stub.cloudFiles.has(cloudKey('photo_a.jpg')));
});

test('兜底 · 本地文件已不存在时从待传清单移除（否则会永久卡住整条同步）', async () => {
  setup();
  makePhoto('photo_gone.jpg');
  ps.enqueue('photo_gone.jpg');
  fs.unlinkSync(path.join(LOCAL, 'photo_gone.jpg'));   // 模拟用户删了这张图

  await ps.flush();
  equal(ps.status().pending, 0, '无源可传的幽灵图必须清掉，不能永远重试');
  equal(stub.cloudUploads.length, 0);
});

test('兜底 · 云不可用时零云调用、不抛错、入队静默无害', async () => {
  setup({ cloud: false });
  makePhoto('photo_a.jpg');
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(stub.cloudUploads.length, 0, '云没配好时连一次上传都不该发');
  equal(stub.cloudCalls.length, 0, '也不该调云函数');
  equal(ps.status().synced, 0);
});

test('索引 · 登记失败则该张不算成功（否则成为"没人知道它存在"的孤儿文件）', async () => {
  setup();
  makePhoto('photo_a.jpg');
  stub.setCloudResult(FN, { ok: false, msg: '写库失败' });
  ps.enqueue('photo_a.jpg');
  await ps.flush();
  equal(ps.status().synced, 0);
  equal(ps.status().pending, 1, '索引没记上就必须留着重试（重传同名文件是幂等的）');
});

// ---------- 落盘与状态 ----------

test('落盘 · 待传清单写入存储，重启（reset+init）后仍能补传', async () => {
  setup();
  makePhoto('photo_a.jpg');
  ps.enqueue('photo_a.jpg');
  equal(ps.status().pending, 1, '入队即应在待传清单里可见');

  ps.reset();          // 模拟小程序退出 / 模块重载
  cloud.init();
  ps.init({ debounceMs: 10000, maxRetry: 1, retryDelayMs: 5 });
  equal(ps.status().pending, 1, '重启后待传清单必须还在（否则这次改动就永久丢了）');
  await ps.flush();
  equal(ps.status().synced, 1);
});

test('状态 · synced 计数与上次同步时间可供界面展示', async () => {
  setup();
  makePhoto('photo_a.jpg');
  makePhoto('photo_b.jpg');
  ps.enqueue('photo_a.jpg');
  ps.enqueue('photo_b.jpg');
  await ps.flush();
  const s = ps.status();
  equal(s.synced, 2);
  equal(s.pending, 0);
  ok(s.enabled, '云可用时应为 enabled');
  ok(s.lastSyncAt > 0, '应有上次同步时间（界面要显示"刚刚 / x 分钟前"）');
});

// ---------- 与本地流程的关系 ----------

test('不阻塞 · 存图成功后自动入队，且云失败绝不影响保存结果', async () => {
  setup();
  const store = require('../utils/store.js');
  const src = path.join(LOCAL, 'temp-pick.jpg');
  fs.writeFileSync(src, 'PICKED');

  const dest = await store.savePhoto(src);
  ok(dest && dest.indexOf('photo_') >= 0, '存图本身必须成功（不能因为云而失败）');

  const name = path.basename(dest);
  equal(ps.status().pending, 1, '存图后应自动进入待传清单');

  stub.faults.cloudUploadFail = true;
  await ps.flush();                       // 上传全失败
  ok(fs.existsSync(dest), '本地文件不受云失败影响');
  equal(ps.status().pending, 1);
});
