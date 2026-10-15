// services/backup.js —— 完整备份 / 恢复（Day 4 核心交付）
//
// 设计要点：
// 1. 备份 = 一个 JSON 文件，落在 USER_DATA_PATH 后由页面层转发出去（wx.shareFileMessage）。
//    ★ 备份必须离开小程序才算数——留在 USER_DATA_PATH 里的文件救不了「清空数据」以外的场景，
//      但清空 storage 并不会删 USER_DATA_PATH 的文件，所以本模块落地的文件本身也是一道保险。
// 2. 两种模式：
//      light —— 只有结构化数据（DATA_KEYS），图片按原文件名引用
//      full  —— 额外把 USER_DATA_PATH 下所有 photo_* 文件 base64 内嵌（含 mime）
// 3. 恢复语义 = 「完全回到备份时点」：先清掉全部业务键再写回，备份里没有的键会被删除。
//    只有 DATA_KEYS 里的键会被写回（防止恶意/损坏 payload 往任意 key 塞东西）。
// 4. 三保险：恢复（导入）前自动生成内部快照，保留最近 3 份；快照键在清空白名单里，
//    清空数据后仍可自救。快照写入失败必须抛错中止——绝不裸奔改数据。
// 5. 版本与完整性校验：损坏 JSON / 非本程序备份 / 版本更新 / 内容为空 → 一律拒绝导入。

const keys = require('./keys.js');
const storage = require('./storage.js');
const image = require('../utils/image.js');

const VERSION = 1;
const KIND = 'pin-backup';
// 内部快照的 storage key（来自 keys.js，唯一来源）
const SNAPSHOT_KEY = keys.KEYS.BACKUP_SNAPSHOTS;
const MAX_SNAPSHOTS = 3;
// 完整备份的体积上限。
// 真机教训（2026-09-12）：原 8MB 基于「文件池 10MB」的过时认知（实际配额 200MB），
// 曾把用户 8.4MB 的合法完整备份拒掉。放宽到 64MB（转发文件也稳妥），
// 剩余空间收紧逻辑保留：上限仍取 min(64MB, 剩余空间-余量)。
const FULL_SIZE_LIMIT = 64 * 1024 * 1024;
// 超过这个大小的旧图，备份时先压缩再内嵌
//（真机教训 2026-09-12：老版本存的图没压缩过，按当时误认的 10MB 配额算，33 张就"占满"，
//  完整备份内嵌原图必然爆体积。压缩后内嵌，原图在磁盘上保持不动。）
const COMPRESS_OVER = 200 * 1024;
// 写备份文件前给 USER_DATA_PATH 留的余量
const WRITE_MARGIN = 256 * 1024;

// 统一错误构造：msg 和 message 都给。
//（真机教训：页面有的读 e.msg、有的读 e.message，漏一个就退化成「生成失败请重试」这种没信息的话。）
function fail(code, msg) {
  const e = new Error(msg);
  e.code = code;
  e.msg = msg;
  return e;
}

// 扩展名 → mime（内嵌图片恢复时记录类型）
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp'
};

// ---------- 小工具 ----------

function fsm() { return wx.getFileSystemManager(); }
function userDataPath() { return wx.env.USER_DATA_PATH; }

// UTF-8 字节数。小程序运行时没有 Buffer，用 encodeURIComponent+unescape 经典法。
// 与 Node 的 Buffer.byteLength(s,'utf8') 严格相等（测试依赖这一点）。
function byteLength(str) {
  try { return unescape(encodeURIComponent(str)).length; }
  catch (e) { return str.length; }
}

// 回调式 fs API → Promise
function fsCall(method, opts) {
  return new Promise((resolve, reject) => {
    fsm()[method](Object.assign({}, opts, {
      success: (r) => resolve(r || {}),
      fail: (e) => reject(e)
    }));
  });
}

function timestamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// ---------- 图片文件 ----------

// USER_DATA_PATH 下所有 photo_* 文件名（图片统一由 store.savePhoto 落盘，前缀固定）
function listPhotoFiles() {
  return fsCall('readdir', { dirPath: userDataPath() })
    .then((r) => (r.files || []).filter((n) => n.indexOf('photo_') === 0))
    .catch(() => []); // 目录不可读时按无图片处理（导出仍可进行，轻量数据不丢）
}

function writePhotoBase64(name, b64) {
  return fsCall('writeFile', { filePath: userDataPath() + '/' + name, data: b64, encoding: 'base64' });
}

// ---------- 构建 payload ----------

// 收集全部业务数据。空数组/缺失的键不写入（恢复时「缺失=删除」语义）。
async function buildPayload(mode) {
  const data = {};
  const counts = {};
  keys.DATA_KEYS.forEach((k) => {
    const v = storage.get(k, null);
    if (v === null) return;
    if (Array.isArray(v) && v.length === 0) return;
    data[k] = v;
    counts[k] = Array.isArray(v) ? v.length : 1;
  });
  const payload = { kind: KIND, version: VERSION, mode: mode, createdAt: Date.now(), counts: counts, data: data };
  let imagesCount = 0;
  if (mode === 'full') {
    const images = {};
    const names = await listPhotoFiles();
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const filePath = userDataPath() + '/' + name;
      let src = filePath;
      // 旧图未压缩：超过阈值先压一份再内嵌（失败自动回退原图，不阻断备份）
      try {
        const st = await fsCall('stat', { path: filePath });
        const size = (st.stats && st.stats.size) || 0;
        if (size > COMPRESS_OVER) src = (await image.compressPhoto(filePath)) || filePath;
      } catch (_) { /* stat 拿不到就按原图走 */ }
      const b64 = await fsCall('readFile', { filePath: src, encoding: 'base64' }).then((r) => r.data).catch(() => null);
      if (b64 == null) continue; // 读不到的文件跳过（不阻断整个备份）
      const extM = name.match(/\.\w+$/);
      const ext = extM ? extM[0].toLowerCase() : '';
      images[name] = { mime: MIME[ext] || 'application/octet-stream', data: b64 };
      imagesCount++;
    }
    payload.images = images;
  }
  return { payload: payload, imagesCount: imagesCount };
}

async function estimateBackupSize(mode) {
  const r = await buildPayload(mode);
  return byteLength(JSON.stringify(r.payload));
}

// ---------- 导出 ----------

// 写备份文件到 USER_DATA_PATH。opts.maxBytes 仅供测试收紧阈值。
// 返回 { path, name, sizeBytes, mode, imagesCount, counts }
// name 是转发时显示的中文文件名；path 是本地实际文件。
async function writeBackupFile(mode, opts) {
  const built = await buildPayload(mode);
  const json = JSON.stringify(built.payload);
  const sizeBytes = byteLength(json);
  // 上限取两者较小：固定阈值 & USER_DATA_PATH 剩余空间（备份文件和图片共用文件池）。
  // ⚠️ 只对 full 模式收紧——真机教训：轻量备份 JSON 只有几十 KB，
  // 曾被「剩余空间≈0」的收紧误杀（照片占满空间时连轻量都导不出，属本末倒置）。
  let maxBytes = (opts && opts.maxBytes) || FULL_SIZE_LIMIT;
  if (mode === 'full' && (!opts || !opts.maxBytes)) {
    const usage = await image.userDataUsage();
    maxBytes = Math.min(maxBytes, Math.max(0, usage.free - WRITE_MARGIN));
  }
  if (sizeBytes > maxBytes) {
    const overM = (sizeBytes / 1024 / 1024).toFixed(1);
    const freeM = (maxBytes / 1024 / 1024).toFixed(1);
    throw fail('TOO_LARGE',
      '图片太多，完整备份（约 ' + overM + 'MB）放不进剩余空间（约 ' + freeM + 'MB）。' +
      '可以先删掉一些不用的图片再完整备份，或改用「轻量模式」（不含图片）');
  }
  const stamp = timestamp();
  const path = userDataPath() + '/pin-backup-' + stamp + '.json';
  await fsCall('writeFile', { filePath: path, data: json });
  return {
    path: path,
    name: '别针手作库备份_' + stamp + '.json',
    sizeBytes: sizeBytes,
    mode: mode,
    imagesCount: built.imagesCount,
    counts: built.payload.counts
  };
}

// ---------- 导入校验（同步、只读，不碰任何数据） ----------

function parseBackup(jsonString) {
  let p;
  try { p = JSON.parse(jsonString); }
  catch (e) { return { ok: false, error: '文件内容不是有效的备份（可能下载不完整或被改动过）' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: '文件结构不对，不是备份文件' };
  if (p.kind !== KIND) return { ok: false, error: '这不是「别针手作库」的备份文件' };
  if (typeof p.version !== 'number' || p.version > VERSION) {
    return { ok: false, error: '备份版本（v' + p.version + '）比当前程序新，请先更新小程序再导入' };
  }
  if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data) || Object.keys(p.data).length === 0) {
    return { ok: false, error: '备份内容为空' };
  }
  return { ok: true, payload: p };
}

// ---------- 恢复 ----------

// 用 payload 完全覆盖当前业务数据。恢复前自动生成内部快照。
// 返回自检报告 { keysRestored, imagesRestored, mode, createdAt }
async function restoreFromPayload(payload) {
  createInternalSnapshot('restore'); // ⭐ 三保险：动手之前先留后路；失败会抛错中止
  keys.DATA_KEYS.forEach((k) => storage.remove(k));
  let keysRestored = 0;
  Object.keys(payload.data || {}).forEach((k) => {
    if (keys.DATA_KEYS.indexOf(k) < 0) return; // 只认业务键，脏数据不落盘
    storage.set(k, payload.data[k]);
    keysRestored++;
  });
  let imagesRestored = 0;
  if (payload.mode === 'full' && payload.images) {
    const names = Object.keys(payload.images);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      // 路径安全：只允许 photo_ 前缀、不允许路径分隔与上跳
      if (name.indexOf('photo_') !== 0 || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) continue;
      await writePhotoBase64(name, payload.images[name].data);
      imagesRestored++;
    }
  }
  return { keysRestored: keysRestored, imagesRestored: imagesRestored, mode: payload.mode || 'light', createdAt: payload.createdAt };
}

// 从文件导入全链路：读文件 → 校验 → 恢复。校验失败抛错（含可读 msg），现有数据分毫不动。
async function importBackupFile(filePath) {
  const r = await fsCall('readFile', { filePath: filePath, encoding: 'utf8' }).catch(() => {
    throw fail('READ_FAIL', '备份文件读不到，可能已被清理，请重新选择');
  });
  const parsed = parseBackup(r.data);
  if (!parsed.ok) throw fail('INVALID_BACKUP', parsed.error);
  return restoreFromPayload(parsed.payload);
}

// ---------- 三保险：内部快照 ----------

function listInternalSnapshots() {
  const v = storage.get(SNAPSHOT_KEY, null);
  return Array.isArray(v) ? v : [];
}

// 生成内部快照（轻量：只有结构化数据）。返回快照元数据。
// ⭐ 存储写失败会抛错——调用方（恢复/清空流程）必须中止，绝不带着「没有后路」改数据。
function createInternalSnapshot(reason) {
  const data = {};
  keys.DATA_KEYS.forEach((k) => {
    const v = storage.get(k, null);
    if (v !== null) data[k] = v;
  });
  const snap = {
    id: 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    at: Date.now(),
    reason: reason || '',
    data: data
  };
  const list = listInternalSnapshots();
  list.unshift(snap);
  const okWrite = storage.set(SNAPSHOT_KEY, list.slice(0, MAX_SNAPSHOTS));
  if (!okWrite) {
    throw fail('SNAPSHOT_FAIL', '内部快照写入失败（存储空间不足？）——已中止本次恢复/清空，数据未动');
  }
  return snap;
}

// 恢复内部快照。恢复前先把「当前状态」也快照一份（before-restore-snapshot），
// 这样恢复动作本身也可回退。返回 { ok, keysRestored } 或 { ok:false, error }
function restoreInternalSnapshot(id) {
  const snap = listInternalSnapshots().find((s) => s.id === id);
  if (!snap) return { ok: false, error: '快照不存在（可能已被滚动清理）' };
  createInternalSnapshot('before-restore-snapshot');
  keys.DATA_KEYS.forEach((k) => storage.remove(k));
  let keysRestored = 0;
  Object.keys(snap.data || {}).forEach((k) => {
    if (keys.DATA_KEYS.indexOf(k) < 0) return;
    storage.set(k, snap.data[k]);
    keysRestored++;
  });
  return { ok: true, keysRestored: keysRestored };
}

// ---------- 孤儿图片 / 备份文件清理（真机「46 张图」问题的解法） ----------

// 找出没有被任何业务数据引用的图片（数据为空或删记录后遗留的「无主图」）。
// 判定：DATA_KEYS 全部数据的 JSON 文本里出现文件名 → 视为被引用（宁可贵一点，不可误删）。
function findOrphanPhotos() {
  return listPhotoFiles().then((names) => {
    let blob = '';
    keys.DATA_KEYS.forEach((k) => {
      const v = storage.get(k, null);
      if (v !== null) blob += JSON.stringify(v);
    });
    const orphans = [];
    let referencedCount = 0;
    names.forEach((name) => {
      if (blob.indexOf(name) >= 0) { referencedCount++; return; }
      orphans.push({ name: name, size: 0 });
    });
    // 逐个 stat 拿大小（孤儿一般不多，逐个查可接受）
    return Promise.all(orphans.map((o) =>
      fsCall('stat', { path: userDataPath() + '/' + o.name })
        .then((r) => { o.size = (r.stats && r.stats.size) || 0; })
        .catch(() => {})
    )).then(() => ({
      orphans: orphans,
      referencedCount: referencedCount,
      orphanBytes: orphans.reduce((t, o) => t + o.size, 0)
    }));
  });
}

// 删除指定图片。安全护栏：只允许 photo_ 前缀、禁止路径分隔与上跳。
function deleteOrphanPhotos(names) {
  const list = (names || []).filter((n) =>
    n.indexOf('photo_') === 0 && n.indexOf('/') < 0 && n.indexOf('\\') < 0 && n.indexOf('..') < 0
  );
  return Promise.all(list.map((name) =>
    fsCall('stat', { path: userDataPath() + '/' + name })
      .then((r) => ({ name: name, size: (r.stats && r.stats.size) || 0 }))
      .catch(() => ({ name: name, size: 0, missing: true }))
  )).then((infos) => Promise.all(infos.map((info) =>
    fsCall('unlink', { filePath: userDataPath() + '/' + info.name })
      .then(() => ({ ok: true, size: info.size }))
      .catch(() => ({ ok: false, size: 0 }))
  ))).then((results) => ({
    deleted: results.filter((r) => r.ok).length,
    freedBytes: results.reduce((t, r) => t + (r.ok ? r.size : 0), 0)
  }));
}

// 清理历史备份文件（pin-backup-*.json）。keepPath 传入刚生成/刚转发的这份则保留。
// 备份转发出去之后，留在本地的副本只是占地方的冗余（还曾和图片抢空间）。
function cleanupBackupFiles(keepPath) {
  // 兼容正反斜杠（真机 wxfile:// 正斜杠 / Windows 工具与测试反斜杠）
  const keepName = keepPath ? keepPath.replace(/\\/g, '/').split('/').pop() : '';
  return fsCall('readdir', { dirPath: userDataPath() })
    .then((r) => (r.files || []).filter((n) =>
      n.indexOf('pin-backup-') === 0 && n.slice(-5) === '.json' && n !== keepName
    ))
    .then((stale) => Promise.all(stale.map((name) =>
      fsCall('stat', { path: userDataPath() + '/' + name })
        .then((r) => ({ name: name, size: (r.stats && r.stats.size) || 0 }))
        .catch(() => ({ name: name, size: 0 }))
    )))
    .then((infos) => Promise.all(infos.map((info) =>
      fsCall('unlink', { filePath: userDataPath() + '/' + info.name })
        .then(() => ({ ok: true, size: info.size }))
        .catch(() => ({ ok: false, size: 0 }))
    )))
    .then((results) => ({
      deleted: results.filter((r) => r.ok).length,
      freedBytes: results.reduce((t, r) => t + (r.ok ? r.size : 0), 0)
    }));
}

// ---------- 任务 4.7：清空前强制备份 ----------
//
// ★ 2026-09-12 真机事故后重构：原 guardBeforeClear 在 await 写完文件之后直接调转发，
//   而微信要求 wx.shareFileMessage **必须由用户的 TAP 手势直接触发** → 必然 fail
//   （且当时 fail 回调吞掉了 errMsg，误报成「你取消了转发」）。现在拆成三段：
//     ① prepareClearBackup() —— 可异步：生成完整备份文件（本文）
//     ② 页面按钮 tap —— 同步调用 share.shareFileNow()（唯一合法姿势，见 utils/share.js）
//     ③ 转发成功后 —— clear-flow.commitClear() 执行清空

// 生成清空用的完整备份文件（不转发、不碰业务数据）。返回：
//   { ok: true, path, name, sizeBytes, imagesCount }
//   { ok: false, stage: 'write', error } —— 备份没写出来，必须中止
function prepareClearBackup(opts) {
  return writeBackupFile('full', opts).then((written) => {
    return {
      ok: true,
      path: written.path,
      name: written.name,
      sizeBytes: written.sizeBytes,
      imagesCount: written.imagesCount
    };
  }).catch((e) => {
    return { ok: false, stage: 'write', error: e };
  });
}

module.exports = {
  VERSION: VERSION,
  KIND: KIND,
  SNAPSHOT_KEY: SNAPSHOT_KEY,
  MAX_SNAPSHOTS: MAX_SNAPSHOTS,
  FULL_SIZE_LIMIT: FULL_SIZE_LIMIT,
  buildPayload: buildPayload,
  estimateBackupSize: estimateBackupSize,
  writeBackupFile: writeBackupFile,
  parseBackup: parseBackup,
  restoreFromPayload: restoreFromPayload,
  importBackupFile: importBackupFile,
  createInternalSnapshot: createInternalSnapshot,
  listInternalSnapshots: listInternalSnapshots,
  restoreInternalSnapshot: restoreInternalSnapshot,
  prepareClearBackup: prepareClearBackup,
  findOrphanPhotos: findOrphanPhotos,
  deleteOrphanPhotos: deleteOrphanPhotos,
  cleanupBackupFiles: cleanupBackupFiles
};
