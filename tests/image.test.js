// tests/image.test.js —— Day 4 任务 4.1/4.5：图片压缩 + USER_DATA_PATH 容量
// 规格来源：03-实施计划.md 第七节 + 兜底审计 P2-2（图片落盘无容量预检）
const { test, group, ok, equal, deepEqual } = require('./harness.js');
const stub = require('./wx-stub.js');
const nodeFs = require('fs');
const path = require('path');

const image = require('../utils/image.js');

function dataPath(name) { return path.join(stub.dataPath, name); }

// 清掉 dataPath 里所有文件（stub 临时目录全进程共享，backup 等用例会留下残留）
function cleanup() {
  nodeFs.readdirSync(stub.dataPath)
    .forEach((n) => nodeFs.unlinkSync(dataPath(n)));
}

// 最近一次 compressImage 收到的参数（stub 记录在 toasts 里）
function lastCompressCall() {
  for (let i = stub.toasts.length - 1; i >= 0; i--) {
    if (stub.toasts[i].compressImage) return stub.toasts[i].compressImage;
  }
  return null;
}

group('image · 压缩');

test('大图：quality 70 + 长边压到 1280（等比）', async () => {
  stub.resetStorage();
  const out = await image.compressPhoto('/tmp/x.jpg'); // 1600x1200（stub 默认）
  const call = lastCompressCall();
  ok(call, '应调用 compressImage');
  equal(call.quality, 70);
  equal(call.compressedWidth, 1280);
  equal(call.compressedHeight, 960);
  equal(out, '/tmp/x.jpg', 'stub 回传原路径，压缩链路走通即可');
});

test('小图：只压质量，不改尺寸', async () => {
  stub.resetStorage();
  stub.wx.__nextImageInfo = { width: 800, height: 600 };
  await image.compressPhoto('/tmp/small.jpg');
  const call = lastCompressCall();
  equal(call.compressedWidth, undefined, '长边未超 1280 不应指定压缩尺寸');
  equal(call.quality, 70);
});

test('compressImage 失败 → 回退原图，不阻断选图流程', async () => {
  stub.resetStorage();
  stub.faults.compressFail = true;
  const out = await image.compressPhoto('/tmp/keep.jpg');
  equal(out, '/tmp/keep.jpg');
});

test('getImageInfo 失败 → 回退原图（尺寸拿不到就只按原图走）', async () => {
  stub.resetStorage();
  stub.faults.imageInfoFail = true;
  const out = await image.compressPhoto('/tmp/keep2.jpg');
  equal(out, '/tmp/keep2.jpg');
  equal(lastCompressCall(), null, '拿不到尺寸时不应盲目压缩');
});

group('image · USER_DATA_PATH 容量');

test('空目录用量为 0，上限 200MB（真机实证：旧版 10MB 是错误认知，69MB 文件真实存在）', async () => {
  stub.resetStorage();
  cleanup();
  const u = await image.userDataUsage();
  equal(u.used, 0);
  equal(u.limit, 200 * 1024 * 1024);
  equal(u.free, u.limit);
});

test('写入已知大小文件后用量准确，并区分图片数（photoCount）', async () => {
  stub.resetStorage();
  cleanup();
  nodeFs.writeFileSync(dataPath('photo_1.jpg'), 'a'.repeat(1000));
  nodeFs.writeFileSync(dataPath('photo_2.png'), 'b'.repeat(500));
  nodeFs.writeFileSync(dataPath('pin-backup-x.json'), 'c'.repeat(10));
  const u = await image.userDataUsage();
  equal(u.used, 1510);
  equal(u.count, 3);
  equal(u.photoCount, 2, '图片数只数 photo_ 前缀（修复：横幅曾把备份文件也算成「图片」）');
});

test('hasRoomFor：剩余不足时拒绝（savePhoto 按「典型照片预留量」判断）', async () => {
  stub.resetStorage();
  cleanup();
  nodeFs.writeFileSync(dataPath('photo_big.jpg'), 'x'.repeat(200 * 1024 * 1024 - 100 * 1024));
  ok(!(await image.hasRoomFor(image.RESERVED_BYTES)), '剩余 100KB 放不下一张典型照片（预留 500KB）→ 应拒绝');
  ok(await image.hasRoomFor(100), '剩余 100KB > 100B → 应放行');
});

group('image · savePhoto 集成（store.js）');

test('空间将满时 savePhoto 拒绝并给出可读原因', async () => {
  stub.resetStorage();
  cleanup();
  nodeFs.writeFileSync(dataPath('photo_huge.jpg'), 'x'.repeat(200 * 1024 * 1024 - 100 * 1024));
  const store = require('../utils/store.js');
  let caught = null;
  await store.savePhoto('/tmp/new.jpg').catch((e) => { caught = e; });
  ok(caught, '空间将满应拒绝保存');
  ok(caught && caught.msg, '应有可读提示');
  ok(caught && caught.code === 'DISK_FULL', 'code 应为 DISK_FULL');
});

test('空间充足时 savePhoto 正常落盘（文件名 photo_ 前缀）', async () => {
  stub.resetStorage();
  cleanup();
  const src = dataPath('tmp_src.jpg');
  nodeFs.writeFileSync(src, 'fake-image-bytes'); // 模拟 chooseMedia 返回的真实临时文件
  const store = require('../utils/store.js');
  const dest = await store.savePhoto(src);
  ok(dest.indexOf('photo_') >= 0, '落盘文件应为 photo_ 前缀');
  ok(nodeFs.existsSync(dest), '文件应真实存在');
  equal(nodeFs.readFileSync(dest, 'utf8'), 'fake-image-bytes');
});
