// tests/want-video-link.test.js —— 「前往原视频」：外链归一化 + 点击反馈
//
// 真机反馈（2026-09-14）：在「想做」里填了外部视频链接，点「前往原视频」**毫无反应**
// —— 不跳转、没弹窗、没报错。用户看得见的"没反应"，代码里必然是某条路径静默失败了。
// 这一层把"任何一条失败路径都必须有明确反馈"钉死。
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');
const F = require('./fixtures.js');
const util = require('../utils/util.js');

const BILI = 'https://www.bilibili.com/video/BV1xx411c7mD';

// 造一条想做记录 + 打开详情页
function setup(link) {
  F.reset();
  const w = F.store.saveWant({ title: '羊毛毡小熊', link: link, desc: '', photos: [] });
  const page = loadPage('../pages/want/detail.js');
  page.onLoad({ id: w.id });
  page.onShow();
  return { page, w };
}

function lastModal() { return stub.modals[stub.modals.length - 1]; }
function clipboards() { return stub.toasts.filter((t) => t && t.clipboard !== undefined).map((t) => t.clipboard); }

// ============================================================================
group('外链归一化 · 纯函数（util.normalizeUrl）');

test('合法 https 链接 → 原样通过', () => {
  const r = util.normalizeUrl(BILI);
  equal(r.ok, true);
  equal(r.url, BILI);
  equal(r.extracted, false, '本身就是链接，不需要提取');
});

test('合法 http 链接 → 允许（不能只认 https）', () => {
  const r = util.normalizeUrl('http://example.com/v/1');
  equal(r.ok, true);
  equal(r.url, 'http://example.com/v/1');
});

test('空 / 空白 / null / undefined → reason=empty（页面据此提示"未填写"）', () => {
  ['', '   ', '\u200b', null, undefined].forEach((v) => {
    const r = util.normalizeUrl(v);
    equal(r.ok, false);
    equal(r.reason, 'empty');
  });
});

test('首尾空格 → 自动去掉（粘贴时最常见的脏数据）', () => {
  const r = util.normalizeUrl('  ' + BILI + '  ');
  equal(r.ok, true);
  equal(r.url, BILI);
});

test('零宽字符（复制常夹带）→ 去掉后可识别', () => {
  const r = util.normalizeUrl('\ufeffhttps://a.com/x\u200b');
  equal(r.ok, true);
  equal(r.url, 'https://a.com/x');
});

test('★ 整段分享文案（含中文）→ 提取出其中的链接，而不是直接判非法', () => {
  const r = util.normalizeUrl('7.43 复制打开抖音，看看【某手作】的作品 https://v.douyin.com/iRNBho6f/ 复制此链接');
  equal(r.ok, true, '这是用户粘贴时最常见的样子，必须能用');
  equal(r.url, 'https://v.douyin.com/iRNBho6f/');
  equal(r.extracted, true);
});

test('无协议域名（www.xxx.com/...）→ 自动补 https://', () => {
  const r = util.normalizeUrl('www.bilibili.com/video/BV1xx411c7mD');
  equal(r.ok, true);
  equal(r.url, 'https://www.bilibili.com/video/BV1xx411c7mD');
});

test('中文全角冒号/斜杠 → 归一化后可识别', () => {
  const r = util.normalizeUrl('https：／／a.com/x');
  equal(r.ok, true);
  equal(r.url, 'https://a.com/x');
});

test('★ 协议白名单：javascript: / weixin:// / ftp:// 一律拒绝（reason=scheme）', () => {
  ['javascript:alert(1)', 'weixin://dl/profile', 'ftp://a.com/x', 'data:text/html,<b>x</b>'].forEach((v) => {
    const r = util.normalizeUrl(v);
    equal(r.ok, false, v + ' 不该被放行');
    equal(r.reason, 'scheme');
  });
});

test('★ 链接中间有空格（被断成两半）→ 判为格式错（reason=malformed），不猜', () => {
  const r = util.normalizeUrl('https://a b.com/x');
  equal(r.ok, false);
  equal(r.reason, 'malformed');
});

test('纯中文 / 随便一句话 → reason=no-url（页面提示"没识别出链接"）', () => {
  ['羊毛毡小熊', 'https://', 'a', '.'].forEach((v) => {
    const r = util.normalizeUrl(v);
    equal(r.ok, false, v + ' 不该被当成链接');
    ok(r.reason === 'no-url' || r.reason === 'malformed', v + ' → ' + r.reason);
  });
});

test('主机名合法但路径含中文 → 允许（浏览器本就支持，不该误杀）', () => {
  const r = util.normalizeUrl('https://a.com/搜索?q=花');
  equal(r.ok, true);
});

test('★ 链接尾部的中文标点 → 去掉（否则复制出去是个打不开的坏链接）', () => {
  ['看看这个 https://v.douyin.com/abc/。', '参考，https://a.com/x，', '（视频 https://a.com/x）', '见：https://a.com/x；']
    .forEach((v) => {
      const r = util.normalizeUrl(v);
      equal(r.ok, true, v);
      ok(/^https?:\/\/[^。，、；：？！）]+$/.test(r.url), '尾部不该残留标点：' + r.url);
    });
});

test('成对括号属于链接本身时 → 保留（`...(disambiguation)` 不该被削掉）', () => {
  const r = util.normalizeUrl('https://a.com/wiki/花_(消歧义)');
  equal(r.ok, true);
  equal(r.url, 'https://a.com/wiki/花_(消歧义)');
});

test('带端口的链接 → 允许（不该误判成格式错）', () => {
  const r = util.normalizeUrl('https://a.com:8080/v/1');
  equal(r.ok, true);
  equal(r.url, 'https://a.com:8080/v/1');
  equal(util.normalizeUrl('https://a.com:abc/x').ok, false, '端口不是数字 → 格式错');
});

// ============================================================================
group('「前往原视频」点击 · 每条失败路径都必须有反馈');

test('★ 合法链接 → 复制的是那个链接，并且给出明确提示（不是静默）', async () => {
  const { page } = setup(BILI);
  await page.goVideo();
  await stub.flush();
  equal(clipboards()[0], BILI, '复制的应是链接本身');
  const m = lastModal();
  ok(m, '必须弹出一个说明（剪贴板自带的系统提示会盖掉 toast，所以这里用弹窗）');
  const said = ((m && m.title) || '') + ' ' + ((m && m.content) || '');
  ok(/已复制/.test(said), '提示要讲清"已复制" —— 实际：' + said);
  ok(/浏览器|App/.test(said), '还要告诉用户下一步去哪打开 —— 实际：' + said);
});

test('整段分享文案 → 弹窗里额外说明"已从文本中提取出链接"', async () => {
  const { page } = setup('7.43 复制打开抖音 https://v.douyin.com/iRNBho6f/ 看作品');
  await page.goVideo();
  await stub.flush();
  const m = lastModal();
  const said = ((m && m.title) || '') + ' ' + ((m && m.content) || '');
  ok(/提取/.test(said), '用户粘的是整段文案，要说清我们只拿了链接 —— 实际：' + said);
});

test('★ 空链接 → 明确提示"未填写视频链接"（不静默）', async () => {
  const { page } = setup('');
  await page.goVideo();
  await stub.flush();
  equal(clipboards().length, 0, '空链接不该去写剪贴板');
  ok(stub.lastToast(), '必须给提示');
  ok(/未填写/.test(stub.lastToast().title), '实际：' + stub.lastToast().title);
});

test('★ 非法链接（纯中文）→ 明确提示，且不去复制', async () => {
  const { page } = setup('羊毛毡小熊');
  await page.goVideo();
  await stub.flush();
  equal(clipboards().length, 0);
  ok(/没识别出链接/.test(stub.lastToast().title), '实际：' + stub.lastToast().title);
});

test('★ 非法协议（javascript:）→ 明确提示"只支持 http / https"', async () => {
  const { page } = setup('javascript:alert(1)');
  await page.goVideo();
  await stub.flush();
  equal(clipboards().length, 0);
  ok(/http/.test(stub.lastToast().title), '实际：' + stub.lastToast().title);
});

test('★ 剪贴板写入失败（系统拒绝）→ 明确提示，绝不静默', async () => {
  const { page } = setup(BILI);
  stub.faults.clipboardFail = true;
  await page.goVideo();
  await stub.flush();
  ok(stub.lastToast(), '失败必须有提示 —— 这正是"点了没反应"的根因场景');
  ok(/复制失败/.test(stub.lastToast().title), '实际：' + stub.lastToast().title);
});

test('★ data.item 为 null（脏状态）→ 不抛异常，且有提示', async () => {
  F.reset();
  const page = loadPage('../pages/want/detail.js');
  page.onLoad({ id: 'wt_not_exist' });     // 不调 onShow，模拟 item 还没装载
  let err = null;
  try { await page.goVideo(); } catch (e) { err = e; }
  await stub.flush();
  equal(err, null, '绝不能抛异常（真机上抛异常＝点了完全没反应）');
  ok(stub.lastToast(), '应给出提示');
});

test('整段分享文案 → 复制出去的是提取后的干净链接', async () => {
  const { page } = setup('看看这个 https://v.douyin.com/iRNBho6f/ 复制打开');
  await page.goVideo();
  await stub.flush();
  equal(clipboards()[0], 'https://v.douyin.com/iRNBho6f/', '不能把中文文案一起复制进去');
});

test('页面展示的链接是可长按选择的（复制失败时用户能手动兜底）', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/want/detail.wxml'), 'utf8');
  ok(/user-select/.test(wxml), '链接文本要允许长按选择 —— 否则"复制失败"的提示等于让用户干瞪眼');
});

test('链接不可用时，详情页要把"格式异常"标出来（别让用户点了才发现）', () => {
  const { page } = setup('羊毛毡小熊');
  equal(page.data.item.linkBad, true);
  const good = setup(BILI);
  equal(good.page.data.item.linkBad, false);
});

// ============================================================================
// 独立评审（2026-09-14）指出的边界：这些都是"复制出去一个坏链接"的另一种形态
group('外链归一化 · 独立评审指出的边界（宁松勿紧，别误杀）');

test('★ 提取时"紧跟链接的中文"要截断（那是文案，不是路径）', () => {
  const r = util.normalizeUrl('看看这个 https://v.douyin.com/abc/看作品');
  equal(r.ok, true);
  equal(r.url, 'https://v.douyin.com/abc/', '不能被当成路径的一部分复制出去');
});

test('但"整串就是一条含中文路径的链接"要保留（浏览器会自动编码，不该误杀）', () => {
  const r = util.normalizeUrl('https://a.com/搜索?q=花');
  equal(r.ok, true);
  equal(r.url, 'https://a.com/搜索?q=花');
});

test('★ 裸域名分支也要清尾部标点（之前漏了）', () => {
  const r = util.normalizeUrl('www.a.com/x。');
  equal(r.ok, true);
  equal(r.url, 'https://www.a.com/x');
});

test('文案里夹的裸域名 → no-url（提示用户粘完整链接，而不是含糊地说格式错）', () => {
  const r = util.normalizeUrl('看这个 www.a.com/x');
  equal(r.ok, false);
  equal(r.reason, 'no-url');
});

test('★ 合法但少见的写法不能误杀：IP 直连 / 内网下划线主机 / 带 userinfo', () => {
  const cases = [
    ['http://192.168.1.10:8080/x', 'http://192.168.1.10:8080/x'],
    ['https://my_host.com/x', 'https://my_host.com/x'],
    ['https://user:pass@a.com/x', 'https://user:pass@a.com/x']
  ];
  cases.forEach(([input, want]) => {
    const r = util.normalizeUrl(input);
    equal(r.ok, true, input + ' 被误判成 ' + r.reason + ' —— 用户明明填对了');
    equal(r.url, want);
  });
});

test('★ 链接被切断（如 query 里的引号）→ 报格式错，绝不静默给出半个链接', () => {
  const r = util.normalizeUrl('https://a.com/x?q="a"');
  equal(r.ok, false, '半个链接复制出去用户只会看到打不开，比报错更糟');
  equal(r.reason, 'malformed');
});

// ============================================================================
// 在源头解决：保存时就把链接收拾干净，别让坏链接入库（独立评审的建议）
group('想做编辑页 · 保存时顺手归一化链接');

function editSetup(link) {
  F.reset();
  const page = loadPage('../pages/want/edit.js');
  page.onLoad({});
  page.setData({ title: '羊毛毡小熊', link: link, desc: '', photos: [] });
  return page;
}

test('★ 粘的是整段分享文案 → 存进库的是干净链接，并提示"已提取"', () => {
  const page = editSetup('7.43 复制打开抖音，看看【某手作】的作品 https://v.douyin.com/iRNBho6f/ 复制此链接');
  const id = page._ensureSaved();
  equal(F.store.getWants().find(x => x.id === id).link, 'https://v.douyin.com/iRNBho6f/');
  ok(/提取/.test(stub.lastToast().title), '要告诉用户存进去的不是原文 —— 实际：' + stub.lastToast().title);
});

test('链接本来就干净 → 原样存，不打扰用户（不该每次都弹提示）', () => {
  const page = editSetup(BILI);
  const id = page._ensureSaved();
  equal(F.store.getWants().find(x => x.id === id).link, BILI);
  const t = stub.lastToast();
  ok(!t || !/提取|异常/.test(t.title), '无变化就别提示');
});

test('★ 提不出链接也照存（随手记不该被拦），但提示一句', () => {
  const page = editSetup('羊毛毡小熊');
  const id = page._ensureSaved();
  const saved = F.store.getWants().find(x => x.id === id);
  equal(saved.link, '羊毛毡小熊', '原样保留，不丢用户输入');
  ok(/不是完整网址/.test(stub.lastToast().title), '实际：' + stub.lastToast().title);
});

// ============================================================================
// 真机复现（2026-09-14 16:10）：用户看到「复制失败 可长按上方链接手动复制」。
// 说明新加的反馈生效了 —— 同时也暴露了真问题：**剪贴板被平台拒了**。
// 平台事实（官方文档 + 社区一致）：`wx.setClipboardData` 属于隐私接口，真机上会返回
//   errno 104    privacy permission is not authorized（用户没同意隐私授权）
//   errno 104179 api scope is not declared in the privacy agreement（后台没声明剪贴板用途）
// 所以"复制失败"必须能分辨这两种：该重试的重试、该让开发者去配置的讲清楚。
group('剪贴板隐私失败 · 分类 / 重试 / 不静默');

const ERR_NO_AUTH = { errMsg: 'setClipboardData:fail privacy permission is not authorized', errno: 104 };
const ERR_NO_DECL = { errMsg: 'setClipboardData:fail api scope is not declared in the privacy agreement', errno: 104179 };

// 点「前往原视频」，并清空记录以看清本次提示。
// ⚠️ configure 必须在 setup **之后**执行：setup 里的 F.reset() 会重置桩的失败开关
//    （否则注入的故障会被清掉，测试就白测了）
async function tapVideo(configure) {
  const { page } = setup(BILI);
  stub.toasts.length = 0;
  stub.modals.length = 0;
  if (configure) configure();
  await page.goVideo();
  await stub.flush();
  return page;
}

test('分类：errno 104（未授权）→ auth；errno 104179（后台未声明）→ decl；其它 → other', () => {
  equal(util.clipboardFailInfo(ERR_NO_AUTH).kind, 'auth');
  equal(util.clipboardFailInfo(ERR_NO_DECL).kind, 'decl');
  equal(util.clipboardFailInfo({ errMsg: 'setClipboardData:fail' }).kind, 'other');
  equal(util.clipboardFailInfo(null).kind, 'other', '传 null 也不能炸');
  // 只给 errMsg 没给 errno 时也要能认出来（不同基础库字段不一致）
  equal(util.clipboardFailInfo({ errMsg: ERR_NO_AUTH.errMsg }).kind, 'auth');
  equal(util.clipboardFailInfo({ errMsg: ERR_NO_DECL.errMsg }).kind, 'decl');
});

test('★ 未授权 → 自动拉起隐私授权并重试一次，成功后给出成功提示', async () => {
  await tapVideo(() => stub.faults.clipboardFailQueue.push(ERR_NO_AUTH));   // 第一次失败，重试时成功
  equal(stub.privacyAuthRequests.length, 1, '应该主动拉起一次隐私授权');
  equal(clipboards()[0], BILI, '重试后应真的写进剪贴板');
  const m = lastModal();
  ok(m && /已复制/.test((m.title || '') + (m.content || '')), '成功要有成功提示');
});

test('★ 未授权 + 用户拒绝授权 → 明确提示，且给出可执行的下一步（不静默）', async () => {
  await tapVideo(() => {
    stub.faults.clipboardFailQueue.push(ERR_NO_AUTH);
    stub.faults.privacyDeny = true;
  });
  const t = stub.lastToast();
  ok(t, '必须有提示');
  ok(/授权/.test(t.title), '要说清是"授权"的问题 —— 实际：' + (t && t.title));
  ok(/长按/.test(t.title), '还要告诉用户当下怎么办 —— 实际：' + (t && t.title));
});

test('★ 后台未声明剪贴板用途（104179）→ 不重试（授权也没用），提示指向真正的解决办法', async () => {
  await tapVideo(() => stub.faults.clipboardFailQueue.push(ERR_NO_DECL));
  equal(stub.privacyAuthRequests.length, 0, '声明缺失时拉授权弹窗没有意义，别打扰用户');
  const t = stub.lastToast();
  ok(t, '必须有提示');
  ok(/声明|开通/.test(t.title), '要指出这是"没声明/没开通"的问题 —— 实际：' + (t && t.title));
});

test('未知失败原因 → 兜底提示仍然可执行（含"长按"），且绝不静默', async () => {
  await tapVideo(() => { stub.faults.clipboardFail = true; });
  const t = stub.lastToast();
  ok(t, '必须有提示');
  ok(/长按/.test(t.title), '实际：' + (t && t.title));
});

test('重试只在隐私失败时发生：普通失败不重试（避免无谓的二次调用）', async () => {
  await tapVideo(() => { stub.faults.clipboardFail = true; });
  equal(stub.privacyAuthRequests.length, 0);
});
