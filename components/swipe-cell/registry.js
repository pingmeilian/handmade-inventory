// components/swipe-cell/registry.js —— 「同时只开一张」与「一键全部收起」的唯一收口
//
// 为什么放在模块级而不是页面 data：
//   · 组件之间互相不认识，但必须互斥 —— 由一个共享模块记住「谁展开着」最省事
//   · 页面也要用它（点卡片防误跳、滚动收起），抽成独立模块后两边 require 到的是同一实例
//     （小程序模块按路径缓存，所以组件与页面拿到的状态是同一份）
//
// 为什么维护「全部实例」而不只是「展开的那一个」（2026-09-14 评审发现）：
//   跟手过程中松手事件可能丢失（PC 上鼠标在元素外抬起等），卡片会停在半开状态，
//   而它并没有"展开"过。如果只记展开的那一张，这种半开卡片就没有任何收起的入口
//   （点空白、滚动都收不到它）。维护全部实例后，任何"收起一切"的路径都能兜住它。

const mounted = new Set();   // 挂载中的实例（attached 注册 / detached 注销）
let openInst = null;         // 视觉上完全展开的那一张（用于互斥）

function attach(inst) { mounted.add(inst); }

function detach(inst) {
  mounted.delete(inst);
  if (openInst === inst) openInst = null;
}

function isVisible(inst) { return !!(inst && typeof inst.visible === 'function' && inst.visible()); }

// 某张卡展开时调用：其他还开着的（含停在半开的）一律收掉
function notifyOpen(inst) {
  mounted.forEach((i) => { if (i !== inst && isVisible(i)) i.close(); });
  openInst = inst;
}

// 某张卡刚开始横滑时调用（还没展开）：同样把别的收掉
// —— 对应需求「其他卡片滑动时自动收起」，不必等它松手
function closeOthers(inst) {
  mounted.forEach((i) => { if (i !== inst && isVisible(i)) i.close(); });
}

function notifyClose(inst) {
  if (openInst === inst) openInst = null;
}

// 是否还有卡片是"开着/半开"的（页面滚动时的廉价检查）
function anyOpen() {
  let found = false;
  mounted.forEach((i) => { if (isVisible(i)) found = true; });
  return found;
}

// 收起一切。返回「是否真的收起过」——
// 页面据此决定这次点击是「只收起」还是「继续跳转」。
// ⚠️ 只看"关掉之前可见、关掉之后不可见"，不能只看"调用了 close"：
//    正在被拖动的卡片会拒绝 close（保手势），那种情况下这里必须返回 false、也不能动 openInst。
function closeAll() {
  let closed = false;
  mounted.forEach((i) => {
    if (!isVisible(i)) return;
    i.close();
    if (!isVisible(i)) closed = true;
  });
  if (closed) openInst = null;
  return closed;
}

function closeIfAny() { return closeAll(); }
function current() { return openInst; }
function reset() { mounted.clear(); openInst = null; }   // 测试钩子

module.exports = {
  attach, detach, notifyOpen, closeOthers, notifyClose,
  anyOpen, closeAll, closeIfAny, current, reset
};
