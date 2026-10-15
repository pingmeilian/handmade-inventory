// tests/component-helper.js —— 自定义组件级测试的公共脚手架
//
// 为什么需要：组件的交互（手势、状态收口、事件抛出）是最容易写错、也最难在真机上回归的部分。
// 微信运行时会替我们做 setData / triggerEvent / 生命周期调度，纯 Node 里没有，
// 所以这里把 Component 配置截下来、补上这些能力，然后像普通对象一样直接调它的方法，
// 跑一整串真实手势序列。
//
// 用法：
//   const inst = loadComponent('../components/swipe-cell/swipe-cell.js');
//   inst.$mount();
//   swipe(inst, { from: [300, 100], to: [40, 100] });
//   inst.data.open  // => true
//
// 注意：与页面不同，组件的 properties 会被微信并入 data，这里也照做（顺序：properties 默认值 → data）。

function deepCopy(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function loadComponent(rel) {
  let captured = null;
  const orig = global.Component;
  global.Component = function (o) { captured = o; return o; };
  try {
    delete require.cache[require.resolve(rel)];
    require(rel);
  } finally {
    global.Component = orig;
  }
  if (!captured) throw new Error(rel + ' 未能捕获 Component 配置（文件里没有调用 Component(...) ？）');

  const inst = Object.assign({}, captured.methods || {});

  // properties 默认值 + data（微信会把 properties 并进 data）
  const data = {};
  Object.keys(captured.properties || {}).forEach(function (k) {
    const p = captured.properties[k];
    data[k] = deepCopy(p && typeof p === 'object' ? p.value : undefined);
  });
  Object.assign(data, deepCopy(captured.data || {}));

  inst.data = data;
  inst.events = [];
  inst.setDataCalls = 0;
  inst.setDataPayload = [];      // 记录每次 setData 的键，供「去抖」类断言
  inst.triggerEvent = function (name, detail) { this.events.push({ name: name, detail: detail }); };
  inst.setData = function (obj) {
    this.setDataCalls++;
    this.setDataPayload.push(Object.keys(obj).join(','));
    const self = this;
    Object.keys(obj).forEach(function (k) { self.data[k] = obj[k]; });
  };

  // 生命周期 / 观察器 / 事件查询
  inst.$mount = function () {
    const L = captured.lifetimes || {};
    if (L.attached) L.attached.call(this);
    return this;
  };
  inst.$detach = function () {
    const L = captured.lifetimes || {};
    if (L.detached) L.detached.call(this);
    return this;
  };
  inst.$pageHide = function () {
    const P = captured.pageLifetimes || {};
    if (P.hide) P.hide.call(this);
    return this;
  };
  inst.$runObserver = function (key, val) {
    const obs = captured.observers || {};
    if (obs[key]) obs[key].call(this, val);
    return this;
  };
  inst.$eventsOf = function (name) { return this.events.filter(function (e) { return e.name === name; }); };
  inst.$lastEvent = function (name) {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].name === name) return this.events[i];
    return null;
  };
  inst.$reset = function () { this.events.length = 0; this.setDataCalls = 0; this.setDataPayload.length = 0; };
  inst.$config = captured;
  return inst;
}

// ---------- 事件构造 ----------
// Touch 类事件：touches / changedTouches 都要给（微信两个都会带）
function touchEvt(x, y) {
  return {
    touches: [{ identifier: 0, clientX: x, clientY: y, pageX: x, pageY: y }],
    changedTouches: [{ identifier: 0, clientX: x, clientY: y, pageX: x, pageY: y }]
  };
}
// Pointer 类事件（PC 专有）：字段是 web 风格的 clientX / clientY
function pointerEvt(x, y) { return { clientX: x, clientY: y, pageX: x, pageY: y }; }

// ---------- 手势驱动 ----------
// kind: 'touch'（默认，手机）| 'pointer'（PC 鼠标）
// path: 中间经过的点（可选），用来模拟真实的连续位移
function swipe(inst, o) {
  const opts = o || {};
  const kind = opts.kind || 'touch';
  const mk = kind === 'pointer' ? pointerEvt : touchEvt;
  const startFn = kind === 'pointer' ? 'onPointerDown' : 'onTouchStart';
  const moveFn = kind === 'pointer' ? 'onPointerMove' : 'onTouchMove';
  const endFn = kind === 'pointer' ? 'onPointerUp' : 'onTouchEnd';
  const from = opts.from || [300, 100];
  const to = opts.to || from;
  const path = opts.path || [to];

  if (!inst[startFn]) throw new Error('组件未实现 ' + startFn + '（WXML 里的 pointer/touch 绑定对不上？）');
  inst[startFn](mk(from[0], from[1]));
  path.forEach(function (p) { inst[moveFn](mk(p[0], p[1])); });
  if (opts.end !== false) inst[endFn](mk(to[0], to[1]));
  return inst;
}

// 点某个操作项（模拟 catchtap 的 event 结构）
function tapAction(inst, index) {
  inst.onActionTap({ currentTarget: { dataset: { i: String(index) } } });
  return inst;
}

module.exports = { loadComponent: loadComponent, swipe: swipe, touchEvt: touchEvt, pointerEvt: pointerEvt, tapAction: tapAction };
