// tests/smoke.test.js —— 环境冒烟：确认打桩与模块加载通路正常
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');

group('环境冒烟');

test('wx 打桩已就位', () => {
  ok(typeof global.wx.getStorageSync === 'function', '缺少 getStorageSync');
  ok(typeof global.wx.setStorageSync === 'function', '缺少 setStorageSync');
  ok(typeof global.getApp === 'function', '缺少 getApp');
});

test('能加载 utils/store.js', () => {
  const store = require('../utils/store.js');
  ok(typeof store.getMaterials === 'function', '缺少 getMaterials');
  ok(typeof store.getFlows === 'function', '缺少 getFlows');
});

test('能加载 utils/calc.js', () => {
  const calc = require('../utils/calc.js');
  ok(typeof calc.computeProduct === 'function', '缺少 computeProduct');
});

test('存储读写往返正常', () => {
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.set('bm_materials', [{ id: 'm1', name: '测试布', totalValue: 100 }]);
  const got = store.get('bm_materials', []);
  equal(got.length, 1, '应读回 1 条');
  equal(got[0].name, '测试布');
});

test('存储做深拷贝隔离（外部改动不应回写）', () => {
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.set('bm_materials', [{ id: 'm1', name: '测试布' }]);
  const got = store.get('bm_materials', []);
  got[0].name = '被外部改坏了';
  const again = store.get('bm_materials', []);
  equal(again[0].name, '测试布', '存储未隔离，外部修改污染了数据');
});

test('意外网络请求会被立刻暴露（零网络架构约束）', () => {
  let threw = false;
  try { global.wx.request({ url: 'https://example.com' }); } catch (e) { threw = true; }
  ok(threw, 'wx.request 未被拦截，可能引入网络依赖');
});
