// tests/sync-queue.test.js —— 同步队列的行为测试（去抖 / 串行 / 重试 / 待传标记）
//
// 为什么这块要重点测：它是"上传顺序"的唯一保障。它一旦出错，会出现
// **旧数据覆盖新数据** —— 比丢数据更隐蔽、更难救（用户以为存上了，其实被回退了）。
// 所以本文件先写、先红，再补实现。

const { test, group, ok, equal } = require('./harness.js');
const syncQueue = require('../utils/sync-queue.js');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 可控的内存存储（模拟 wx.storage）：用来验证"待传标记"有没有落盘
function memStorage() {
  const m = {};
  return {
    get: function (k, d) { return k in m ? m[k] : d; },
    set: function (k, v) { m[k] = v; },
    _raw: m
  };
}

group('同步队列 · 去抖（连续改动合并成一次）');

test('连续 schedule 只跑一次，且用最后一次的任务（覆盖语义）', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 10 });
  q.schedule(() => { ran.push('A'); return Promise.resolve(); });
  q.schedule(() => { ran.push('B'); return Promise.resolve(); });
  q.schedule(() => { ran.push('C'); return Promise.resolve(); });
  await sleep(50);
  equal(ran.length, 1, '三次 schedule 应合并为一次');
  equal(ran[0], 'C', '应执行最后一次（最新数据），不是第一次');
});

test('间隔超过去抖窗口 → 各跑一次', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 10 });
  q.schedule(() => { ran.push(1); return Promise.resolve(); });
  await sleep(40);
  q.schedule(() => { ran.push(2); return Promise.resolve(); });
  await sleep(40);
  equal(ran.length, 2, '两次相隔足够远，应各跑一次');
});

group('同步队列 · 串行（防"旧覆盖新"）');

test('执行中到来的任务会排队，绝不并发', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const q = syncQueue.create({ debounceMs: 5 });
  const mk = function (ms) {
    return function () {
      return new Promise(function (res) {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        setTimeout(function () { concurrent--; res(); }, ms);
      });
    };
  };
  q.schedule(mk(40));
  await sleep(20);          // 第一个已经开始执行
  q.schedule(mk(10));       // 执行中到来
  await sleep(150);
  equal(maxConcurrent, 1, '同一时刻只能有一个任务在跑（否则会乱序覆盖）');
});

test('执行中连续到来多次 → 补跑时只再跑一次，且用最新的', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 5 });
  const slow = function () { return new Promise(function (res) { setTimeout(res, 40); }); };
  q.schedule(() => { ran.push('first'); return slow(); });
  await sleep(20);
  q.schedule(() => { ran.push('x'); return Promise.resolve(); });
  q.schedule(() => { ran.push('y'); return Promise.resolve(); });
  q.schedule(() => { ran.push('z'); return Promise.resolve(); });
  await sleep(200);
  equal(ran.length, 2, '第一次 + 补齐一次 = 2 次');
  equal(ran[1], 'z', '补齐那次用的是最新任务');
});

group('同步队列 · 失败重试与待传标记');

test('失败会重试；成功后停止重试且状态回 idle', async () => {
  let attempts = 0;
  const q = syncQueue.create({ debounceMs: 5, maxRetry: 3, retryDelayMs: 10 });
  q.schedule(() => {
    attempts++;
    return attempts < 3 ? Promise.reject(new Error('net')) : Promise.resolve();
  });
  await sleep(300);
  equal(attempts, 3, '前两次失败，第三次成功');
  equal(q.status(), 'idle', '成功后应回到 idle');
  equal(q.hasPending(), false, '成功后不应再有待传标记');
});

test('重试超过上限 → 状态 error + 落"待传"标记（下次启动能补传）', async () => {
  const st = memStorage();
  const q = syncQueue.create({ debounceMs: 5, maxRetry: 2, retryDelayMs: 10, storage: st, pendingKey: 'k_pending' });
  q.schedule(() => Promise.reject(new Error('offline')));
  await sleep(400);
  equal(q.status(), 'error', '连续失败到上限应进入 error');
  equal(q.hasPending(), true, '应有待传标记');
  ok(st.get('k_pending', null) != null, '待传标记必须落盘（否则重开会丢）');
});

test('启动时读得到上次留下的待传标记', () => {
  const st = memStorage();
  st.set('k_pending', { at: 123 });
  const q = syncQueue.create({ storage: st, pendingKey: 'k_pending' });
  equal(q.hasPending(), true, '应能识别上次未完成的同步');
});

test('成功后抹掉待传标记', async () => {
  const st = memStorage();
  const q = syncQueue.create({ debounceMs: 5, storage: st, pendingKey: 'k_pending' });
  st.set('k_pending', { at: 1 });
  q.schedule(() => Promise.resolve());
  await sleep(50);
  equal(q.hasPending(), false, '成功后内存态应为"无待传"');
  equal(st.get('k_pending', null), null, '成功后应把标记抹掉');
});

group('同步队列 · flush / 状态回调 / 健壮性');

test('flush：跳过去抖等待，立即执行', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 10000 });   // 去抖设得很长
  q.schedule(() => { ran.push('now'); return Promise.resolve(); });
  equal(ran.length, 0, '去抖期间不应执行');
  await q.flush();
  equal(ran.length, 1, 'flush 后应立即执行');
});

test('状态回调能观察到 pending → syncing → idle', async () => {
  const seen = [];
  const q = syncQueue.create({ debounceMs: 5 });
  q.onStatus(function (s) { seen.push(s); });
  q.schedule(() => Promise.resolve());
  await sleep(50);
  ok(seen.indexOf('pending') >= 0, '应出现过 pending');
  ok(seen.indexOf('syncing') >= 0, '应出现过 syncing');
  equal(q.status(), 'idle', '结束后回到 idle');
});

test('没有任务时 flush 不报错，状态保持 idle', async () => {
  const q = syncQueue.create({});
  equal(q.status(), 'idle');
  await q.flush();
  equal(q.status(), 'idle');
});

test('任务抛同步异常（不是 reject）也不能卡死队列', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 5, maxRetry: 1, retryDelayMs: 5 });
  q.schedule(() => { throw new Error('boom'); });
  await sleep(120);
  equal(q.status(), 'error', '同步异常也要按失败处理，不能崩');
  q.schedule(() => { ran.push('after'); return Promise.resolve(); });
  await sleep(60);
  equal(ran.length, 1, '队列没被卡死，后续任务照常执行');
});

group('同步队列 · cancel（复位必须能取消，否则定时器漏到下一次会话）');

// 为什么需要它：reset() 若只把队列引用置空，**旧队列的去抖定时器仍然活着**，
// 到点就会执行一次"上一场会话的任务"。测试里会让下一个用例莫名收到上传（假红/假绿），
// 生产里则是"切环境后旧环境还在偷偷跑"。
test('cancel 后到点不执行，状态回到 idle', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 10 });
  q.schedule(() => { ran.push('x'); return Promise.resolve(); });
  equal(q.status(), 'pending');
  q.cancel();
  equal(q.status(), 'idle', 'cancel 后应立刻回到 idle');
  await sleep(50);
  equal(ran.length, 0, '已取消的任务到点也不能执行');
});

test('cancel 不影响后续重新 schedule（队列可复用）', async () => {
  const ran = [];
  const q = syncQueue.create({ debounceMs: 10 });
  q.schedule(() => { ran.push('old'); return Promise.resolve(); });
  q.cancel();
  q.schedule(() => { ran.push('new'); return Promise.resolve(); });
  await sleep(60);
  equal(ran.length, 1);
  equal(ran[0], 'new');
});
