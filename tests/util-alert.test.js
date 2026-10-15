// tests/util-alert.test.js —— 单按钮说明弹窗（交付完成提示用）
//
// 为什么不复用 util.confirm：confirm 一定会渲染「取消」按钮，用它做"说明"会让用户
// 以为还有一步撤销操作。这里补一个只有「知道了」的 alert，并沿用 confirm 的两条纪律：
//   ① 按钮文字 ≤ 4 字（微信硬约束，超了直接 fail）
//   ② 任何失败路径都必须 resolve，绝不静默挂起（2026-09-12 真机事故的教训）
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const util = require('../utils/util.js');

group('通用 · util.alert 单按钮说明弹窗');

test('alert 只有一个确认按钮（showCancel:false），不与操作按钮文字混淆', async () => {
  stub.resetStorage();
  const p = util.alert('交付完成', '剩余 3 件已全部交付！');
  await p;
  const modal = stub.modals[stub.modals.length - 1];
  ok(modal, '应调用 showModal');
  equal(modal.showCancel, false, '说明弹窗不该给"取消"选项');
  equal(modal.title, '交付完成');
  equal(modal.content, '剩余 3 件已全部交付！');
});

test('alert 默认按钮文字「知道了」≤ 4 字，且超长会被截断（否则微信直接 fail）', async () => {
  stub.resetStorage();
  await util.alert('标题', '内容');
  equal(stub.modals[stub.modals.length - 1].confirmText, '知道了');
  await util.alert('标题', '内容', '我知道了谢谢你');
  ok(stub.modals[stub.modals.length - 1].confirmText.length <= 4);
});

test('alert 弹窗失败也必须 resolve（绝不静默卡死调用方）', async () => {
  stub.resetStorage();
  stub.faults.modalFail = true;
  const r = await util.alert('标题', '内容');
  equal(r, true, '失败按"已读"处理，让调用方继续走下去');
  stub.faults.modalFail = false;
});

test('alert 已在 util 上导出（页面可直接用）', () => {
  equal(typeof util.alert, 'function');
});
