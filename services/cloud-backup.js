// services/cloud-backup.js —— 云备份：把本地数据同步一份到云端（P3）
//
// 三个关键设计（都是为了"别把好备份传坏"）：
//
// ① **云端保留 2 份**（双槽 a / b 轮转）
//    每次只写「较旧的那个槽」，**上传成功后才更新索引指向它**。
//    所以任何一步失败，云端那份好备份都原封不动。
//    反过来若只留 1 份：新版传到一半失败就把唯一那份覆盖了 ——
//    那是"为了防丢数据，反而制造了一种新的丢法"，而且极难发现。
//
// ② **索引由云函数记**（不靠"列目录"）
//    平台**没给**客户端「列云存储目录」的能力，所以"云端有哪些备份、fileID 是什么"
//    必须由服务端记一笔 —— 这也是换机后能找到自己备份的唯一途径。
//
// ③ **自动上传走同步队列**（去抖 / 串行 / 重试），云不可用则静默降级为纯本地
//    —— 保证"接了云"绝不比"不接云"更差。

const cloud = require('./cloud.js');
const backup = require('./backup.js');
const photoSync = require('./photo-sync.js');
const queue = require('../utils/sync-queue.js');
const storage = require('./storage.js');
const { KEYS, DATA_KEYS } = require('./keys.js');

const SLOTS = ['a', 'b'];
const FN_INDEX = 'backupIndex';
// 云端备份的上传模式：**不含图片**（图片走 P4 独立通道，见实施计划）
const CLOUD_MODE = 'lite';
// 这两个键都**不在 DATA_KEYS 里** —— 所以备份自己的元数据写入不会触发新一轮上传（防自激）
const PENDING_KEY = 'bm_cloud_backup_pending';
const STATE_KEY = 'bm_cloud_backup_state';
// 去抖默认 20 秒：用户连续改几笔账，台上只传一次
const DEFAULT_DEBOUNCE_MS = 20000;

let q = null;
let unsubscribe = null;
let lastUploadAt = 0;
let lastSlot = null;
let lastResult = null;

// ---------- 小工具 ----------

function fsCall(method, opts) {
  return new Promise((resolve, reject) => {
    try {
      const fsm = wx.getFileSystemManager();
      fsm[method](Object.assign({}, opts, {
        success: resolve,
        fail: (err) => reject({ code: 'fs-fail', msg: (err && err.errMsg) || (method + ' 失败'), detail: err })
      }));
    } catch (e) {
      reject({ code: 'fs-fail', msg: (e && e.message) || (method + ' 异常'), detail: e });
    }
  });
}

function cloudPathFor(openid, slot) {
  return 'backups/' + openid + '/slot-' + slot + '.json';
}

function saveState(s) {
  try { storage.set(STATE_KEY, s); } catch (_) { /* 状态存不下不该影响备份本身 */ }
}

// ---------- 选槽（纯函数，最好测） ----------

// 云端只有两个槽。规则：新数据永远写「较旧的那个」，从而保住最新的那份。
// 输入脏数据（null / 空对象 / 缺字段）时也必须给出确定结果 ——
// 返回 undefined 会让上传路径拿到非法路径。
function pickTargetSlot(records) {
  const list = Array.isArray(records) ? records.filter((r) => r && typeof r === 'object') : [];
  const a = list.filter((r) => r.slot === 'a')[0];
  const b = list.filter((r) => r.slot === 'b')[0];

  if (a && !b) return 'b';
  if (b && !a) return 'a';
  if (a && b) {
    const at = Number(a.updatedAt) || 0;
    const bt = Number(b.updatedAt) || 0;
    return at <= bt ? 'a' : 'b';
  }
  return 'a';   // 空 / 都是脏数据 → 从 a 开始
}

// ---------- 索引（读云端"有哪些备份"） ----------

function fetchIndex() {
  if (!cloud.isReady()) return Promise.resolve({ ok: false, reason: 'cloud-disabled' });
  return cloud.callFunction(FN_INDEX, { action: 'get' })
    .then((res) => {
      if (!res || res.ok !== true) return { ok: false, reason: 'index-fail', detail: res };
      return { ok: true, records: Array.isArray(res.records) ? res.records : [] };
    })
    .catch((e) => ({ ok: false, reason: 'index-fail', detail: e }));
}

// ---------- 上传 ----------

// 返回 { ok:true, slot, fileID, sizeBytes, at }
// 或   { ok:false, reason, notified:true, detail }
// reason ∈ cloud-disabled | no-identity | upload-fail | index-fail | fs-fail
function uploadNow(opts) {
  const o = opts || {};
  // ⚠️ 云不可用时的第一道闸：直接返回，连一次云调用都不发（保证纯本地体验不变）
  if (!cloud.isReady()) {
    return Promise.resolve({ ok: false, reason: 'cloud-disabled', notified: true });
  }

  // 延迟 require：避免加载期与 store 形成环
  let store = null;
  try { store = require('../utils/store.js'); } catch (_) { store = null; }

  let tmpPath = null;

  const identity = (store && store.ensureRealOpenid)
    ? store.ensureRealOpenid().catch(() => '')
    : Promise.resolve('');

  return identity
    .then((openid) => {
      const who = openid || storage.get(KEYS.REAL_OPENID, '') || storage.get(KEYS.OPENID, '');
      if (!who) throw { __reason: 'no-identity', msg: '拿不到身份，无法确定备份归属' };
      return fetchIndex().then((idx) => {
        if (!idx.ok) throw { __reason: idx.reason || 'index-fail', detail: idx.detail, msg: '读取云端索引失败' };
        return { who: who, records: idx.records };
      });
    })
    .then((ctx) => {
      const slot = pickTargetSlot(ctx.records);
      return backup.buildPayload(CLOUD_MODE).then((built) => {
        const json = JSON.stringify(built.payload);
        const path = wx.env.USER_DATA_PATH + '/cloud-upload-' + Date.now() + '-' + slot + '.json';
        return fsCall('writeFile', { filePath: path, data: json })
          .catch((e) => { throw { __reason: 'fs-fail', detail: e, msg: '暂存文件写入失败' }; })
          .then(() => { tmpPath = path; })
          .then(() => cloud.uploadFile(cloudPathFor(ctx.who, slot), path))
          .then((fileID) => ({ slot: slot, fileID: fileID, sizeBytes: json.length }))
          .catch((e) => {
            if (e && e.__reason) throw e;
            throw { __reason: 'upload-fail', detail: e, msg: '上传到云端失败' };
          });
      });
    })
    .then((up) => cloud.callFunction(FN_INDEX, {
      action: 'put',
      slot: up.slot,
      fileID: up.fileID,
      updatedAt: Date.now(),
      sizeBytes: up.sizeBytes,
      mode: CLOUD_MODE
    }).then((res) => {
      // 索引没写成不算成功 —— 否则云端文件成了"没人知道它存在"的孤儿，
      // 下次上传还会往同一个槽写，等于白传
      if (!res || res.ok !== true) throw { __reason: 'index-fail', detail: res, msg: '索引写入失败' };
      return up;
    }).catch((e) => {
      if (e && e.__reason) throw e;
      throw { __reason: 'index-fail', detail: e, msg: '索引写入失败' };
    }))
    .then((up) => {
      const at = Date.now();
      lastUploadAt = at;
      lastSlot = up.slot;
      lastResult = 'ok';
      saveState({ lastUploadAt: at, lastSlot: up.slot, sizeBytes: up.sizeBytes });
      return { ok: true, slot: up.slot, fileID: up.fileID, sizeBytes: up.sizeBytes, at: at, notified: true };
    })
    .catch((e) => {
      const reason = (e && e.__reason) || 'upload-fail';
      lastResult = reason;
      if (reason !== 'cloud-disabled') console.error('[cloud-backup] 云端备份失败（本地数据不受影响）：', e);
      return { ok: false, reason: reason, notified: true, detail: e };
    })
    .then((r) => {
      // 无论成败都清掉临时文件：失败路径最容易忘，然后越攒越多
      if (tmpPath) {
        fsCall('unlink', { filePath: tmpPath }).catch(() => { /* 清不掉就算了，不该盖住真实结果 */ });
      }
      return r;
    });
}

// ---------- 调度（自动上传的入口） ----------

function scheduleUpload(reason) {
  if (!q) return;
  try {
    q.schedule(function () { return uploadNow({ reason: reason }); });
  } catch (e) {
    console.error('[cloud-backup] 调度失败（不影响本地使用）：', e);
  }
}

function flush() {
  return q ? q.flush() : Promise.resolve();
}

function status() {
  const saved = storage.get(STATE_KEY, null) || {};
  return {
    enabled: !!(q && cloud.isReady()),
    pending: q ? q.hasPending() : false,
    // 落盘值兜底：重启后内存变量没了，但「上次同步时间」必须还在 ——
    // 否则界面会谎报"从未同步"，用户以为备份坏了，其实一直好着
    lastUploadAt: lastUploadAt || saved.lastUploadAt || 0,
    lastSlot: lastSlot || saved.lastSlot || '',
    lastResult: lastResult || ''
  };
}

// ---------- 云端备份点列表 / 从云端恢复（界面用） ----------

// 云端有哪些备份点，按时间倒序（界面显示"最新 / 上一个"）
function cloudBackups() {
  return fetchIndex().then((r) => {
    if (!r.ok) return { ok: false, reason: r.reason };
    const list = r.records
      .filter((x) => x && x.fileID)
      .map((x) => ({
        slot: x.slot,
        at: Number(x.updatedAt) || 0,
        sizeBytes: Number(x.sizeBytes) || 0,
        fileID: x.fileID
      }))
      .sort((a, b) => b.at - a.at);
    return { ok: true, list: list };
  });
}

// 把云端某一份备份拉回来覆盖本地。
//
// opts.slot 指定恢复 a / b 哪一份；**不传则取最新那份**（保持原行为）。
//
// 安全设计（这条链路一旦出错就是"丢数据"，所以步步设防）：
//   下载 → 校验 → 恢复，复用 backup.importBackupFile（它保证「校验不过则本地分毫不动」）；
//   而恢复动作本身会自动先留一份内部快照 —— 万一恢复成了旧数据，还退得回来。
//   ⚠️ 这是**覆盖全部数据**的动作，所以拒绝一切含糊输入：槽不存在、取值非法，
//   都明确失败并分毫不动本地数据（绝不"猜一个"）。
function restoreFromCloud(opts) {
  const o = opts || {};
  if (!cloud.isReady()) return Promise.resolve({ ok: false, reason: 'cloud-disabled', notified: true });

  const want = o.slot == null ? null : String(o.slot);
  if (want !== null && SLOTS.indexOf(want) < 0) {
    return Promise.resolve({ ok: false, reason: 'bad-slot', notified: true });
  }

  return cloudBackups()
    .then((r) => {
      if (!r.ok) return { ok: false, reason: r.reason, notified: true };
      if (!r.list.length) return { ok: false, reason: 'no-backup', notified: true };
      // 列表已按时间倒序：不指定就是要最新的那份
      let target = r.list[0];
      if (want) {
        target = r.list.filter((x) => x.slot === want)[0];
        if (!target) return { ok: false, reason: 'no-such-slot', notified: true };
      }
      return cloud.downloadFile(target.fileID)
        .then((tmp) => ({ tmp: tmp, slot: target.slot, at: target.at, sizeBytes: target.sizeBytes }))
        .catch((e) => { throw { __reason: 'download-fail', detail: e, msg: '备份文件下载失败' }; })
        .then((dl) => backup.importBackupFile(dl.tmp)
          .then((report) => ({
            ok: true,
            slot: dl.slot,
            at: dl.at,
            sizeBytes: dl.sizeBytes,
            keysRestored: report.keysRestored,
            imagesRestored: report.imagesRestored,
            notified: true
          }))
          .catch((e) => {
            throw { __reason: 'invalid-backup', detail: e, msg: (e && (e.msg || e.message)) || '备份内容不可用' };
          }));
    })
    .then((dataResult) => {
      // 数据回来了，接着把图片也找回来（P5 换机恢复的关键一环 ——
      // 没有它，换机后记录都在、图全丢，等于只找回一半）。
      // 图片是「**尽力而为**」：单张失败不影响数据恢复的成功结论，
      // 但结果里会如实报出几张没回来（opts.onPhotoProgress 供界面显示进度）。
      if (!dataResult.ok) return dataResult;
      return photoSync.restorePhotos({ onProgress: o.onPhotoProgress })
        .then((pr) => Object.assign({}, dataResult, { photos: pr }))
        .catch(() => Object.assign({}, dataResult, { photos: { ok: false, total: 0, restored: 0, failed: 0 } }));
    })
    .catch((e) => {
      const reason = (e && e.__reason) || 'restore-fail';
      console.error('[cloud-backup] 从云端恢复失败（本地数据未受影响）：', e);
      return { ok: false, reason: reason, notified: true, detail: e };
    });
}

// ---------- 接线 ----------

// 可重复调用（幂等）：不会重复挂钩子、不会重建队列
function init(opts) {
  const o = opts || {};
  if (!q) {
    q = queue.create({
      debounceMs: o.debounceMs == null ? DEFAULT_DEBOUNCE_MS : o.debounceMs,
      storage: { get: storage.get, set: storage.set },
      pendingKey: PENDING_KEY
    });
  }
  if (!unsubscribe) {
    unsubscribe = storage.onWrite(function (key) {
      // 只管业务数据；备份自己的元数据写入不触发（否则会自己叫自己，无限循环）
      if (DATA_KEYS.indexOf(key) < 0) return;
      // 云不可用时静默跳过 —— 绝不因为"云没配好"影响本地使用
      if (!cloud.isReady()) return;
      scheduleUpload('data-change');
    });
  }
  return true;
}

// 测试复位（也用于"切环境"）
function reset() {
  if (unsubscribe) { try { unsubscribe(); } catch (_) { /* 忽略 */ } unsubscribe = null; }
  // 必须 cancel：只把 q 置空的话，旧队列的去抖定时器还活着，
  // 到点会执行"上一场会话的上传"（测试里会莫名多出一次云调用）
  if (q && q.cancel) { try { q.cancel(); } catch (_) { /* 忽略 */ } }
  q = null;
  lastUploadAt = 0;
  lastSlot = null;
  lastResult = null;
}

module.exports = {
  SLOTS: SLOTS,
  CLOUD_MODE: CLOUD_MODE,
  pickTargetSlot: pickTargetSlot,
  cloudPathFor: cloudPathFor,
  init: init,
  reset: reset,
  scheduleUpload: scheduleUpload,
  flush: flush,
  uploadNow: uploadNow,
  fetchIndex: fetchIndex,
  cloudBackups: cloudBackups,
  restoreFromCloud: restoreFromCloud,
  status: status
};
