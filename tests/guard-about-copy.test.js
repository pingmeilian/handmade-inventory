// tests/guard-about-copy.test.js —— V146 「关于」页的用户可见文案要克制
//
// 用户报：
//   「你这关于里的库存与成本核算一堆字儿是什么意思？不用写啊，去掉」
// 查实页面上堆了两处"其实是给自己看的东西"：
//   ① 标题行「手工物料库存与成本核算」—— 纯重复（下面那行说明里已经讲清了这是什么工具）；
//   ② 构建标识后面挂着**十几行**"相对上次发布的变化"—— 那是我们核对真机用的备忘，
//      顶在页面上对用户没用；审核员看到一长串开发说明，还容易被判"像开发版"。
// 本文件把三件事钉住：① 那串说明不许再滚回来；② 被删的两处不许加回来；
// ③ **该留的必须留**（版本号 / 构建标识 / "数据存本机" / 合规说明）—— 删过头也是错。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 查源码锚点前先剥注释 —— 否则会被"注释里提到了这件事"骗到（V143 踩过这个坑）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

group('V146 · 「关于」页只显示用户该看的');

test('★ 构建标识只留「构建 <日期> · <版本>」，不许再塞变化说明', () => {
  const src = strip(R('pages/settings/about.js')).split('\n')
    .filter((l) => l.trim().indexOf('//') !== 0).join('\n');
  const m = /const BUILD_TAG\s*=\s*'([^']*)'/.exec(src);
  ok(!!m, '找不到 BUILD_TAG —— 锚点漂了就更新这条');
  const tag = m[1];
  ok(tag.length <= 40, '★ BUILD_TAG 只该是短串（真机核对"装的是哪一版"够用就行），实际 ' +
    tag.length + ' 字符：' + tag);
  ok(!/比上次发布|多了：|另修/.test(tag),
    '★ 不许把"相对上次发布的变化"塞回页面显示串 —— 那串写进注释里，别给用户看：' + tag);
  ok(/^构建 /.test(tag), '开头要能一眼认出这是构建标识：' + tag);
});

test('★ 版本号不许带内部阶段说法（里程碑 / M1 / M2 之类）', () => {
  const src = strip(R('pages/settings/about.js'));
  const m = /version:\s*'([^']*)'/.exec(src);
  ok(!!m, '找不到 version 字段');
  ok(!/里程碑|M[12]\b/.test(m[1]),
    '★ 用户界面上别写内部阶段术语（用户看不懂，审核员还容易觉得"像开发版"）；' +
    '要声明"二期未开发"，合规说明卡里已有专门的一句。实际：' + m[1]);
});

test('★ 「手工物料库存与成本核算」那行大字不许加回来', () => {
  const wxml = strip(R('pages/settings/about.wxml'));
  ok(wxml.indexOf('about-title') < 0, '★ 那行标题已按用户要求删除，别再渲染它');
  const wxss = strip(R('pages/settings/about.wxss'));
  ok(wxss.indexOf('.about-title') < 0, '★ 样式里的 .about-title 也该一并删（不然是孤儿样式）');
});

test('★★ 该留的必须留（删过头也是错）', () => {
  const wxml = R('pages/settings/about.wxml');
  ok(/\{\{version\}\}/.test(wxml), '版本号要在');
  ok(/\{\{buildTag\}\}/.test(wxml),
    '★★ 构建标识必须在 —— 真机核对"装的是哪一版"、排查"改了没生效"全靠它（上架清单里也点名要看）');

  // ⚠️ 这一条必须**定位到那一行**再断言含"本机"：全页搜 /本机/ 是不行的 ——
  //    「合规说明」卡里还有一句"数据全部保存在本机微信存储"，
  //    于是"把顶部那句删掉"这种破坏会蒙混过关（验牙第 6 条就是这么 survuve 的）。
  const line = wxml.split('\n').filter((l) => l.indexOf('一款面向手作人的') >= 0)[0] || '';
  ok(!!line, '找不到顶部那句"这是什么工具"的说明 —— 锚点漂了就更新这条');
  ok(/本机/.test(line),
    '★ 顶部那句说明里要写明"数据保存在本机"（审核看的合规口径，别删）：' + line.trim());
  ok(/无需联网|不联网/.test(line), '★ 同句里"无需联网"也要在（与云总闸关闭的对外口径一致）');

  ok(/合规说明/.test(wxml), '★ 「合规说明」整卡要留（不联网 / 无爬虫 / 二期未开发，审核口径）');
  ok(/隐私保护说明/.test(wxml), '★ 隐私入口要留（上架必备）');
});
