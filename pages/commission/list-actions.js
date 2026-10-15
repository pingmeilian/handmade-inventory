// pages/commission/list-actions.js —— 排单列表的左滑操作项配置
//
// 放在页面层而不是组件里：组件只认「操作项」这个抽象（文案/图标/主题色/是否确认），
// 完全不知道排单是什么。业务语义（交付/取消对已完成单没意义）由页面自己决定。
//
// 顺序有讲究：操作区贴在右侧，越靠"外侧"（越右）的越先被露出来 ——
// 所以破坏性的「删除」放在最右，并且它带二次确认（微信会话列表也是这个排法）。

// 图标沿用项目惯例：内联 base64 SVG（白色描边，正好压在彩色底上）
const ICONS = {
  deliver: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjkiLz48cGF0aCBkPSJNOCAxMi40bDIuOCAyLjhMMTYgOS42Ii8+PC9zdmc+',
  cancel: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjkiLz48cGF0aCBkPSJNNi4yIDYuMmwxMS42IDExLjYiLz48L3N2Zz4=',
  edit: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAyMGg5Ii8+PHBhdGggZD0iTTE2LjUgMy41YTIuMTIgMi4xMiAwIDAgMSAzIDNMNyAxOWwtNCAxIDEtNCAxMi41LTEyLjV6Ii8+PC9zdmc+',
  del: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0zIDZoMTgiLz48cGF0aCBkPSJNOCA2VjRoOHYyIi8+PHBhdGggZD0iTTE4LjUgNmwtMSAxNGgtMTFsLTEtMTQiLz48cGF0aCBkPSJNMTAgMTF2Nk0xNCAxMXY2Ii8+PC9zdmc+'
};

// 进行中：交付 / 取消 / 编辑 / 删除
const ACTIVE = [
  {
    key: 'deliver', text: '交付', theme: 'primary', iconSrc: ICONS.deliver
    // V149：不再叫「快速交付」—— 它现在会开一个交付弹窗（先选「货从哪来」），
    //   点名里带「快速」就是在骗人。弹窗本身就是确认，所以不另加二次确认。
  },
  {
    key: 'cancel', text: '取消', theme: 'warning', iconSrc: ICONS.cancel,
    // 取消是状态变更（与详情页同口径：已交付部分保留记录），确认一下更稳
    confirm: { title: '取消排单', content: '确认取消该排单？已交付部分保留记录', confirmText: '取消排单' }
  },
  { key: 'edit', text: '编辑', theme: 'default', iconSrc: ICONS.edit },
  {
    key: 'del', text: '删除', theme: 'danger', iconSrc: ICONS.del,
    // 数据安全：删除只删排单记录，**不回补已出库的物料**（那些流水已经发生），必须讲清楚
    confirm: { title: '删除排单', content: '删除后不可恢复；已交付部分不回补物料，流水保留', confirmText: '删除' }
  }
];

// 已完成 / 已取消：交付与取消都失去意义，只留编辑与删除
const ENDED = [
  ACTIVE[2],
  ACTIVE[3]
];

module.exports = { ACTIVE, ENDED, ICONS };
