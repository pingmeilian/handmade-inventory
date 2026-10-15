// tools/privacy-manifest.js —— 本项目用到的「用户隐私接口」唯一清单（**构建期工具，不进包**）
//
// ⚠️⚠️ 为什么在 tools/ 而不是 services/（2026-10-12 提交审核时踩到）：
//   它原先在 `services/` ⇒ **会被打进代码包**。而这个文件里，`ALL_PRIVACY_APIS` 把
//   `wx.getLocation` / `wx.chooseLocation` / `wx.chooseAddress` 等**完整接口名**写成了字符串。
//   提交审核时，平台弹出「**接口未配置在app.json文件中且无权限**」，
//   列出的恰好就是「位置 / 地址」那 7 项 —— 而我们**一条都没调用**（业务代码零处）。
//   ⇒ 平台的静态扫描是**按文本认接口**的：它把我们的"记录 / 清单"读成了"实际调用"。
//   👉 **教训：进包文件里不要出现「我们并未使用」的敏感接口名 —— 哪怕是写在数组或注释里。**
//      （真正用到的那些（chooseMedia / setClipboardData…）无所谓 —— 我们本来就在用。）
//   移到 tools/ 后：① 不进包 ⇒ 平台扫不到；② 守卫测试照样能 require（tools/ 不进包但可读）。
//
// ⭐ 为什么必须有这个文件（2026-09-26 真机教训）：
//   备份页「从聊天记录选择备份文件」在**手机上**永远失败。根因：
//   `wx.chooseMessageFile` 属于隐私接口「收集你选中的文件」，
//   而 mp 后台《用户隐私保护指引》**没声明这一项** → 调用被平台直接拒绝。
//
//   ⚠️ 更值得记的是「为什么会漏」：上次（V50）梳理隐私声明时，
//   我是按**已知关键词**去 grep 的（chooseMedia / saveImageToPhotosAlbum /
//   setClipboardData / openMedia），于是 `chooseMessageFile`、`saveFileToDisk`
//   就漏在了视线之外。
//   👉 **正确做法：拿官方清单逐条对，而不是拿印象去搜。**
//   本文件就是"官方清单在本项目的落地"，并有守卫扫源码防止再漏：
//   `tests/guard-privacy-manifest.test.js`。
//
// 用法：
//   ① 后台《用户隐私保护指引》要勾的项 = DECLARED 里 scope 去重（提审前照着勾）
//   ② 每条的 usage 可直接粘进后台的「用途说明」框
//   ③ 新写代码若用到 ALL_PRIVACY_APIS 里的任何接口，必须同步加到 DECLARED，否则测试红

// ---------- 官方隐私接口总表（用于"用了但没登记"的检测） ----------
// 来源：微信官方《小程序用户隐私保护指引内容介绍》里的「处理的信息 ↔ 接口」对照表。
// 只收本项目**可能用到**的那些类别，不追求穷举平台全部接口。
const ALL_PRIVACY_APIS = [
  // 位置
  'wx.getLocation', 'wx.startLocationUpdate', 'wx.startLocationUpdateBackground',
  'wx.getFuzzyLocation', 'wx.choosePoi', 'wx.chooseLocation',
  // 地址 / 发票 / 运动 / 车牌
  'wx.chooseAddress', 'wx.chooseInvoiceTitle', 'wx.chooseInvoice',
  'wx.getWeRunData', 'wx.chooseLicensePlate',
  // 选中的照片或视频
  'wx.chooseImage', 'wx.chooseMedia', 'wx.chooseVideo',
  // 选中的文件
  'wx.chooseMessageFile',
  // 麦克风
  'wx.startRecord', 'wx.getRecorderManager', 'wx.joinVoIPChat',
  // 相册（仅写入）
  'wx.saveImageToPhotosAlbum', 'wx.saveVideoToPhotosAlbum',
  // 剪贴板
  'wx.getClipboardData', 'wx.setClipboardData',
  // 摄像头
  'wx.createCameraContext',
  // 通讯录
  'wx.addPhoneContact',
  // 保存文件到磁盘
  'wx.saveFileToDisk'
];

// ---------- 本项目实际用到、且需要在后台声明的隐私项 ----------
// ⚠️ `where` 只写「文件 + 场景」，**不写行号**（2026-10-09 修正）：
//    原先记的是 `backup.js:238` / `tutorial-export.js:418` 这类行号，几个月后全部失效
//    （实际已漂到 308 / 422），照着找只会白费功夫。要定位就 grep API 名。
const DECLARED = [
  {
    api: 'wx.setClipboardData',
    scope: '剪贴板',
    usage: '用于复制商品链接、视频链接及教程地址等文本内容到系统剪贴板，方便用户分享给好友，或在外部浏览器中打开原视频与教程页面。',
    where: ['utils/util.js（copyText 统一收口）']
  },
  {
    api: 'wx.chooseMedia',
    scope: '收集你选中的照片或视频信息',
    usage: '用于从相册选择或拍摄手作物料、成品的图片，关联到库存与作品记录中。',
    where: ['pages/materials/edit.js（拍/选图）', 'pages/products/edit.js（拍/选图）',
      'pages/inspiration/edit.js', 'pages/inspiration/list.js',
      'pages/want/edit.js', 'pages/want/list.js（共 8 处）']
  },
  {
    // 摄像头也来自 chooseMedia（sourceType 含 camera），后台需同时勾「摄像头」
    api: 'wx.chooseMedia(camera)',
    scope: '摄像头',
    usage: '用于拍摄手作物料、成品照片，便于记录库存与制作进度。',
    where: ['pages/products/edit.js（openMedia([\'camera\'])）', 'pages/materials/edit.js（同上）']
  },
  {
    api: 'wx.saveImageToPhotosAlbum',
    scope: '相册（仅写入）',
    usage: '用于保存成品图、教程卡到本地相册，方便用户离线查看与分享。',
    where: ['pages/products/detail.js（保存成品图）', 'pages/products/tutorial-export.js（保存教程卡）']
  },
  {
    // ⭐ 2026-09-26 补：这一项就是"手机上打不开文件选择"的直接原因
    api: 'wx.chooseMessageFile',
    scope: '收集你选中的文件',
    usage: '用于从你的微信聊天记录中选择「别针手作库」的备份文件，以便把之前备份的数据恢复到本机。',
    where: ['pages/settings/backup.js（从聊天记录选择备份文件）']
  },
  {
    // ⭐ 2026-09-26 补：与上一条同批漏掉的（导出教程卡到电脑）
    // ⚠️ 但后台「使用用户信息类型」弹窗里**没有对应项**（2026-09-26 实查截图确认），
    // 所以 needsDeclaration: false —— 代码侧登记备查，后台**无需也无法勾选**。
    api: 'wx.saveFileToDisk',
    scope: '（后台无对应项）',
    usage: '用于把导出的教程卡文件保存到你的电脑磁盘，方便打印或在其它设备上使用。',
    needsDeclaration: false,
    where: ['pages/products/tutorial-export.js（导出到电脑）']
  }
];

// 后台要勾的项（按 scope 去重）—— 提审前照着这个清单核对
// ⚠️ 只收 needsDeclaration !== false 的：后台弹窗里没有对应项的（如 saveFileToDisk）
// 不算"要勾"，否则这份清单会与后台实际可选项对不上（2026-09-26 实查确认）
function requiredScopes() {
  const seen = {};
  DECLARED.forEach((d) => {
    if (d.needsDeclaration === false) return;
    seen[d.scope] = true;
  });
  return Object.keys(seen);
}

// 源码里出现过的隐私接口（供守卫比对）
function allApis() { return ALL_PRIVACY_APIS.slice(); }

// 已登记的接口名（去掉括号里的补充说明，只留 API 名）
function declaredApis() {
  return DECLARED.map((d) => d.api.replace(/\(.*$/, ''));
}

module.exports = {
  ALL_PRIVACY_APIS: ALL_PRIVACY_APIS,
  DECLARED: DECLARED,
  allApis: allApis,
  declaredApis: declaredApis,
  requiredScopes: requiredScopes
};
