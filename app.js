// app.js
const store = require('./utils/store.js');
const state = require('./services/state.js');
const cloud = require('./services/cloud.js');
const cloudBackup = require('./services/cloud-backup.js');
const photoSync = require('./services/photo-sync.js');

App({
  globalData: {
    // 说明：手作空间已迁移到 services/state.js 统一管理（原 currentCategoryId 已移除）。
    // globalData 仅保留页面间传草稿等零散用途（tutDraft）。
    openid: ''
  },

  onLaunch() {
    // 初始化种子数据（手作空间 / 物料分类 / 品类 / 单位 / 平台 / 自定义属性 / 设置）
    store.ensureSeed();
    // 数据迁移：每次启动都执行（已初始化过的老用户也能拿到迁移收益，如属性预设回填）
    store.runMigrations();
    // 静默体检：只算不弹窗。结果存 globalData.checkup，账不平时首页顶部显示提示条
    // （不打扰——没问题就完全无感；有问题点横幅进「数据体检」页查看/修复）
    try {
      const r = store.reconcileTotalValue();
      this.globalData.checkup = { ranAt: Date.now(), mismatchCount: r.mismatchCount, checked: r.checked };
    } catch (e) {
      this.globalData.checkup = null;   // 体检失败不影响启动，也不打扰用户
    }
    // 存储写失败兜底：原先 set() 失败是静默的，用户以为存上了其实没存。
    // 现在写失败会回调到这里，明确告知用户并引导导出备份（services/storage.js 加固的一部分）。
    store.onWriteError((err) => {
      console.error('[storage] 写入失败', err);
      wx.showModal({
        title: '保存失败',
        content: '本机存储空间可能已满，刚才的改动没有保存成功。\n建议先导出备份，再清理一些图片后重试。',
        showCancel: false,
        confirmText: '知道了'
      });
    });
    // 全局手作空间恒为单个真实空间：若当前选中项已被删除/失效，回退到首个有效大类（绝不落入 'all' 汇总态）
    const cats = store.getBusinessCategories();
    const fallback = cats[0] ? cats[0].id : 'bc_default';
    state.init(fallback);
    // M1-01 微信授权登录：零成本方案，本地匿名标识代替 openid（如需真实 openid 可后续接入云函数）
    this.globalData.openid = store.getOpenid();
    // 合规-1：隐私授权同意入口。
    // 注意：不要在此处主动调 wx.requirePrivacyAuthorize（会在启动时弹窗打扰），
    // 改由下方 wx.onNeedPrivacyAuthorize 统一接管——当用户点击相册/相机等隐私接口时，
    // 微信会自动触发此回调，弹窗让用户「同意」后接口才放开。
    if (typeof wx.onNeedPrivacyAuthorize === 'function') {
      wx.onNeedPrivacyAuthorize((resolve) => {
        wx.showModal({
          title: '隐私授权',
          content: '使用拍照、相册功能需要您同意《隐私保护指引》。\n点击「同意并继续」即表示您已知晓并同意相关条款。',
          confirmText: '同意',
          cancelText: '查看详情',
          success: (res) => {
            if (res.confirm) {
              try { resolve({ event: 'agree' }); } catch (e) { /* 已同意，忽略 */ }
              wx.setStorageSync('bm_privacy_agreed', true);
            } else {
              // 用户想先看隐私说明：跳转隐私说明页（该页可查看微信官方指引并二次同意）
              wx.navigateTo({ url: '/pages/settings/privacy' });
            }
          }
        });
      });
    }

    // ── 云开发（P1）：必须在**所有本地初始化之后**，且失败绝不影响本地功能 ──
    // 顺序理由：本地能力是主体，云是增强。先让 App 完整可用，再去谈云。
    // cloud.init() 内部已 try/catch；未配置环境或不支持时直接返回 false（纯本地模式）。
    if (cloud.init()) {
      // 拿真实微信身份（异步、不阻塞启动）。
      // 成功 → 身份升级为跨设备唯一的 openid；失败 → 自动保持本机身份，功能不受影响。
      store.ensureRealOpenid().catch(function () { /* 内部已兜底，这里只防未捕获拒绝 */ });
      // ── 云备份（P3）：接上「数据变了就同步一份到云端」 ──
      // 只在云可用时接线：云不可用则**完全不挂钩子**，本地路径零额外开销。
      // 上传由同步队列去抖合并（连续改几笔账只传一次），失败自动退避重试；
      // 云端保留 2 份，任何一步失败都不会把好备份覆盖掉。
      cloudBackup.init();
      // ── 图片上云（P4）：把本地图片文件也传一份到云存储 ──
      // 与数据同步**各自独立**：图片走攒批（攒够 5 张或空闲 30 秒），数据走改动即传。
      // init 里会顺带扫一遍本地存量图 —— 用户先用本地版、后来才开通云，那些图也要传上去，
      // 否则"换机找回图片"只能找回一半。上传**不阻塞任何本地操作**。
      photoSync.init();
    }
  },

  // 切换手作空间（兼容入口；页面已直接使用 services/state.js）
  setCurrentCategory(id) {
    state.setCurrentSpace(id);
  }
});
