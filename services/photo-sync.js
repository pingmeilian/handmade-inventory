// services/photo-sync.js —— 图片上云（P4）：把本地图片文件传到云存储
//
// 三条设计原则：
//
// ① **保持原文件名**（`photos/{openid}/photo_xxx.jpg`）
//    数据里存的仍是本地路径，**一行都不用改**；日后恢复按同名下载回来覆盖即可。
//    代价只是图片本地 / 云端各一份（只传新增的，不重复传）。
//
// ② **攒批上传**（攒够 N 张、或空闲一段时间才动手）
//    图片是流量大头，存一张传一次太浪费。数据备份走"改动即传"，图片走攒批 ——
//    两条链路各有独立队列，互不阻塞。
//
// ③ **只增不减**（本地删图**不**同步删云端）
//    万一用户误删，「清理孤儿图」还能从云端找回。代价是云端空间只涨不降 ——
//    这是**有意的取舍**，云端图片清理留待后续版本专门做（不能顺手删，删错就没救）。
//
// 平台事实（与 P3 同源）：客户端**不能列云存储目录**，fileID 也无法自拼。
// 所以上传成功后必须由云函数登记一份清单，否则换机后根本不知道云端有哪些图。

const cloud = require('./cloud.js');
const queue = require('../utils/sync-queue.js');
const storage = require('./storage.js');
const { KEYS } = require('./keys.js');

const FN_PHOTO = 'photoIndex';
// 这四个键都**不在 DATA_KEYS 里** —— 图片同步自己的元数据写入不会触发数据备份上传（防自激）
const PENDING_KEY = 'bm_photo_pending';
const SYNCED_KEY = 'bm_photo_synced';
const STATE_KEY = 'bm_photo_sync_state';
const QUEUE_PENDING_KEY = 'bm_photo_queue_pending';

// 攒够这么多张就立刻开传；否则空闲一段时间（数据同步 20 秒，图片可以从容些）
const DEFAULT_BATCH = 5;
const DEFAULT_DEBOUNCE_MS = 30000;
// 单批上限：首次接入云时可能一次扫出几十张存量图，一鼓作气全传会瞬间吃光流量
const DEFAULT_MAX_PER_BATCH = 20;
// 重试很克制：图片**不是"错过就丢"的数据**（本地始终有原件），
// 所以失败后只补一次就放手，留待下次存图 / 下次启动 / 用户手动同步。
// 数据备份可以激进重试，图片不行 —— 那会把"立即同步"按钮卡住十几秒。
const DEFAULT_MAX_RETRY = 1;
const DEFAULT_RETRY_DELAY_MS = 5000;
// 已传清单上限（防无限膨胀；超出后丢最早的，只影响"是否重传"的判断，不影响数据）
const MAX_SYNCED_KEEP = 2000;
const PHOTO_PREFIX = 'photo_';

let q = null;
let batchSize = DEFAULT_BATCH;
let maxPerBatch = DEFAULT_MAX_PER_BATCH;
let lastSyncAt = 0;
let lastError = '';

// ---------- 基础工具 ----------

function userDataPath() {
  return (wx.env && wx.env.USER_DATA_PATH) || '';
}

function photoCloudPath(openid, name) {
  if (!openid || !name) return '';
  return 'photos/' + openid + '/' + name;
}

// 本地文件大小；文件不在（或读不了）返回 null —— 调用方据此判定"无源可传"。
//
// ⭐ 为什么把"读不了"一律当不存在：能兜住它的是 init() 里的本地扫描 ——
// 若文件其实还在，下次启动扫描会重新把它加回清单，不会永久漏掉。
// 反过来若一直当"失败"留着，一张幽灵图就能把整条图片同步永久堵在队首。
function fsStat(filePath) {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().stat({
        path: filePath,
        success: (r) => {
          const st = (r && r.stats) || {};
          resolve(Number(st.size) || Number(r && r.size) || 0);
        },
        fail: () => resolve(null)
      });
    } catch (_) { resolve(null); }
  });
}

function fsReaddir(dirPath) {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().readdir({
        dirPath: dirPath,
        success: (r) => resolve((r && r.files) || []),
        fail: () => resolve([])
      });
    } catch (_) { resolve([]); }
  });
}

// ---------- 清单读写（全部落盘，重启后仍有效） ----------

function readPending() {
  const v = storage.get(PENDING_KEY, []);
  return Array.isArray(v) ? v.filter((n) => typeof n === 'string' && n) : [];
}

function writePending(list) {
  try { storage.set(PENDING_KEY, list); } catch (_) { /* 存不下不该影响本地图片本身 */ }
}

function readSynced() {
  const v = storage.get(SYNCED_KEY, {});
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function pruneSynced(m) {
  const keys = Object.keys(m);
  if (keys.length <= MAX_SYNCED_KEEP) return m;
  keys.sort((a, b) => ((m[a] && m[a].at) || 0) - ((m[b] && m[b].at) || 0));
  keys.slice(0, keys.length - MAX_SYNCED_KEEP).forEach((k) => { delete m[k]; });
  return m;
}

function markSynced(name, info) {
  const m = readSynced();
  m[name] = { at: Date.now(), sizeBytes: (info && info.sizeBytes) || 0 };
  pruneSynced(m);
  try { storage.set(SYNCED_KEY, m); } catch (_) { /* 同上 */ }
  return m;
}

function saveState(s) {
  try { storage.set(STATE_KEY, s); } catch (_) { /* 状态存不下不该影响同步本身 */ }
}

// ---------- 身份 ----------

function fallbackIdentity() {
  return storage.get(KEYS.REAL_OPENID, '') || storage.get(KEYS.OPENID, '');
}

// 与 cloud-backup 同一套：优先真实微信身份（换机不变），拿不到则回退本机码
function resolveIdentity() {
  let store = null;
  try { store = require('../utils/store.js'); } catch (_) { store = null; }   // 延迟 require：避免加载期成环
  if (store && store.ensureRealOpenid) {
    return store.ensureRealOpenid()
      .then((id) => id || fallbackIdentity())
      .catch(() => fallbackIdentity());
  }
  return Promise.resolve(fallbackIdentity());
}

// ---------- 入队 ----------

// 把一张图排进待传清单。**立刻返回**，不等待任何网络动作。
// 返回 true = 真的进了队列（新图）；false = 已传过 / 已在队列 / 参数无效 / 云未启用。
function enqueue(name) {
  if (typeof name !== 'string' || !name) return false;
  if (!q) return false;                                  // 云未启用：彻底不记录，零开销
  if (readSynced()[name]) return false;                  // 已传过：省流量的关键一步

  const list = readPending();
  if (list.indexOf(name) >= 0) return false;             // 已在队列
  list.push(name);
  writePending(list);

  if (list.length >= batchSize) {
    q.flush();                                           // 攒够阈值：立刻开传
  } else {
    q.schedule(function () { return uploadBatch(); });   // 否则等空闲窗口，顺便合并后续存图
  }
  return true;
}

// ---------- 单张上传 ----------

// 返回 { status:'ok', fileID, sizeBytes } | { status:'gone' } | { status:'fail', detail }
function uploadOne(openid, name) {
  const localPath = userDataPath() + '/' + name;
  const cloudPath = photoCloudPath(openid, name);
  if (!cloudPath) return Promise.resolve({ status: 'fail', detail: { code: 'no-identity' } });

  return fsStat(localPath).then((sizeBytes) => {
    if (sizeBytes == null) return { status: 'gone' };     // 本地已无此图 → 幽灵图，清出去
    return cloud.uploadFile(cloudPath, localPath)
      .then((fileID) => ({ status: 'ok', fileID: fileID, sizeBytes: sizeBytes }))
      .catch((e) => ({ status: 'fail', detail: e }));
  });
}

// ---------- 一批（串行） ----------

// 返回 { ok, uploaded, gone, failed, remaining }
// ⚠️ 只要有失败就 **reject** —— 交给队列的退避重试统一处理；
//    重试时已成功的不在清单里了，所以不会重复传。
function uploadBatch() {
  if (!cloud.isReady()) {
    return Promise.resolve({ ok: false, reason: 'cloud-disabled', uploaded: 0, gone: 0, failed: 0, remaining: readPending().length });
  }

  const pending = readPending();
  if (!pending.length) {
    return Promise.resolve({ ok: true, uploaded: 0, gone: 0, failed: 0, remaining: 0 });
  }

  const batch = pending.slice(0, maxPerBatch);
  const rest = pending.slice(maxPerBatch);

  return resolveIdentity().then((openid) => {
    const who = openid || fallbackIdentity();
    if (!who) {
      // 拿不到身份：不动清单、不报错，等下次（也就不会误删任何待传项）
      lastError = 'no-identity';
      return { ok: false, reason: 'no-identity', uploaded: 0, gone: 0, failed: 0, remaining: pending.length };
    }

    const done = [];      // 上传成功的
    const failed = [];    // 要留着重试的
    let gone = 0;         // 无源可传，已清出清单

    // 逐张串行：并发上传对弱网毫无好处，还容易触发平台限流
    let chain = Promise.resolve();
    batch.forEach((name) => {
      chain = chain.then(() => uploadOne(who, name).then((r) => {
        if (r.status === 'ok') done.push({ name: name, fileID: r.fileID, sizeBytes: r.sizeBytes });
        else if (r.status === 'gone') gone++;
        else failed.push(name);
      }));
    });

    return chain.then(() => {
      if (!done.length) {
        writePending(failed.concat(rest));
        if (failed.length) throwFail(failed);
        // 全是幽灵图（本地已删）→ 清单已清空，正常结束
        return finishBatch({ uploaded: 0, gone: gone, failed: 0, deferred: rest.length });
      }

      // 索引必须一次批量登记：一张一次会几百次云函数调用，既慢又费额度。
      // 登记失败则**整批都不算成功** —— 否则云端文件成了"没人知道它存在"的孤儿，
      // 换机后找不回来（重传同名文件是幂等的，代价只是再传一遍）。
      return cloud.callFunction(FN_PHOTO, {
        action: 'put',
        items: done.map((d) => ({
          name: d.name,
          fileID: d.fileID,
          sizeBytes: d.sizeBytes,
          updatedAt: Date.now()
        }))
      }).then((r) => {
        if (!r || r.ok !== true) throw { __reason: 'index-fail', detail: r, msg: '图片清单登记失败' };
        done.forEach((d) => markSynced(d.name, { sizeBytes: d.sizeBytes }));
        writePending(failed.concat(rest));
        if (failed.length) throwFail(failed);
        return finishBatch({ uploaded: done.length, gone: gone, failed: 0, deferred: rest.length });
      }).catch((e) => {
        if (e && e.__failCount) throw e;                 // 上面的 throwFail 透传
        console.error('[photo-sync] 图片清单登记失败（本地图片不受影响）：', e);
        // ⚠️ 索引失败时**已上传成功的那些也必须留在待传清单里** ——
        // 它们虽然传上去了，但没人知道它存在（孤儿文件），换机后找不回来。
        // 重传同名文件是幂等的，所以"再传一遍"是安全且必要的补救。
        const retry = failed.concat(done.map((d) => d.name));
        writePending(retry.concat(rest));
        throwFail(retry);
      });
    });
  }).catch((e) => {
    if (e && e.__failCount) {
      lastError = 'upload-fail';
      throw e;                                            // 让队列的退避重试接管
    }
    lastError = (e && e.__reason) || 'upload-fail';
    console.error('[photo-sync] 图片同步失败（本地图片不受影响）：', e);
    throw e;
  });
}

function throwFail(names) {
  const err = new Error('图片上传失败 ' + names.length + ' 张');
  err.__failCount = names.length;
  throw err;
}

// 记录状态 + 决定要不要接着传下一批
function finishBatch(r) {
  const remaining = readPending().length;
  if (r.uploaded > 0) {
    lastSyncAt = Date.now();
    lastError = '';
    saveState({ lastSyncAt: lastSyncAt });
  }
  // 还有剩余（超过单批上限）→ 安排下一批，而不是一口气把流量打光。
  // 只在没有失败时排：有失败的话交给队列的重试，避免两条重试路径打架。
  if (remaining > 0 && r.failed === 0 && q) {
    q.schedule(function () { return uploadBatch(); });
  }
  return {
    ok: true,
    uploaded: r.uploaded,
    gone: r.gone,
    failed: 0,
    remaining: remaining
  };
}

// ---------- 状态 ----------

function status() {
  const saved = storage.get(STATE_KEY, null) || {};
  return {
    enabled: !!(q && cloud.isReady()),
    pending: readPending().length,
    synced: Object.keys(readSynced()).length,
    // 落盘兜底：重启后内存变量没了，但「上次同步时间」必须还在，
    // 否则界面会谎报"从未同步"，用户以为坏了（其实一直好着）
    lastSyncAt: lastSyncAt || saved.lastSyncAt || 0,
    lastError: lastError || ''
  };
}

// ---------- 本地存量图片扫描 ----------

// 把本地已有、但没传过的图片补进待传清单。
// 场景：用户先用了一阵子本地版才开通云 —— 那些存量图也得传上去，否则"换机找回"只找得回一半。
function scanLocalPhotos() {
  return fsReaddir(userDataPath()).then((files) => {
    const list = (files || []).filter((n) => typeof n === 'string' && n.indexOf(PHOTO_PREFIX) === 0);
    if (!list.length) return 0;
    const pending = readPending();
    const synced = readSynced();
    let added = 0;
    list.forEach((name) => {
      if (synced[name]) return;
      if (pending.indexOf(name) >= 0) return;
      pending.push(name);
      added++;
    });
    if (added) writePending(pending);
    return added;
  }).catch(() => 0);
}

// ---------- 恢复（P5）：把云端图片找回本机 ----------

// 云端有哪些图（只能问云函数；客户端没有列云存储目录的能力）
function listCloudPhotos() {
  if (!cloud.isReady()) return Promise.resolve({ ok: false, reason: 'cloud-disabled', records: [] });
  return cloud.callFunction(FN_PHOTO, { action: 'get' })
    .then((res) => {
      if (!res || res.ok !== true) return { ok: false, reason: 'index-fail', records: [] };
      const list = Array.isArray(res.records) ? res.records : [];
      // 缺 name / fileID 的记录根本没法恢复，直接滤掉 —— 脏数据不该拖垮整件事
      return { ok: true, records: list.filter((x) => x && x.name && x.fileID) };
    })
    .catch(() => ({ ok: false, reason: 'index-fail', records: [] }));
}

function fsSave(tempFilePath, dest) {
  return new Promise((resolve, reject) => {
    try {
      wx.getFileSystemManager().saveFile({
        tempFilePath: tempFilePath,
        filePath: dest,
        success: () => resolve(),
        fail: (err) => reject({ code: 'fs-fail', msg: (err && err.errMsg) || 'saveFile 失败', detail: err })
      });
    } catch (e) {
      reject({ code: 'fs-fail', msg: (e && e.message) || 'saveFile 异常', detail: e });
    }
  });
}

// 下载一张并落到**原名**位置（数据里存的是本地路径，靠文件名对上号）
function downloadOne(item) {
  const dest = userDataPath() + '/' + item.name;
  return cloud.downloadFile(item.fileID)
    .then((tmp) => fsSave(tmp, dest))
    .then(() => true)
    .catch((e) => {
      console.error('[photo-sync] 恢复图片失败（本机其它数据不受影响）：' + item.name, e);
      return false;
    });
}

// 把云端全部图片恢复到本机。
//
// 原则是「**尽力而为 + 如实报告**」：换机时本地是空的，要下载几十张 ——
// 某一张坏了就让整件事失败是说不通的，但必须报出几张成功几张失败，
// 不能让用户以为"全好了"。
//
// opts.onProgress(done, total) 供界面显示进度。
function restorePhotos(opts) {
  const o = opts || {};
  const empty = { ok: true, total: 0, restored: 0, failed: 0 };
  if (!cloud.isReady()) return Promise.resolve(Object.assign({}, empty, { ok: false, reason: 'cloud-disabled' }));

  return listCloudPhotos().then((r) => {
    if (!r.ok) return Object.assign({}, empty, { ok: false, reason: r.reason });
    const list = r.records;
    if (!list.length) return empty;

    let restored = 0;
    let failed = 0;

    // 逐张串行：并发下载对弱网毫无好处，还容易触发平台限流
    let chain = Promise.resolve();
    list.forEach((item, i) => {
      chain = chain.then(() => downloadOne(item).then((okFlag) => {
        if (okFlag) {
          restored++;
          // ⭐ 必须登记"已传"：否则 init 的本地扫描会把它当成"本地有、但没传过"，
          //    又原样传回云端一遍（幂等，但白烧流量）
          markSynced(item.name, { sizeBytes: item.sizeBytes });
        } else {
          failed++;
        }
        if (typeof o.onProgress === 'function') {
          try { o.onProgress(i + 1, list.length); } catch (_) { /* 回调自身出错不该影响恢复 */ }
        }
      }));
    });

    return chain.then(() => ({ ok: true, total: list.length, restored: restored, failed: failed }));
  }).catch((e) => {
    console.error('[photo-sync] 恢复图片过程异常：', e);
    return Object.assign({}, empty, { ok: false, reason: 'restore-fail' });
  });
}

// ---------- 接线 ----------

// 可重复调用（幂等）
function init(opts) {
  const o = opts || {};
  batchSize = o.batchSize == null ? DEFAULT_BATCH : o.batchSize;
  maxPerBatch = o.maxPerBatch == null ? DEFAULT_MAX_PER_BATCH : o.maxPerBatch;

  // 云不可用：**完全不挂钩子**（连队列都不建）→ 本地路径零额外开销
  if (!cloud.isReady()) return false;

  if (!q) {
    q = queue.create({
      debounceMs: o.debounceMs == null ? DEFAULT_DEBOUNCE_MS : o.debounceMs,
      maxRetry: o.maxRetry == null ? DEFAULT_MAX_RETRY : o.maxRetry,
      retryDelayMs: o.retryDelayMs == null ? DEFAULT_RETRY_DELAY_MS : o.retryDelayMs,
      storage: { get: storage.get, set: storage.set },
      pendingKey: QUEUE_PENDING_KEY
    });
  }

  // ① 扫本地存量图（首次接入云时把已有图片带上）
  // ② 有待传的（上次没传完 / 刚扫出来的）安排一次
  scanLocalPhotos().then(() => {
    if (q && readPending().length) q.schedule(function () { return uploadBatch(); });
  }).catch(() => { /* 扫描失败不影响使用 */ });

  return true;
}

function flush() {
  if (!q) return Promise.resolve();
  // 先补排一个任务再 flush：队列在"此刻恰好没有待调度任务"时 flush 会空转，
  // 而待传清单里明明还有图（比如刚启动、还没到去抖窗口）。
  // 「立即同步」按钮点下去就该真的同步一次，不能看运气。
  q.schedule(function () { return uploadBatch(); });
  return q.flush();
}

// 测试复位（也用于"切环境"）
function reset() {
  // ⚠️ 必须 cancel：只把 q 置空的话，旧队列的去抖定时器还活着，
  // 到点会执行"上一场会话的任务"（测试里会莫名多出上传）
  if (q && q.cancel) { try { q.cancel(); } catch (_) { /* 忽略 */ } }
  q = null;
  batchSize = DEFAULT_BATCH;
  maxPerBatch = DEFAULT_MAX_PER_BATCH;
  lastSyncAt = 0;
  lastError = '';
}

module.exports = {
  FN_PHOTO: FN_PHOTO,
  DEFAULT_BATCH: DEFAULT_BATCH,
  DEFAULT_MAX_PER_BATCH: DEFAULT_MAX_PER_BATCH,
  PENDING_KEY: PENDING_KEY,
  SYNCED_KEY: SYNCED_KEY,
  photoCloudPath: photoCloudPath,
  enqueue: enqueue,
  scanLocalPhotos: scanLocalPhotos,
  listCloudPhotos: listCloudPhotos,
  restorePhotos: restorePhotos,
  status: status,
  init: init,
  flush: flush,
  reset: reset,
  uploadBatch: uploadBatch
};
