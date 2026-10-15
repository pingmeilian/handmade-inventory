// tests/guard-cloud-offline.test.js —— 云功能「离线态」守卫（2026-09-27）
//
// 背景：用户拍板「先不开云」（云环境不续期、功能关掉），但**代码全部保留**。
// 关掉的是「总闸」（一个配置值），不是删代码——将来改回即可。
//
// 本守卫盯三件事，每一条都有具体的踩坑史：
//   ① **零云调用** —— 关掉后不能只在界面上藏起来、代码却还在偷偷发请求。
//      "关了但还在跑"是最难发现的一类问题（用户流量被吃、日志被打、行为不一致）。
//   ② **测试钩子有效** —— 总闸一关，72 条云测试会全部失去意义。
//      必须有一条"测试专用注入"通道，让云代码继续被测试覆盖（生产路径永不调用它）。
//   ③ **文案不许许愿** —— 降级文案要给得起承诺：「敬请期待」是承诺，
//      而"可能永远不开"是已知事实；「暂时连不上」会把内部决定甩锅给用户网络。

const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const config = require('../services/cloud-config.js');
const cloud = require('../services/cloud.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 模拟「生产的关闭态」（ENV_ID 不可用）；用完必须还原为测试注入态
function useProduction() { config.setEnvForTest(null); }
function restoreTestEnv() { config.setEnvForTest(config.TEST_ENV); }

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

group('云离线态 · 生产配置必须处于关闭');

test('① 生产常量 ENV_ID 必须是占位符（直接读源码，不受测试注入影响）', () => {
  const src = stripComments(
    fs.readFileSync(path.join(ROOT, 'services/cloud-config.js'), 'utf8'));
  const m = src.match(/const\s+ENV_ID\s*=\s*'([^']*)'/);
  ok(m, 'cloud-config.js 应定义 const ENV_ID');
  ok(m[1].indexOf('__') === 0,
    '生产 ENV_ID 应为占位符（关闭云功能），实际：' + m[1]);
});

test('② 关闭态：cloud.init() 返回 false，且**零** wx.cloud.init 调用', () => {
  useProduction();
  stub.resetStorage();
  stub.cloudInits.length = 0;

  equal(cloud.init(), false, '关闭态下 init 必须返回 false');
  equal(cloud.isReady(), false, '未就绪');
  equal(stub.cloudInits.length, 0,
    '关闭态下**不得**调用 wx.cloud.init —— 关了就必须真的不动，不能只是界面上看不见');

  restoreTestEnv();
});

test('③ 关闭态：云调用被拒且带 cloud-disabled（上层据此降级为纯本地）', async () => {
  useProduction();
  stub.resetStorage();
  try {
    let err = null;
    await cloud.callFunction('getOpenid', {}).catch((e) => { err = e; });
    ok(err, '关闭态下云调用应 reject，不能静默 resolve');
    equal(err.code, 'cloud-disabled', '要带 code，调用方据此走本地路径');
  } finally {
    restoreTestEnv();
  }
});

group('云离线态 · 测试注入钩子（保障云代码仍被测试覆盖）');

test('④ 注入后能正常初始化，且 env 用的是注入值（不是占位符）', () => {
  restoreTestEnv();
  equal(config.hasEnv(), true, '注入后应判为「已配置」');
  equal(config.ENV_ID, config.TEST_ENV, 'ENV_ID 应返回注入值');

  stub.resetStorage();
  stub.cloudInits.length = 0;
  equal(cloud.init(), true, '注入后应能初始化成功');
  equal(stub.cloudInits.length, 1, '注入后应真的调用一次 wx.cloud.init');
  equal(stub.cloudInits[0].env, config.TEST_ENV,
    '传给 wx.cloud.init 的应是注入的 env —— 否则真机会拿到占位符');
});

test('⑤ 守卫：生产源码不得调用 setEnvForTest（测试钩子只属于测试）', () => {
  // 注入法自检：先确认这套「剥注释 + 匹配」真的能抓到违规，否则守卫是摆设
  ok(stripComments("function bad() { config.setEnvForTest('x'); }").indexOf('setEnvForTest') >= 0,
    '自检失败：扫描逻辑抓不到真实的调用代码');
  equal(stripComments('// 仅测试用：setEnvForTest(null)').indexOf('setEnvForTest'), -1,
    '自检失败：注释里的提及不应被误报');

  const offenders = [];
  // 定义处豁免：cloud-config.js 是这条通道的唯一出处（定义 + 导出）。
  // 其余任何生产文件出现它，都意味着有人绕过了总闸。
  const DEFINITION_FILE = path.join('services', 'cloud-config.js');
  const scan = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      fs.readdirSync(p).forEach((name) => scan(path.join(p, name)));
      return;
    }
    if (!/\.(js|wxml|json)$/.test(p)) return;
    if (path.relative(ROOT, p) === DEFINITION_FILE) return;
    if (stripComments(fs.readFileSync(p, 'utf8')).indexOf('setEnvForTest') >= 0) {
      offenders.push(path.relative(ROOT, p));
    }
  };
  ['app.js', 'pages', 'utils', 'services', 'components'].forEach((t) => {
    const p = path.join(ROOT, t);
    if (fs.existsSync(p)) scan(p);
  });
  equal(offenders.length, 0,
    '生产代码出现了测试注入钩子（真机上会绕过总闸）：' + offenders.join(' / '));
});

group('云离线态 · 降级文案（不许许愿、不许甩锅网络）');

test('⑥ 备份页降级文案：不给承诺、不甩锅网络，且说清不影响本地功能', () => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'pages/settings/backup.wxml'), 'utf8');

  // 取出降级分支那一段（wx:if="{{!cloud.enabled}}" 之后到 </block>）
  const m = wxml.match(/wx:if="\{\{!cloud\.enabled\}\}"[\s\S]*?<\/block>/);
  ok(m, '备份页应有「云端未开启」的降级分支');
  const copy = m[0];

  ok(copy.indexOf('敬请期待') === -1,
    '「敬请期待」是承诺，而我们可能永远不开 —— 不能给用户许愿');
  ok(copy.indexOf('暂时连不上') === -1,
    '「暂时连不上」把内部决定甩锅给网络，会让用户去折腾 WiFi');
  ok(/本机|本地/.test(copy),
    '降级文案必须说清「不影响本地功能」，否则用户会以为数据安全变差了');
});
