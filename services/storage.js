// services/storage.js —— 存储内核：读写 + 容量保护 + 失败可见
//
// 为什么单独抽出来并加固：
//   原实现 set() 是裸调 wx.setStorageSync，没有任何兜底 —— 一旦存储写满或异常，
//   数据会**静默丢失**，界面看起来"保存成功"，实际什么也没存。这是最隐蔽的一类 bug。
//   现改为：捕获失败 → 记录错误 → 通知订阅者（由 app.js 弹提示），返回值告知成功与否。

const { ALL_KEYS, PRESERVED_ON_CLEAR } = require('./keys.js');

// 容量告警阈值：使用率超过 80% 就提示用户清理或导出备份
const FULL_WARN_RATIO = 0.8;
// 微信 storage 上限（KB）—— 平台固定值，getStorageInfoSync 不可用时兜底
const DEFAULT_LIMIT_KB = 10240;

let lastError = null;
const errorHandlers = [];

// 数据损坏留痕（存储里的值类型与期望不符时记录，便于排查）
let lastCorruption = null;
const corruptionHandlers = [];

// 写入订阅者（云备份的自动同步靠它触发）。
// ⚠️ 只在**写成功**后通知：写失败时数据根本没变，通知只会让上层传一份旧数据、还以为成功了。
const writeHandlers = [];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function reportCorruption(key, value, expected) {
  lastCorruption = {
    key: key,
    expected: expected,
    actual: Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value),
    at: Date.now()
  };
  corruptionHandlers.forEach(function (fn) {
    try { fn(lastCorruption); } catch (_) { /* 订阅者自身出错不应影响读取 */ }
  });
}

// ---------- 读写 ----------

// 读：任何异常都退化为默认值（读失败不该让页面崩）
//
// ⚠️ 类型护栏（本次加固）：
//   原先只要读得到就原样返回。但如果存储里的值**类型不对**（被截断、被外部写入、
//   旧版本格式残留、序列化异常），页面后续一调 .filter() 就会抛
//   "xxx.filter is not a function" —— 整页白屏，且用户完全不知道发生了什么。
//   现在按「调用方给的默认值」推断期望类型，类型不符则安全降级为默认值并留痕。
//   好处：一处改动覆盖全部读取点，调用方零改动。
function get(key, def) {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === undefined || v === null) return def;

    if (Array.isArray(def) && !Array.isArray(v)) {
      reportCorruption(key, v, 'array');
      return def;
    }
    if (isPlainObject(def) && !isPlainObject(v)) {
      reportCorruption(key, v, 'object');
      return def;
    }
    return v;
  } catch (e) {
    return def;
  }
}

// 写入成功后的通知（云备份的自动同步靠它触发）
function notifyWrite(key) {
  if (!writeHandlers.length) return;
  writeHandlers.forEach(function (fn) {
    try { fn(key); } catch (_) { /* 订阅者自身出错不应影响写入流程 */ }
  });
}

// 订阅"数据写入成功"事件；返回取消订阅函数
function onWrite(fn) {
  if (typeof fn !== 'function') return function () {};
  writeHandlers.push(fn);
  return function () {
    const i = writeHandlers.indexOf(fn);
    if (i >= 0) writeHandlers.splice(i, 1);
  };
}

// 写：失败不再静默
// 返回值：true = 写入成功；false = 写入失败（已记录并通知订阅者）
function set(key, val) {
  try {
    wx.setStorageSync(key, val);
    notifyWrite(key);
    return true;
  } catch (e) {
    const message = (e && (e.errMsg || e.message)) || String(e);
    lastError = { key: key, at: Date.now(), message: message };
    errorHandlers.forEach(function (fn) {
      try { fn(lastError); } catch (_) { /* 订阅者自身出错不应影响写入流程 */ }
    });
    return false;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 容量 ----------

// 当前用量：{ currentSize(KB), limitSize(KB), ratio(0~1), keys[] }
function usage() {
  try {
    const info = wx.getStorageInfoSync() || {};
    const limit = info.limitSize || DEFAULT_LIMIT_KB;
    const cur = info.currentSize || 0;
    return {
      currentSize: cur,
      limitSize: limit,
      ratio: limit > 0 ? cur / limit : 0,
      keys: info.keys || []
    };
  } catch (e) {
    return { currentSize: 0, limitSize: DEFAULT_LIMIT_KB, ratio: 0, keys: [] };
  }
}

function isNearFull() {
  return usage().ratio >= FULL_WARN_RATIO;
}

// 估算追加 extraBytes 字节后是否会超限
// 返回 { ok, ratioAfter, freeKB, needKB }
function canFit(extraBytes) {
  const u = usage();
  const freeKB = Math.max(0, u.limitSize - u.currentSize);
  const needKB = Math.ceil((Number(extraBytes) || 0) / 1024);
  return {
    ok: needKB <= freeKB,
    ratioAfter: u.limitSize > 0 ? (u.currentSize + needKB) / u.limitSize : 0,
    freeKB: freeKB,
    needKB: needKB
  };
}

// ---------- 清空 ----------

// 清空业务数据，保留种子标记与本地匿名标识
function clearAll() {
  ALL_KEYS.forEach(function (k) {
    if (PRESERVED_ON_CLEAR.indexOf(k) < 0) remove(k);
  });
}

// ---------- 失败订阅 ----------

function onWriteError(fn) {
  if (typeof fn === 'function') errorHandlers.push(fn);
}

function lastWriteError() {
  return lastError;
}

function resetLastError() {
  lastError = null;
}

// 数据损坏订阅与查询
function onCorruption(fn) {
  if (typeof fn === 'function') corruptionHandlers.push(fn);
}

function lastCorruptionInfo() {
  return lastCorruption;
}

function resetLastCorruption() {
  lastCorruption = null;
}

module.exports = {
  get: get,
  set: set,
  remove: remove,
  usage: usage,
  isNearFull: isNearFull,
  canFit: canFit,
  clearAll: clearAll,
  onWriteError: onWriteError,
  onWrite: onWrite,
  lastWriteError: lastWriteError,
  resetLastError: resetLastError,
  onCorruption: onCorruption,
  lastCorruptionInfo: lastCorruptionInfo,
  resetLastCorruption: resetLastCorruption,
  FULL_WARN_RATIO: FULL_WARN_RATIO
};
