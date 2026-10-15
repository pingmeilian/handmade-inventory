// tests/wx-stub.js —— 微信小程序运行环境打桩
// 目的：让 utils/*.js 这类依赖 wx.* 的模块能在纯 Node 环境里被加载和测试。
// 设计原则：尽量贴近微信真实行为（尤其是「存储会序列化」这一点），否则测试会掩盖真实 bug。

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- 存储（模拟 wx.storage，总量上限 10MB） ----------
const STORAGE_LIMIT_KB = 10 * 1024;
const storage = new Map();

// 微信 storage 是序列化存储：返回的是副本，且 undefined 字段会丢失。
// 这里用 JSON 往返模拟，既保证隔离，也能暴露「依赖对象引用」的隐患。
function clone(v) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}
function sizeOf(v) {
  if (v === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(v), 'utf8');
}

// ---------- 文件系统（模拟 USER_DATA_PATH，上限 10MB） ----------
const dataPath = path.join(os.tmpdir(), 'bdp-test-' + process.pid + '-' + Date.now());
fs.mkdirSync(dataPath, { recursive: true });

// 记录所有被调用的隐私接口，供测试断言「是否弹过授权」
const privacyCalls = [];
// 记录主动拉起的隐私授权请求（requirePrivacyAuthorize），供断言"失败后是否重试过"
const privacyAuthRequests = [];
// 记录所有 toast / modal，供测试断言用户看到了什么提示
const toasts = [];
const modals = [];
// 记录 eventChannel 上 emit / on 过的数据（断言页面间传参用）
const emitted = [];
// 导航栏设色的记录（单独一个数组、不混进 toasts —— 见"混着取会偶发失败"那条注释）。
// 用途：断言「每个页面各自设过一次」（V98：模块级缓存会让第二个页面被跳过）。
const navBars = [];

// 可控的失败开关：测试「存储写失败 / 容量告警」的兜底行为用
// limitSizeKB：把容量上限临时改小，避免测试里真的写 8MB 数据
// clipboardFailQueue：按顺序消费的剪贴板失败（模拟"第一次失败、重试成功"这类真实链路）
//   —— 真机上剪贴板的失败几乎都是隐私相关：errno 104（未授权）/ 104179（后台未声明剪贴板用途）
// privacyDeny：隐私授权弹窗被拒绝
const faults = { storageFull: false, writeFail: false, limitSizeKB: 0, compressFail: false, imageInfoFail: false, shareFail: false, writeFileFail: false, modalFail: false, shareUnsupported: false, clipboardFail: false, clipboardFailQueue: [], privacyDeny: false, cloudInitFail: false, cloudFail: false, cloudUploadFail: false, cloudDownloadFail: false, cloudDeleteFail: false };

// ---------- 云开发（wx.cloud）模拟 ----------
// 只模拟本项目真正用到的能力：云函数调用 + 云存储上传/下载/删除。
// 云盘用内存 Map 模拟，便于后续（P3/P5）测"上传后能下载回来"这类闭环。
const cloudFiles = new Map();   // cloudPath -> { content }（内容用字符串模拟文件字节）

// ── 测试环境：把云配置装成「可用」──
// 生产 ENV_ID 是占位符（2026-09-27 用户决定先不开云），但云代码**必须继续被测试覆盖**——
// 否则总闸一关，72 条云测试就全成了摆设。所以在这里统一注入测试态环境 ID。
// ⚠️ 这是测试专用通道，生产代码永不调用（有守卫 tests/guard-cloud-offline.test.js 盯着）。
// 任何测试都可用 setEnvForTest(null) 临时模拟「生产关闭态」，用完还原为 TEST_ENV。
const cloudConfigForTest = require('../services/cloud-config.js');
cloudConfigForTest.setEnvForTest(cloudConfigForTest.TEST_ENV);

const cloudInits = [];          // cloud.init 调用记录
const cloudCallResults = {};    // 云函数名 -> 自定义返回值（值，或 (data)=>值）
const cloudCalls = [];          // callFunction 记录
const cloudUploads = [];        // uploadFile 记录
const cloudDownloads = [];      // downloadFile 记录
const cloudDeletes = [];        // deleteFile 记录
const CLOUD_ENV = 'cloudbase-test-env';
// 云函数 getOpenid 默认返回的"真实身份"（测试可用 wx.__nextOpenid 覆盖；设为 null 表示云函数没返回）
let cloudNextOpenid = 'oREAL_test_openid_A';

// ---------- TAP 手势上下文（微信硬约束的忠实模拟） ----------
// 微信要求 wx.shareFileMessage 必须由用户点击的**同步调用栈**触发：一旦离开 tap 回调
// （例如在 await / .then 之后再调用），平台会 fail: can only be invoked by user TAP gesture。
// 2026-09-12 真机事故正是踩了这个坑（点清空 → 异步写完备份 → 再转发，必然失败）。
// 这里用 tapDepth 复刻该约束，让「在异步链条里转发」这类错误在测试阶段就暴露。
let tapDepth = 0;
function simulateTap(fn) {
  tapDepth++;
  try { return fn(); } finally { tapDepth--; }
}

const wx = {
  env: { USER_DATA_PATH: dataPath },

  // ---- storage ----
  getStorageSync(key) {
    const v = storage.get(key);
    return v === undefined ? '' : clone(v);
  },
  setStorageSync(key, val) {
    if (faults.storageFull) {
      const e = new Error('setStorageSync:fail exceed storage max size');
      e.errMsg = 'setStorageSync:fail exceed storage max size';
      throw e;
    }
    storage.set(key, clone(val));
  },
  removeStorageSync(key) { storage.delete(key); },
  clearStorageSync() { storage.clear(); },
  getStorageInfoSync() {
    let bytes = 0;
    storage.forEach((v, k) => { bytes += sizeOf(v) + Buffer.byteLength(k, 'utf8'); });
    return {
      keys: Array.from(storage.keys()),
      currentSize: Math.ceil(bytes / 1024),
      limitSize: faults.limitSizeKB || STORAGE_LIMIT_KB
    };
  },
  getStorageInfo(opt) {
    const info = wx.getStorageInfoSync();
    setTimeout(() => opt && opt.success && opt.success(info), 0);
  },

  // ---- 文件系统 ----
  getFileSystemManager() {
    return {
      saveFile(opt) {
        if (faults.writeFail) return setTimeout(() => opt.fail && opt.fail({ errMsg: 'saveFile:fail' }), 0);
        try {
          fs.copyFileSync(opt.tempFilePath, opt.filePath);
          setTimeout(() => opt.success && opt.success({ savedFilePath: opt.filePath }), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      writeFile(opt) {
        if (faults.writeFileFail) return setTimeout(() => opt.fail && opt.fail({ errMsg: 'writeFile:fail' }), 0);
        try {
          fs.writeFileSync(opt.filePath, opt.data, opt.encoding || 'utf8');
          setTimeout(() => opt.success && opt.success({}), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      readFile(opt) {
        try {
          const buf = fs.readFileSync(opt.filePath);
          const data = opt.encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8');
          setTimeout(() => opt.success && opt.success({ data }), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      readdir(opt) {
        try {
          let list = fs.readdirSync(opt.dirPath);
          if (opt.success) setTimeout(() => opt.success({ files: list }), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      unlink(opt) {
        try {
          fs.unlinkSync(opt.filePath);
          setTimeout(() => opt.success && opt.success({}), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      access(opt) {
        try {
          fs.accessSync(opt.path);
          setTimeout(() => opt.success && opt.success({}), 0);
        } catch (e) {
          setTimeout(() => opt.fail && opt.fail(e), 0);
        }
      },
      stat(opt) {
        const done = (r) => {
          if (r) { if (opt.success) opt.success(r); }
          else if (opt.fail) opt.fail({ errMsg: 'stat:fail' });
          if (opt.complete) opt.complete();
        };
        try {
          const st = fs.statSync(opt.path);
          setTimeout(() => done({ stats: st, size: st.size }), 0);
        } catch (e) {
          setTimeout(() => done(null), 0);
        }
      }
    };
  },

  // ---- UI 反馈（记录而不真的弹） ----
  showToast(opt) { toasts.push(opt); setTimeout(() => opt && opt.success && opt.success({}), 0); },
  hideToast() {},
  showModal(opt) {
    if (faults.modalFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'showModal:fail confirmText length should not larger than 4 Chinese characters' }), 0);
    modals.push(opt);
    // 默认点「确定」，测试可覆盖 answers
    const answer = modals.answerQueue.length ? modals.answerQueue.shift() : { confirm: true, cancel: false };
    setTimeout(() => opt && opt.success && opt.success(answer), 0);
  },
  showLoading() {}, hideLoading() {},
  showActionSheet(opt) { setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'cancel' }), 0); },

  // ---- 导航（记录调用，不真的跳） ----
  // ⚠️ 真机上 navigateTo 带 events 时，success 回调**一定**会拿到 res.eventChannel；
  //    桩不给它的话，页面里 `res.eventChannel.emit('passTasks', ...)` 会异步抛错并崩掉整个测试进程
  //    （2026-09-12 被刀口布生产用例踩到：用例本身是绿的，但套件在半路 TypeError 中断）。
  //    这里补一个记录型的 eventChannel，emit/on 的内容留在 emitted 供断言。
  navigateTo(opt) { toasts.push({ nav: 'navigateTo', url: opt.url }); setTimeout(() => opt && opt.success && opt.success({ errMsg: 'navigateTo:ok', eventChannel: mkChannel(opt.url) }), 0); },
  redirectTo(opt) { toasts.push({ nav: 'redirectTo', url: opt.url }); setTimeout(() => opt && opt.success && opt.success({ errMsg: 'redirectTo:ok', eventChannel: mkChannel(opt.url) }), 0); },
  navigateBack(opt) { toasts.push({ nav: 'navigateBack' }); setTimeout(() => opt && opt.success && opt.success({ errMsg: 'navigateBack:ok' }), 0); },
  switchTab(opt) { toasts.push({ nav: 'switchTab', url: opt.url }); setTimeout(() => opt && opt.success && opt.success({ errMsg: 'switchTab:ok' }), 0); },

  // ---- 媒体 / 文件交互（只记录） ----
  compressImage(opt) {
    if (faults.compressFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'compressImage:fail' }), 0);
    toasts.push({ compressImage: opt });
    setTimeout(() => opt && opt.success && opt.success({ tempFilePath: opt.src }), 0);
  },
  getImageInfo(opt) {
    // 测试可用 wx.__nextImageInfo 覆盖默认尺寸（默认 1600x1200 大图）
    const info = Object.assign({ width: 1600, height: 1200, path: opt.src, type: 'jpg' }, wx.__nextImageInfo || {});
    wx.__nextImageInfo = null;
    if (faults.imageInfoFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'getImageInfo:fail' }), 0);
    setTimeout(() => opt && opt.success && opt.success(info), 0);
  },
  chooseMedia(opt) {
    setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'chooseMedia:fail cancel' }), 0);
  },
  chooseImage(opt) {
    setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'chooseImage:fail cancel' }), 0);
  },
  shareFileMessage(opt) {
    // ★ 忠实模拟微信硬约束：必须处于 TAP 手势的同步调用栈里，否则平台直接拒绝。
    //   真实 errMsg: shareFileMessage:fail can only be invoked by user TAP gesture
    if (tapDepth === 0) {
      return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'shareFileMessage:fail can only be invoked by user TAP gesture' }), 0);
    }
    if (faults.shareFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'shareFileMessage:fail cancel' }), 0);
    toasts.push({ shareFileMessage: opt.fileName });
    setTimeout(() => opt && opt.success && opt.success({}), 0);
  },
  canIUse(name) {
    if (name === 'shareFileMessage') return !faults.shareUnsupported;
    return true;
  },
  // 仅供页面级逻辑调用（真机上把页面滚到指定位置，不影响数据）
  pageScrollTo(opt) { setTimeout(() => opt && opt.success && opt.success({}), 0); },
  saveFileToDisk(opt) {
    // PC 端能力：把文件复制到调用方给的路径
    try {
      if (opt.filePath && opt.filePath.indexOf(dataPath) === 0 && opt.targetPath) {
        fs.copyFileSync(opt.filePath, opt.targetPath);
      }
      setTimeout(() => opt && opt.success && opt.success({}), 0);
    } catch (e) {
      setTimeout(() => opt && opt.fail && opt.fail(e), 0);
    }
  },
  chooseMessageFile(opt) {
    // 测试可预设 nextChosenFile 来模拟用户选回一个备份文件
    const f = wx.__nextChosenFile;
    wx.__nextChosenFile = null;
    if (!f) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'chooseMessageFile:fail cancel' }), 0);
    setTimeout(() => opt && opt.success && opt.success({ tempFiles: [{ path: f, name: path.basename(f), size: 0 }] }), 0);
  },
  saveImageToPhotosAlbum(opt) { setTimeout(() => opt && opt.success && opt.success({}), 0); },
  openDocument(opt) { setTimeout(() => opt && opt.success && opt.success({}), 0); },
  // 剪贴板：成功/失败都要能模拟 —— 真机上它**真的会失败**，而且失败几乎都是隐私相关：
  //   errno 104    privacy permission is not authorized（用户没同意隐私授权）
  //   errno 104179 api scope is not declared in the privacy agreement（后台没声明剪贴板用途）
  // 之前项目里 4 处调用都没接 fail，导致失败时"点了没反应"，根本没人发现。
  setClipboardData(opt) {
    const q = faults.clipboardFailQueue;
    if (faults.clipboardFail || (q && q.length)) {
      const e = (q && q.length) ? q.shift() : { errMsg: 'setClipboardData:fail', errno: 0 };
      return setTimeout(() => opt && opt.fail && opt.fail(e), 0);
    }
    toasts.push({ clipboard: opt && opt.data });
    setTimeout(() => opt && opt.success && opt.success({}), 0);
  },

  // ---- 隐私 ----
  onNeedPrivacyAuthorize(cb) { privacyCalls.push(cb); },
  // 主动拉起隐私授权弹窗（剪贴板失败后的重试路径会用到）—— 记次数供断言，可模拟被拒
  requirePrivacyAuthorize(opt) {
    privacyAuthRequests.push(opt || {});
    if (faults.privacyDeny) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'requirePrivacyAuthorize:fail auth deny' }), 0);
    setTimeout(() => opt && opt.success && opt.success({}), 0);
  },
  getPrivacySetting(opt) { setTimeout(() => opt && opt.success && opt.success({ needAuthorization: false }), 0); },

  // ---- 其他 ----
  // 测试可用 wx.__nextSystemInfo 覆盖（典型用途：模拟阿拉伯语环境验证 RTL 方向）
  getSystemInfoSync() {
    return Object.assign(
      { platform: 'windows', SDKVersion: '3.0.0', windowWidth: 375, windowHeight: 667, language: 'zh_CN' },
      wx.__nextSystemInfo || {}
    );
  },
  getAppBaseInfo() { return { SDKVersion: '3.0.0', platform: 'windows' }; },
  setNavigationBarTitle(opt) { setTimeout(() => opt && opt.success && opt.success({}), 0); },
  setNavigationBarColor(opt) { navBars.push(opt || {}); setTimeout(() => opt && opt.success && opt.success({}), 0); },
  nextTick(cb) { setTimeout(cb, 0); },

  // ---- cloud（云开发：只模拟本项目真正用到的能力）----
  // 注意：客户端**没有**"列云存储目录"的能力（真实平台也没给），所以本项目用
  // 「固定命名 + 索引文件」而不是列目录；桩也据此不提供 list，免得写出真机跑不通的代码。
  cloud: {
    init(opt) {
      cloudInits.push(opt || {});
      if (faults.cloudInitFail) throw new Error('cloud.init:fail env not found');
    },
    callFunction(opt) {
      cloudCalls.push({ name: opt && opt.name, data: opt && opt.data });
      if (faults.cloudFail) {
        return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'callFunction:fail network error' }), 0);
      }
      if (opt && opt.name === 'getOpenid') {
        // cloudNextOpenid 为 null → 模拟「云函数没返回 openid」（测兜底路径）
        if (cloudNextOpenid == null) {
          return setTimeout(() => opt.success && opt.success({ result: {} }), 0);
        }
        return setTimeout(() => opt.success && opt.success({ result: { openid: cloudNextOpenid } }), 0);
      }
      // 测试可用 setCloudResult(name, 值 | (data)=>值) 指定某个云函数的返回值
      if (Object.prototype.hasOwnProperty.call(cloudCallResults, opt && opt.name)) {
        const spec = cloudCallResults[opt && opt.name];
        let result;
        try {
          result = typeof spec === 'function' ? spec(opt && opt.data) : spec;
        } catch (e) {
          return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'callFunction:fail ' + (e && e.message) }), 0);
        }
        return setTimeout(() => opt.success && opt.success({ result: result }), 0);
      }
      setTimeout(() => opt && opt.success && opt.success({ result: {} }), 0);
    },
    uploadFile(opt) {
      cloudUploads.push({ cloudPath: opt && opt.cloudPath, filePath: opt && opt.filePath });
      if (faults.cloudUploadFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'uploadFile:fail' }), 0);
      // 真机是「把本地文件的字节传上去」，所以桩也读真实文件内容 ——
      // 否则测试无法验证「传上去的确实是当前数据」（内容会全成占位串）
      let content = 'stub';
      try {
        if (opt && opt.filePath && fs.existsSync(opt.filePath)) {
          content = fs.readFileSync(opt.filePath, 'utf8');
        }
      } catch (_) { /* 读不到就退回占位内容，不阻断上传 */ }
      if (opt && opt.cloudPath) cloudFiles.set(opt.cloudPath, { content: content });
      setTimeout(() => opt && opt.success && opt.success({ fileID: 'cloud://' + CLOUD_ENV + '/' + (opt && opt.cloudPath) }), 0);
    },
    downloadFile(opt) {
      cloudDownloads.push({ fileID: opt && opt.fileID });
      if (faults.cloudDownloadFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'downloadFile:fail' }), 0);
      const key = String((opt && opt.fileID) || '').replace('cloud://' + CLOUD_ENV + '/', '');
      if (!cloudFiles.has(key)) {
        return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'downloadFile:fail file not exist' }), 0);
      }
      // 真机下载会落成一个真实文件 —— 桩也必须写盘，
      // 否则调用方（如「从云端恢复」）读文件时一无所获，测出来的是假绿/假红
      const tempFilePath = dataPath + '/dl-' + key.replace(/\//g, '_');
      try { fs.writeFileSync(tempFilePath, (cloudFiles.get(key) || {}).content || ''); } catch (_) { /* 写不了就交给调用方暴露 */ }
      setTimeout(() => opt && opt.success && opt.success({ tempFilePath: tempFilePath }), 0);
    },
    deleteFile(opt) {
      const list = (opt && opt.fileList) || [];
      cloudDeletes.push({ fileList: list.slice() });
      if (faults.cloudDeleteFail) return setTimeout(() => opt && opt.fail && opt.fail({ errMsg: 'deleteFile:fail' }), 0);
      list.forEach((id) => cloudFiles.delete(String(id).replace('cloud://' + CLOUD_ENV + '/', '')));
      setTimeout(() => opt.success && opt.success({ fileList: list.map((id) => ({ fileID: id, status: 0 })) }), 0);
    }
  },

  // 若框架代码意外发起网络请求，测试里应当立刻暴露
  request() { throw new Error('未预期的 wx.request 调用：本项目应为零网络架构'); }
};

// showModal 的答案队列（测试可 push）
modals.answerQueue = [];

// ---------- 全局注册 ----------
const appInstance = {
  globalData: { currentCategoryId: 'bc_default', openid: '' },
  setCurrentCategory(id) { this.globalData.currentCategoryId = id; }
};

global.wx = wx;
global.getApp = () => appInstance;
global.getCurrentPages = () => [];
global.App = (o) => Object.assign(appInstance, o);
global.Page = (o) => o;
global.Component = (o) => o;
global.Behavior = (o) => o;

// ---------- 测试辅助 ----------
function resetStorage() {
  storage.clear();
  privacyAuthRequests.length = 0;
  faults.clipboardFailQueue.length = 0;
  faults.privacyDeny = false;
  faults.storageFull = false;
  faults.writeFail = false;
  faults.limitSizeKB = 0;
  faults.compressFail = false;
  faults.imageInfoFail = false;
  faults.shareFail = false;
  faults.writeFileFail = false;
  faults.modalFail = false;
  faults.shareUnsupported = false;
  faults.clipboardFail = false;
  // 云开发故障/观测清零（否则上一个用例的云调用会串到下一个）
  faults.cloudInitFail = false;
  faults.cloudFail = false;
  faults.cloudUploadFail = false;
  faults.cloudDownloadFail = false;
  faults.cloudDeleteFail = false;
  cloudFiles.clear();
  cloudInits.length = 0;
  cloudCalls.length = 0;
  cloudUploads.length = 0;
  cloudDownloads.length = 0;
  cloudDeletes.length = 0;
  cloudNextOpenid = 'oREAL_test_openid_A';
  Object.keys(cloudCallResults).forEach((k) => { delete cloudCallResults[k]; });
  toasts.length = 0;
  navBars.length = 0;
  modals.length = 0;
  modals.answerQueue.length = 0;
  appInstance.globalData.currentCategoryId = 'bc_default';
  wx.__nextChosenFile = null;
  wx.__nextImageInfo = null;
}

// ---------- 断言辅助：把「真 toast」与「导航记录」分开 ----------
// toasts 数组里混着两类记录：真正的 toast（有 title）与导航调用（{ nav: '...' }）。
// 为什么必须分开取（2026-09-14 踩到）：
//   页面里「提示一下然后返回」写的是 setTimeout(() => wx.navigateBack(), 400~500)，
//   测试不会等这 400ms —— 那个定时器会在**后续某个测试**的 await 窗口里落地，
//   于是「最近一条 toast」被一条导航记录顶掉，表现为偶发失败（跑 5 次挂 2 次），极难查。
//   所以：断言 toast 用 lastToast()，断言跳转用 navs()，不要直接摸 toasts[末尾]。
function toastsOnly() { return toasts.filter((t) => t && typeof t.title === 'string'); }
function lastToast() { const a = toastsOnly(); return a[a.length - 1]; }
// kind 可选：'navigateTo' / 'redirectTo' / 'navigateBack' / 'switchTab'
// 建议带上 kind —— 别的测试残留的"延迟返回"定时器可能往数组里插一条 navigateBack
function navs(kind) { return toasts.filter((t) => t && t.nav && (!kind || t.nav === kind)); }

// 记录型的页面间通道：真机 navigateTo(events) 的 success 一定带 eventChannel，
// 桩里补上以免页面代码异步抛错（见下方 navigateTo 注释）
function mkChannel(url) {
  const channel = {
    on(name) { emitted.push({ url, on: name }); return channel; },
    emit(name, data) { emitted.push({ url, emit: name, data }); return channel; }
  };
  return channel;
}

const api = {
  wx, storage, dataPath, toasts, modals, emitted, privacyCalls, privacyAuthRequests, faults, appInstance,
  navBars,
  // 云开发观测（P1 起）：云盘内容、init/调用/上传/下载/删除 的记录
  cloudFiles, cloudInits, cloudCalls, cloudUploads, cloudDownloads, cloudDeletes,
  // 设定云函数 getOpenid 的返回值；传 null 可模拟「云函数没返回 openid」的兜底路径
  setCloudOpenid: (v) => { cloudNextOpenid = v; },
  // 设定任意云函数的返回值；传函数则按入参 data 现算（见 callFunction 分支）
  setCloudResult: (name, spec) => { cloudCallResults[name] = spec; },
  resetStorage,
  // 从「toast + 导航」混合数组里分别取（见上方注释：混着取会偶发失败）
  toastsOnly, lastToast, navs,
  // 模拟一次用户点击：只有在其同步调用栈内触发的 shareFileMessage 才会成功
  simulateTap,
  setSpace: (id) => { appInstance.globalData.currentCategoryId = id; },
  // 等待所有 setTimeout(…, 0) 回调跑完
  flush: () => new Promise((r) => setTimeout(r, 0))
};

module.exports = api;
