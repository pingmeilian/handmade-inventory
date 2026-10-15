// utils/clear-flow.js —— 「清空数据（恢复出厂）」的共享编排（关于页 / 数据体检页共用）
//
// 为什么抽出来：同一个危险操作要在多个入口提供，逻辑必须只有一份 —— 保证两条路的护栏完全一致。
//
// ★★ 为什么是「两段式」（2026-09-12 真机事故后重构）：
//   微信硬约束：wx.shareFileMessage 必须由用户的 TAP 手势「直接」触发。
//   旧实现是「点清空 → 弹确认 → await 写完整备份 → 直接调转发」——转发发生在异步链条深处，
//   脱离手势上下文 → 必然 fail: shareFileMessage:fail can only be invoked by user TAP gesture。
//   因此拆成三段，把「转发」这一步交还给页面的点击：
//     ① prepareClear()              可异步：确认 → 生成完整备份 → 交回 {path,name} 供页面展示转发按钮
//     ② sharePendingAndCommit(pb)   ⚠️ 必须在页面 bindtap 处理器里**同步**调用（第一行）
//     ③ commitClear()               转发成功后：清空 + 恢复出厂预设
//
// 任何一步没走通都中止，数据分毫不动。
//
// 返回约定：
//   prepareClear         → { ok:true, path, name, sizeBytes, imagesCount } | { ok:false, stage:'cancel'|'write' }
//   sharePendingAndCommit→ { ok:true } | { ok:false, reason:'cancel'|'no-gesture'|'unsupported'|'fail'|'no-pending'|'snapshot-fail' }
//   commitClear          → { ok:true } | { ok:false, reason:'snapshot-fail', error }（快照留不下则**中止清空**）

const store = require('./store.js');
const util = require('./util.js');
const state = require('../services/state.js');
const backup = require('../services/backup.js');
const share = require('./share.js');

const CLEAR_TIP = '清空前会先做一次完整备份（含图片）。备份生成后，需要你点一下「转发备份到微信」把它发到「文件传输助手」保存——微信规定转发必须由你的点击触发。转发成功才会清空。';

function abortModal(why) {
  wx.showModal({ title: '已中止清空', content: why, showCancel: false, confirmText: '知道了' });
}

// ① 第一段（可异步）：确认 + 生成完整备份文件，不转发
function prepareClear() {
  return util.confirm('清空本地数据', CLEAR_TIP, '继续').then((confirmed) => {
    if (!confirmed) return { ok: false, stage: 'cancel' };
    wx.showLoading({ title: '正在生成完整备份…', mask: true });
    return backup.prepareClearBackup().then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        // 用 modal 而不是 toast：真机上 toast 紧跟 hideLoading 会被吞（用户曾以为按钮失灵）
        abortModal((r.error && (r.error.msg || r.error.message)) || '备份生成失败，已中止清空（数据未变动）');
        return { ok: false, stage: 'write', error: r.error };
      }
      return { ok: true, path: r.path, name: r.name, sizeBytes: r.sizeBytes, imagesCount: r.imagesCount };
    });
  });
}

// ② 第二段：⚠️ 必须在 bindtap 处理器里**同步**调用（首行），中间不能有 await。
//    转发成功才执行清空。取消转发 → 静默返回（用户自己知道）；其他失败 → 弹窗说清真实原因。
function sharePendingAndCommit(pending) {
  if (!pending || !pending.path) {
    abortModal('没有待转发的备份，请重新点一次「清空本地数据」。');
    return Promise.resolve({ ok: false, reason: 'no-pending' });
  }
  return share.shareFileNow(pending.path, pending.name).then((r) => {
    if (!r.ok) {
      if (r.reason !== 'cancel') abortModal(r.msg);
      return { ok: false, reason: r.reason, errMsg: r.errMsg };
    }
    const cleared = commitClear();
    if (!cleared.ok) {
      // 清空被中止（快照留不下）。⚠️ 此时**不动**备份文件与待转发状态 ——
      // 用户手上那份转发出去的备份、以及本地这两份文件都还在，可以再试一次。
      return { ok: false, reason: cleared.reason };
    }
    // 清空**成功之后**才清理历史备份文件。反过来的话，一旦清空被中止，
    // 历史备份已经先没了 —— 只剩用户转发出去的那一份，白丢一层保障。
    backup.cleanupBackupFiles(pending.path);
    return { ok: true };
  });
}

// ③ 第三段：先留后路，再纯清空 + 恢复出厂预设
//
// ⭐ 清空前必须留一份内部快照（2026-09-26 补）：
//   这是全项目**最危险**的操作 —— 恢复好歹是"拿一份完整数据覆盖上来"，清空是**直接删**。
//   流程虽然要求先把完整备份转发到微信，可那份文件得靠用户自己保存好，丢了就真没了；
//   而快照留在本机（且不在被清之列），清空后发现弄错了，回设置页点一下「恢复」就能找回来。
//
// ⚠️ 快照写不进去就**中止清空** —— 绝不带着"没有后路"去删数据
//   （与恢复流程同一条纪律；`services/backup.js` 的 createInternalSnapshot 会抛错）。
function commitClear() {
  try {
    backup.createInternalSnapshot('clear');
  } catch (e) {
    abortModal((e && (e.msg || e.message)) || '无法保存「清空前快照」，已中止清空（数据未变动）');
    return { ok: false, reason: 'snapshot-fail', error: e };
  }
  store.clearAll();
  store.ensureSeed();   // 预设全部重发（清空 = 恢复出厂）
  if (state.getCurrentSpace() !== 'bc_default') state.setCurrentSpace('bc_default');
  return { ok: true };
}

module.exports = {
  CLEAR_TIP: CLEAR_TIP,
  prepareClear: prepareClear,
  sharePendingAndCommit: sharePendingAndCommit,
  commitClear: commitClear
};
