// pages/want/list.js —— 想做清单（待填坑 / 已填坑）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');
const privacy = require('../../utils/privacy.js');
const draft = require('../../services/draft.js');   // V138：弹窗 → 详细编辑页 的一次性草稿

// 缝纫针线占位图标（列表无图时兜底展示）
const SEW_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNDOEE4OEYiIHN0cm9rZS13aWR0aD0iMS42IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNi41IDMuNWw0IDQtOCA4LTQtNCA4LTh6Ii8+PHBhdGggZD0iTTguNSAxNS41TDQgMjAiLz48cGF0aCBkPSJNMTIgNmwyIDIiLz48L3N2Zz4=';

function sourceTag(link) {
  if (!link) return '外部';
  const s = (link || '').toLowerCase();
  if (s.indexOf('douyin') >= 0 || s.indexOf('tiktok') >= 0) return '抖音';
  if (s.indexOf('bilibili') >= 0 || s.indexOf('b23') >= 0) return 'B站';
  if (s.indexOf('xiaohongshu') >= 0 || s.indexOf('xhslink') >= 0) return '小红书';
  return '外部';
}

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    spaceName: '', tab: 'pending', list: [],
    placeholderIcon: SEW_PLACEHOLDER,

    // 新增弹窗
    showAdd: false, addTitle: '', addLink: '', addPhotos: []
  },

  onShow() {
    themePage.apply(this);
    this.reload();
    // V139：从「详细编辑」过去、在编辑页**保存成功**后回来 —— 把「新增想做」弹窗关掉并清空。
    //   ⚠️ 改前弹窗会原样留在这儿，用户再点一次「保存」⇒ **又存一条**（用户报的 bug：
    //      「保存后返回还是这个新增想做界面　再点一次保存就会重新保存一次」）。
    //   ⚠️ 只在"确实保存了"时才关：编辑页中途返回（没保存）⇒ 弹窗原样留着，内容不丢。
    // V140：正常路径下这里只是**保底** —— 编辑页在落库那一刻就隔着页面栈把弹窗收掉了
    //   （见 `draft.closeAddOnStack`）。因为等返回之后再关太晚：页面已经画出来了 ⇒ 弹窗会**闪一下**
    //   （用户 2026-10-11 跟进报的：「点完保存之后会返回，但是那个弹窗还能看见，会闪一下」）。
    if (draft.takeSaved('want')) this.closeAdd();
  },

  reload() {
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    const spaceName = (cats.find(c => c.id === cur) || {}).name || '';
    let arr = store.getWants().filter(w => (w.categoryId || 'bc_default') === cur);
    if (this.data.tab === 'pending') arr = arr.filter(w => w.status !== 'done');
    else arr = arr.filter(w => w.status === 'done');
    arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const list = arr.map(w => {
      const src = sourceTag(w.link);
      const done = w.status === 'done';
      return {
        id: w.id,
        title: w.title || '未命名',
        cover: (w.photos && w.photos[0]) || '',
        catName: src,
        pitText: done ? '已填坑' : '待填坑',
        subText: src + ' · ' + (done ? '已填坑' : '待填坑'),
        done: done
      };
    });
    this.setData({ spaceName, list });
  },

  // 切换 tab：刷新列表（含图片重新读取）
  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t });
    this.reload();
  },

  goDetail(e) { util.navTo({ url: '/pages/want/detail?id=' + e.currentTarget.dataset.id }); },
  goEdit() { util.navTo({ url: '/pages/want/edit' }); },

  /* ========== 新增弹窗（含图片上传） ========== */
  openAdd() { this.setData({ showAdd: true, addTitle: '', addLink: '', addPhotos: [] }); },
  // V140：`closeAdd` 从"只关"升级成"彻底收起"（关 + 清字段）——
  //   它现在会被**编辑页隔着页面栈**调用（保存成功那一刻就收掉，见 draft.closeAddOnStack），
  //   只关一半会把旧标题 / 旧链接 / 旧图留到下一次打开弹窗时。
  closeAdd() { this.setData({ showAdd: false, addTitle: '', addLink: '', addPhotos: [] }); },
  noop() {},
  onAddTitle(e) { this.setData({ addTitle: e.detail.value }); },
  onAddLink(e) { this.setData({ addLink: e.detail.value }); },

  // V138：弹窗里的「详细编辑 ›」——**把已经填好的内容一起带过去**。
  //   ⚠️ 改前这里直接 `goEdit`（裸跳到编辑页）⇒ 标题 / 链接 / 图片全丢，只能重填。
  //   走一次性草稿（services/draft.js）+ `?from=add` 标记，编辑页只在带标记时取用。
  goAddDetail() {
    draft.set('want', {
      title: this.data.addTitle || '',
      link: this.data.addLink || '',
      photos: (this.data.addPhotos || []).slice()
    });
    util.navTo({ url: '/pages/want/edit?from=add' });
  },

  chooseAddPhoto() {
    const remain = 6 - (this.data.addPhotos || []).length;
    if (remain <= 0) { util.toast('最多 6 张图片'); return; }
    privacy.authorize(() => {
      wx.chooseMedia({
        count: remain, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: async (res) => {
          const paths = [];
          for (const t of (res.tempFiles || [])) {
            try { paths.push(await store.savePhoto(t.tempFilePath)); }
            catch (e) { util.toast('图片保存失败'); }
          }
          if (paths.length) this.setData({ addPhotos: this.data.addPhotos.concat(paths) });
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

  removeAddPhoto(e) {
    const idx = e.currentTarget.dataset.idx;
    const addPhotos = this.data.addPhotos.slice();
    addPhotos.splice(idx, 1);
    this.setData({ addPhotos });
  },

  saveAdd() {
    const title = (this.data.addTitle || '').trim();
    if (!title) { util.toast('请填写标题'); return; }
    const cur = state.getCurrentSpace();
    store.saveWant({
      title: title,
      link: (this.data.addLink || '').trim(),
      photos: this.data.addPhotos,
      categoryId: cur,
      status: 'pending',
      createdAt: util.today(),
      desc: ''
    });
    util.toast('已添加', 'success');
    this.setData({ showAdd: false, addTitle: '', addLink: '', addPhotos: [] });
    this.reload();
  }
});
