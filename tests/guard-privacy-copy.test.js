// tests/guard-privacy-copy.test.js —— 「隐私文案不得与实现冲突」的防回归守卫
//
// 背景（2026-09-26 · P7 收尾时发现）：
// 云端备份（V51–V61）已经把**数据和图片**上传到微信云开发（腾讯云），
// 但项目里多处仍在向用户声称"数据不会上传任何服务器"——
// 例如 `pages/settings/privacy.wxml`：
//   「…仅存储于您本机的微信本地存储（wx.storage），不会上传至任何服务器，开发者无法远程读取。」
//
// 这在云备份上线后就是**假话**：
//   ① 对用户是虚假陈述（比"没说清"严重得多）
//   ② 审核/合规风险：内容与实现不符
//
// 本守卫：生产代码与文档里**不得出现**这类绝对化表述；
// 且隐私说明页**必须**说明数据会上云（否则就是漏告知）。
// 第三个用例用"注入法"验证守卫本身有牙（能真的抓出违规文案）、且不误报合规文案。

const path = require('path');
const fs = require('fs');
const { test, ok, equal } = require('./harness.js');
const config = require('../services/cloud-config.js');

const ROOT = path.join(__dirname, '..');

// ⭐ 2026-09-27 起：本守卫**跟随云开关**（用户决定先不开云，代码保留）。
//   云开启 → 「不上传服务器」是假话，必须禁止；且隐私页必须告知数据会上云。
//   云关闭 → 反过来：「会同步到云端」成了假话，同样必须禁止。
//   这样无论开关怎么变，守卫都不会失效、也不会误报。
function isCloudOnInProduction() {
  config.setEnvForTest(null);                    // 摘下测试注入，读生产态
  const on = config.hasEnv();
  config.setEnvForTest(config.TEST_ENV);         // 还原（wx-stub 的注入态）
  return on;
}

// 「数据不上传服务器」类绝对化表述 —— 云备份上线后一律为假
const BANNED = [
  '不会上传至任何服务器',
  '不会上传任何服务器',
  '不上传任何服务器',
  '不上传至任何服务器',
  '不传至任何服务器',
  '无服务器、无网络请求',
  '零网络请求、零云开发'
];

const SCAN_EXT = ['.wxml', '.js', '.md', '.json'];

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git' || f === '.workbuddy') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.some((e) => f.endsWith(e))) out.push(p);
  });
  return out;
}

// 测试/开发工具/云函数（服务端）不算"对用户的表述"
function isProduction(rel) {
  return rel.indexOf('tests/') !== 0 && rel.indexOf('tools/') !== 0
    && rel.indexOf('cloudfunctions/') !== 0;
}

// 注释里的句子不构成"对用户的表述"，剥掉再扫（否则本文件自己的说明会误报）
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/[^\n]*/g, '');
}

// 纯函数：给定源码与禁用短语表，返回命中的短语（便于注入法自检）
function findBanned(code, banned) {
  return banned.filter((b) => code.indexOf(b) >= 0);
}

// 纯函数：隐私说明页是否说明了"数据会上云"
function mentionsCloud(code) {
  return code.indexOf('云端') >= 0;
}

test('云开启时，生产代码/文档里不得声称"数据不上传服务器"（此时这类表述是假话）', () => {
  if (!isCloudOnInProduction()) {
    // 云当前是关闭的（2026-09-27 用户决定）：此时「数据仅在本机」是**事实**，
    // 这条禁令自然不适用 —— 由下面第三条守卫反向把关。
    return;
  }
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (!isProduction(rel)) return;
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    findBanned(code, BANNED).forEach((phrase) => {
      const at = rel + ' → 「' + phrase + '」';
      if (offenders.indexOf(at) < 0) offenders.push(at);
    });
  });
  equal(offenders.length, 0, '以下位置声称数据不上传服务器，与云备份实现冲突：\n' + offenders.join('\n'));
});

test('隐私说明页的「数据去向」表述必须与云开关一致（两侧都查）', () => {
  const f = path.join(ROOT, 'pages/settings/privacy.wxml');
  ok(fs.existsSync(f), '隐私说明页必须存在');
  const code = fs.readFileSync(f, 'utf8');
  if (isCloudOnInProduction()) {
    ok(mentionsCloud(code), 'privacy.wxml 未提及「云端」——云端备份已开启，用户有权知道数据去向');
  } else {
    ok(!mentionsCloud(code),
      'privacy.wxml 提到了「云端」，但云功能当前是关闭的 —— 这构成不实陈述（用户会以为数据上了云）');
  }
});

test('守住自己的牙：注入违规文案必须被抓出，合规文案不得误报', () => {
  const bad = '本小程序数据仅存储于本机，不会上传至任何服务器，开发者无法远程读取。';
  ok(findBanned(bad, BANNED).length > 0, '注入法自检：违规文案必须被 findBanned 抓出');

  const second = '本小程序为纯本地架构，无服务器、无网络请求。';
  ok(findBanned(second, BANNED).length > 0, '注入法自检：「无服务器、无网络请求」也必须被抓出');

  const good = '数据默认存于本机；你可在「备份与恢复」中开启云端备份，'
    + '数据会加密上传到微信云开发（腾讯云），按你的微信身份隔离，仅你本人可取回。';
  equal(findBanned(good, BANNED).length, 0, '注入法自检：合规文案不得误报');
  ok(mentionsCloud(good), '注入法自检：合规文案应被判定为"已说明上云"');
});
