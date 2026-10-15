// utils/share.js —— 转发文件的**唯一入口**（全项目只此一处调用 wx.shareFileMessage）
//
// ⚠️⚠️ 微信硬约束（2026-09-12 真机事故，务必遵守）：
//   wx.shareFileMessage 必须由用户的 **TAP 手势直接触发** —— 即调用必须发生在
//   bindtap 处理器的「同步调用栈」里。若在异步回调（await 之后、.then 里、定时器里）调用，
//   会直接失败：shareFileMessage:fail can only be invoked by user TAP gesture
//   （官方 FAQ 亦明确：下载任务完成后的回调里调用不合法）
//
//   因此正确的姿势是「两段式」：
//     ①（允许异步）在某个 tap 里生成文件 → setData 记住路径
//     ② 页面另设一个按钮，把转发作为该 bindtap 处理器的**第一条同步语句**调用
//
//   本模块的调用方必须保证：`shareFileNow` 是 tap 处理器里第一个被调用的东西，
//   中间不能有 await / .then / setTimeout。
//
//   防回归：tests/share-gesture.test.js 会
//     ① 扫描全项目源码，禁止 utils/share.js 以外出现 wx.shareFileMessage；
//     ② 用 stub 模拟 tap 上下文（脱离 tap 就 fail），把这类错误变成测试可捕获。

const MSG_UNSUPPORTED = '当前微信版本不支持转发文件（需基础库 2.16.1 及以上），请升级微信后重试';

// 把平台原始 errMsg 翻译成我们能处置的原因（绝不吞错）
function classify(errMsg) {
  const m = String(errMsg || '');
  if (/TAP gesture/i.test(m)) {
    return { reason: 'no-gesture', msg: '转发需要由你的点击直接触发（请直接点这个按钮重试一次）' };
  }
  if (/cancel/i.test(m)) {
    return { reason: 'cancel', msg: '你取消了转发' };
  }
  if (/not support|unsupport/i.test(m)) {
    return { reason: 'unsupported', msg: MSG_UNSUPPORTED };
  }
  return { reason: 'fail', msg: m ? ('转发失败：' + m) : '转发失败（未返回原因），请重试' };
}

// 必须在 bindtap 处理器里同步调用（第一行）。
// 返回 Promise：{ ok:true } | { ok:false, reason, errMsg, msg }
function shareFileNow(filePath, fileName) {
  return new Promise((resolve) => {
    // 能力前置检查：低版本微信没有这个 API（此时直接说清楚，不去撞一个必然的失败）
    let supported = true;
    try {
      supported = typeof wx.canIUse !== 'function' || wx.canIUse('shareFileMessage');
      // 有些环境没有 canIUse 但也没有该 API
      if (typeof wx.shareFileMessage !== 'function') supported = false;
    } catch (e) {
      supported = typeof wx.shareFileMessage === 'function';
    }
    if (!supported) {
      console.warn('[share] 转出失败：当前环境不支持 shareFileMessage');
      return resolve({ ok: false, reason: 'unsupported', errMsg: '', msg: MSG_UNSUPPORTED });
    }
    if (!filePath) {
      return resolve({ ok: false, reason: 'fail', errMsg: '', msg: '没有可转发的文件' });
    }
    try {
      wx.shareFileMessage({
        filePath: filePath,
        fileName: fileName,
        success: () => resolve({ ok: true }),
        fail: (err) => {
          const errMsg = (err && err.errMsg) || '';
          console.warn('[share] fail:', errMsg);
          const c = classify(errMsg);
          resolve({ ok: false, reason: c.reason, errMsg: errMsg, msg: c.msg });
        }
      });
    } catch (e) {
      const m = (e && e.message) || String(e);
      console.error('[share] 调用异常:', m);
      resolve({ ok: false, reason: 'fail', errMsg: m, msg: '转发调用异常：' + m });
    }
  });
}

module.exports = {
  shareFileNow: shareFileNow,
  classify: classify,
  MSG_UNSUPPORTED: MSG_UNSUPPORTED
};
