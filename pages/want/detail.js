// pages/want/detail.js —— 想做详情（视频链接、附件图、转成品）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

function sourceTag(link) {
  if (!link) return '';
  const s = (link || '').toLowerCase();
  if (s.indexOf('douyin') >= 0 || s.indexOf('tiktok') >= 0) return '抖音';
  if (s.indexOf('bilibili') >= 0 || s.indexOf('b23') >= 0) return 'B站';
  if (s.indexOf('xiaohongshu') >= 0 || s.indexOf('xhslink') >= 0) return '小红书';
  return '外部';
}

// 「前往原视频」的提示文案：按归一化失败的原因分别说清楚，别让用户猜
const LINK_TIP = {
  empty: '未填写视频链接',
  'no-url': '没识别出链接，请检查后重填',
  scheme: '只支持 http / https 链接',
  malformed: '链接格式不对，请检查后重填'
};

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: { id: '', item: null, done: false, sourceTag: '' },

  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const it = store.getWants().find(x => x.id === this.data.id);
    if (!it) { util.toast('数据不存在'); setTimeout(() => wx.navigateBack(), 500); return; }
    // 展示与复制都走归一化：用户可能粘的是整段分享文案，展示成干净链接更好读、更好长按复制
    const linkInfo = util.normalizeUrl(it.link);
    this.setData({
      item: {
        title: it.title || '未命名', link: it.link || '',
        linkShown: linkInfo.ok ? linkInfo.url : (it.link || ''),
        linkBad: !!it.link && !linkInfo.ok,      // 存进去的链接不可用 → 视图上标出来，别让用户猜
        desc: it.desc || '',
        photos: it.photos || [], createdAt: it.createdAt || ''
      },
      done: it.status === 'done',
      sourceTag: sourceTag(it.link)
    });
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    wx.previewImage({ urls: this.data.item.photos || [], current: url });
  },

  goEdit() { util.navTo({ url: '/pages/want/edit?id=' + this.data.id }); },

  // 前往原视频。
  // 为什么不是"跳转"：小程序里没有 window.open，也**无法打开任意外部网页** ——
  // `<web-view>` 只允许打开"自己在后台备案并配置的业务域名"，抖音/B站这类站外域名配不了，
  // 硬跳只会落到 web-view 的错误页（比现在更难懂）。所以走"校验 → 复制链接 → 明确指引"。
  // 关键：任何一条失败路径都必须给反馈 —— 真机反馈"点了没反应"就是这条没做到
  //       （旧实现没接 fail 回调，且 item 为 null 时会抛异常静默中断）。
  async goVideo() {
    const item = this.data.item || {};                    // 脏状态下也不许抛异常
    const r = util.normalizeUrl(item.link);
    if (!r.ok) { util.toast(LINK_TIP[r.reason] || '链接不可用'); return; }
    await util.copyText(r.url, {
      alert: true,        // 剪贴板成功后微信会弹自带的"内容已复制"，会盖掉 toast → 用弹窗保证被看见
      alertTitle: '链接已复制',
      alertContent: '小程序内无法直接打开站外视频，请到浏览器或对应 App 粘贴打开。'
        + (r.extracted ? '\n（已从你粘贴的文本中提取出链接）' : ''),
      failText: '复制失败，可长按上方链接手动复制'
    });
  },

  // 转为成品（V137 用户拍板改法）：
  //   ① **不再当场把成品建出来**（旧实现直接 saveProduct({bom:[]}) ⇒ 成品物料栏全空，
  //      用户还得回头补料）；改为**带着本记录跳成品编辑页**，由用户自己选物料并保存。
  //   ② **取消「样品 / 待售商品」二选一弹窗** —— 成品编辑页本来就有「商品 / 样品」开关，
  //      在这儿问一次、进去还能改，纯属多一步。
  //   ③ 本记录**什么时候**变「已填坑」：等成品**保存成功**才由编辑页回填（不是现在）。
  openConvert() {
    if (this.data.done) { util.toast('该想做已填坑'); return; }
    util.navTo({ url: '/pages/products/edit?from=want&sid=' + this.data.id });
  },

  async remove() {
    const ok = await util.confirm('删除', '确认删除这条想做记录？原始记录将被移除', '删除');
    if (!ok) return;
    store.removeWant(this.data.id);
    util.toast('已删除', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
