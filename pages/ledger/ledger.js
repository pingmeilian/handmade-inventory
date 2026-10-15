// pages/ledger/ledger.js —— 累计总账（总计消费 / 总计收入）· 2026-10-10 V131 建页 / V132 重排
//
// 用户需求：「从最开始直到现在，所有的物料损耗、机器等等一系列的消费都算上。
//            收入呢，就是我收入我囊中的钱卖出去的等等」
// 用户拍板：① 消费 **A（累计投入/现金）与 B（累计已耗/成本）都要**；
//           ② 要有「其它支出」入口；③ 排单**只算已交付那一截**；④ 放「我的」页，主数字用 A。
//
// V132 用户追加：「太乱、说明文字太多；**A、B 要并排**（每一行要对照着看）；尽量不要有换行」
//   ⇒ 本页改动：① 删掉全部说明文字（`hint` 字段一并去掉）；
//               ② **B 侧补两条占位行**，让 A/B 行数相等（见下方注释 —— 这是"能对照"的前提）；
//               ③ 行对齐的两个前提是「行数相同 + 行高相同」，行高由 wxss 统一控制。
//
// 口径的唯一实现处是 utils/stat.js 的 cumulativeTotals() —— 本页只负责展示，
// **一行计算都不做**（否则页面和聚合会各算一套，迟早对不上）。
//
// V136 用户拍板：「我要总账，**只显示当前空间的总账**，不同的空间用不同的总账」
//   ⇒ ① `cumulativeTotals` 必须带 `categoryId: 当前手作空间`。
//        ⚠️ 改前传的是 `{}`（= 所有空间混成一本），而「我的」页那张卡一直传的是当前空间
//        ⇒ **同一个功能两个入口本来是两本账**（多空间时数字必然不同）。本次统一到当前空间。
//     ② 标题旁标出空间名 —— 否则切了空间用户看不出"已经换了本账"。
//     ③ 「物料采购 / 用掉的物料」两行接到「物料出入库」页（用户选的**方案甲**，见 openRow）。
const util = require('../../utils/util.js');
const stat = require('../../utils/stat.js');
const store = require('../../utils/store.js');
const state = require('../../services/state.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); this.reload(); },

  data: {
    ready: false, from: '', to: '',
    spaceName: '',
    spendA: null, spendB: null, income: null,
    rowsIncome: [], rowsA: [], rowsB: []
  },

  reload() {
    // 当前手作空间 —— 总账「一个空间一本账」（用户 2026-10-10 拍板）
    const cur = state.getCurrentSpace();
    const cats = store.getBusinessCategories();
    // 取不到名字就留空串（页面据此整块不显示），别把 undefined 渲染到界面上
    const spaceName = ((cats || []).find(c => c.id === cur) || {}).name || '';
    const t = stat.cumulativeTotals({ categoryId: cur });
    const m = (n) => util.money(n);
    const wrap = (o, total) => Object.assign({}, o, { totalText: m(total) });

    this.setData({
      ready: true, from: t.from, to: t.to, spaceName,
      spendA: wrap(t.spendA, t.spendA.total),
      spendB: wrap(t.spendB, t.spendB.total),
      income: wrap(t.income, t.income.total),
      rowsIncome: [
        { key: 'sales', label: '售出', valueText: m(t.income.sales) },
        { key: 'cm', label: '排单 · 已交付部分', valueText: m(t.income.commission) }
      ],
      // A：一共掏了多少钱（机器算原值）
      // ⚠️ V136：第 1 行「物料采购」原来的注释是"要跨到物料库，那是一次 tab 切换 + 筛选"
      //    —— 物料库确实是 tabBar 页（带不了参数），但**物料出入库页不是**，
      //    而它是同一件事的更好落点（全量入库/出库 + 数量 + 结余 + 类型筛选）⇒ 改用 `hist:in`。
      rowsA: [
        { key: 'material', label: '物料采购', valueText: m(t.spendA.material), to: 'hist:in' },
        { key: 'consumable', label: '耗材', valueText: m(t.spendA.consumable), to: 'consumable' },
        { key: 'asset', label: '资产（机器）', valueText: m(t.spendA.asset), to: 'asset' },
        { key: 'tool', label: '工具', valueText: m(t.spendA.tool), to: 'tool' },
        { key: 'repair', label: '维修', valueText: m(t.spendA.repair), to: 'asset' },
        { key: 'other', label: '其它支出', valueText: m(t.spendA.other), to: 'other' }
      ],
      // B：到目前真正消耗掉多少（机器算折旧）
      // ⚠️ V132：A、B 并排后要**逐行对照**，这要求两边**行数相同**。
      //    「维修 / 其它支出」在 B 口径里没有对应项（B 只有 4 项），所以补两条**占位行**；
      //    否则 B 的「合计」会上移，两栏的合计就不在同一条横线上、根本没法对照。
      //    占位行显示「—」而不是 0.00 —— 写 0.00 会让人以为 B 侧真有这笔金额。
      rowsB: [
        { key: 'material', label: '用掉的物料', valueText: m(t.spendB.material), to: 'hist:out' },
        { key: 'amort', label: '耗材摊销', valueText: m(t.spendB.consumableAmort), to: 'consumable' },
        { key: 'depre', label: '资产折旧', valueText: m(t.spendB.depreciation), to: 'asset' },
        { key: 'toolExpense', label: '工具支出', valueText: m(t.spendB.toolExpense), to: 'tool' },
        { key: 'repairPh', label: '维修', valueText: '—', placeholder: true },
        { key: 'otherPh', label: '其它支出', valueText: '—', placeholder: true }
      ]
    });
  },

  // 每一行的下钻。`to` 有两种写法（只有一处分派，别在别处再判断一次）：
  //   · 无前缀（'consumable' / 'asset' / 'tool' / 'other'）= **损耗页分段**（历史写法）
  //   · `hist:in` / `hist:out` = **「物料出入库」页**，并带上总账的起止区间
  //
  // ⚠️ V136 用户选的**方案甲**：跳过去看的是**全部**入库 / 出库流水（含退料、盘盈、校准、冲销），
  //    而总账 A「物料采购」只认 `source==='manual'`、B 是扣除退料后的**净额**，
  //    且那边显示的是**数量**、这边是**金额** ⇒ 两边**本来就不完全对应**。
  //    所以跳转时带 `src=ledger`，由出入库页显示一句口径说明（这是方案甲的组成部分，不是装饰）。
  //
  // ⚠️ 没给 `to` 的行 = **不可点的纯数字**；B 侧两条占位行也没有 `to`（B 口径本无此项，点了无处可去）。
  openRow(e) {
    const to = e.currentTarget.dataset.to;
    if (!to) return;
    if (to.indexOf('hist:') === 0) {
      const type = to.slice(5);   // 'in' | 'out'
      util.navTo({
        url: '/pages/settings/history?type=' + type +
          '&start=' + this.data.from + '&end=' + this.data.to + '&src=ledger'
      });
      return;
    }
    util.navTo({ url: '/pages/loss/index?seg=' + to });
  }
});
