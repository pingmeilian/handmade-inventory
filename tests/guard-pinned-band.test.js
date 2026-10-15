// tests/guard-pinned-band.test.js —— 顶部固定区（V116）
//
// 用户 2026-10-05（四张截图）：「圈出的部分固定，上下滑动时固定在原地，只有下面的列表能滑」
//   + 「固定住的部分背景是粉色，再往下就是奶黄色」⇒ 四个 tab 页（看板/物料库/作品集/我的）
//   顶部那一整块（含里面的控件）钉住；粉色的范围 = 固定区的下沿（不再按屏高比例）。
//
// 做法（沿用 V105 验证过的技术）：固定带 position: fixed + **等高等位**（占位把内容顶下去），
// 高度由 JS 量出来（内容会变：作品集切「作品集/商品/样品」时多一行、主题不同高度也不同）。
//
// ⚠️ 本文件**一个反斜杠都不用**（正则一律改 indexOf）：写文件的通道会吃掉反斜杠。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PAGES = [
  { name: '看板', wxml: 'pages/dashboard/dashboard.wxml', js: 'pages/dashboard/dashboard.js',
    band: ['class="topbar"', 'space-pill'] },
  { name: '物料库', wxml: 'pages/materials/list.wxml', js: 'pages/materials/list.js',
    band: ['class="toolbar"', 'mc-chip', '批量入库'] },
  { name: '作品集', wxml: 'pages/products/list.wxml', js: 'pages/products/list.js',
    band: ['class="toolbar"', 'cat-bar', 'cat-sub', 'headerSummary'] },
  { name: '我的', wxml: 'pages/mine/mine.wxml', js: 'pages/mine/mine.js',
    band: ['class="card profile"', 'profile-name'] }
];

group('V116 · 顶部固定区（四页）');

test('① 四页都有「固定带 + 等高等位 + 量高函数」', () => {
  PAGES.forEach((pg) => {
    const w = read(pg.wxml);
    const i = w.indexOf('class="pin-band"');
    ok(i >= 0, pg.name + ' 缺少固定带 .pin-band');
    const j = w.indexOf('pin-band-ph', i);
    ok(j > i, pg.name + ' 固定带后面要有等高等位 .pin-band-ph（否则内容会被压在带下面）');
    pg.band.forEach((mark) => {
      const k = w.indexOf(mark, i);
      ok(k > i && k < j,
        pg.name + ' 的固定带里应当包含 ' + mark + '（固定的是这些控件，不是一条空色带）');
    });
    const js = read(pg.js);
    ok(js.indexOf('measureBand') >= 0, pg.name + ' 要有 measureBand() 量固定带高度');
    const r = js.indexOf('onReady');
    ok(r >= 0 && js.indexOf('measureBand', r) > r, pg.name + ' 要在 onReady 里量一次');
    ok(js.indexOf('boundingClientRect') >= 0, pg.name + ' 要用 boundingClientRect 取真实高度');
  });
});

test('② 固定带样式：钉住 + 底色走角色 + z-index 在"内容之上、弹层之下"', () => {
  const css = read('app.wxss');
  const blockOf = (sel) => {
    const i = css.indexOf(sel);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };
  const band = blockOf('.pin-band {');
  ok(band.length > 0, 'app.wxss 里要有 .pin-band 规则');
  ok(band.indexOf('position: fixed') >= 0, '固定带必须 position: fixed（钉住不随内容滚）');
  ok(band.indexOf('var(--color-band)') >= 0, '固定带底色走 --color-band（粉帽=粉，其它主题=页面底）');
  ok(band.indexOf('z-index: 40') >= 0, 'z-index 取 40（内容之上、弹层 100 之下）—— V105 挑出来的夹缝');
  ok(blockOf('.pin-band-ph').length > 0, '要有等高等位 .pin-band-ph（fixed 不占位，会压住内容）');
  ok(blockOf('.pin-band { background: var(--color-band); }').indexOf('position: fixed') < 0,
    '自检失败：去掉 fixed 的写法没被判出 —— 这条守卫没有牙');
});

test('③ band 角色：默认 = 页面底（其它主题零影响），粉帽 = 樱花粉', () => {
  const themes = require('../utils/themes.js');
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    equal(themes.roles(k).band, themes.get(k).bg,
      k + ' 未声明 band ⇒ 固定带底色必须等于页面底（视觉零影响）');
  });
  const g = themes.roles('gingerbreadHat');
  equal(String(g.band).toLowerCase(), '#f8c8c6', '粉帽的固定带 = 樱花粉（用户：固定住的部分背景是粉色）');
  ok(themes.styleOf('gingerbreadHat').indexOf('--color-band: #F8C8C6') >= 0, 'styleOf 要发 --color-band');
  equal(String(themes.get('gingerbreadHat').bg).toLowerCase(), '#fbf4e4', '页面底仍是奶黄（粉只到固定区下沿）');
  ok(themes.roles('不存在的主题').band, 'roles 对坏 key 也要回默认（band 不许 undefined）');
});

test('② 固定带样式：钉住 + 底色走角色 + z-index 在"内容之上、弹层之下"', () => {
  const css = read('app.wxss');
  const blockOf = (sel) => {
    const i = css.indexOf(sel);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };
  const band = blockOf('.pin-band {');
  ok(band.length > 0, 'app.wxss 里要有 .pin-band 规则');
  ok(band.indexOf('position: fixed') >= 0, '固定带必须 position: fixed（钉住不随内容滚）');
  ok(band.indexOf('var(--color-band)') >= 0, '固定带底色走 --color-band（粉帽=粉，其它主题=页面底）');
  ok(band.indexOf('z-index: 40') >= 0, 'z-index 取 40（内容之上、弹层 100 之下）—— V105 挑出来的夹缝');
  ok(blockOf('.pin-band-ph').length > 0, '要有等高等位 .pin-band-ph（fixed 不占位，会压住内容）');
  ok(blockOf('.pin-band { background: var(--color-band); }').indexOf('position: fixed') < 0,
    '自检失败：去掉 fixed 的写法没被判出 —— 这条守卫没有牙');
});

test('③ band 角色：默认 = 页面底（其它主题零影响），粉帽 = 樱花粉', () => {
  const themes = require('../utils/themes.js');
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    equal(themes.roles(k).band, themes.get(k).bg,
      k + ' 未声明 band ⇒ 固定带底色必须等于页面底（视觉零影响）');
  });
  const g = themes.roles('gingerbreadHat');
  equal(String(g.band).toLowerCase(), '#f8c8c6', '粉帽的固定带 = 樱花粉（用户：固定住的部分背景是粉色）');
  ok(themes.styleOf('gingerbreadHat').indexOf('--color-band: #F8C8C6') >= 0, 'styleOf 要发 --color-band');
  equal(String(themes.get('gingerbreadHat').bg).toLowerCase(), '#fbf4e4', '页面底仍是奶黄（粉只到固定区下沿）');
  ok(themes.roles('不存在的主题').band, 'roles 对坏 key 也要回默认（band 不许 undefined）');
});
test('④ 带下的缝只许算一遍：留白交给带，页面顶部内边距抵消（V116a）', () => {
  // 用户 2026-10-05：「缝隙留得太大了 每一页都是 还和之前一样的布局，不要留这么宽」
  // 根因：`.pin-band` 用了**四边同值**的内边距 ⇒ 带底空白一档 + `.page-wrap` 顶部内边距
  //   又叠一档 ⇒ 内容起点 160+32=192rpx，而改动前是 128rpx（多出 64rpx）。
  const css = read('app.wxss');
  const blockOf = (sel) => {
    const i = css.indexOf(sel);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };
  // 不用正则（本环境写文件的通道会吃掉反斜杠）：纯字符串取「关键子后第一个数字rpx」
  const rpxAfter = (s, key) => {
    const i = s.indexOf(key);
    if (i < 0) return null;
    let j = i + key.length;
    while (j < s.length && (s[j] < '0' || s[j] > '9')) j++;
    let k = j;
    while (k < s.length && s[k] >= '0' && s[k] <= '9') k++;
    return k > j ? Number(s.slice(j, k)) : null;
  };
  const band = blockOf('.pin-band {');

  ok(band.indexOf('padding: var(--page-margin);') < 0,
    '★ 固定带不许再用四边同值的内边距 —— 带底空白会与页面顶部内边距叠成两份（用户：缝隙留得太大了）');
  ok(band.indexOf('padding: var(--page-margin) var(--page-margin)') >= 0,
    '固定带的内边距要写成「上 左右 下」三段式（下边距单独给一档）');

  // V116b：留白由「带的下内边距」与「页面顶部内边距」**对半分** —— 界线才落在两行字中间
  // V117：页面顶部内边距归零，那半档改由**面板的顶部内边距**承担（面板顶边 = 分界线）
  const panel = blockOf('.content-panel {');
  ok(panel.indexOf('padding:') >= 0, '面板必须给出内边距（上面那半档 + 左右页面边距由它承担）');

  // 四个页面都要挂上这个类，否则抵消不了
  PAGES.forEach((pg) => {
    const w = read(pg.wxml);
    const i = w.indexOf('class="page-wrap');
    const j = w.indexOf('>', i);
    ok(i >= 0 && j > i && w.slice(i, j).indexOf('pin-page') >= 0,
      pg.name + ' 的 page-wrap 缺少 pin-page 类（抵消不到顶部内边距）');
  });

  // ⭐ 量化：内容起点 = 带上内边距 + 控件高 + 带下内边距，必须回到改动前的 128rpx
  const pm = rpxAfter(css, '--page-margin:');
  const tb = rpxAfter(blockOf('.topbar {'), 'height:');
  const decl = band.split('padding:')[1].split(';')[0].trim();
  const parts = decl.split(' ').filter(Boolean);
  const padB = rpxAfter(parts[parts.length - 1] || '', '');
  const panelDecl = panel.split('padding:')[1].split(';')[0].trim();
  const padT = rpxAfter(panelDecl.split(' ').filter(Boolean)[0] || '', '');
  ok(pm && tb && padB !== null && padT !== null,
    '解析失败：page-margin=' + pm + ' topbar=' + tb + ' band下=' + padB + ' 页顶=' + padT);
  equal(pm + tb + padB + padT, 128,
    '★ 内容起点必须是 128rpx（= 改动前的布局）—— 实际 ' + (pm + tb + padB + padT)
    + 'rpx（若是有意改全局边距，请同步更新这个期望值并说明）');
});
test('⑤ 带内最后一块控件不许再留一份下边距（否则与带的下边距叠成两份）', () => {
  // 四页带内**最后一块**分别是：看板 .topbar / 物料库 .mc-scroll / 作品集 .summary（计数行） / 我的 .card
  // 它们改前各自带着「到下一块」的下边距（24 / 24 / 20 / gap-card）——
  // 进了带以后这份间距已由带的下内边距统一承担，元素自己那份必须归零。
  const css = read('app.wxss');
  const i = css.indexOf('.pin-band .topbar');
  ok(i >= 0, '缺少「带内控件下边距归零」的规则（.pin-band .topbar 一段起）');
  const block = i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  ok(block.indexOf('margin-bottom: 0') >= 0, '归零规则要真的写 margin-bottom: 0');
  ['topbar', 'mc-scroll', 'summary', '.card'].forEach((c) => {
    ok(block.indexOf(c) >= 0,
      '带内最后一块 ' + c + ' 没被归零 —— 会与带的下边距叠成两份');
  });
  // 注入法自检：把归零规则拆掉，上面那条必须判得出
  const fake = '.pin-band .topbar { margin-bottom: 24rpx; }';
  const fb = fake.slice(fake.indexOf('.pin-band .topbar'), fake.indexOf('}') + 1);
  ok(fb.indexOf('margin-bottom: 0') < 0, '自检失败：没归零的写法没被判出 —— 这条守卫没有牙');
});

test('⑥ 量高失败不许把页面带崩（四页都要兜底）', () => {
  // 2026-10-05 冒烟发现：`measureBand()` 直接调 wx.createSelectorQuery().in(this)…
  //   取不到就抛 ⇒ 页面 onReady 挂掉（真机某基础库异常 / 桩环境都同此）。
  // 📌 与 V115a 同一条纪律：**宁可少一档高度，也不许白屏**。
  const stub = require('./wx-stub.js');
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.ensureSeed();
  require('../services/state.js').init(store.getBusinessCategories()[0].id);
  const { loadPage } = require('./page-helper.js');
  const FOUR = ['dashboard/dashboard', 'materials/list', 'products/list', 'mine/mine'];
  FOUR.forEach((f) => {
    const pg = loadPage('../pages/' + f + '.js');
    let threw = null;
    try {
      if (pg.onLoad) pg.onLoad({});
      if (pg.onReady) pg.onReady();
      if (pg.onShow) pg.onShow();
    } catch (e) { threw = e; }
    ok(!threw, f + ' 量高取不到也不许抛（量高失败必须兜底）'
      + (threw ? ' —— 实际抛了：' + threw.message : ''));
    equal(pg.data.bandH, 0, f + ' 量不到 ⇒ bandH 保持 0（不写脏数据）');
  });
  // 注入法自检：四个文件的 measureBand 体内必须有 typeof 检查 + try
  FOUR.forEach((f) => {
    const js = read('pages/' + f + '.js');
    const i = js.indexOf('measureBand()');
    const body = i < 0 ? '' : js.slice(i, js.indexOf('},', i));
    ok(body.indexOf('createSelectorQuery') >= 0, f + ' 的 measureBand 里应当有量高调用');
    ok(body.indexOf('try') >= 0 && body.indexOf('typeof') >= 0,
      f + ' 的 measureBand 缺兜底 —— 要 typeof 检查 + try/catch（否则量高失败整页挂）');
  });
});

test('⑦ 分界线居中：带上下的留白必须相等（界线落在两行字中间）', () => {
  // 用户 2026-10-05：「分界线应该在两行字的中间，而不是紧挨着下面那行字」。
  // 界线 = 固定带的下沿；上面那行字是带内最后一块（看板＝「缝纫」胶囊），
  // 下面那行字是带下第一块的第一行（看板＝「原料资产」）。
  // ⇒「带的下内边距」与「页面顶部内边距」必须**相等**（各占一半），界线才居中。
  const css = read('app.wxss');
  const blockOf = (src, sel) => {
    const i = src.indexOf(sel);
    return i < 0 ? '' : src.slice(i, src.indexOf('}', i) + 1);
  };
  const numIn = (s, key) => {
    const i = s.indexOf(key);
    if (i < 0) return null;
    let j = i + key.length;
    while (j < s.length && (s[j] < '0' || s[j] > '9')) j++;
    let k = j;
    while (k < s.length && s[k] >= '0' && s[k] <= '9') k++;
    return k > j ? Number(s.slice(j, k)) : null;
  };
  const band = blockOf(css, '.pin-band {');
  const decl = band.split('padding:')[1].split(';')[0].trim();
  const padB = numIn(decl.split(' ').filter(Boolean).slice(-1)[0] || '', '');
  const panelBlk = blockOf(css, '.content-panel {');
  const panelDecl = panelBlk.split('padding:')[1].split(';')[0].trim();
  const padT = numIn(panelDecl.split(' ').filter(Boolean)[0] || '', '');
  equal(padB, padT, '★ 带的下内边距(' + padB + ')必须等于页面顶部内边距(' + padT + ') —— '
    + '否则界线不居中（贴着下面那行）');
  equal(padB + padT, 24, '两半加起来仍是原来那一档 24rpx（总量不变、内容位置不动）');

  // 带下第一块不许自带「到上一块」的上边距（否则下面那半变宽，界线又偏了）
  const topMarginOf = (src, sel) => {
    const blk = blockOf(src, sel);
    if (!blk) return null;
    const ms = blk.indexOf('margin:');
    const mt = blk.indexOf('margin-top:');
    let raw = null;
    if (ms >= 0 && (mt < 0 || ms < mt)) raw = blk.slice(ms + 'margin:'.length).split(';')[0].trim().split(' ')[0];
    else if (mt >= 0) raw = blk.slice(mt + 'margin-top:'.length).split(';')[0].trim();
    if (raw === null) return 0;
    let j = 0;
    while (j < raw.length && (raw[j] < '0' || raw[j] > '9')) j++;
    let k = j;
    while (k < raw.length && raw[k] >= '0' && raw[k] <= '9') k++;
    return k > j ? Number(raw.slice(j, k)) : 0;
  };
  const FIRST = [
    ['pages/dashboard/dashboard.wxss', '.board-sec {', '看板「原料资产」板块'],
    ['pages/dashboard/dashboard.wxss', '.ck-alert {', '看板体检条（有告警时它是第一行）'],
    ['app.wxss', '.std-card {', '物料库列表卡片'],
    ['pages/products/list.wxss', '.list {', '作品集列表'],
    ['pages/mine/mine.wxss', '.stat {', '我的统计卡']
  ];
  FIRST.forEach((pair) => {
    const v = topMarginOf(read(pair[0]), pair[1]);
    ok(v !== null, '找不到 ' + pair[1] + '（' + pair[2] + '）—— 守卫失效，请检查选择器');
    equal(v, 0, '★ ' + pair[2] + ' 自带 ' + v + 'rpx 上边距 —— 界线下面那半会变宽，界线就不在'
      + '两行字中间了（该间距应挪到下边距去）');
  });
});

test('⑧ 奶黄圆角面板：包住分界线以下的全部内容（顶角 44rpx、左右贴边）', () => {
  // 用户 2026-10-05：「奶黄圆角面板（22px 顶弧）包住『原料资产』往下的全部内容，底部毛玻璃栏不变」
  //   + 拍板：左右不要细条（贴边）、圆角 22px（= 44rpx）、四页都这样。
  const css = read('app.wxss');
  const blockOf = (src, sel) => {
    const i = src.indexOf(sel);
    return i < 0 ? '' : src.slice(i, src.indexOf('}', i) + 1);
  };
  const panel = blockOf(css, '.content-panel {');
  ok(panel.length > 0, 'app.wxss 里要有 .content-panel 规则');
  ok(panel.indexOf('border-radius: 44rpx 44rpx 0 0') >= 0,
    '★ 面板顶边两角 44rpx 圆弧（22px）、下边不圆 —— 界线处起弧');
  ok(panel.indexOf('var(--color-bg)') >= 0,
    '面板底色 = 页面底「奶黄」（--color-bg）—— 其它主题与现在同色，零视觉变化');
  ok(panel.indexOf('var(--page-margin)') >= 0,
    '面板自己承担左右页面边距（贴边 ⇒ 两侧不露细条）');
  ok(panel.indexOf('overflow') < 0 && panel.indexOf('transform') < 0 && panel.indexOf('filter') < 0,
    '★ 面板不许有 overflow / transform / filter —— 它装着 fixed 定位的弹层，会被裁掉或失去 fixed 语义');

  const pin = blockOf(css, '.page-wrap.pin-page');
  ok(pin.indexOf('var(--color-band)') >= 0,
    '带页的页面底要走 --color-band（粉帽=樱花粉；其它主题=页面底本身 ⇒ 零变化）—— 面板外围露出的就是它');
  ok(pin.indexOf('padding: 0') >= 0,
    '带页的页面内边距必须归零（左右边距改由面板承担，否则两侧露出细条）');

  // 「包住」的机器化：从面板开始标签起按 view 深度找它的闭合，断言内容落在区间内
  const panelRange = (wxml) => {
    const start = wxml.indexOf('class="content-panel"');
    if (start < 0) return null;
    const openIdx = wxml.lastIndexOf('<view', start);
    let depth = 0;
    let i = openIdx;
    while (i < wxml.length) {
      const o = wxml.indexOf('<view', i + 1);
      const c = wxml.indexOf('</view>', i + 1);
      if (c < 0) return null;
      if (o >= 0 && o < c) {
        const gt = wxml.indexOf('>', o);
        if (wxml.slice(o, gt + 1).indexOf('/>') < 0) depth++;
        i = gt;
      } else {
        if (depth === 0) return [openIdx, c];
        depth--;
        i = c;
      }
    }
    return null;
  };

  const INSIDE = [
    ['看板', 'pages/dashboard/dashboard.wxml', ['board-sec']],
    ['物料库', 'pages/materials/list.wxml', ['std-card']],
    ['作品集', 'pages/products/list.wxml', ['class="list']],
    ['我的', 'pages/mine/mine.wxml', ['class="stat ']]
  ];
  INSIDE.forEach((row) => {
    const w = read(row[1]);
    const r = panelRange(w);
    ok(r, row[0] + ' 缺少 .content-panel 包裹层');
    if (!r) return;
    ok(r[0] > w.indexOf('pin-band-ph'),
      row[0] + ' 的面板必须在固定带占位**之后**（顶边才落在分界线上）');
    row[2].forEach((mark) => {
      const k = w.indexOf(mark, r[0]);
      ok(k > r[0] && k < r[1], row[0] + ' 的内容 ' + mark + ' 没被面板包住');
    });
    ok(w.slice(r[0], r[1]).indexOf('min-height') >= 0,
      row[0] + ' 的面板要给 min-height（内容少时也铺到屏幕底，否则面板下面露出页面底色）');
  });

  // 注入法自检：正例要认得出、反例（没包住）要判得出
  const good = '<view class="pin-band-ph"></view><view class="content-panel"><view class="board-sec"></view></view>';
  const gr = panelRange(good);
  ok(gr && gr[0] > good.indexOf('pin-band-ph') && good.indexOf('board-sec', gr[0]) < gr[1],
    '自检失败：正例（包住）没被识别');
  const bad = '<view class="content-panel"></view><view class="board-sec"></view>';
  const br = panelRange(bad);
  ok(br && bad.indexOf('board-sec', br[0]) > br[1],
    '自检失败：内容没被面板包住却判不出 —— 这条守卫没有牙');
});
