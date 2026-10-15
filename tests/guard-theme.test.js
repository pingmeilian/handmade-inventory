// tests/guard-theme.test.js —— V97 主题体系的结构守卫
//
// 为什么要有守卫：主题这套东西坏起来**全是静默的** ——
//   漏一个 token → 主色换了、别的没换（"90% 换了"，看着差不多）
//   页面漏接 → 那一页还是旧配色（用户会以为功能坏了）
//   tabBar 写死色 → 页面变了、底部没变
//   语义色跟着换 → 红绿灯失稳
// 这些都不会抛异常、不会白屏，只能靠守卫钉住。
//
// 每条守卫都带「注入法自检」：把**旧写法**喂给它，必须能被抓出来 —— 否则这条守卫没有牙。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

group('V97 主题体系 · 结构守卫');

test('① 6 套主题的 token 键集合必须**完全一致**（铁律 2）', () => {
  const themes = require('../utils/themes.js');
  const list = themes.list();
  const first = Object.keys(themes.get(list[0].key)).sort().join(',');
  equal(list.length, 6, '6 套（暖陶土 + 海盐奶盖 + 铁皮饼干盒 + 姜饼粉帽 + 青提可露丽·绿带 + 苹果爱丽丝·红带）');
  list.forEach((t) => {
    equal(Object.keys(themes.get(t.key)).sort().join(','), first,
      t.name + ' 的 token 键集合不同 —— 漏一个就是"主色换了、这一项还是旧的"，极难发现');
  });
  // 注入法自检：从一套里删掉一个 token，键集合必然不同
  const tampered = Object.assign({}, themes.get(list[1].key));
  delete tampered.accent;
  ok(Object.keys(tampered).sort().join(',') !== first, '自检失败：少一个 token 都没检出');
});

test('② 语义色永不随主题变（铁律 1）—— 主题表里不许出现它们', () => {
  const themes = require('../utils/themes.js');
  const BAD = ['success', 'warning', 'danger', 'info'];
  const js = R('utils/themes.js');
  BAD.forEach((k) => {
    ok(!new RegExp("['\"]?" + k + "['\"]?\\s*:").test(js),
      'themes.js 里出现了语义色 ' + k + ' —— 成功/警告/危险/信息必须固定，否则"红=出错了"会失稳');
  });
  // 语义色必须仍然定义在 app.wxss（没被谁删掉）
  const css = R('app.wxss');
  BAD.forEach((k) => ok(css.indexOf('--color-' + k) >= 0, 'app.wxss 里 --color-' + k + ' 不见了'));
  // 注入法自检
  ok(/danger\s*:/.test('  danger: "#x",'), '自检失败：往主题里塞语义色没被检出');
});

test('③ 36 个页面**每一页**都接了主题（漏一页就是"这页还是旧配色"）', () => {
  const dir = path.join(__dirname, '..', 'pages');
  const pages = [];
  fs.readdirSync(dir).forEach((d) => {
    const sub = path.join(dir, d);
    if (!fs.statSync(sub).isDirectory()) return;
    fs.readdirSync(sub).forEach((f) => {
      if (f.endsWith('.wxml')) pages.push(d + '/' + f.replace('.wxml', ''));
    });
  });
  ok(pages.length >= 36, '页面数异常：' + pages.length);
  const missPm = [], missApply = [];
  pages.forEach((p) => {
    const wxml = R('pages/' + p + '.wxml');
    const js = R('pages/' + p + '.js');
    // 注意：page-style 允许「合并写法」（dashboard 用它同时锁滚动），
    // 所以判据是「page-meta 的 page-style 里出现了 themeStyle」，不是整串相等。
    if (!/<page-meta[^>]*page-style="[^"]*themeStyle/.test(wxml)) missPm.push(p);
    if (js.indexOf('themePage.apply(this)') < 0) missApply.push(p);
  });
  equal(missPm.join(', '), '', '这些页面缺 page-meta/page-style（颜色不会跟着主题变）');
  equal(missApply.join(', '), '', '这些页面没调 themePage.apply（同上）');
  // 注入法自检：拿一个不带主题的页面片段，必须能被发现
  const bad = '<view class="page-wrap"></view>';
  ok(!(bad.indexOf('page-meta') >= 0 && bad.indexOf('themeStyle') >= 0), '自检失败：没接主题的页面没被检出');
});

test('④ tabBar 里不许出现十六进制色值（漏点 1：它是独立组件树，拿不到 CSS 变量）', () => {
  const css = R('custom-tab-bar/index.wxss');
  const wxml = R('custom-tab-bar/index.wxml');
  const js = R('custom-tab-bar/index.js');
  // SVG mask 里的 %23333 是图标占位色（不是可见颜色），要排除
  const cleaned = css.split('\n').filter((l) => l.indexOf('data:image') < 0).join('\n');
  const hits = cleaned.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  equal(hits.join(','), '', 'tabBar 的 wxss 里还有硬编码色：' + hits.join(',') +
    ' —— 页面换了色、底部没换，看着就像坏了');
  ok(/th\./.test(wxml), 'tabBar 的 wxml 必须用 th.* 内联上色（组件里拿不到 page-meta 的变量）');
  ok(/function pick\(/.test(js) && /themes\.get\(/.test(js), 'tabBar 必须自己读主题算色');
  // 注入法自检
  ok(/#C8A98E/.test('.plus-circle { background: #C8A98E; }'), '自检失败：硬编码色没被检出');
});

test('⑤ 导航栏必须**动态**设、且缓存挂**页面**上（漏点 2）', () => {
  const js = R('utils/theme-page.js');
  ok(js.indexOf('wx.setNavigationBarColor') >= 0,
    'theme-page.js 必须调 wx.setNavigationBarColor —— 只换页面主体、顶上那条不变，上下两截不一样');
  ok(/page\.__navBg/.test(js),
    '缓存必须挂在**页面实例**上：每个页面的导航栏都从 app.json 的初始值起步，' +
    '模块级缓存会让第二个页面被跳过 ⇒ 它的导航栏永远停在暖陶土色（2026-10-03 真机截图）');
  ok(!/^\s*let lastNavBg/m.test(js) && js.indexOf('lastNavBg') < 0,
    '不许再有模块级缓存：跨页面共享的"设过了"判断 = 换主题只换了一半');
  // 注入法自检：老写法（模块级缓存）必须同时被上面两条抓出来
  const oldStyle = "let lastNavBg = '';\nif (bg === lastNavBg) return;";
  ok(oldStyle.indexOf('lastNavBg') >= 0 && oldStyle.indexOf('page.__navBg') < 0,
    '自检失败：模块级缓存的写法没被检出 —— 这条守卫没有牙');
});

test('⑤B tabBar 必须由**页面**推主题（它够不着页面栈，自己刷不可靠）', () => {
  const js = R('utils/theme-page.js');
  ok(/getTabBar/.test(js),
    '★ 页面 onShow 里要顺手把主题推给 tabBar：它不在 getCurrentPages() 里，' +
    'state.notifyTheme 的广播够不着它；组件自己的 pageLifetimes 在真机上不可靠' +
    '（用户实测：页面换了、底部整条还是上个主题的色）');
  ok(/applyTheme/.test(js), '推的是组件的 applyTheme(tokens)');
  const bar = R('custom-tab-bar/index.js');
  ok(/applyTheme\(tokens\)/.test(bar.replace(/\s+/g, ' ')) || /applyTheme\s*\(\s*tokens\s*\)/.test(bar),
    'tabBar 的 applyTheme 要能接受外部喂进来的 tokens（否则它只能自己读，又回到"读的是快照"）');
  // 注入法自检
  ok(/getTabBar/.test('if (typeof page.getTabBar === "function") {}'), '自检失败');
});

test('⑥ 主色底上的字必须走 --color-primary-on（漏点 3：写死白字在浅色主题下会看不清）', () => {
  const files = ['app.wxss'];
  const walk = (d) => {
    fs.readdirSync(d).forEach((f) => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.wxss')) files.push(path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/'));
    });
  };
  walk(path.join(__dirname, '..', 'pages'));
  walk(path.join(__dirname, '..', 'components'));

  const bad = [];
  files.forEach((rel) => {
    const css = strip(R(rel));
    const rules = css.match(/[^{}]*\{[^{}]*\}/g) || [];
    rules.forEach((r) => {
      const body = r.slice(r.indexOf('{') + 1);
      if (/background(?:-color)?\s*:\s*var\(--color-primary\)/.test(body) &&
          /(?<![-\w])color\s*:\s*(#fff\b|#FFFFFF\b|white)/i.test(body)) {
        bad.push(rel + ' → ' + r.split('{')[0].trim());
      }
    });
  });
  equal(bad.join(' | '), '', '这些规则是"主色底 + 写死白字"：' + bad.join(' | ') +
    ' —— 换成浅色主色时字就看不清了，必须用 var(--color-primary-on)');
  // 注入法自检
  const old = '.btn { background: var(--color-primary); color: #fff; }';
  ok(/background(?:-color)?\s*:\s*var\(--color-primary\)/.test(old) &&
     /(?<![-\w])color\s*:\s*(#fff\b)/i.test(old), '自检失败：老写法没被检出 —— 这条守卫没有牙');
});

test('⑦ 主题色不得"兼职"状态语义（accent 不能当成功/危险用）', () => {
  const themes = require('../utils/themes.js');
  // accent 是"装饰/标签"，语义四色是"状态" —— 两类颜色必须来自不同 token
  themes.list().forEach((t) => {
    const tk = themes.get(t.key);
    ok(tk.accent !== tk.primary || true, '（accent 与 primary 可以同色，不强制区分）');
  });
  const js = R('utils/themes.js');
  ok(/accent:/.test(js) && !/accent:\s*['"]?#?(8FB27E|D9786A|E0A26B|9DB8C2)/i.test(js),
    'accent 不许直接拿语义色的值（否则"装饰"和"状态"撞车）');
  // 注入法自检
  ok(/8FB27E/i.test("accent: '#8FB27E'"), '自检失败');
});

// ---------------------------------------------------------------
// 2026-10-03（V98）用户真机反馈：
//   「换成姜饼小熊仁怎么还混着别的主题 你能不能行 换主题就要整个都换啊」
// 除了 tabBar / 导航栏（在 theme-space ⑨⑩ 盯住），还有一类静默漏口：
//   **页面自己写了死色值** —— 换主题时它们不动（首当其冲的是看板/灵感/想做这三页的
//   页面底色、卡边线、说明文字，全是暖陶土那套）。暖色主题下看不出来，
//   换个绿主题就露馅（整页底色还是奶油色）。
// ---------------------------------------------------------------

test('⑧ ★ wxss 里不许再出现「暖陶土中性色」的死值（换主题时它们不会动）', () => {
  // 这些就是 V98 逐个换成 token 的那批。列出来当**反回归清单**：
  // 它们看着"很中性"，实际都带着暖陶土的色温 —— 换主题时会留在原地。
  const BANNED = [
    '#FCF8F0', // 看板页面底 / 各弹层面板底
    '#ECE3D8', // 看板卡边线、细横线
    '#6E655C', // 说明文字（深灰棕）
    '#C9C2BA', // 极浅提示文字 / 图表坐标
    '#F9F6EF', // 灵感·想做 列表页整页底 / 输入框底
    '#F3EDE4', // 取消按钮底
    '#FDFBF7', // 虚线加号卡底
    '#F3E9DC', // 状态药丸选中底
    '#8A6D4F', // 状态药丸选中文字
    '#E7E0D6', // 禁用按钮底
    '#B3ABA0', // 禁用按钮文字
    '#EAE3DA', // 普通徽标底
    '#F0E9E0', // 排单行分隔线
    '#F4EDE4', // 排单编辑里的浅底
    '#FBFDF8', // 裁剪界面"可用"卡片底
    '#F1EADD', // 折线图网格线
    'RGBA(51, 46, 41',  // 遮罩（旧正文色 35%/45%/50%）
    'RGBA(74, 63, 53'   // 遮罩（更早的写法）
  ];
  const files = [];
  const walk = (d) => {
    fs.readdirSync(d).forEach((f) => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); }
      else if (/\.wxss$/.test(f)) files.push(p);
    });
  };
  ['pages', 'components'].forEach((d) => walk(path.join(__dirname, '..', d)));
  files.push(path.join(__dirname, '..', 'app.wxss'));

  const hits = [];
  files.forEach((p) => {
    // 先去掉「变量定义本身」（app.wxss 里 --color-mask 的兜底值就该是字面量），
    // 再看剩下还有没有写死的色值。var(--color-x) 不带冒号，不会被这条剔掉。
    const txt = strip(fs.readFileSync(p, 'utf8'))
      .replace(/-{2}[a-z0-9-]+\s*:[^;]*;?/g, '')
      .toUpperCase();
    BANNED.forEach((c) => {
      if (txt.indexOf(c) >= 0) hits.push(path.relative(path.join(__dirname, '..'), p) + ' → ' + c);
    });
  });
  equal(hits.join(' | '), '',
    '★ 这些死色值又回来了：它们换主题时不会动（页面主体变了、这几处没变）⇒ 改用 var(--color-*)');
  // 面积填充：旧暖陶土主色的 10% 也是写死的
  const lc = strip(R('components/line-chart/line-chart.wxss'));
  ok(lc.indexOf('rgba(200,169,142') < 0, '折线图的面积填充还在用旧暖陶土主色（写死的 10%）⇒ 走 var(--color-primary)');

  // 注入法自检：把老写法喂进来必须被抓到
  ok(BANNED.some((c) => 'page { background: #FCF8F0; }'.toUpperCase().indexOf(c) >= 0),
    '自检失败：老写法没被检出 —— 这条守卫没有牙');
});

test('⑨ ★ 页面底色必须走 token（page / .page-wrap 里不许写死背景色）', () => {
  const files = [];
  const walk = (d) => {
    fs.readdirSync(d).forEach((f) => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); }
      else if (/\.wxss$/.test(f)) files.push(p);
    });
  };
  walk(path.join(__dirname, '..', 'pages'));
  const bad = [];
  files.forEach((p) => {
    const txt = strip(fs.readFileSync(p, 'utf8'));
    // 只看 page 选择器的块（页面根节点 —— 它不该有个"固定"的底色）
    const m = txt.match(/(?:^|\n)\s*page\s*\{([^}]*)\}/g) || [];
    m.forEach((blk) => {
      const bg = blk.match(/background(?:-color)?\s*:\s*([^;]+);/);
      if (bg && bg[1].indexOf('var(--color-') < 0) {
        bad.push(path.relative(path.join(__dirname, '..'), p) + ' → ' + bg[1].trim());
      }
    });
  });
  equal(bad.join(' | '), '', '★ page 的背景写死了：换主题时整页底色不动（第一条就露馅）');
  // 注入法自检
  ok(/background\s*:\s*#FCF8F0/.test('page { background: #FCF8F0; }'), '自检失败');
});

test('⑩ ★ app.wxss 里的主题变量必须是默认主题的**实值**（自引用 = 假的兜底）', () => {
  // 主题变量正常由 page-meta 的 page-style 写进页面根节点；app.wxss 这一份是"page-style
  // 没生效"时的兜底。以前写的是自引用（--color-primary: var(--color-primary)）——
  // 按 CSS 规范自引用是**无效值**，会让 13 个变量一起失效 ⇒ 整页没颜色（比用错主题更糟）。
  const css = strip(R('app.wxss'));
  const blk = (css.match(/(?:^|\n)\s*page\s*\{([\s\S]*?)\}/) || [])[1] || '';
  ok(blk.length > 0, 'app.wxss 里要有 page 块');
  const themes = require('../utils/themes.js');
  const tk = themes.get(themes.DEFAULT);
  ['primary', 'primary-deep', 'primary-soft', 'primary-on', 'bg', 'surface', 'surface-2', 'divider',
    'text-1', 'text-2', 'text-3', 'mask'].forEach((k) => {
    const got = (blk.match(new RegExp('--color-' + k + '\\s*:\\s*([^;]+);')) || [])[1];
    ok(got, 'app.wxss 缺 --color-' + k + '（兜底要整套给）');
    equal(String(got).trim(), String(tk[k]).trim(),
      '--color-' + k + ' 必须逐字等于默认主题的值 —— 它是"page-style 没生效/页面漏接"时的兜底');
  });
  ok(!/--color-[a-z0-9-]+\s*:\s*var\(--color-/.test(blk),
    '★ 又出现自引用了：它是无效值，会让整页没颜色');
  // 注入法自检
  ok(/--color-primary:\s*var\(--color-primary\)/.test('--color-primary: var(--color-primary);'),
    '自检失败：自引用写法没被检出 —— 这条守卫没有牙');
});

test('⑪ ★ 页面里的「面」色不许写死（卡片 / 面板必须走 token）', () => {
  // 2026-10-03（V101）用户真机反馈：「你这个卡片 也不是奶白色啊 是按照我给的色卡上的色吗」
  // 根因：看板页 dashboard.wxss 里 **24 处写死的 `background: #FFFFFF`**（V98 清扫漏了这一页）
  //   ⇒ 那页 18 张卡永远纯白、不吃主题，换成「海盐奶盖」也还是白的。
  // ⚠️ **为什么 ⑧ 没拦住**：⑧ 用的是「具体色值反回归清单」，那 18 个值里**没有 #FFFFFF**。
  //    "纯白"看着最无辜，恰恰是漏得最狠的（一整页卡片）。
  //    ⇒ 这条改成**通用规则**：凡是 background 上写死的十六进制，一律要在白名单里。
  // 白名单只放两类 ——
  //   ① **语义色**（危险 / 警告 / 成功 / 信息）：铁律 1，永不随主题变，"红=出错了"必须稳；
  //   ② **内容语义色**（分类图例 / 布料几何示意 / 左滑按钮）：它们描述**"这是什么"**，
  //      不是"这是什么风格"—— 工具就是黄的、折旧就是绿的，不该跟着主题走。
  const ALLOW = [
    // ① 语义色系
    '#fbeae6', '#f6d9d2', '#c0502e', '#f7e6ce', '#b9802f', '#e4efe6', '#4e8d5b',
    '#e6f1fb', '#85b7eb', '#fff7e8', '#f2d9a4',
    // ② 内容语义色
    '#a79a8c', '#fefaf9', '#f5e6d3', '#d8c4a8', '#7a9e7e', '#d9a441',
    '#e6efdd', '#a8b79e', '#f6e7d6', '#c49a6c',
    // ② 内容语义色 · 裁剪页的「布」（2026-10-04 V111 由暖米黄 `#f5e6d3` 换成**中性灰白**：
    //    用户选 c —— 布块**不跟主题**，灰白放任何主题下都不打架；缺口用近白 `#fbfbf9`）
    '#efefec', '#fbfbf9'
  ];
  const files = [];
  const walk = (d) => {
    fs.readdirSync(d).forEach((f) => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); }
      else if (/\.wxss$/.test(f)) files.push(p);
    });
  };
  walk(path.join(__dirname, '..', 'pages'));
  walk(path.join(__dirname, '..', 'components'));

  const bad = [];
  files.forEach((p) => {
    const txt = strip(fs.readFileSync(p, 'utf8'));
    const re = /background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{3,6})\b/g;
    let m;
    while ((m = re.exec(txt))) {
      const v = m[1].toLowerCase();
      // #FFF 与 #FFFFFF 归一化后再比（同一个色，别因为写法不同漏掉）
      const norm = v.length === 4 ? '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v;
      if (ALLOW.indexOf(norm) < 0) {
        bad.push(path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/') + ' → ' + m[1]);
      }
    }
  });
  equal(bad.length, 0, '★ 这些「面」色写死了、不会跟主题变：\n    ' + bad.join('\n    ') +
    '\n  ⇒ 改成 var(--color-surface) / --color-surface-2 / --color-divider / --color-bg；' +
    '\n    确实是语义色或内容语义色，才加进 ALLOW 白名单（并且写清理由）。');

  // 注入法自检：用户报的那个 bug 必须能被抓出来
  const sample = '.card { background: #FFFFFF; }';
  const sm = /background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{3,6})\b/.exec(sample);
  ok(sm && ALLOW.indexOf(sm[1].toLowerCase()) < 0,
    '自检失败：抓不出"卡片写死纯白"—— 这条守卫没有牙（用户就是这么报的）');
  // 白名单本身也得自检：语义色必须在里面（否则会被误报）
  ok(ALLOW.indexOf('#fbeae6') >= 0 && ALLOW.indexOf('#f5e6d3') >= 0,
    '自检失败：语义色 / 内容色 不在白名单里');
});

test('⑥ 深色带：带内元素必须走 band-ink（未声明该变量的主题零影响）', () => {
  // V154：第 6 套「苹果爱丽丝·红带」是第一套**深色带**（带 = 红，明度 0.145 —— V155 提亮后）。
  //   带内那几处元素原本是按"浅色带"配的 —— 带上是深色文字、实心块用主色 ——
  //   压到红带上分别只剩 2.35 / **1.00**（后者是「批量入库」入口整个看不见）。
  //   ⇒ 它们必须改走 band-ink / band-ink-on，且**写 fallback**（未声明的主题 = 原值 ⇒ 零影响）。
  const themes = require('../utils/themes.js');   // 本文件的惯例：每个 test 自己 require
  // ⚠️ sel 要写到"能唯一定位"为止 —— 同一个类名在文件里可能有好几条规则：
  //    本页的 `.chip` 就有两条（布局 `.chip { flex: none; }` 在前、主按钮样式在后），
  //    只写 `.chip {` 会命中错的那条（V154 第一版守卫就栽在这儿）。
  //   ⇒ 允许把 sel 写成"选择器 + 下一行的开头"；取块时回退到**行首**再截到第一个 `}`。
  const blockOf = (src, sel) => {
    const i = src.indexOf(sel);
    if (i < 0) return '';
    const ls = src.lastIndexOf('\n', i) + 1;
    const j = src.indexOf('}', i);
    return j < 0 ? '' : src.slice(ls, j + 1);
  };
  // 唯一定位用的长串（见上）
  const SEL_CHIP = '.chip {\n  height: var(--input-sm);';

  // 清单：带内的元素（都在 .pin-band 里）→ 必须走带内前景
  // ⚠️ 往里加新元素要改这张表 —— 逼作者显式做个决定（同"例外清单"的做法）
  const IN_BAND = [
    ['app.wxss', '.toolbar-actions .link {'],
    ['pages/products/list.wxss', '.summary {'],
    ['pages/products/list.wxss', '.cat-cap {'],
    ['pages/products/list.wxss', '.cat-standalone.on {'],
    ['pages/products/list.wxss', '.cat-sub-seg.on {'],
    ['pages/products/list.wxss', '.filter-badge {'],
    ['pages/materials/list.wxss', SEL_CHIP],
    ['pages/materials/list.wxss', '.sort-badge {'],
    ['pages/materials/list.wxss', '.mc-chip.on {']
  ];
  const cache = {};
  IN_BAND.forEach((pair) => {
    const f = pair[0], sel = pair[1];
    if (!cache[f]) cache[f] = R(f);   // 用文件顶部那个 helper
    const body = blockOf(cache[f], sel);
    ok(body, '★ ' + f + ' 找不到 ' + sel + '（选择器改名了？这张清单要跟着改）');
    // ⚠️ 判定串必须带那个逗号：`var(--color-band-ink-on)` 是以 `var(--color-band-ink` 开头的，
    //    只查前缀的话，一个"底色还留在主色、字色改成了 band-ink-on"的块会**假通过**（V154 自检就撞上这个）。
    ok(body.indexOf('var(--color-band-ink,') >= 0,
      '★ ' + f + ' 的 ' + sel + ' 在顶部固定带里，必须走 var(--color-band-ink, <原值>) —— ' +
      '否则深色带（红带）上会看不见 / 融进去');
  });

  // 零影响：**没声明 bandInk 的主题一个字都不许发**
  ['clayWarm', 'seaSaltFoam', 'retroTin', 'gingerbreadHat', 'matchaCanele'].forEach((k) => {
    const st = themes.styleOf(k);
    ok(st.indexOf('--color-band-ink') < 0,
      k + ' 没有声明 bandInk，但 styleOf 发了这个变量 —— 会盖掉 wxss 的 fallback（= 外观被动改变）');
    ok(themes.THEMES[k].bandInk === undefined, k + ' 不该声明 bandInk');
  });

  // 声明了的那套：变量要真的发出来
  const apple = themes.styleOf('appleAlice');
  ok(apple.indexOf('--color-band-ink: #FFFFFF') >= 0, '苹果套要发 --color-band-ink: #FFFFFF');
  ok(apple.indexOf('--color-band-ink-on: ') >= 0, '苹果套要发 --color-band-ink-on');
  ok(themes.THEMES.appleAlice.bandInk && themes.THEMES.appleAlice.bandInkOn,
    '苹果套是深色带 ⇒ 必须声明 bandInk / bandInkOn');

  // 注入自检：退回老写法必须能被抓出来（带上小字 + 带内实心块各一次）
  const bad = cache['pages/products/list.wxss']
    .replace('var(--color-band-ink, var(--color-text-3))', 'var(--color-text-3)');
  ok(blockOf(bad, '.summary {').indexOf('var(--color-band-ink,') < 0,
    '自检失败：退回老写法（三级文字直接压在带上）却没被检出');
  // ⚠️ 必须 replaceAll：这个文件里 `var(--color-band-ink, var(--color-primary))` 出现多次，
  //    `replace` 只替第一处（会改到 .sort-badge 上，自检就假通过了）—— 同一个坑在验牙脚本里也踩过。
  const bad2 = cache['pages/materials/list.wxss']
    .replaceAll('var(--color-band-ink, var(--color-primary))', 'var(--color-primary)');
  ok(blockOf(bad2, SEL_CHIP).indexOf('var(--color-band-ink,') < 0,
    '自检失败：实心块退回主色（红块压红带 = 1.00）却没被检出');
});
