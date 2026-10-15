// utils/sync-queue.js —— 同步队列：去抖 + 串行 + 重试 + 待传标记
//
// 为什么需要它（而不是"改完就传"）：
//   ① 去抖 —— 连续改动合并成一次上传，省流量、省次数
//   ② 串行 —— 同一时刻只跑一个任务。**这条最关键**：并发上传会"后发先至"，
//      导致旧数据覆盖新数据 —— 比丢数据更隐蔽（用户以为存上了，其实被回退了）
//   ③ 重试 + 待传标记 —— 离线/弱网时不丢改动，联网或下次启动自动补传
//
// 设计：时钟、定时器、存储全部可注入，因此纯 Node 环境能完整单测（见 tests/sync-queue.test.js）。
//
// 语义约定：
//   - schedule(task)：登记"最新要做的事"，去抖后执行；连续调用只保留**最后一次**
//   - 登记即落"待传"标记，**成功才清除** —— 这样"去抖期间退出小程序"也能补传
//   - flush()：跳过去抖立即执行（返回 Promise，可 await 到完成）

function create(opts) {
  const o = opts || {};
  const debounceMs = o.debounceMs == null ? 8000 : o.debounceMs;
  const maxRetry = o.maxRetry == null ? 3 : o.maxRetry;
  const retryDelayMs = o.retryDelayMs == null ? 3000 : o.retryDelayMs;
  const pendingKey = o.pendingKey || 'sync_pending';
  const storage = o.storage || null;
  const setTimeout_ = o.setTimeout || setTimeout;
  const clearTimeout_ = o.clearTimeout || clearTimeout;

  let state = 'idle';
  let timer = null;
  let current = null;      // 正在执行的 Promise（flush 可等它）
  let pendingTask = null;  // 待执行的任务（后到者覆盖前者）
  let retryCount = 0;
  const listeners = [];

  function emit(next) {
    if (next === state) return;
    state = next;
    listeners.forEach(function (cb) {
      try { cb(state); } catch (e) { /* 订阅者自己的异常不该影响队列 */ }
    });
  }

  // ---------- 待传标记（落盘，保证"关掉再打开"能补传） ----------
  function markPending() {
    if (!storage) return;
    try { storage.set(pendingKey, { at: Date.now() }); } catch (e) { /* 存不下也不该崩 */ }
  }

  function clearPending() {
    if (!storage) return;
    try { storage.set(pendingKey, null); } catch (e) { /* 同上 */ }
  }

  function hasPending() {
    if (pendingTask || current || retryCount > 0) return true;
    if (!storage) return false;
    return !!storage.get(pendingKey, null);
  }

  // ---------- 执行（串行） ----------
  function run() {
    if (current) return current;                 // 已在跑：交给它，绝不并发
    if (!pendingTask) { emit('idle'); return Promise.resolve(); }

    const task = pendingTask;                    // 先不清空：失败重试还要用它
    emit('syncing');

    current = Promise.resolve()
      .then(function () { return task(); })
      .then(function () {
        current = null;
        retryCount = 0;
        clearPending();
        if (pendingTask === task) pendingTask = null;   // 没被新任务覆盖才清掉
        if (pendingTask) return run();                 // 执行期间来的改动：补齐一次
        emit('idle');
      })
      .catch(function () {
        current = null;
        return onFail();
      });

    return current;
  }

  function onFail() {
    retryCount++;
    if (retryCount <= maxRetry) {
      emit('pending');
      return new Promise(function (res) {
        timer = setTimeout_(function () {
          timer = null;
          run();
          res();
        }, retryDelayMs * retryCount);          // 退避：越失败等越久
      });
    }
    // 到上限：留着待传标记，等下次启动 / 手动 flush 补传
    markPending();
    emit('error');
    return Promise.resolve();
  }

  // ---------- 对外接口 ----------
  function schedule(task) {
    if (typeof task !== 'function') return;
    pendingTask = task;                          // 覆盖：永远是"最新数据"
    retryCount = 0;
    if (timer) { clearTimeout_(timer); timer = null; }
    markPending();                               // 登记即标记（成功才清除）
    emit('pending');
    timer = setTimeout_(function () { timer = null; run(); }, debounceMs);
  }

  function flush() {
    if (timer) { clearTimeout_(timer); timer = null; }
    return run();                                // 在跑的话 run() 会返回同一个 Promise
  }

  // 取消待执行的任务并停掉定时器 —— reset() 必须调它。
  // 否则"把队列引用置空"只是丢掉了把手：**旧队列的去抖定时器仍然活着**，
  // 到点照样执行上一场会话的任务（测试里会莫名多出一次上传，生产里是旧环境偷偷跑）。
  // ⚠️ 只清"还没开始跑"的：正在执行的任务不打断（半完成状态更难收拾）。
  function cancel() {
    if (timer) { clearTimeout_(timer); timer = null; }
    pendingTask = null;
    retryCount = 0;
    emit('idle');
  }

  return {
    schedule: schedule,
    flush: flush,
    cancel: cancel,
    status: function () { return state; },
    onStatus: function (cb) { listeners.push(cb); return function () {}; },
    hasPending: hasPending,
    markPending: markPending,
    clearPending: clearPending
  };
}

module.exports = { create: create };
