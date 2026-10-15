// pages/settings/categories.js —— 手作空间管理（M1-17，级联删除）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const themes = require('../../utils/themes.js');
const themePage = require('../../utils/theme-page.js');
const state = require('../../services/state.js');

Page({
  data: {
    list: [],
    themes: [],         // 选择弹层用的主题列表（key / 中文名 / 三个色）
    themeFor: '',       // 正在给哪个大类选主题（空 = 弹层关着）
    themeName: '',      // 那个大类的名字（弹层标题用）
    pickedTheme: '',    // 弹层里当前选中的主题（高亮）
    themeStyle: ''      // page-meta 用：当前主题的 CSS 变量
  },

  onShow() {
    themePage.apply(this);   // 按当前大类上色（V97）
    this.reload();
  },

  reload() {
    const mats = store.getMaterials(), prods = store.getProducts();
    const list = store.getBusinessCategories().map(c => {
      const key = store.getBusinessCategoryTheme(c.id);     // 缺字段 = 默认主题（无需数据迁移）
      const t = themes.get(key);
      return {
        id: c.id, name: c.name,
        count: mats.filter(m => m.categoryId === c.id).length + prods.filter(p => p.categoryId === c.id).length,
        theme: key, themeName: themes.nameOf(key),
        primary: t.primary, soft: t['primary-soft'], accent: t.accent
      };
    });
    this.setData({ list: list, themes: themes.list() });
  },

  // ---- 主题（V97） ----
  pickTheme(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.list.find(x => x.id === id);
    this.setData({
      themeFor: id, themeName: it ? it.name : '',
      pickedTheme: store.getBusinessCategoryTheme(id)
    });
  },

  // 点一下立刻生效（改的是外观、无破坏性）—— 可以直接来回点着比
  chooseTheme(e) {
    const key = e.currentTarget.dataset.key;
    const id = this.data.themeFor;
    if (!id) return;
    this.setData({ pickedTheme: key });
    if (store.setBusinessCategoryTheme(id, key)) {
      // ⚠️ 只改主题、不切空间 ⇒ 走 notifyTheme（"外观变了"的那条广播）。
      //    早先这里**不能**用 setCurrentSpace 的广播：它排除栈顶、而发起页正是本页，
      //    结果本页自己不换色、看着像没生效。2026-10-04 两条广播口径已统一为"都含栈顶"，
      //    但语义上仍各走各的：**改主题 → notifyTheme**，**切空间 → setCurrentSpace**。
      state.notifyTheme();
    }
    // 本页显式再算一次，**不依赖广播**（广播走页面栈，单页/栈场景都不该决定本页是否换色）。
    // 这条是页面级测试 ⑧ 抓出来的：起初只调 notifyTheme，本页的 themeStyle 纹丝不动。
    themePage.apply(this);
    this.reload();
  },

  closeTheme() { this.setData({ themeFor: '' }); },
  noop() {},


  add() {
    wx.showModal({
      title: '新建手作空间', editable: true, placeholderText: '如：钩针专区',
      confirmColor: themePage.modalColor(),
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) { util.toast('名称不能为空'); return; }
        store.addBusinessCategory(name); this.reload();
      }
    });
  },

  edit(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.list.find(x => x.id === id);
    if (!it) return;
    wx.showModal({
      title: '重命名手作空间', editable: true, content: it.name,
      confirmColor: themePage.modalColor(),
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) { util.toast('名称不能为空'); return; }
        store.updateBusinessCategory(id, name); this.reload();
      }
    });
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.list.find(x => x.id === id);
    if (!it) return;
    if (it.count > 0) {
      const ok = await util.confirm('删除手作空间', '将同时删除该空间下的 ' + it.count + ' 条物料/成品数据，且不可恢复', '确认删除');
      if (!ok) return;
    } else {
      const ok = await util.confirm('删除手作空间', '确认删除「' + it.name + '」？', '确认删除');
      if (!ok) return;
    }
    try {
      store.removeBusinessCategory(id);  // 内部已处理：若删的是当前空间，经 state 层回退并广播刷新
      util.toast('已删除', 'success');
    } catch (err) {
      // 删除是破坏性操作：失败必须让用户知道"没删成"，而不是静默无反应
      util.toast(err && err.msg ? err.msg : '删除失败，请重试');
    }
    this.reload();
  }
});
