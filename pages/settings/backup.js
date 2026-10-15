// pages/settings/backup.js —— 备份与恢复（Day 4 任务 4.2/4.3/4.4/4.6 的页面入口）
// 逻辑全部在 services/backup.js（有测试覆盖），本页只做编排、确认与防双击。
const backup = require('../../services/backup.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const cloudBackup = require('../../services/cloud-backup.js');
const photoSync = require('../../services/photo-sync.js');

// 云端失败的"人话"说明 —— 给最终用户看，**不出现开发者术语**（errno / 云函数名之类）
const CLOUD_ERR = {
  'cloud-disabled': '云端服务暂时不可用，请稍后再试',
  'no-identity': '暂时无法确认你的身份，请稍后再试',
  'upload-fail': '上传失败（可能是网络问题），稍后会自动重试',
  'index-fail': '同步未完成，稍后会自动重试',
  'fs-fail': '本机文件操作失败，请稍后再试',
  'no-backup': '云端还没有备份',
  'no-such-slot': '云端已经没有这一份了，请刷新后重试',
  'bad-slot': '这份备份无法识别，请刷新后重试',
  'download-fail': '备份下载失败，请检查网络后重试',
  'invalid-backup': '云端备份内容不可用',
  'restore-fail': '恢复失败，请稍后再试'
};
function cloudErrText(reason) { return CLOUD_ERR[reason] || '操作失败，请稍后再试'; }
function fmtKB(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; }

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    busy: false,          // 导出进行中（防双击）
    importing: false,     // 导入进行中（防双击）
    mode: 'full',         // 默认完整模式（决策 4：含图片）
    lastExported: null,   // { path, name, sizeText, imagesCount }
    snapshots: [],        // 内部快照（三保险，最近 3 份）
    imgUsage: null,       // 图片空间 { usedText, percent, count }
    cloud: { enabled: false, statusText: '', backups: [] },  // 云端备份状态（P3.5）
    photo: { enabled: false, statusText: '' },              // 图片上云状态（P4）
    cloudBusy: false      // 云端操作进行中（防双击）
  },

  onShow() { themePage.apply(this); this.refresh(); },

  refresh() {
    // 内部快照列表
    const snaps = backup.listInternalSnapshots().map((s) => ({
      id: s.id,
      reason: this._reasonText(s.reason),
      at: util.fmtDate(new Date(s.at)),
      keys: Object.keys(s.data || {}).length
    }));
    this.setData({ snapshots: snaps });
    this.refreshCloud();   // 云端状态一起刷（含"上次同步时间"）
    // 图片空间用量（已用/图片张数/百分比）——帮用户判断要不要清图或用轻量模式
    // 口径注意：photoCount 只数图片；备份 json/CSV/PDF 是文件不算图片（真机「46 张图」教训）
    require('../../utils/image.js').userDataUsage().then((u) => {
      this.setData({
        imgUsage: {
          count: u.photoCount,
          usedText: (u.used / 1024 / 1024).toFixed(1) + ' MB',
          percent: Math.round(u.ratio * 100)
        }
      });
    });
  },

  // ---------- 云端备份（P3.5） ----------
  // 为什么要有这一块：云端备份最怕的不是坏，而是"你以为它在工作，其实早就停了"。
  // 有一个看得见的时间，用户才敢信它。

  refreshCloud() {
    const st = cloudBackup.status();
    if (!st.enabled) {
      this.setData({ cloud: { enabled: false, statusText: '', backups: [] }, photo: { enabled: false, statusText: '' } });
      return;
    }
    const statusText = st.lastUploadAt
      ? ('上次同步：' + this._agoText(st.lastUploadAt))
      : '还没有同步过（改一笔账后会自动同步，也可以点下面立即同步）';
    this.setData({ 'cloud.enabled': true, 'cloud.statusText': statusText });

    // 图片上云（P4）：与数据同步是**两条独立链路**，所以单独一行 ——
    // 图片走攒批，可能数据早就同步好了、图还在排队，两件事得能分别看见。
    const pst = photoSync.status();
    const parts = ['已同步 ' + pst.synced + ' 张'];
    if (pst.pending > 0) parts.push(pst.pending + ' 张待传');
    this.setData({ 'photo.enabled': true, 'photo.statusText': parts.join(' · ') });

    // 云端还原点列表：拿不到就只影响这一行显示，不该打扰用户（状态行仍然有效）
    cloudBackup.cloudBackups().then((r) => {
      if (!r.ok) return;
      this.setData({
        'cloud.backups': r.list.map((x, i) => ({
          slot: x.slot,
          // ⭐ 必须到「时:分」—— 两个还原点常常是同一天的，
          // 只显示到"日"时两条长得一模一样，用户根本分不清该恢复哪一份
          at: util.fmtDateTime(new Date(x.at)),
          ago: this._agoText(x.at),
          sizeText: fmtKB(x.sizeBytes),
          isLatest: i === 0
        }))
      });
    }).catch(() => { /* 静默：这只是展示信息，不是关键路径 */ });
  },

  _agoText(ts) {
    const d = Date.now() - ts;
    if (d < 60 * 1000) return '刚刚';
    if (d < 3600 * 1000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 24 * 3600 * 1000) return Math.floor(d / 3600000) + ' 小时前';
    return util.fmtDate(new Date(ts));
  },

  // 立即同步（手动触发；平时改了账 20 秒后会自动同步，这里只是给用户一个"我现在就要"的入口）
  async doCloudSync() {
    if (this.data.cloudBusy) return;
    this.setData({ cloudBusy: true });
    wx.showLoading({ title: '同步中…', mask: true });
    try {
      const r = await cloudBackup.uploadNow();
      // 图片是独立链路：顺手把待传的图也传一批 ——
      // 用户点了「立即同步」，不该出现"数据上去了、图还留在本地"的半吊子状态
      try { await photoSync.flush(); } catch (e) { /* 图片失败不改变数据同步的结果提示 */ }
      wx.hideLoading();
      if (r.ok) {
        const pst = photoSync.status();
        util.toast(pst.pending > 0 ? ('数据已同步，图片还有 ' + pst.pending + ' 张') : '已同步到云端', 'success');
      } else {
        util.toast(cloudErrText(r.reason));
      }
      this.refreshCloud();
    } catch (e) {
      wx.hideLoading();
      util.toast('同步失败，请稍后再试');
    } finally {
      this.setData({ cloudBusy: false });
    }
  },

  // 从云端恢复（覆盖本机）。风险动作，所以：先确认 → 再恢复（恢复前 services/backup 会自动留快照）
  // 主按钮 = 恢复**最新**那份；想回到更早的那份用列表里的「恢复这份」。
  async doCloudRestore() {
    await this._runCloudRestore(
      {},
      '从云端恢复',
      '将用云端最新备份覆盖本机全部数据。恢复前会自动留一份本机快照，万一恢复错了还能退回。'
    );
  },

  // 恢复的共用流程：两个入口只差「恢复哪一份」与确认文案
  async _runCloudRestore(opts, title, content) {
    if (this.data.cloudBusy) return;
    const yes = await util.confirm(title, content, '恢复');
    if (!yes) return;
    this.setData({ cloudBusy: true });
    wx.showLoading({ title: '恢复中…', mask: true });
    try {
      const r = await cloudBackup.restoreFromCloud(Object.assign({}, opts, {
        // 图片可能几十张，逐张报进度 —— 否则长时间一个不动的 loading，用户会以为卡死了
        onPhotoProgress: (done, total) => {
          wx.showLoading({ title: '找回图片 ' + done + '/' + total, mask: true });
        }
      }));
      wx.hideLoading();
      if (r.ok) {
        this._reportRestore(r);
        this.refresh();   // 数据变了：快照列表、图片用量都要跟着刷新
      } else {
        util.toast(cloudErrText(r.reason));
      }
    } catch (e) {
      wx.hideLoading();
      util.toast('恢复失败，请稍后再试');
    } finally {
      this.setData({ cloudBusy: false });
    }
  },

  // 恢复结果**如实报告**：数据回来了，图片几张回来、几张没回来 ——
  // 不许含糊成一句"已恢复"，那会让用户以为图也全回来了。
  _reportRestore(r) {
    const p = r.photos || {};
    let content = '云端备份已恢复到本机。';
    if (p.total > 0) {
      content += '\n\n图片：' + (p.restored || 0) + ' / ' + p.total + ' 张已找回';
      if (p.failed > 0) content += '（' + p.failed + ' 张没回来，可能是网络原因，可以再恢复一次）';
    } else {
      content += '\n\n云端暂时没有需要找回的图片。';
    }
    content += '\n\n恢复前的数据已自动留了一份快照，万一不对可以在下方退回。';
    wx.showModal({ title: '恢复完成', content: content, showCancel: false, confirmText: '知道了' });
  },

  // 恢复指定的那一份（列表里每行的「恢复这份」——想回到更早的那份时用）。
  // 确认弹窗里**把时间点写清楚**：覆盖本机全部数据的动作，
  // 用户必须确切知道自己在拿哪一份覆盖。
  async doCloudRestoreSlot(e) {
    const slot = (e && e.currentTarget && e.currentTarget.dataset)
      ? String(e.currentTarget.dataset.slot || '')
      : '';
    if (!slot) return;
    const item = (this.data.cloud.backups || []).filter((x) => x.slot === slot)[0];
    const when = item ? item.at : '所选时间点';
    await this._runCloudRestore(
      { slot: slot },
      '恢复这份备份？',
      '将用 ' + when + ' 的云端备份覆盖本机全部数据。恢复前会自动留一份本机快照，万一恢复错了还能退回。'
    );
  },
  // 清理无主图片：数据里已经没有任何引用、纯粹占空间的孤儿图（真机 46 张孤儿图的解法）
  async doCleanOrphans() {
    if (this.data.busy) return;
    const r = await backup.findOrphanPhotos();
    if (!r.orphans.length) {
      util.toast('没有可清理的图片：每一张都被数据引用着', 'success');
      return;
    }
    const mb = (r.orphanBytes / 1024 / 1024).toFixed(1);
    const ok = await util.confirm(
      '清理无主图片',
      '找到 ' + r.orphans.length + ' 张图片没有被任何物料/成品/记录引用（约 ' + mb + ' MB）。' +
      (r.referencedCount ? '另有 ' + r.referencedCount + ' 张在用，不会动。' : '') +
      '删除后不可恢复，确定清理吗？',
      '清理'
    );
    if (!ok) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '清理中…', mask: true });
    try {
      const d = await backup.deleteOrphanPhotos(r.orphans.map((o) => o.name));
      wx.hideLoading();
      this.setData({ busy: false });
      util.toast('已清理 ' + d.deleted + ' 张，释放 ' + (d.freedBytes / 1024 / 1024).toFixed(1) + ' MB', 'success');
      this.refresh();
    } catch (e) {
      wx.hideLoading();
      this.setData({ busy: false });
      util.toast('清理失败，请重试');
    }
  },

  _reasonText(reason) {
    return { restore: '恢复前自动保存', 'before-restore-snapshot': '恢复快照前自动保存', 'clear': '清空前自动保存' }[reason] || (reason || '手动');
  },

  pickMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  // ---------- 导出 ----------
  async doExport() {
    if (this.data.busy) return;
    const full = this.data.mode === 'full';
    const ok = await util.confirm(
      '生成备份',
      full
        ? '完整模式：包含全部数据【和图片】，图片多时体积较大、耗时稍长。生成后请点「转发这份备份」发到「文件传输助手」或好友处保存。'
        : '轻量模式：只包含数据不含图片，体积小速度快。注意：恢复后图片不会回来（记录还在）。生成后请点「转发这份备份」。',
      '生成备份'
    );
    if (!ok) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '正在打包…', mask: true });
    try {
      const r = await backup.writeBackupFile(this.data.mode);
      wx.hideLoading();
      this.setData({
        busy: false,
        lastExported: { path: r.path, name: r.name, sizeText: fmtMB(r.sizeBytes), imagesCount: r.imagesCount }
      });
      // ⚠️ 不在这里自动转发：微信要求 shareFileMessage 必须由 TAP 手势直接触发，
      //    在 await 之后的异步链条里调用必然失败（2026-09-12 真机事故）。
      //    改由下方「转发这份备份」按钮触发（唯一合法姿势，见 utils/share.js）。
      util.toast('备份已生成，点下面「转发这份备份」发到微信保存');
    } catch (e) {
      wx.hideLoading();
      this.setData({ busy: false });
      util.toast((e && (e.msg || e.message)) || '备份生成失败，请重试');
    }
  },

  // ⚠️ 必须在 tap 处理器里同步调用（首行）——微信硬约束，详见 utils/share.js
  shareLast() {
    const ex = this.data.lastExported;
    if (!ex) { util.toast('请先生成一份备份'); return; }
    share.shareFileNow(ex.path, ex.name).then((r) => {
      if (r.ok) {
        util.toast('已发出，请确认对方收到并保存', 'success');
        // 备份已离开小程序，本地历史备份顺手清掉（保留刚转发的这份）
        backup.cleanupBackupFiles(ex.path);
      } else if (r.reason === 'cancel') {
        util.toast('转发已取消，文件还在，可再次转发');
      } else {
        // 真实原因必须让用户看见（此前一律报「分享已取消」，把错误全吞了）
        wx.showModal({ title: '转发失败', content: r.msg, showCancel: false, confirmText: '知道了' });
      }
    });
  },

  // ---------- 导入 ----------
  doImport() {
    if (this.data.importing) return;
    const that = this;
    wx.chooseMessageFile({
      count: 1, type: 'file',
      success(res) {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        that._importFile(f.path);
      },
      // ⚠️ 这里曾经是 `fail() { util.toast('已取消选择') }` —— 连 errMsg 都没接住，
      // 于是**任何**失败（平台不支持、权限、其它异常）都被说成"用户取消"：
      // 用户以为是自己手滑，排查也会一路查错方向。
      // 本项目这是第二次踩（第一次是 utils/share.js 的"你取消了转发"），故按 errMsg 分流：
      // 真取消 = 正常操作，一句轻提示；其它 = 留日志 + 给可执行的下一步。
      fail(err) {
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('cancel') >= 0) { util.toast('已取消选择'); return; }
        console.error('[backup] 选择聊天文件失败：', err);
        util.toast('打不开文件选择，请稍后再试');
      }
    });
  },

  async _importFile(filePath) {
    const that = this;
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'utf8',
      success(r) { that._confirmImport(r.data); },
      // 同样要接住 errMsg：读不出来可能是文件没了、编码不对、权限问题……
      // 只弹一句"读取失败"就永远查不到根因
      fail(err) {
        console.error('[backup] 读取备份文件失败：', err);
        util.toast('文件读取失败，请重选');
      }
    });
  },

  async _confirmImport(jsonText) {
    const parsed = backup.parseBackup(jsonText);
    if (!parsed.ok) { util.toast(parsed.error); return; }
    const p = parsed.payload;
    let records = 0;
    Object.keys(p.counts || {}).forEach((k) => { records += p.counts[k] || 0; });
    const when = p.createdAt ? util.fmtDate(new Date(p.createdAt)) : '未知时间';
    const imgText = p.mode === 'full' ? ('，含图片 ' + Object.keys(p.images || {}).length + ' 张') : '，不含图片';
    const ok = await util.confirm(
      '确认恢复这份备份？',
      '备份时间：' + when + imgText + '，共 ' + records + ' 条记录。\n\n恢复会【覆盖】当前全部数据（当前数据会先自动留一份内部快照，可在本页找回）。确认恢复吗？',
      '恢复'
    );
    if (!ok) return;
    this.setData({ importing: true });
    wx.showLoading({ title: '正在恢复…', mask: true });
    try {
      const report = await backup.restoreFromPayload(p);
      wx.hideLoading();
      this.setData({ importing: false });
      util.toast('恢复完成：' + report.keysRestored + ' 组数据' + (report.imagesRestored ? '，' + report.imagesRestored + ' 张图片' : ''), 'success');
      this.refresh();
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      util.toast((e && (e.msg || e.message)) || '恢复失败，当前数据未受影响');
    }
  },

  // ---------- 内部快照 ----------
  async restoreSnapshot(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('恢复到这个快照？', '将把数据回到生成该快照的时刻（不含图片）。当前数据会先自动留一份快照。', '恢复');
    if (!ok) return;
    try {
      const r = backup.restoreInternalSnapshot(id);
      if (r.ok) util.toast('已恢复到快照', 'success');
      else util.toast(r.error || '恢复失败');
    } catch (err) {
      util.toast(err && err.msg ? err.msg : '恢复失败');
    }
    this.refresh();
  }
});
