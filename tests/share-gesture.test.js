// tests/share-gesture.test.js —— 转发「TAP 手势」约束的防回归守卫
//
// 背景（2026-09-12 真机事故）：
//   微信要求 wx.shareFileMessage 必须由用户的 TAP 手势**直接**触发。旧代码是
//   「点清空 → 弹确认 → await 写完备份 → 直接转发」——转发发生在异步链条深处，
//   脱离手势上下文 → 平台必然拒绝：
//     shareFileMessage:fail can only be invoked by user TAP gesture
//   更糟的是 fail 回调吞掉了 errMsg，把失败统统一句话「你取消了转发」，
//   用户明明没取消，却被误导（这条错误的提示本身也是 bug）。
//
// 本测试三道闸：
//   ① 源码扫描：wx.shareFileMessage 只允许出现在 utils/share.js（唯一入口）
//   ② 行为：脱离 tap 上下文调用 → 必须失败；在 tap 内同步调用 → 成功
//   ③ 清空流程：第一段不转发；第二段必须由 tap 同步触发才成功
// stub 已忠实模拟平台约束（见 tests/wx-stub.js 的 simulateTap / tapDepth）。

const path = require('path');
const fs = require('fs');
const stub = require('./wx-stub.js');
const { test, group, ok, equal } = require('./harness.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const share = require('../utils/share.js');
const clearFlow = require('../utils/clear-flow.js');

const ROOT = path.join(__dirname, '..');

// ---------- 源码扫描工具 ----------
function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}
// 去掉注释，避免「注释里提到 API 名字」造成假阳性
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

group('转发唯一入口 · 源码扫描（防回归）');

test('wx.shareFileMessage 只允许出现在 utils/share.js —— 其他文件一律绕道', () => {
  const files = walk(ROOT, []).filter((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    return rel.indexOf('tests/') !== 0 && rel.indexOf('tools/') !== 0 && rel.indexOf('.workbuddy/') !== 0;
  });
  const offenders = [];
  files.forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel === 'utils/share.js') return;
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    if (/wx\.shareFileMessage\s*\(/.test(code)) offenders.push(rel);
  });
  equal(
    offenders.length, 0,
    '以下文件绕过唯一入口调用了转发（微信要求转发必须由 TAP 手势同步触发，否则必失败；请改走 utils/share.js）：' + offenders.join('、')
  );
});

test('每个页面若展示「转发备份」按钮，其处理器必须同步调用（源码顺序检查）', () => {
  // 检查两个清空入口：转发必须是 tap 处理器的第一条语句，中间不能有 await
  ['pages/settings/about.js', 'pages/settings/checkup.js'].forEach((rel) => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const i = src.indexOf('onShareBackup(');
    ok(i > 0, rel + ' 缺少 onShareBackup 处理器');
    const body = src.slice(i, src.indexOf('\n  },', i) > 0 ? src.indexOf('\n  },', i) : i + 900);
    ok(body.indexOf('await') < 0, rel + ' 的转发处理器里出现了 await —— 会脱离 TAP 手势上下文，转发必被平台拒绝');
    const callIdx = body.indexOf('sharePendingAndCommit(');
    ok(callIdx > 0, rel + ' 未调用 sharePendingAndCommit');
  });
});

group('转发 · TAP 手势约束（stub 忠实模拟平台行为）');

test('脱离 TAP 上下文调用 → 平台拒绝，且原始 errMsg 被如实带出（不再吞错）', async () => {
  stub.resetStorage();
  const r = await share.shareFileNow(stub.dataPath + '/x.json', 'x.json');
  equal(r.ok, false, '不在 tap 里调用必须失败');
  equal(r.reason, 'no-gesture');
  ok(String(r.errMsg).indexOf('TAP gesture') >= 0, 'errMsg 必须原样保留，实际：' + r.errMsg);
  ok(r.msg.indexOf('点击') >= 0, '要给出人能看懂的提示，实际：' + r.msg);
});

test('在 TAP 上下文里同步调用 → 成功', async () => {
  stub.resetStorage();
  let pend = null;
  stub.simulateTap(() => { pend = share.shareFileNow(stub.dataPath + '/x.json', 'x.json'); });
  const r = await pend;
  equal(r.ok, true);
  ok(stub.toasts.some((t) => t.shareFileMessage), '应记录到一次转发');
});

test('用户取消 → reason=cancel（与平台错误严格区分，不再混为一谈）', async () => {
  stub.resetStorage();
  stub.faults.shareFail = true;
  let pend = null;
  stub.simulateTap(() => { pend = share.shareFileNow(stub.dataPath + '/x.json', 'x.json'); });
  const r = await pend;
  equal(r.ok, false);
  equal(r.reason, 'cancel');
});

test('低版本微信不支持该 API → 明确提示升级，而不是让用户干瞪眼', async () => {
  stub.resetStorage();
  stub.faults.shareUnsupported = true;
  let pend = null;
  stub.simulateTap(() => { pend = share.shareFileNow(stub.dataPath + '/x.json', 'x.json'); });
  const r = await pend;
  equal(r.ok, false);
  equal(r.reason, 'unsupported');
  ok(r.msg.indexOf('升级') >= 0, '应提示升级微信，实际：' + r.msg);
});

group('清空流程 · 两段式的边界（回归锁）');

test('回归锁：若仍在「异步之后再转发」（旧 bug 写法）→ 平台拒绝且必须弹窗说明真实原因', async () => {
  stub.resetStorage();
  store.ensureSeed();
  store.saveMaterial({ name: '保住我', materialCategoryId: 'mc_other' });
  const pending = await clearFlow.prepareClear();
  equal(pending.ok, true);
  // 故意不放进 simulateTap —— 模拟旧写法（异步链条里转发）
  const r = await clearFlow.sharePendingAndCommit(pending);
  equal(r.ok, false);
  equal(r.reason, 'no-gesture');
  const last = stub.modals[stub.modals.length - 1];
  ok(last && String(last.content).indexOf('点击') >= 0,
    '必须告知真实原因（应与「你取消了转发」严格不同），实际：' + (last && last.content));
  equal(store.getMaterials().length, 1, '数据分毫不动');
});

test('转发成功后才清空：commitClear 清空业务数据并恢复出厂预设', async () => {
  stub.resetStorage();
  store.ensureSeed();
  store.saveMaterial({ name: '待清空', materialCategoryId: 'mc_other' });
  const pending = await clearFlow.prepareClear();
  let pend = null;
  stub.simulateTap(() => { pend = clearFlow.sharePendingAndCommit(pending); });
  const r = await pend;
  equal(r.ok, true);
  equal(store.getMaterials().length, 0, '业务数据已清空');
  ok(storage.get(KEYS.UNITS, []).length >= 8, '预设已重发（恢复出厂）');
});

test('确认框取消 → 连备份都不生成（stage=cancel，数据分毫不动）', async () => {
  stub.resetStorage();
  store.ensureSeed();
  store.saveMaterial({ name: '保住我2', materialCategoryId: 'mc_other' });
  stub.modals.answerQueue.push({ confirm: false, cancel: true });
  const r = await clearFlow.prepareClear();
  equal(r.ok, false);
  equal(r.stage, 'cancel');
  equal(stub.toasts.filter((t) => t.shareFileMessage).length, 0);
  equal(store.getMaterials().length, 1);
});
