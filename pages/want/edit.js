// pages/want/edit.js —— 想做新增 / 编辑（外部视频链接 + 备注 + 附件图）
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
    id: '', title: '', link: '', desc: '', photos: [],
    createdAt: '', isEdit: false
  },

  onLoad(options) {
    if (options.id) {
      const it = store.getWants().find(x => x.id === options.id);
      if (it) this.setData({
        id: it.id, title: it.title || '', link: it.link || '', desc: it.desc || '',
        photos: it.photos || [], createdAt: it.createdAt || '', isEdit: true
      });
    } else {
      this.setData({ createdAt: util.today() });
      // V138：从列表页「新增」弹窗的「详细编辑 ›」进来 —— 把已填的标题 / 链接 / 图片带进来。
      //   ⚠️ 只在 `?from=add` 时才 take（take 会清空草稿），避免旧草稿串到普通新增里。
      if (options.from === 'add') {
        // V139：记下"我是从列表页那个「新增想做」弹窗过来的" ⇒ 一旦内容真的落库（保存 / 转成品），
        //   就回一个信号让列表页把弹窗关掉（否则返回时弹窗还在，再点保存会重复存一条）。
        this._fromAdd = true;
        const d = draft.take('want');
        if (d) this.setData({
          title: d.title || '',
          link: d.link || '',
          photos: (d.photos || []).slice()
        });
      }
    }
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onLink(e) { this.setData({ link: e.detail.value }); },
  onDesc(e) { this.setData({ desc: e.detail.value }); },

  // 附件图（仅详情页查看，列表不渲染预览）
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

  // 保存前顺手把链接归一化：用户粘的常是整段分享文案（"7.43 复制打开抖音…https://v.douyin.com/x/"），
  // 直接把原文存进去，详情页展示与复制都会带着一堆中文。能提取出链接就存干净的那条。
  // 提不出来**也照存**（"随手记"场景不该被拦住），只是提示一句 —— 详情页会把异常标出来。
  _cleanLink() {
    const raw = (this.data.link || '').trim();
    if (!raw) return { link: '', warned: false };
    const r = util.normalizeUrl(raw);
    if (r.ok) return { link: r.url, warned: false, extracted: r.extracted };
    return { link: raw, warned: true };
  },

  _ensureSaved() {
    const title = (this.data.title || '').trim();
    if (!title) { util.toast('请填写标题'); return null; }
    const cleaned = this._cleanLink();
    const cur = state.getCurrentSpace();
    let id = this.data.id;
    if (!id) {
      const rec = store.saveWant({
        title, link: cleaned.link, desc: this.data.desc,
        photos: this.data.photos, categoryId: cur,
        status: 'pending', createdAt: this.data.createdAt || util.today()
      });
      id = rec.id;
      this.setData({ id, isEdit: true });
    } else {
      const it = store.getWants().find(x => x.id === id) || {};
      store.saveWant({
        id, title, link: cleaned.link, desc: this.data.desc,
        photos: this.data.photos, categoryId: it.categoryId || cur,
        status: it.status || 'pending', createdAt: it.createdAt || this.data.createdAt || util.today()
      });
    }
    // 提示要"说清发生了什么"，且只在真发生事情时才打扰用户
    if (cleaned.warned) util.toast('链接可能不是完整网址，已原样保存');
    else if (cleaned.extracted) util.toast('已从文本中提取出链接');
    // V139：内容真的落库了 ⇒ 给列表页留一个回程信号（让它把「新增想做」弹窗关掉）。
    //   放在这里而不是各个按钮里：`_ensureSaved` 是**所有**落库路径的唯一出口
    //   （「保存」和「转为成品」都走它）⇒ 以后新增调用方也不会漏。
    // V140：光留信号还不够 —— 列表页要等**返回之后 onShow** 才去关，那时它已经画出来了，
    //   用户会看到弹窗**闪一下**（用户跟进报的：「点完保存之后会返回，但是那个弹窗还能看见，会闪一下」）。
    //   这里顺手在"还没返回、列表页还藏着"的时候就把那一页的弹窗收掉 ⇒ 返回时一上来就是没有弹窗的样子。
    if (this._fromAdd) {
      draft.markSaved('want');
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

  // 转为成品（V137 同「想做详情」）：先把本页内容存好（`_ensureSaved`），
  // 再带着记录跳到成品编辑页 —— **不在这里建成品**，也不问「样品 / 待售」。
  openConvert() {
    const id = this._ensureSaved();
    if (!id) return;
    util.navTo({ url: '/pages/products/edit?from=want&sid=' + id });
  },

  goBack() { wx.navigateBack(); }
});
