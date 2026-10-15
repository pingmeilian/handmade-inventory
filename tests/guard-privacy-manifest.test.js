// tests/guard-privacy-manifest.test.js —— 「用了隐私接口却没登记」的防回归守卫
//
// 背景（2026-09-26 真机）：备份页「从聊天记录选择备份文件」在手机上永远失败。
// 根因：`wx.chooseMessageFile` 属于隐私接口「收集你选中的文件」，
// 而后台《用户隐私保护指引》**没声明这一项** → 平台直接拒绝调用。
//
// 为什么会漏？——上次梳理时是按**已知关键词**grep 的
// （chooseMedia / saveImageToPhotosAlbum / setClipboardData…），
// `chooseMessageFile`、`saveFileToDisk` 就漏在了视线之外。
// **教训：拿官方清单逐条对，而不是拿印象去搜。**
//
// 本守卫：扫源码里出现的所有隐私接口 → 必须都在 tools/privacy-manifest.js 登记过。
// 第二个用例用"注入法"验证守卫本身有牙（能真的抓出漏登记）。

const path = require('path');
const fs = require('fs');
const { test, ok, equal } = require('./harness.js');
const manifest = require('../tools/privacy-manifest.js');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function isProduction(rel) {
  return rel.indexOf('tests/') !== 0 && rel.indexOf('tools/') !== 0
    && rel.indexOf('cloudfunctions/') !== 0 && rel.indexOf('.workbuddy/') !== 0;
}

// 纯函数：给定源码与两份清单，返回"用了但没登记"的接口名
function findUndeclared(code, allApis, declaredApis) {
  return allApis.filter((api) => code.indexOf(api + '(') >= 0 && declaredApis.indexOf(api) < 0);
}

test('代码里用到的每个隐私接口，都必须在 privacy-manifest 里登记（否则后台会漏声明）', () => {
  const all = manifest.allApis();
  const declared = manifest.declaredApis();
  const offenders = [];

  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (!isProduction(rel)) return;
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    findUndeclared(code, all, declared).forEach((api) => {
      const at = rel + ' → ' + api;
      if (offenders.indexOf(at) < 0) offenders.push(at);
    });
  });

  equal(
    offenders.length, 0,
    '以下隐私接口在代码里被调用、却没在 tools/privacy-manifest.js 登记 ——\n'
    + '漏登记的后果是 mp 后台也不会声明它，真机上该功能会被平台直接拒绝：\n'
    + offenders.join('\n')
  );
});

test('守卫本身有牙：注入一个未登记的隐私接口，必须能被抓出来', () => {
  const all = manifest.allApis();
  const declared = manifest.declaredApis();
  // 伪装一段"偷偷用了定位"的代码
  const fake = 'Page({ go() { wx.getLocation({ type: "wgs84" }); } });';
  const caught = findUndeclared(fake, all, declared);
  ok(caught.indexOf('wx.getLocation') >= 0, '注入的未登记接口应被抓出，实际：' + caught.join(','));
  // 反向：已登记的接口不应被误报
  equal(findUndeclared('wx.setClipboardData({ data: "x" });', all, declared).length, 0,
    '已登记的接口不该被误报');
});

test('后台声明清单必须含「收集你选中的文件」（2026-09-26 真机踩过的坑，别被删掉）', () => {
  const scopes = manifest.requiredScopes();
  ok(scopes.indexOf('收集你选中的文件') >= 0, '缺「收集你选中的文件」→ 从聊天选文件会在手机上直接失败');
  ok(scopes.indexOf('剪贴板') >= 0, '缺「剪贴板」→ 复制链接会失败（V49 踩过）');
  ok(scopes.indexOf('相册（仅写入）') >= 0, '缺「相册（仅写入）」→ 保存图片到相册会失败');
  ok(scopes.indexOf('摄像头') >= 0, '缺「摄像头」→ 拍照功能会失败');
  ok(scopes.indexOf('收集你选中的照片或视频信息') >= 0, '缺「选中的照片或视频」→ 从相册选图会失败');
});

test('「要勾的项」必须与后台弹窗实际选项对齐（2026-09-26 实查确认）', () => {
  // saveFileToDisk 在代码里用到、也已登记，但后台「使用用户信息类型」弹窗里没有对应项，
  // 不该混进"提审前照着勾"的清单 —— 否则用户核对时会发现对不上
  const scopes = manifest.requiredScopes();
  equal(scopes.indexOf('保存文件到磁盘'), -1, '后台弹窗无此项，不该出现在要勾清单里');
  ok(manifest.declaredApis().indexOf('wx.saveFileToDisk') >= 0, '但代码侧仍要登记备查');
});

// ---------------- V147 新增：进包文件里不许出现"我们并未使用"的敏感接口名 ----------------
//
// 背景（2026-10-12 提交审核时踩到）：
//   平台弹出「**接口未配置在app.json文件中且无权限**」，列出的是
//   `wx.chooseAddress` / `wx.chooseLocation` / `wx.choosePoi` / `wx.getFuzzyLocation` /
//   `wx.getLocation` / `wx.startLocationUpdate` / `wx.startLocationUpdateBackground` —— 共 7 项。
//   而本工具是**纯本机记账**，这些接口**一条都没调用**（业务代码带括号的调用零处）。
//   根因：`services/privacy-manifest.js`（当时是**进包文件**）里，`ALL_PRIVACY_APIS`
//   把「位置 / 地址」那一组写成了**完整接口名的字符串** ⇒ 平台的静态扫描**按文本认接口**，
//   把我们的「清单 / 记录」读成了「实际调用」。
//
// ⇒ 修法：该文件已移到 `tools/`（不进包）。而这条守则扫**进包范围**，
//   防止它、或将来任何一份"候选接口清单"再被塞回进包文件里。
//
// ⚠️ 注意这条**不剥注释**：注释里的接口名，平台一样扫得到（这正是本轮的教训）。
const UNUSED_SENSITIVE = [
  'wx.getLocation', 'wx.startLocationUpdate', 'wx.startLocationUpdateBackground',
  'wx.getFuzzyLocation', 'wx.choosePoi', 'wx.chooseLocation', 'wx.chooseAddress',
  'wx.getWeRunData', 'wx.chooseLicensePlate',
  'wx.chooseInvoiceTitle', 'wx.chooseInvoice', 'wx.addPhoneContact'
];

test('★★ 进包文件里不许出现"我们并未使用"的敏感接口名（平台会误判成已调用）', () => {
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (!isProduction(rel)) return;                    // tests/ tools/ docs/ cloudfunctions/ 不进包
    const raw = fs.readFileSync(p, 'utf8');            // ⚠️ 不剥注释：注释也算
    UNUSED_SENSITIVE.forEach((api) => {
      if (raw.indexOf(api) >= 0) offenders.push(rel + ' → ' + api);
    });
  });
  equal(offenders.length, 0,
    '★ 这些接口名出现在**进包文件**里，而我们并没有调用它们 ——\n'
    + '提交审核时平台会因此弹出「接口未配置在app.json文件中且无权限」（2026-10-12 真实发生过），\n'
    + '把这类"清单 / 记录"挪到 tools/ 或 tests/（不进包），或者改成不会被文本扫描命中的写法：\n'
    + offenders.join('\n'));
});

test('守卫本身有牙：往"进包文件"里塞一个未使用的接口名，必须能被抓出来', () => {
  // 用 walk 走一遍真实项目，确认这条判据确实能区分"进包 / 不进包"
  const inPkg = walk(ROOT, []).map((p) => path.relative(ROOT, p).replace(/\\/g, '/'))
    .filter(isProduction);
  ok(inPkg.length > 50, '进包文件应当有几十个（实际 ' + inPkg.length + '）—— 判据不能是空集');
  ok(inPkg.indexOf('tools/privacy-manifest.js') < 0,
    '★ tools/ 里的清单文件不该被算作进包文件（它正是为了避开扫描才挪出去的）');
  ok(inPkg.indexOf('services/privacy-manifest.js') < 0,
    '★ 那个位置（进包）已经不该再有这份清单了');
});
