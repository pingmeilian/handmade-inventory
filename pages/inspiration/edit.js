// pages/inspiration/edit.js —— 灵感新增 / 编辑（含多图、面料辅料、转成品）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');
const privacy = require('../../utils/privacy.js');
const draft = require('../../services/draft.js');   // V138：承接列表页「新增」弹窗带来的内容

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    id: '', title: '', fabricInfo: '', desc: '', photos: [],
    createdAt: '', isEdit: false
  },

  onLoad(options) {
    if (options.id) {
      const it = store.getInspirations().find(x => x.id === options.id);
      if (it) this.setData({
        id: it.id, title: it.title || '', fabricInfo: it.fabricInfo || '',
        desc: it.desc || '', photos: it.photos || [],
        createdAt: it.createdAt || '', isEdit: true
      });
    } else {
      this.setData({ createdAt: util.today() });
      // V138：从列表页「新增」弹窗的「详细编辑 ›」进来 —— 把弹窗里已填的标题 / 图片带进来。
      //   ⚠️ 只在 `?from=add` 时才 take（take 会清空草稿），
      //      否则"上一次没被取走的草稿"会串到下一次普通新增里（很难查的脏数据）。
      if (options.from === 'add') {
        // V139：记下"我是从列表页那个「新增」弹窗过来的" ⇒ 一旦内容真的落库（保存 / 转成品），
        //   就回一个信号让列表页把弹窗关掉（否则返回时弹窗还在，再点保存会重复存一条）。
        this._fromAdd = true;
        const d = draft.take('inspiration');
        if (d) this.setData({ title: d.title || '', photos: (d.photos || []).slice() });
      }
    }
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onFabric(e) { this.setData({ fabricInfo: e.detail.value }); },
  onDesc(e) { this.setData({ desc: e.detail.value }); },

  // 多图上传（草图 / 面料实拍，仅在详情页查看）
  choosePhoto() {
    const remain = 9 - (this.data.photos || []).length;
    if (remain <= 0) { util.toast('最多 9 张图片'); return; }
    privacy.authorize(() => {
      wx.chooseMedia({
        count: remain, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: async (res) => {
          const paths = [];
          for (const t of (res.tempFiles || [])) {
            try { paths.push(await store.savePhoto(t.tempFilePath)); } catch (e) { util.toast((e && (e.msg || e.message)) || '图片保存失败'); }
          }
          if (paths.length) this.setData({ photos: this.data.photos.concat(paths) });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0 || msg.indexOf('deny') >= 0) util.toast('已取消选择');
          else if (msg.indexOf('auth') >= 0 || msg.indexOf('Privacy') >= 0) {
            util.toast('请先同意隐私政策，并在公众平台配置《隐私保护指引》');
            setTimeout(() => { try { wx.openSetting && wx.openSetting(); } catch (e) {} }, 800);
          } else util.toast('无法打开：' + (msg.split(':')[1] || '请重试'));
        }
      });
    });
  },
  removePhoto(e) {
    const idx = e.currentTarget.dataset.idx;
    const photos = this.data.photos.slice();
    photos.splice(idx, 1);
    this.setData({ photos });
  },
  previewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    wx.previewImage({ urls: this.data.photos, current: url });
  },

  // 确保记录已落库（新建时先保存拿 id）
  _ensureSaved() {
    const title = (this.data.title || '').trim();
    if (!title) { util.toast('请填写标题'); return null; }
    const cur = state.getCurrentSpace();
    let id = this.data.id;
    if (!id) {
      const rec = store.saveInspiration({
        title, fabricInfo: this.data.fabricInfo, desc: this.data.desc,
        photos: this.data.photos, categoryId: cur,
        status: 'pending', createdAt: this.data.createdAt || util.today()
      });
      id = rec.id;
      this.setData({ id, isEdit: true });
    } else {
      const it = store.getInspirations().find(x => x.id === id) || {};
      store.saveInspiration({
        id, title, fabricInfo: this.data.fabricInfo, desc: this.data.desc,
        photos: this.data.photos, categoryId: it.categoryId || cur,
        status: it.status || 'pending', createdAt: it.createdAt || this.data.createdAt || util.today()
      });
    }
    // V139：内容真的落库了 ⇒ 给列表页留一个回程信号（让它把「新增」弹窗关掉）。
    //   放在这里而不是各个按钮里：`_ensureSaved` 是**所有**落库路径的唯一出口
    //   （「保存」和「转为成品」都走它）⇒ 以后新增调用方也不会漏。
    // V140：光留信号还不够 —— 列表页要等**返回之后 onShow** 才去关，那时它已经画出来了，
    //   用户会看到弹窗**闪一下**。这里顺手在"还没返回、列表页还藏着"的时候就把那一页的弹窗收掉。
    if (this._fromAdd) {
      draft.markSaved('inspiration');
      draft.closeAddOnStack();
    }
    return id;
  },

  save() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const id = this._ensureSaved();
    if (!id) return;
    util.toast('已保存', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  },

  // 转为成品（V137）：先把本页内容存好，再跳到成品编辑页填物料 —— 不在这里建成品、不问样品/待售。
  openConvert() {
    const id = this._ensureSaved();
    if (!id) return;
    util.navTo({ url: '/pages/products/edit?from=inspiration&sid=' + id });
  },

  goBack() { wx.navigateBack(); }
});
