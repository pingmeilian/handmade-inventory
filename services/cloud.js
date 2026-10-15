// services/cloud.js —— 云能力的**唯一入口**
//
// 设计原则（继承项目铁律，见 docs/05-兜底审计报告）：
//   ① 失败一律 reject 且带 { code, msg, detail } —— **绝不静默**。
//      静默失败会让上层以为"传上去了"，而用户以为"备份好了" —— 这比报错糟得多。
//   ② 云不可用时统一 reject { code:'cloud-disabled' }，调用方据此**降级为纯本地**，
//      保证"接了云"绝不比"不接云"更差。
//   ③ 只提供本项目真正用到的最小能力：云函数 + 云存储上传/下载/删除。
//
// ⚠️ 平台事实：小程序端**没有**"列云存储目录"的能力（wx.cloud 未提供 list）。
//    所以备份用「固定命名 + 索引文件」而不是列目录 —— **别在这里加 listFiles**，
//    那在真机上跑不通。

const config = require('./cloud-config.js');

let inited = false;

// 初始化。可重复调用（每次重新判定，便于测试与切换环境）。
// 返回 true 表示云能力可用；false 时调用方应走纯本地路径。
function init() {
  inited = false;
  if (!config.hasEnv()) return false;
  if (!config.isSupported()) return false;
  try {
    wx.cloud.init({ env: config.ENV_ID, traceUser: true });
    inited = true;
  } catch (e) {
    console.error('[cloud] 初始化失败，云功能降级为纯本地：', e);
    inited = false;
  }
  return inited;
}

function isReady() { return inited; }

function disabledError() {
  return { code: 'cloud-disabled', msg: '云功能未启用（未配置环境或初始化失败）' };
}

// 把 wx.cloud.* 的回调式 API 统一成 Promise，并把失败翻译成可读错误
function toPromise(label, exec, pick) {
  return new Promise((resolve, reject) => {
    const onFail = (err) => {
      console.error('[cloud] ' + label + ' 失败：', err);
      reject({
        code: 'cloud-fail',
        msg: (err && (err.errMsg || err.message)) || (label + ' 失败'),
        detail: err
      });
    };
    try {
      exec({
        success: (res) => resolve(pick ? pick(res) : res),
        fail: onFail
      });
    } catch (e) {
      console.error('[cloud] ' + label + ' 抛异常：', e);
      reject({ code: 'cloud-fail', msg: (e && e.message) || (label + ' 异常'), detail: e });
    }
  });
}

// 云函数调用 → 返回 result
function callFunction(name, data) {
  if (!inited) return Promise.reject(disabledError());
  return toPromise(
    '云函数 ' + name,
    (cb) => wx.cloud.callFunction({ name: name, data: data || {}, success: cb.success, fail: cb.fail }),
    (res) => res && res.result
  );
}

// 上传本地文件到云存储 → 返回 fileID
function uploadFile(cloudPath, filePath) {
  if (!inited) return Promise.reject(disabledError());
  return toPromise(
    '上传 ' + cloudPath,
    (cb) => wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: filePath, success: cb.success, fail: cb.fail }),
    (res) => res && res.fileID
  );
}

// 下载云文件到本地临时路径 → 返回 tempFilePath
function downloadFile(fileID) {
  if (!inited) return Promise.reject(disabledError());
  return toPromise(
    '下载 ' + fileID,
    (cb) => wx.cloud.downloadFile({ fileID: fileID, success: cb.success, fail: cb.fail }),
    (res) => res && res.tempFilePath
  );
}

// 删除云文件（传 fileID 数组）
function deleteFile(fileList) {
  if (!inited) return Promise.reject(disabledError());
  return toPromise(
    '删除文件',
    (cb) => wx.cloud.deleteFile({ fileList: fileList || [], success: cb.success, fail: cb.fail })
  );
}

module.exports = {
  init: init,
  isReady: isReady,
  callFunction: callFunction,
  uploadFile: uploadFile,
  downloadFile: downloadFile,
  deleteFile: deleteFile
};
