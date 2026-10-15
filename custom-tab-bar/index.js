// custom-tab-bar/index.js —— 自定义底部导航栏
// 5 段：看板 / 物料库 / 加号(中间) / 作品集 / 我的
// 中间圆形加号点开「快速记录」面板（5 入口一排），其余 4 段 switchTab 跳转
//
// V97：颜色跟着「当前手作空间」的主题走。
// ⚠️ tabBar 是**独立组件树**，不在 page 的 DOM 里 ⇒ 拿不到 page-meta 上的 CSS 变量，
//    所以这里读一次主题、把色值算好放在 data.th 上，由 wxml 用内联 style 传进去。
//
// V98（真机修）：光靠组件自己刷**不够** ——
//   用户实测「换成姜饼小熊仁，页面换了、底部整条还是玫瑰的粉」。
//   原因：`data.th` 的初值在**模块加载那一刻**就算好了（那时还是旧主题），
//   而组件的 `pageLifetimes.show` 在真机上并不可靠，于是它一直停在那个快照上。
//   ⇒ 现在由**页面**在 onShow 里推（页面 → getTabBar() 这条路是通的，
//     各 tab 页本来就用它设选中态）：见 utils/theme-page.js 的 applyTabBar()。
//     组件这边把 applyTheme(tokens) 开成"可以外部喂色"。
const themes = require('../utils/themes.js');
const store = require('../utils/store.js');

// hex + alpha -> rgba（底色需要半透明磨砂，不能直接用 hex）
function rgba(hex, a) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 3 && h.length !== 6) return 'transparent';
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
}

// 算出本组件要用的那一组色。
// tokens（可选）：由页面推过来的当前主题 token；不给就自己读（取不到一律回默认主题）。
function pick(tokens) {
  let t = tokens;
  if (!t) {
    try { t = themes.get(store.currentTheme()); } catch (e) { t = themes.get(themes.DEFAULT); }
  }
  // 角色分工（V115）：FAB 的底色/加号色 —— 姜饼粉帽的设计稿是**摩卡棕圆 + 樱花粉「+」**；
  // 没声明 roles 的主题默认仍是 primary / primary-on（其它主题外观零影响）。
  // ⚠️ 兜底（2026-10-05）：**取不到 roles 也必须能画出来** ——
  //   工具/真机上若出现『旧 themes.js + 新组件』的混搭编译态，`themes.roles` 会不存在，
  //   取色一抛错 ⇒ 组件起不来 ⇒ **tab 页整页白屏**（比『颜色退一步』严重得多）。
  //   所以这里双层防：typeof 检查 + try/catch，最终一律退回 primary / primary-on。
  let rl = { fab: t.primary, fabOn: t['primary-on'] };
  try {
    if (typeof themes.roles === 'function') rl = themes.roles(store.currentTheme());
  } catch (e) { /* 保持上面的兜底值 */ }
  return {
    fab: rl.fab, fabOn: rl.fabOn,
    barBg: rgba(t.surface, 0.82),
    barLine: rgba(t.divider, 0.55),
    barShadow: rgba(t['text-1'], 0.04),
    plusShadow: rgba(t.primary, 0.32),
    unsel: t['text-2'],          // 未选中：次要文字色
    sel: t['text-1'],            // 选中：正文色（原设计是"深棕"，不过度强调）
    primary: t.primary,
    on: t['primary-on'],
    mask: t.mask,
    sheetBg: t.surface,
    sheetInput: t['surface-2'],
    sheetText: t['text-1']
  };
}

Component({
  data: {
    selected: 0,
    panelShow: false,
    // 初值在模块加载时就算一次（给首帧一个颜色），真正的色由页面 onShow 推过来
    th: pick(),
    list: [
      { page: '/pages/dashboard/dashboard', text: '看板', icon: '📊', idx: 0 },
      { page: '/pages/materials/list', text: '物料库', icon: '📦', idx: 1 },
      { action: true, text: '快速记录', idx: 2 },
      { page: '/pages/products/list', text: '作品集', icon: '🎨', idx: 3 },
      { page: '/pages/mine/mine', text: '我的', icon: '👤', idx: 4 }
    ],
    quickItems: [
      { url: '/pages/materials/edit', label: '+ 物料' },
      { url: '/pages/products/edit', label: '+ 成品' },
      { url: '/pages/inspiration/edit', label: '记灵感' },
      { url: '/pages/commission/edit', label: '+ 排单' },
      { url: '/pages/loss/edit', label: '+ 损耗' }
    ]
  },

  // 兜底：页面显示时也自算一次（主路径是页面主动推，见 applyTheme）
  pageLifetimes: {
    show() { this.applyTheme(); }
  },

  attached() { this.applyTheme(); },

  methods: {
    // tokens 可选：页面推过来的当前主题（推荐路径）。不给就自己读一次。
    applyTheme(tokens) {
      let tk = tokens;
      if (!tk) {
        try { tk = themes.get(store.currentTheme()); } catch (e) { tk = themes.get(themes.DEFAULT); }
      }
      // 同一套主题不重复 setData（每个 tab 页 onShow 都会推一次，没必要白刷）
      // themes.get() 每次返回的是**同一个对象引用**，所以按引用比就够。
      if (this._tk === tk) return;
      this._tk = tk;
      try { this.setData({ th: pick(tk) }); } catch (e) { /* 换色失败不能影响 tabBar 本身 */ }
    },
    onTap(e) {
      const idx = e.currentTarget.dataset.idx;
      const item = this.data.list[idx];
      if (item.action) {
        this.setData({ panelShow: !this.data.panelShow });
        return;
      }
      this.setData({ panelShow: false });
      if (idx === this.data.selected) return;
      wx.switchTab({ url: item.page });
    },
    closePanel() { this.setData({ panelShow: false }); },
    noop() {},
    quickTap(e) {
      const url = e.currentTarget.dataset.url;
      this.setData({ panelShow: false });
      wx.navigateTo({ url });
    }
  }
});
