# swipe-cell · 左滑露出操作区（通用组件）

参照微信会话列表的左滑交互：**跟手位移 → 超过阈值吸附展开 → 点空白/滑别的卡片/列表滚动自动收起 →
同一时间只允许一张展开 → 带二次确认的操作先确认再执行**。

组件**不认识任何业务**：操作项全部由 `actions` 配置，点了只抛一个 `action` 事件，怎么处理由你决定。
所以它可以直接搬到任何列表里（灵感、想做、物料、作品集……）。

```
components/swipe-cell/
├── swipe-cell.js     # 组件本体（手势调度 / 状态 / 事件）
├── swipe-cell.wxml   # 结构：操作区（贴在 reveal 侧）+ 内容（跟手位移）
├── swipe-cell.wxss   # 样式（配色/圆角走宿主 token，且都自带兜底值）
├── gesture.js        # 手势数学（纯函数，可单测）
├── registry.js       # 「同时只开一张 / 一键全部收起」的唯一收口（页面也要 require）
└── README.md
```

---

## 一、最小可用示例

```html
<!-- page.wxml -->
<view class="page-wrap" bindtap="onBlankTap">
  <view class="swipe-row" wx:for="{{list}}" wx:key="id">
    <swipe-cell
      data-id="{{item.id}}"
      actions="{{item.ended ? cmActionsEnded : cmActionsActive}}"
      direction="{{swipeDir}}"
      bind:action="onCardAction"
    >
      <!-- slot 里放你要的卡片内容；点击事件照旧写在这里 -->
      <view class="card" data-id="{{item.id}}" bindtap="goDetail">
        <view class="card-title">{{item.title}}</view>
        <view class="card-sub">{{item.sub}}</view>
      </view>
    </swipe-cell>
  </view>
</view>
```

```json
// page.json
{
  "usingComponents": {
    "swipe-cell": "/components/swipe-cell/swipe-cell"
  }
}
```

```js
// page.js
const registry = require('../../components/swipe-cell/registry.js');

Page({
  data: {
    list: [],
    swipeDir: 'auto',            // 'left' | 'right' | 'auto'（auto 会随系统语言支持 RTL）
    cmActions: [
      { key: 'deliver', text: '快速交付', theme: 'primary' },
      { key: 'cancel',  text: '取消',     theme: 'warning' },
      { key: 'edit',    text: '编辑',     theme: 'default' },
      { key: 'del',     text: '删除',     theme: 'danger',
        confirm: { title: '删除', content: '删除后不可恢复', confirmText: '删除' } }
    ]
  },

  // ① 有卡片展开时，这一次点击只用来「收起」，不跳转（防误触）
  goDetail(e) {
    if (registry.closeIfAny()) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  // ② 点空白处收起
  onBlankTap() { registry.closeAll(); },

  // ③ 列表滚动时收起（只在真有开着/半开的卡片时才动手，滚动帧里零多余开销）
  onPageScroll() { if (registry.anyOpen()) registry.closeAll(); },

  // ④ 操作项回调：组件只给 key，业务语义在这里
  onCardAction(e) {
    const id = e.currentTarget.dataset.id;
    switch (e.detail.key) {
      case 'deliver': /* ... */ break;
      case 'cancel':  /* ... */ break;
      case 'edit':    /* ... */ break;
      case 'del':     /* ... */ break;
      // 未知 key 请务必什么都不做，别落到默认分支上
    }
  }
});
```

---

## 二、Props / 事件 / 方法

### properties

| 名称 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `actions` | Array | `[]` | 操作项数组，见下表；为空时不挂手势、不产生任何开销 |
| `direction` | String | `'left'` | `'left'` 左滑露出右侧操作区 · `'right'` RTL（右滑露出左侧）· `'auto'` 按系统语言自动判（阿语/希伯来语等自动变 `right`） |
| `actionWidth` | Number | `130` | 单个操作项宽度（**rpx**）。操作项自身可用 `width` 覆盖 |
| `threshold` | Number | `0.3` | 落位阈值（0~1）：朝目标方向拖过「操作区宽度 × 它」就落位。判定方向随「手势开始时是否已展开」而变，所以"想打开"和"想关掉"都只需拖 30% |
| `disabled` | Boolean | `false` | 整卡禁用（不响应手势） |

### `actions` 里的每一项

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | String | **必需**。回调时回传，用来识别是哪个操作 |
| `text` | String | **必需**。按钮文字 |
| `icon` | String | 可选。文字类图标（如 `'✓'`），渲染为一行文本 |
| `iconSrc` | String | 可选，优先于 `icon`。图片地址或内联 base64 SVG（本项目图标惯例，见 `pages/commission/list-actions.js`） |
| `theme` | String | 可选。`primary` / `default` / `warning` / `danger`，对应组件 wxss 里的底色类；默认 `default` |
| `width` | Number | 可选。该项宽度（rpx），不传用 `actionWidth` |
| `confirm` | Boolean \| Object | 可选。`true` 用默认文案；对象支持 `{ title, content, confirmText }`。⚠️ `confirmText` ≤ 4 个汉字（微信 showModal 硬约束，组件已自动截断兜底） |
| `disabled` | Boolean | 可选。禁用项点了毫无反应（连收起都不做） |

### events

| 名称 | detail | 说明 |
|---|---|---|
| `action` | `{ key, index, action }` | 点了某个操作项（需确认的**在用户确认之后**才抛）。**不携带任何业务数据** —— 行标识请用组件标签上的 `data-*`（`e.currentTarget.dataset.id`） |
| `change` | `{ open }` | 展开状态变化（只有真的变了才抛，减少无谓联动） |

### 方法（`selectComponent` 或 `registry.current()` 拿到实例后调用）

| 方法 | 说明 |
|---|---|
| `setHandlers(map)` | **可选**：给操作项挂 JS 函数回调，见下面「两种回调方式」。传 `null` 清空 |
| `close()` | 收起（幂等） |
| `visible()` | 是否"开着或半开"（registry 用它判断要不要收） |

### `externalClasses`

`ext-class` —— 宿主想给组件根节点加额外样式（间距、阴影等）时用。

---

## 二·补、两种回调方式（都在 `actions` 配置里，但触发通道不同）

| | 事件（默认，推荐） | `setHandlers`（配置化回调） |
|---|---|---|
| 怎么写 | `<swipe-cell bind:action="onCardAction">` | `comp.setHandlers({ edit: fn, del: fn })` |
| 分发方式 | 一个入口，按 `e.detail.key` switch | 每个 key 一个函数 |
| 适合 | 页面里操作不多、逻辑集中 | 想按 key 拆函数、或逻辑分散在别处 |
| 是否抛 `action` 事件 | 抛 | **不抛**（避免同一个操作被处理两次） |

**为什么回调不能直接写进 `actions`**：组件属性是从 WXML 传进来的，跨渲染层必须**可序列化** ——
函数会在传递中被丢掉，组件根本收不到。所以"配置化回调"只能走 JS 侧注入（`setHandlers`，
不经过 `setData`）。两种方式可以在同一张卡上混用：挂了 handler 的 key 走函数，其余走事件。

```js
// 单行卡片：拿实例挂回调（列表里建议用 bind:action 更省事）
onReady() {
  this.selectComponent('#sc_del').setHandlers({
    del: (d) => { console.log('删了', d.key, d.index); }   // d = { key, index, action }
  });
}
```

> 非函数值会被自动过滤（不会在用户点击的那一刻才抛 `not a function`）；
> 需确认的操作项，`setHandlers` 的回调同样**在用户确认之后**才执行。

---

## 三、`registry.js`（页面必须用到的部分）

```js
const registry = require('/components/swipe-cell/registry.js');

registry.closeIfAny()   // 有卡片开着/半开 → 全部收起并返回 true；否则返回 false
registry.closeAll()     // 同上（语义更直白）
registry.anyOpen()      // 是否存在开着/半开的卡片（滚动时用它做廉价判断）
registry.current()      // 完全展开的那一张实例（一般不用）
```

为什么"是否收起过"要返回布尔值：**点卡片时先用它拦一道**，避免"卡片还开着，手指点上去却直接跳走了"。

> 模块是小程序按路径缓存的，所以页面与组件 require 到的是**同一份状态**。

---

## 四、接入注意（踩过的地方）

1. **卡片的背景/圆角/阴影交给组件根节点**
   组件根节点是 `overflow: hidden`（内容滑出时不能越过卡片边界），因此 slot 内卡片的 `box-shadow`
   会被裁掉。组件根节点默认吃宿主的 `--radius-card` / `--shadow-card`（没定义则回落到 24rpx / 无阴影），
   所以视觉与普通卡片一致。**slot 内的卡片只放背景色与内边距即可，不要指望它的阴影**。

2. **行间距放在外层容器上，不要给 slot 内的卡片加 `margin-bottom`**
   操作区是"和卡片等高"的；卡片自带下外边距会让操作区多出一截空档（视觉上按钮比卡片高）。
   正确写法：`<view class="swipe-row" wx:for=...><swipe-cell>…</swipe-cell></view>` + `.swipe-row { margin-bottom: 18rpx; }`。

3. **不要用 `catchtouchmove`**：小程序没法"只在横滑时禁用滚动"，用了它会把纵向滚动一起废掉。
   组件靠**轴向判定**：手势一开始只判方向，判为纵向就整串交还原生滚动。

4. **PC 端（鼠标）**：手机走 touch 事件，PC 走官方 `bind:pointerdown/move/up`（官方文档明确 PC 会触发 pointer 事件）。
   两类事件可能同时到达，组件用"手势来源"去重。`pointerleave/pointercancel` 用来兜住"鼠标在元素外抬起"。
   > 真机验证点：PC 微信里按住卡片左右拖动应能跟手（若个别环境 pointer 事件不触发，回落到触摸事件即可，
   > 组件两条通路都绑着）。

5. **RTL**：`direction="auto"` 会读系统语言自动判（阿语/希伯来语等 → 右滑露出左侧操作区），
   并镜像按钮顺序，保证两个方向"最先露出的按钮"一致。要手动指定就传 `'right'`。

6. **操作项的排列顺序有 UX 含义**：操作区贴在 reveal 侧，**越靠外侧的越先被露出来**。
   所以破坏性操作（删除）放在最后并配上二次确认 —— 与微信会话列表同一个排法。

7. **样式 token 全部带兜底值**（`var(--color-primary, #C28E72)` 之类）：既能融入宿主主题，
   也能在没有 token 的环境里独立工作。

---

## 五、想改样式

| 想改什么 | 改哪里 |
|---|---|
| 操作项底色 | `swipe-cell.wxss` 的 `.sa-primary / .sa-default / .sa-warning / .sa-danger`（想换成微信那套高饱和蓝/橙/红，改这四行即可） |
| 图标大小、文字大小 | `swipe-cell.wxss` 的 `.sa-ico / .sa-ico-text / .sa-txt` |
| 吸附松紧 | 组件属性 `threshold`（越小越容易展开/收起） |
| 展开动画时长 | `swipe-cell.wxss` 的 `.swipe-body { transition }` |
| 判方向的手感 | `gesture.js` 的 `AXIS_SLOP`（默认 10px）、`AXIS_DOMINANCE`（1.2 倍）、`AXIS_FIX_MS / AXIS_FIX_MAX_PX`（起手纠偏窗口） |
| 甩动灵敏度 | `gesture.js` 的 `FLICK_V`（默认 0.35px/ms ≈ 350px/s） |
| 手势"算不算还活着" | `swipe-cell.js` 的 `LIVE_MS`（默认 800ms，见下） |

### 手势稳定性的三条设计（改之前先看一眼，别踩回去）

1. **判不准就不判**：轴向判定要求主轴压过副轴 `AXIS_DOMINANCE` 倍，否则返回 `null` 继续等。
   手指起手那一小段往往是斜的，硬判一半概率判错，而判错会把整串手势废掉（用户感知：划不出来）。
2. **拖动中不许被外部 close 打断**：`close()` 在手势"还活着"时（最后一次事件距今 < `LIVE_MS`）直接让路 ——
   因为宿主会在列表滚动时调用 `registry.closeAll()`，而横滑时页面**常会滚几个像素**，
   否则手势会被当场清掉（真机现象：刚划一点就缩回去、后面也不跟手）。
   反过来，末尾事件丢失、已经断流（> `LIVE_MS`）的卡片仍然收得掉，不会留"卡在半开没人管"。
3. **松手同时看距离和速度**：快速短滑（距离不够）也算展开 —— 只按距离判的话，
   一甩手就回弹，用户会觉得"明明划了却缩回去"。速度采样的是「语义化位移」，
   所以自带开/合符号，RTL 不需要额外判断。

---

## 六、测试

组件是零依赖的原生实现，测试在纯 Node 下跑（无需真机）：

```
node tests/run.js swipe            # 手势数学 + 组件行为
node tests/run.js commission-list-swipe
node tests/run.js guard-swipe-direction
```

- `tests/swipe-gesture.test.js`：手势数学的边界（NaN / 超界 / 反向 / RTL / 已展开时再拖）
- `tests/swipe-cell.test.js`：手势序列 → 状态 → 事件（用 `tests/component-helper.js` 驱动）
- `tests/guard-swipe-direction.test.js`：方向一致性守卫（WXML 不许写死单边、WXSS 两套定位都要有）

写新用例时用组件脚手架（可以像普通对象一样调组件方法、模拟手势）：

```js
const H = require('./component-helper.js');
const inst = H.loadComponent('../components/swipe-cell/swipe-cell.js');
inst.$mount();
H.swipe(inst, { from: [300, 100], to: [100, 100] });        // 触摸
H.swipe(inst, { kind: 'pointer', from: [300, 100], to: [100, 100] });  // PC 鼠标
```

> ⚠️ `registry` 是模块级单例，跨用例共享。用例前请 `registry.reset()`（`swipe-cell.test.js` 里用
> `it()` 包装统一做掉了）。

---

## 七、换到另一个列表接入（5 步清单）

组件不认识任何业务，所以搬到别的列表**不用改组件一行代码**：

1. **页面 json 注册**
   ```json
   { "usingComponents": { "swipe-cell": "/components/swipe-cell/swipe-cell" } }
   ```
2. **WXML 包住卡片**，行间距放到外层容器（别给卡片加 `margin-bottom`）
   ```html
   <view class="swipe-row" wx:for="{{list}}" wx:key="id">
     <swipe-cell data-id="{{item.id}}" actions="{{myActions}}" direction="{{swipeDir}}" bind:action="onCardAction">
       <view class="card" data-id="{{item.id}}" bindtap="goDetail">…你的卡片…</view>
     </swipe-cell>
   </view>
   ```
3. **页面 js 里定义 `myActions`**（文案 / 图标 / 主题色 / 是否确认，全是纯数据）
4. **页面 js 接三处 registry**（页面 require 到的是与组件同一份状态）
   ```js
   const registry = require('../../components/swipe-cell/registry.js');
   goDetail(e) { if (registry.closeIfAny()) return; /* 再跳转 */ },
   onBlankTap() { registry.closeAll(); },
   onPageScroll() { if (registry.anyOpen()) registry.closeAll(); }
   ```
5. **卡片样式照旧**：slot 里只放背景色与内边距；圆角/阴影由组件根节点吃
   `--radius-card` / `--shadow-card`（没定义则回落到 24rpx / 无阴影）

**接完只需要检查三件事**：① 页面有没有 `onPageScroll`（没有就加上，滚动收起靠它）；
② 卡片点击有没有先问 `closeIfAny()`（否则展开状态下会误跳转）；③ `direction` 传的是配置值，
不是写死的 `'left'`。

> 已按这套接入的列表：`pages/commission/list`（排单）。
> 不同列表的差异只体现在 `actions` 数组与 `onCardAction` 里的业务分支。
> 复用性有测试兜底：`tests/swipe-cell.test.js` 里有一条用例用**完全非排单语义的
> actions（置顶/归档/分享）**跑同一套手势与回调，并自检组件源码里不出现业务词。
