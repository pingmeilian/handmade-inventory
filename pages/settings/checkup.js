// pages/settings/checkup.js —— 数据体检（对账 + 存储状况）
// Day 3 任务 3.4：把 Day 2 的对账/修复能力交到用户手上。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const image = require('../../utils/image.js');   // 只为取文件池上限（图片/备份走另一个池，V148）

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    ranAt: '',
    running: false,
    // 对账结果
    checked: 0, okCount: 0, mismatchCount: 0,
    sumCached: 0, sumDerived: 0, sumDiff: 0,
    items: [],            // 不一致明细（渲染用）
    repairing: false,     // 防双击
    // 存储状况
    usageKB: 0, limitKB: 10240, usagePercent: 0, nearFull: false,
    usageMB: '0.0', limitMB: '10.0', fileLimitMB: 200,   // 人类可读 + 另一个池的上限（V148）
    corruption: null,     // 最近一次数据损坏留痕（如有）
    pendingBackup: null   // 待转发的清空备份（两段式流程第二段）
  },

  onLoad() { this.runCheck(); },

  onShow() { themePage.apply(this);},

  runCheck() {
    this.setData({ running: true });
    try {
      const r = store.reconcileTotalValue();          // 全部手作空间一起查
      const items = (r.mismatches || []).map(x => ({
        id: x.materialId,
        name: x.name || '未命名物料',
        cached: util.money(x.cached),
        derived: util.money(x.derived),
        diff: util.money(x.diff),
        diffText: (x.diff > 0 ? '+' : '') + util.money(x.diff)
      }));
      this.setData({
        ranAt: util.fmtDate(new Date()),
        checked: r.checked, okCount: r.okCount, mismatchCount: r.mismatchCount,
        sumCached: util.money(r.sumCached), sumDerived: util.money(r.sumDerived),
        sumDiff: util.money(r.sumDiff),
        items
      });
    } catch (e) {
      util.toast(e && e.msg ? e.msg : '体检失败，请重试');
    }
    this.setData({ running: false });
    this.loadStorage();
  },

  loadStorage() {
    try {
      const u = store.usage();
      const percent = Math.min(100, Math.round(u.currentSize / (u.limitSize || 10240) * 100));
      this.setData({
        usageKB: u.currentSize, limitKB: u.limitSize, usagePercent: percent,
        usageMB: (u.currentSize / 1024).toFixed(1), limitMB: (u.limitSize / 1024).toFixed(1),
        fileLimitMB: Math.round(image.USER_FILE_LIMIT / 1024 / 1024),
        nearFull: store.isNearFull(),
        corruption: store.lastCorruptionInfo()
      });
    } catch (e) { /* 存储信息拿不到就不显示，不影响对账结果 */ }
  },

  // 一键修复：按流水重算漂移的库存总值
  doRepair() {
    if (this.data.repairing) return;                 // 防双击（避免重复触发）
    const n = this.data.mismatchCount;
    util.confirm('一键修复', '将把 ' + n + ' 个物料的库存总值按流水重算回正确值。修复后可在下方复检。', '修复').then(ok => {
      if (!ok) return;
      this.setData({ repairing: true });
      try {
        const res = store.repairTotalValue();
        if (res.repairedCount > 0) {
          util.toast('已修复 ' + res.repairedCount + ' 处', 'success');
        } else {
          util.toast('没有需要修复的地方');
        }
      } catch (e) {
        util.toast(e && e.msg ? e.msg : '修复失败');
      }
      this.setData({ repairing: false });
      this.runCheck();                                // 修完立刻复检
    });
  },

  goBackup() {
    util.navTo({ url: '/pages/settings/export' });
  },

  // 恢复出厂预设（不动业务数据）：预设大类/单位/平台/默认手作空间被误删后一键找回
  async restorePresets() {
    const ok = await util.confirm('恢复出厂预设', '会把被删掉的默认手作空间、物料分类、单位、平台等预设补回来。你自己的数据和自定义内容都不会动。', '恢复');
    if (!ok) return;
    try {
      const r = store.restoreFactoryPresets();
      util.toast(r.restored.length ? '已恢复：' + r.restored.join('、') : '预设都在，无需恢复', 'success');
    } catch (e) {
      util.toast(e && e.msg ? e.msg : '恢复失败');
    }
  },

  // 清空本地数据（恢复出厂）第一段：确认 → 生成完整备份 → 展示「转发」按钮。
  // 与关于页同一套流程（utils/clear-flow.js），护栏完全一致。
  // ⚠️ 转发不能在这里做：微信要求 shareFileMessage 必须由 TAP 手势直接触发（见 utils/share.js）。
  async doClear() {
    try {
      const r = await require('../../utils/clear-flow.js').prepareClear();
      if (!r.ok) return;
      this.setData({
        pendingBackup: {
          path: r.path,
          name: r.name,
          sizeText: ((r.sizeBytes || 0) / 1024 / 1024).toFixed(2) + ' MB',
          imagesCount: r.imagesCount || 0
        }
      });
      // 【不要用 toast】：真机上 toast 紧跟 hideLoading 会被吞。用弹窗讲清下一步，并滚到底部。
      wx.showModal({
        title: '备份已生成',
        content: '请点下面「转发备份到微信」，把备份发到「文件传输助手」保存。转发成功才会清空数据。',
        showCancel: false, confirmText: '知道了'
      });
      wx.pageScrollTo({ scrollTop: 100000, duration: 200 });
    } catch (e) {
      util.toast((e && (e.msg || e.message)) || '清空失败，数据未变动');
    }
  },

  // 第二段：⚠️ 必须在本 tap 处理器里同步调用分享（首行）——微信硬约束
  onShareBackup() {
    const pb = this.data.pendingBackup;
    if (!pb) { util.toast('请先点「清空本地数据」生成备份'); return Promise.resolve({ ok: false }); }
    return require('../../utils/clear-flow.js').sharePendingAndCommit(pb).then((r) => {
      if (!r.ok) return;
      this.setData({ pendingBackup: null });
      util.toast('备份已发出，本地数据已清空并恢复出厂', 'success');
      this.runCheck();
    });
  },

  cancelPending() {
    this.setData({ pendingBackup: null });
    util.toast('已取消，数据未变动');
  }

  // ⚠️ 开发期工具「填充演示数据」已于 2026-09-14（V50）**移除**（上线前检查阻断项）。
  //    原因：该按钮原先对用户 100% 可达（我的 → 数据体检是常驻菜单），一点就追加约 200 条
  //    演示数据（张女士/李先生…），会污染真实账目；按钮上的"开发"字样审核也可见。
  //    生成器已移到开发区 tools/demo.js（不随代码包发布）。需要预览效果时，在开发者工具
  //    控制台手动执行：require('tools/demo.js').fillDemoData()
  //    防复发：tests/guard-demo-entry.test.js（扫生产源码，禁止 bindtap="fillDemo" 与 demo 引用）
});
