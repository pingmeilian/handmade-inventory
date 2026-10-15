// tests/themes.test.js —— V97 主题口径（utils/themes.js）
//
// 这个文件盯的是**三条铁律**（见文档仓《19-主题配色方案.md》）：
//   铁律 1  换气质不换信息 —— 语义色永不随主题变
//   铁律 2  一套主题 = 13 个 token 全给，键集合必须一致（漏一个就是"90% 换了"，极难发现）
//   铁律 3  常驻元素必须一起换（在 guard 里盯）
const { test, group, ok, equal, near } = require('./harness.js');
const themes = require('../utils/themes.js');

const TOKEN_KEYS = [
  'primary', 'primary-deep', 'primary-soft', 'primary-on',
  'bg', 'surface', 'surface-2', 'divider',
  'text-1', 'text-2', 'text-3',
  'mask', 'accent'
];

// 相对亮度（WCAG）：⑥ 与 ⑨ 共用，避免两处各写一份、改一处忘一处
const _f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lumOf = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
  return 0.2126 * _f(c[0]) + 0.7152 * _f(c[1]) + 0.0722 * _f(c[2]);
};
const contrastOf = (a, b) => {
  const la = lumOf(a), lb = lumOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

group('V97 主题口径 · 结构与铁律');

test('① 6 套主题，token 键集合**完全一致**（铁律 2）', () => {
  const list = themes.list();
  equal(list.length, 6, '应该是 6 套（暖陶土 + 海盐奶盖 + 铁皮饼干盒 + 姜饼粉帽 + 青提可露丽·绿带 + 苹果爱丽丝·红带）');
  list.forEach((t) => {
    const tokens = themes.get(t.key);
    const keys = Object.keys(tokens).sort();
    equal(keys.length, TOKEN_KEYS.length,
      t.name + ' 的 token 数量不对（应为 ' + TOKEN_KEYS.length + ' 个）');
    equal(JSON.stringify(keys), JSON.stringify(TOKEN_KEYS.slice().sort()),
      t.name + ' 的 token 键集合与其他套不一致 —— 漏一个就会变成"主色换了、别的还是旧的"');
  });
});

test('② 语义色不随主题变（铁律 1：红绿灯必须稳）', () => {
  const bad = ['success', 'warning', 'danger', 'info'];
  themes.list().forEach((t) => {
    const tokens = themes.get(t.key);
    bad.forEach((k) => {
      ok(!(k in tokens),
        t.name + ' 里不该出现语义色 ' + k + ' —— 成功/警告/危险/信息永远固定在 app.wxss');
    });
  });
});

test('③ 兜底：未知 / 空 / 坏值 一律回默认主题，绝不抛异常', () => {
  const def = themes.get(themes.DEFAULT).primary;
  [undefined, null, '', '不存在的主题', 0, {}].forEach((k) => {
    let got = null;
    try { got = themes.get(k); } catch (e) {
      ok(false, 'themes.get(' + JSON.stringify(k) + ') 抛异常了：' + e.message);
      return;
    }
    equal(got.primary, def, 'themes.get(' + JSON.stringify(k) + ') 应回默认主题');
  });
});

test('④ styleOf：输出合法 CSS 变量串，13 个 token 一个不少（给 page-meta page-style 用）', () => {
  const s = themes.styleOf('seaSaltFoam');
  ok(/--color-primary:\s*#[0-9A-Fa-f]{6}/.test(s), '要有 --color-primary（十六进制）');
  ok(/--color-primary-on:\s*(#[0-9A-Fa-f]{6})/.test(s), '要有 --color-primary-on');
  ok(/--color-accent:\s*#[0-9A-Fa-f]{6}/.test(s), '要有 --color-accent（本版新增的 token）');
  ok(/--color-mask:\s*rgba\(/.test(s), '--color-mask 是 rgba');
  // V115/V116/V118：styleOf 除了 13 个 token，还会发**角色变量**（band / chip / fab / highlight / highlight-sub / ring / num-1..3 共 12 个）
  // —— 它们不是 token（不进铁律 2 的键集合），是"这几个位置用哪个 token"的映射结果。
  const vars = s.split(';').map(x => x.trim()).filter(Boolean);
  const ROLE_VARS = ['--color-band', '--color-chip', '--color-chip-on', '--color-fab', '--color-fab-on',
    '--color-highlight', '--color-highlight-on', '--color-highlight-sub', '--color-ring',
    '--color-num-1', '--color-num-2', '--color-num-3'];
  const roleGot = vars.filter(v => ROLE_VARS.indexOf(v.split(':')[0].trim()) >= 0);
  equal(roleGot.length, ROLE_VARS.length, '角色变量应发满 ' + ROLE_VARS.length + ' 个，实际 ' + roleGot.length);
  const tokVars = vars.filter(v => ROLE_VARS.indexOf(v.split(':')[0].trim()) < 0);
  equal(tokVars.length, TOKEN_KEYS.length,
    'token 变量个数应为 ' + TOKEN_KEYS.length + '，实际 ' + tokVars.length);
  // 变量名必须与 app.wxss 里的口径一致（多一个 --color- 前缀或写错名字都会静默失效）
  vars.forEach((v) => {
    const name = v.split(':')[0].trim();
    ok(/^--color-[a-z0-9-]+$/.test(name), '变量名不合规：' + name);
  });
});

test('⑤ 主色 = 用户色板原色（一个字不改，D129/D130 定案）', () => {
  const expect = {
    clayWarm: '#c28e72',     // 暖陶土：项目最初的配色，主色原样照搬（一个字节没改）
    seaSaltFoam: '#583722',  // 海盐奶盖：黑可可当主色（设计稿③「主强调」）
    retroTin: '#8f3d38',     // 铁皮饼干盒：砖红当主色（设计稿「钱与动作」；结构色蓝灰走 text-1）
                             // ⚠️ 这里必须小写：上面那句比的是 toLowerCase()，写大写会假红
    gingerbreadHat: '#e5a383',  // 姜饼粉帽：陶土橘当主色（设计稿「主强调」）
    matchaCanele: '#9bb336',    // 青提可露丽：中绿当主色（用户 2026-10-13 发来的色板）
    // 苹果爱丽丝：色板原色是 #BF0A2D；**用户 2026-10-14 追加要求「红色稍微淡一点点」**
    //   ⇒ 保色相提亮到 #D31035。这是**唯一一条"不是色板原色"的主色**，且是用户点名的、
    //     不是谁顺手改的 —— 所以它仍留在这张表里（改它必须动这一行 = 逼作者显式做个决定）。
    appleAlice: '#d31035'
  };
  Object.keys(expect).forEach((k) => {
    equal(themes.get(k).primary.toLowerCase(), expect[k],
      k + ' 的主色必须是色板里的原色（唯一例外：苹果爱丽丝被用户点名提亮，见上面注释）—— 不许谁顺手改');
  });
});

test('⑥ 主色上的字色能看清（自动择高对比，3 套全部 ≥2.8）', () => {
  // 阈值为什么是 2.8 而不是 3.0：**项目基准就是 2.84** ——
  //   最初那套暖陶土的主色 #C28E72 配白字是 2.84，比 WCAG 大字线（3.0）略低。
  //   那是项目用了很久的原始值，用户 2026-10-04 明确要它当主题 ⇒ 这条判据的职责
  //   是"新主题不许比项目基准更差"，不是"必须达标"（要达标就得压深用户给的色，那条更不允许）。
  const FLOOR = 2.8;
  themes.list().forEach((t) => {
    const tk = themes.get(t.key);
    const c = contrastOf(tk.primary, tk['primary-on']);
    ok(c >= FLOOR, t.name + ' 主色上的字色对比度只有 ' + c.toFixed(2) +
      '（要 ≥' + FLOOR + '，项目基准 2.84）');
  });
  // 注入法自检：基准值本身必须落在合格线内（否则这条守卫会把基准自己判红）
  ok(contrastOf('#C28E72', '#FFFFFF') >= FLOOR,
    '自检失败：项目基准 #C28E72 配白字都过不了，阈值定高了吧');
});

test('⑦ list() 给选择器用的字段齐全（画色块要这几个）', () => {
  themes.list().forEach((t) => {
    ok(t.key && t.name, '每套要有 key 与中文名');
    ok(/^#[0-9A-Fa-f]{6}$/.test(t.primary), t.name + ' 缺 primary');
    ok(/^#[0-9A-Fa-f]{6}$/.test(t.soft), t.name + ' 缺 soft');
    ok(/^#[0-9A-Fa-f]{6}$/.test(t.accent), t.name + ' 缺 accent');
  });
  // 名字必须是用户给的那些（别自己起名）
  const names = themes.list().map(t => t.name);
  ['暖陶土', '海盐奶盖', '铁皮饼干盒', '姜饼小熊仁·粉帽'].forEach((n) => {
      ok(names.indexOf(n) >= 0, '缺了主题「' + n + '」（名字要用用户给的）');
    });
});

test('⑧ 默认主题 = 暖陶土（项目最初那套配色，用户 2026-10-04 指定）', () => {
  equal(themes.DEFAULT, 'clayWarm');
  equal(themes.nameOf(themes.DEFAULT), '暖陶土');
  // get() 只返回 token（13 个），主题名走 list() / nameOf() —— 两者职责不混
  equal(themes.nameOf('不存在'), '暖陶土', '名字取不到也要回默认，不能是 undefined');
});

test('⑨ ★ 浅底 / 中性底必须与主色**同色调**（色相差 >30° 就是"两套主题混着"）', () => {
  // 2026-10-03 真机反馈（用户原话）：「换成姜饼小熊仁怎么还混着别的主题 你能不能行 换主题就要整个都换啊」
  // 根因之一：色板里那格「浅色」跟主色不是同一色调时，我却直接拿它当软底/中性底用 ——
  //   姜饼 = 奶黄主色 + 粉色底（粉正是玫瑰那套的色），看着就是两套主题混着。
  // 判据：任何 token 的色相都要落在主色 ±30° 内（30° 以内人眼读作"同一个色调"）。
  const hueOf = (hex) => {
    const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    let h;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h * 60;
  };
  const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  // 分两组看，因为"跟谁同色调"不一样（这是设计事实，不是将就）：
  //   · 主色系（主色/软底/各种底）→ 必须跟**主色**同色调
  //   · 次级文字（text-2/3）        → 必须跟**正文色 text-1** 同色调
  //     （正文色来自色板的「深色」，本身可能就跟主色不是一路 —— 玫瑰是粉主色 + 棕文字）
  const TINT = ['primary-deep', 'primary-soft', 'bg', 'surface', 'surface-2', 'divider'];
  const MUTED = ['text-2', 'text-3'];

  // ⭐ 两条分支（2026-10-03 加第 10 套「海盐奶盖」时定的）：
  //    · 常规主题：地面色与主色**必须同色调** —— V98 的真机教训，见上
  //    · 撞色主题（主题里声明 contrast: true）：**故意**让底与主色分居冷暖两端 ⇒ 不查色相，
  //      改查"跳过色相之后更需要保证的东西"：主色在页面底与卡面上还读不读得出来。
  //    为什么必须由主题自己声明：机器分不出「有意的撞色」与「意外混进了别的主题的色」，
  //    而这两件事的处理方式正好相反 —— 声明是唯一可靠的区分方式。
  themes.list().forEach((t) => {
    const tk = themes.get(t.key);
    const th = hueOf(tk['text-1']);
    if (t.contrast) {
      // 撞色分支：**整组跳过**色调检查（连次级文字也不再要求与正文同色调），
      // 但主色得能在两种底上当"文字"读出来（主色在本项目要承担标题/数字/选中态，读不出来这套就废了）。
      //
      // 为什么连 MUTED 组也跳过（2026-10-04 加「铁皮饼干盒」时补的）：
      //   那套的设计语言是**双色分工** —— 正文用冷蓝灰 #5C8E9B、说明文字却是暖棕灰 #93826B
      //   （作者标注就这么分的），两者差 158°。上一版的撞色分支只放行了「地面组」，
      //   于是在这里假红。⇒ 撞色主题的定义本就是"刻意不统一色调"，色调检查对它**整体不适用**；
      //   它该被管的是"主色读不读得出来"（下面两条），不是"色相齐不齐"。
      const cBg = contrastOf(tk.primary, tk.bg), cSf = contrastOf(tk.primary, tk.surface);
      ok(cBg >= 4.5, t.name + ' 是撞色主题，主色在页面底上对比度只有 ' + cBg.toFixed(2) +
        '（撞色可以，但主色必须读得出来，要 ≥4.5）');
      ok(cSf >= 4.5, t.name + ' 是撞色主题，主色在卡面上对比度只有 ' + cSf.toFixed(2) + '（要 ≥4.5）');
      return;   // ← 跳过下面的 TINT / MUTED 色调检查
    } else {
      const ph = hueOf(tk.primary);
      TINT.forEach((k) => {
        const d = diff(hueOf(tk[k]), ph);
        ok(d <= 30, t.name + ' 的 ' + k + '（' + tk[k] + '）色相与主色差 ' + d.toFixed(0) +
          '° —— 超过 30° 就是两个色调，界面上会像两套主题混着');
      });
    }
    MUTED.forEach((k) => {
      const d = diff(hueOf(tk[k]), th);
      ok(d <= 30, t.name + ' 的 ' + k + '（' + tk[k] + '）色相与正文色差 ' + d.toFixed(0) + '°');
    });
  });
  // 注入法自检：姜饼原来的"粉底 + 奶黄主色"必须能被抓出来
  ok(diff(hueOf('#f8c8c6'), hueOf('#deb075')) > 30, '自检失败：抓不出"粉底配奶黄主色"');
  ok(diff(hueOf('#b9d9ea'), hueOf('#e9ba6c')) > 30, '自检失败：抓不出"蓝底配焦糖主色"');
  // 自检：撞色分支必须真能放行「海盐奶盖」，否则等于没生效（这条守卫就没有牙）
  const foam = themes.THEMES.seaSaltFoam;
  ok(foam && foam.contrast === true, '自检失败：海盐奶盖没有声明 contrast，撞色分支永远走不到');
  ok(diff(hueOf(foam.tokens.bg), hueOf(foam.tokens.primary)) > 30,
    '自检失败：海盐奶盖本该是"底与主色差很大"的撞色（不差 30° 以上就白声明了）');
});

test('⑩ ★ 卡片必须"浮得起来"（卡面与页面底要有可辨的明度差）', () => {
  // 2026-10-03 用户原话：「为什么这些卡片都是白色的 不能用主题的颜色吗」
  // 起因：卡面 token 值全是 #FFFCFD / #FBFDF8 这种"离纯白一步之遥"的颜色 ⇒ 看着就是白卡片。
  // 早期那 9 套甜品主题的四个"地面色"是按主色混白的阶梯推导的（底 5% / 卡面 13% / 内底 25% / 分隔线 33%）。
  //
  // ⭐ 这条判据先后修过两次口径，两次都是**把手段当成了目的**：
  //    ① 原判「卡面必须比页面底**更深**」—— 那只是"主色混白阶梯"这一种做法的特征，
  //       并不是"卡片浮得起来"的必要条件。奶盖卡是**浮在粉蓝底上面**的（卡面比底**亮**），
  //       层次比谁都清楚，却被原判误杀 ⇒ 改成查「**明度差够不够**」，谁深谁浅不限。
  //    ② 另有「卡面离纯白必须 ≥18」—— 那是**风格判断**（"别太白了"），不是**可用性判断**。
  //       2026-10-04 加「暖陶土」时它又误杀：那套的原始配色就是「奶油纸底 + 近乎纯白的卡」
  //       （#FFFDFA 离纯白只有 7），而这正是它的手工纸感来源、用户点名要的那套；
  //       至于"卡片糊在页面里"那个**真问题**，下面这条明度差已经完整覆盖 ⇒ 删掉"离纯白距离"。
  //    📌 通用句：**「卡片要看得出来」的本质是"卡面与底有差别"，不是"卡面必须够深/够不白"。**
  //       写在判据里的具体数值，要先问一句：**它是在描述目的，还是在描述某个做法的副产品？**
  //
  //    内底同理（下面 g2）：改成"在卡面上或页面底上**至少一处**看得清"
  //    （输入框常常是直接放在页面底上的，并不嵌在卡里 —— 奶盖那套的搜索框就是这种）。
  const MIN_GAP = 0.035;                           // 明度差低于此值，人眼基本读不出层次
  themes.list().forEach((t) => {
    const tk = themes.get(t.key);
    const gap = Math.abs(lumOf(tk.surface) - lumOf(tk.bg));
    ok(gap >= MIN_GAP, t.name + ' 的卡面与页面底明度差只有 ' + gap.toFixed(3) + '（要 ≥' +
      MIN_GAP + '，否则卡片和页面分不开 —— 谁深谁浅不限）');
    const g2 = Math.max(Math.abs(lumOf(tk['surface-2']) - lumOf(tk.surface)),
                        Math.abs(lumOf(tk['surface-2']) - lumOf(tk.bg)));
    ok(g2 >= MIN_GAP, t.name + ' 的内底跟卡面、页面底都太接近（最大差 ' + g2.toFixed(3) +
      '），卡里内嵌的块会看不出来');
  });
  // 注入法自检：必须能抓出"卡面与页面底几乎同亮"（这是原判"必须更深"抓不到的）
  //    ⚠️ 例子要挑"真的分不开"的：纯白 vs #FDFCF9 只差 0.027；
  //    而纯白 vs #FFF9FA 差 0.041，其实**看得出来**（别拿它当反例，会把守卫写成假红）。
  ok(Math.abs(lumOf('#FFFFFF') - lumOf('#FDFCF9')) < MIN_GAP,
    '自检失败：明度差判据没有牙（纯白卡面配近白页面底该被判太近）');
  ok(Math.abs(lumOf('#FFFFFF') - lumOf('#FFF9FA')) >= MIN_GAP,
    '自检失败：0.041 的明度差是看得出来的，不该被判太近');
});

test('⑪ 海盐奶盖：设计稿给的七色必须**各有落点**（一个不剩）', () => {
  // 2026-10-03 用户发来整套设计稿（七色板 + 开发标注图），逐色标了用途；
  // 色值已**像素扫描验证**：矢量稿与标注 100% 一致（与手机截图的 ±2 压缩噪声不同）。
  //   粉蓝 #BCD7DE 页面底 ／ 奶盖 #F7F3E8 卡片 ／ 黑可可 #583722 主强调 ／ 暖灰褐 #A2937F 次级文字
  //   ＋ 浅薄荷 #EDF3F0 输入框底 ／ 薄荷雾 #D5E8EC 缩略图底 ／ 浅奶 #F0EBDE 分隔线
  // 为什么要专门盯：**七色板最容易变成"有定义、没落点"** ——
  //   玫瑰那套的 accent（姜黄）就是这么被漏掉的，用户直接问「你这里有用到棕色和姜黄色吗」。
  const tk = themes.get('seaSaltFoam');
  const SEVEN = {
    '#bcd7de': 'bg（页面底 · 粉蓝）',
    '#f7f3e8': 'surface（卡片 · 奶盖）',
    '#583722': 'primary / text-1（主强调 · 黑可可）',
    '#a2937f': 'text-2（次级文字 · 暖灰褐）',
    '#edf3f0': 'surface-2（输入框底 · 浅薄荷）',
    '#d5e8ec': 'primary-soft（缩略图/图标底 · 薄荷雾）',
    '#f0ebde': 'divider（分隔线 · 浅奶）'
  };
  const vals = Object.keys(tk).map(k => String(tk[k]).toLowerCase());
  Object.keys(SEVEN).forEach((hex) => {
    ok(vals.indexOf(hex) >= 0,
      '海盐奶盖缺了设计稿的 ' + hex + '（' + SEVEN[hex] + '）—— 七色要各有落点，一个不剩');
  });
  // 另两个 token 是**同色系派生**（设计稿没给，13 个 token 必须凑满）：
  //   primary-deep 按下态、text-3 三级文字 —— 都按黑可可/暖灰褐压浅，不引入新色相
  ok(/^#[0-9a-f]{6}$/.test(tk['primary-deep'].toLowerCase()) &&
     /^#[0-9a-f]{6}$/.test(tk['text-3'].toLowerCase()),
    '派生 token 必须是合法十六进制色');
});

test('⑫ ★ 暖陶土 = 项目最初那套配色，色值逐字锁定（它就是"最开始那个"）', () => {
  // 2026-10-04 用户：「主题还是之前的棕色，最开始的那个」，并指定它当**默认主题**。
  // 这套的**全部价值就在于"和当年一模一样"** —— 它是用户对自家界面最原始的印象。
  // ⇒ 它的色值要**钉死**，不许谁"顺手优化一下"（别的主题可以调，这套不行）。
  // 基准值取自 V96（主题体系引入前）的 app.wxss —— 那是它最后一次以硬编码形式存在的版本。
  const tk = themes.get('clayWarm');
  const ORIGINAL = {
    primary: '#c28e72', 'primary-deep': '#a9765c', 'primary-soft': '#f3e6dc', 'primary-on': '#ffffff',
    bg: '#faf6f0', surface: '#fffdfa', 'surface-2': '#f5efe7', divider: '#ede4d9',
    'text-1': '#4a3f35', 'text-2': '#8a7b6d', 'text-3': '#b7aaa0'
  };
  Object.keys(ORIGINAL).forEach((k) => {
    equal(String(tk[k]).toLowerCase(), ORIGINAL[k],
      'clayWarm 的 ' + k + ' 被改动了（' + tk[k] + '）—— 这套要原样照搬，不许调');
  });
  equal(String(tk.mask).replace(/\s/g, ''), 'rgba(74,63,53,0.40)', 'mask 也要原样');
  // accent 是**唯一"补"出来的 token**（原配色没有它，V97 才引入这个键）：
  // 取原色板自带的奶油黄 --cat-butter，不引入外来色。见 themes.js 里的说明。
  equal(String(tk.accent).toLowerCase(), '#e7d6a2', 'accent 应取原色板自带的奶油黄');
  // 注入法自检：随便改一个值必须能被抓出来（证明上面那串真的在比，不是走个过场）
  const tampered = Object.assign({}, tk, { bg: '#FBF7F1' });
  ok(String(tampered.bg).toLowerCase() !== ORIGINAL.bg, '自检失败：色值改动没被检出');
});

// ============================================================
// V114 · 第 4 套「姜饼小熊仁·粉帽」（用户发设计稿《姜饼小熊仁·粉帽分屏》）
//
// 用户附加的两条硬约束（原话）：
//   「背景的拼色只是颜色，不是结构，只放在底部，不改变任何东西」
//   —— 设计稿里的"分屏"是**顶部色带 + 内容上浮压线**（V104/V106 那次翻车的做法），
//      用户点名不要结构：樱花粉只铺在**背景的底部**，纯颜色层（page-style 的背景渐变），
//      页面不新增任何元素、内容不上浮、导航栏/tabBar 一概不动。
// ============================================================

test('⑬ 姜饼粉帽：设计稿的色**各有落点**（一个不剩）+ 拼色只走 bgSplit', () => {
  const tk = themes.get('gingerbreadHat');
  const MAP = {
    '#e5a383': 'primary（主强调 · 陶土橘 —— 选中chip/标签/部分数字）',
    '#8b7069': 'text-1（结构文字 · 摩卡棕 —— 与主色双色分工，同铁皮饼干盒）',
    '#deb075': 'accent（次强调 · 姜黄 —— 交错数字）',
    '#fbf4e4': 'bg（页面底 · 米黄）',
    '#fffcf5': 'surface（卡片 · 奶白）',
    '#f4e8d2': 'surface-2（输入框/chip底）',
    '#f6ddd4': 'primary-soft（缩略图/图标底 · 粉调）',
    '#b3a08b': 'text-2（次级文字）',
    '#c4b49c': 'text-3（三级文字/tabBar未选中）'
  };
  const vals = Object.keys(tk).map(k => String(tk[k]).toLowerCase());
  Object.keys(MAP).forEach((hex) => {
    ok(vals.indexOf(hex) >= 0, '姜饼粉帽缺了设计稿的 ' + hex + '（' + MAP[hex] + '）');
  });
  // ⭐ 樱花粉 #F8C8C6 的落点是**背景拼色**（bgSplit），不是 token：
  //    它只出现在"背景底部那条纯颜色"里 —— 铺进 token 就会染到卡片/按钮上，
  //    那就成了"到处都是粉"，不是用户要的"只放在底部"。
  const th = themes.THEMES.gingerbreadHat;
  ok(th && th.bgSplit && String(th.bgSplit.color).toLowerCase() === '#f8c8c6',
    '樱花粉必须走 bgSplit（背景底部拼色），不该出现在任何 token 里');
  // 粉帽在顶部（设计稿的色带在顶 —— 用户 2026-10-04 深夜纠错：「你看没看见我要的粉色是在顶部？
  //    会不会看图？」—— 上一轮我照着他上一条消息里「只放在底部」的字面做了，没回头看图。
  //    文字与图打架：以图为准，或先问一句。
  // V116 口径变更：粉色的"范围"不再是屏高百分比，而是**固定区的下沿**（用户 2026-10-05：
  //   「固定住的部分背景是粉色，再往下就是奶黄色」）⇒ 粉由固定带自己承担，见 band 角色。
  ok(!('at' in th.bgSplit) && !('side' in th.bgSplit),
    '拼色不再用 at/side（屏高比例）—— 范围改由固定带的高度决定');
  equal(vals.indexOf('#f8c8c6'), -1, '樱花粉不许混进 13 个 token —— 拼色只是背景');
  // 其余三套都是纯色背景，没有 bgSplit（"有的主题纯色、有的拼色，主题自己的属性"）
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    ok(!themes.THEMES[k].bgSplit, k + ' 不该有 bgSplit（拼色是这套的设计，不是每套都有）');
  });
});

test('⑭ 拼色的实现：改为固定带的底色（口径 V116 变更），仍是"纯颜色"', () => {
  const fs = require('fs');
  const path = require('path');
  const style = themes.styleOf('gingerbreadHat');
  // V116 口径变更：**不再**用页面背景渐变（那条"按屏高比例"的粉带已废）——
  //   粉现在是**固定带**的底色（`.pin-band` 走 `--color-band`），范围 = 固定区高度。
  ok(style.indexOf('background-image') < 0, '拼色不再走页面背景渐变');
  ok(style.indexOf('--color-band:') >= 0, 'styleOf 要发 --color-band（固定带的底色）');

  // 其余三套的 styleOf 不得带任何背景图 —— 纯色主题就是纯色
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    ok(themes.styleOf(k).indexOf('background-image') < 0,
      k + ' 是纯色背景主题，styleOf 不该带 background-image');
  });

  // 「不是结构」的机器化：bgSplit 只允许活在 themes.js（数据）与 theme-page.js（导航栏配套），
  // 任何 wxml / wxss 都不许出现它 —— 一出现就说明有人开始搭"结构"了
  const walk = (dir, out) => {
    fs.readdirSync(dir).forEach((f) => {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) walk(fp, out);
      else if (/\.(wxml|wxss)$/.test(f)) out.push(fp);
    });
    return out;
  };
  const files = walk(path.join(__dirname, '../pages'), [])
    .concat([path.join(__dirname, '../app.wxss')]);
  files.forEach((fp) => {
    ok(fs.readFileSync(fp, 'utf8').indexOf('bgSplit') < 0,
      fp + ' 里出现了 bgSplit —— 拼色不许变成页面结构/样式规则');
  });
  // 顶部的拼色要跟**导航栏**连成一体（导航栏米黄 + 固定带粉 = 断成两截）
  ok(fs.readFileSync(path.join(__dirname, '../utils/theme-page.js'), 'utf8').indexOf('bgSplit') >= 0,
    'theme-page.js 要把拼色喂给导航栏 —— 常驻元素配套教训第 4 次');
});
// ============================================================
// V115 · 主题「角色分工」（用户 2026-10-05：「严格按照我给你的截图来调整配色？
//        手作空间按钮和下面的圆形加号是棕色的」）
//
// 设计稿的四色是**分工**而不是"一套通用色"：摩卡棕=结构/深色按钮与胶囊、
// 陶土橘=主强调、姜黄=次强调、樱花粉=色带/点睛卡。
// 项目现在是"一套 token 通用" ⇒ 橘色到处跑、姜黄没上场。
// 做法：主题加一层**可选的角色映射**（roles），**默认值 = 现状** ⇒ 其它三套零影响。
// ============================================================

test('⑮ 角色分工：默认 = 现状（其它主题零影响），姜饼粉帽按设计稿', () => {
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    const tk = themes.get(k), r = themes.roles(k);
    equal(r.chip, tk.primary, k + ' 未声明 roles ⇒ 胶囊底必须仍是 primary（零影响）');
    equal(r.chipOn, tk['primary-on'], k + ' 胶囊字色默认 primary-on');
    equal(r.fab, tk.primary, k + ' FAB 底默认仍 primary');
    equal(r.fabOn, tk['primary-on'], k + ' FAB 加号默认 primary-on');
    equal(r.highlight, tk.surface, k + ' 高亮卡默认仍 surface（=现状）');
    equal(r.highlightOn, tk['text-3'], k + ' 高亮卡字色默认 text-3（=现状）');
    equal(r.num1, tk.primary, k + ' 数字三色默认都是 primary');
    equal(r.num2, tk.primary, '');
    equal(r.num3, tk.primary, '');
  });

  const g = themes.roles('gingerbreadHat');
  equal(g.chip, '#8B7069', '手作空间胶囊底 = 摩卡棕（设计稿：棕实底 + 米黄字）');
  equal(g.chipOn, '#FBF4E4', '胶囊字色 = 米黄');
  equal(g.fab, '#8B7069', '圆形加号底 = 摩卡棕（用户原话：下面的圆形加号是棕色的）');
  equal(g.fabOn, '#F8C8C6', '加号本身 = 樱花粉（设计稿：棕圆 + 粉加号）');
  equal(g.highlight, '#F8C8C6', '「还没有排单」空态卡 = 樱花粉实底');
  equal(g.highlightOn, '#8B7069', '空态卡字色 = 摩卡棕');
  equal(g.num1, '#E5A383', '数字色1 = 陶土橘（原料组）');
  equal(g.num2, '#DEB075', '数字色2 = 姜黄（成品组）');
  equal(g.num3, '#8B7069', '数字色3 = 摩卡棕（营收组第三卡）');

  const s = themes.styleOf('gingerbreadHat');
  ['--color-chip', '--color-chip-on', '--color-fab', '--color-fab-on',
    '--color-highlight', '--color-highlight-on', '--color-num-1', '--color-num-2', '--color-num-3'
  ].forEach((v) => {
    ok(s.indexOf(v + ':') >= 0, 'styleOf 必须把 ' + v + ' 发出去（否则页面上静默失效）');
  });
  const r0 = themes.roles('不存在的主题');
  ok(r0.chip && r0.fab && r0.highlight && r0.num1, 'roles 对坏 key 也要回默认主题的角色');
});

test('⑯ 分工要真的落在界面上：胶囊 / FAB / 空态卡 / 数字 四处', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const blockOf = (css, sel) => {
    const i = css.indexOf(sel);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };

  const app = read('app.wxss');
  const pill = blockOf(app, '.space-pill.on');
  ok(pill.indexOf('var(--color-chip)') >= 0, '手作空间选中胶囊必须走 --color-chip（棕）');
  ok(pill.indexOf('var(--color-chip-on)') >= 0, '胶囊字色走 --color-chip-on');
  ok(pill.indexOf('var(--color-primary)') < 0, '胶囊底不许再直接用 primary');

  const tw = read('custom-tab-bar/index.wxml');
  ok(tw.indexOf('th.fab') >= 0 && tw.indexOf('th.fabOn') >= 0,
    '圆形加号必须走 th.fab / th.fabOn（棕底 + 粉加号）');
  ok(read('custom-tab-bar/index.js').indexOf('fab:') >= 0, 'tabBar 的 pick() 要给出 fab / fabOn');

  const dw = read('pages/dashboard/dashboard.wxss');
  ok(blockOf(dw, '.cm-empty').indexOf('var(--color-highlight)') >= 0,
    '空态「还没有排单」卡要走 --color-highlight');
  ok(dw.indexOf('var(--color-highlight-on)') >= 0, '空态卡字色走 --color-highlight-on');
  ok(dw.indexOf('var(--color-num-1)') >= 0 && dw.indexOf('var(--color-num-2)') >= 0 &&
     dw.indexOf('var(--color-num-3)') >= 0, '数字三色都要被用上（橘 / 黄 / 棕）');

  const fake = '.space-pill.on{background:var(--color-primary);}';
  ok(blockOf(fake, '.space-pill.on').indexOf('var(--color-chip)') < 0,
    '自检失败：改回 primary 却没被检出 —— 这条守卫没有牙');
});
test('⑰ 兜底：tabBar 取不到 roles 也不许抛错（防"新旧文件混搭"白屏）', () => {
  // 2026-10-05 真机/工具白屏排查：若工具侧存在"旧 themes.js + 新 tabBar"的混搭编译缓存，
  // `themes.roles` 会不存在 ⇒ 取色抛错 ⇒ tabBar 组件起不来 ⇒ **tab 页整页白屏**。
  // 这条把"退回 primary 也要能画出来"钉住：宁可颜色退一步，也不许白屏。
  const stub = require('./wx-stub.js');
  stub.resetStorage();
  const store = require('../utils/store.js');
  store.ensureSeed();
  const themes = require('../utils/themes.js');
  const real = themes.roles;
  delete themes.roles;                       // ���拟"旧版 themes.js"
  try {
    let cfg = null;
    const orig = global.Component;
    global.Component = (o) => { cfg = o; return o; };
    delete require.cache[require.resolve('../custom-tab-bar/index.js')];
    require('../custom-tab-bar/index.js');
    global.Component = orig;
    const inst = Object.assign({ data: {} }, cfg.methods);
    inst.setData = function (o) { Object.assign(this.data, o); };
    inst.applyTheme();                        // 不许抛
    ok(inst.data.th && inst.data.th.fab, 'roles 缺失时仍要给出 fab 色（退回 primary）');
    equal(inst.data.th.fab, themes.get(themes.DEFAULT).primary, '兜底色 = 默认主题的 primary');
  } finally {
    themes.roles = real;
  }
});

test('⑱ 排单卡片（看板）走点睛卡角色：粉底 + 粉底上看得清的字', () => {
  // 用户 2026-10-05：「排单卡片，我想要粉色的」→ 确认范围 = 看板的排单卡片。
  // 空态卡（.cm-empty）V115 已经是粉的；这次是**有排单时**的顶卡与叠层。
  const fs = require('fs');
  const path = require('path');
  const dw = fs.readFileSync(path.join(__dirname, '../pages/dashboard/dashboard.wxss'), 'utf8');
  const blockOf = (sel) => {
    const i = dw.indexOf(sel);
    return i < 0 ? '' : dw.slice(i, dw.indexOf('}', i) + 1);
  };
  ok(blockOf('.cm-top {').indexOf('var(--color-highlight)') >= 0,
    '★ 排单顶卡要走 --color-highlight（粉帽=樱花粉；其它主题=surface ⇒ 零变化）');
  ok(blockOf('.cm-layer {').indexOf('var(--color-highlight)') >= 0,
    '叠层（后面露边的那张）也走同一支色 —— 一整叠排单卡都是粉的');
  ok(blockOf('.cm-top-sub {').indexOf('var(--color-highlight-sub)') >= 0,
    '★ 副信息（客户 · 余 N 件）要走 --color-highlight-sub —— 粉底上用 text-2 对比只有 1.67，看不清');

  // 角色默认值 = 现状 ⇒ 其它三套主题外观零变化
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    const tk = themes.get(k);
    equal(themes.roles(k).highlightSub, tk['text-2'],
      k + ' 未声明 highlightSub ⇒ 副信息色必须仍是 text-2（= 现状）');
    equal(themes.roles(k).highlight, tk.surface, k + ' 卡片底默认仍是 surface（= 现状）');
  });
  const g = themes.roles('gingerbreadHat');
  equal(g.highlightSub, '#8B7069', '粉帽的副信息 = 摩卡棕');
  ok(themes.styleOf('gingerbreadHat').indexOf('--color-highlight-sub:') >= 0,
    'styleOf 要把 --color-highlight-sub 发出去（否则页面上静默失效）');
  ok(themes.roles('不存在的主题').highlightSub, 'roles 对坏 key 也要回默认（不许 undefined）');

  // ⭐ 可读性：粉底上的标题与副信息都要过项目基准 2.8
  const gi = themes.get('gingerbreadHat');
  ok(contrastOf(g.highlight, gi['text-1']) >= 2.8,
    '粉底上的标题对比要达标 —— 实际 ' + contrastOf(g.highlight, gi['text-1']).toFixed(2));
  ok(contrastOf(g.highlight, g.highlightSub) >= 2.8,
    '★ 粉底上的副信息对比要达标 —— 实际 ' + contrastOf(g.highlight, g.highlightSub).toFixed(2));
  // 注入法自检：若 text-2 在粉底上就达标，说明这条判据的前提不成立（基准或底色变了）
  ok(contrastOf(g.highlight, gi['text-2']) < 2.8,
    '自检失败：text-2 在粉底上竟然达标了 —— 请复核基准（这条守卫的前提是"粉底上 text-2 太浅"）');
});

test('⑲ 选中态改「荧光描边」：细描边 + 一圈柔光，颜色走 ring 角色', () => {
  // 用户 2026-10-06：「为啥这四边有棕色的框 不好看」→ 拍板：改成荧光描边，颜色用樱花粉。
  // 原来的选中 = 实色粗框（border-color 主色 + box-shadow 0 0 0 4rpx 主色）——
  // 粉帽主题下主色是陶土橘，看起来就是一圈棕色方框。
  const fs = require('fs');
  const path = require('path');
  const cut = fs.readFileSync(path.join(__dirname, '../pages/cut-editor/cut-editor.wxss'), 'utf8');
  ['.strip-card.on', '.piece-hit.on'].forEach((sel) => {
    const i = cut.indexOf(sel);
    ok(i >= 0, '找不到 ' + sel);
    const blk = i < 0 ? '' : cut.slice(i, cut.indexOf('}', i) + 1);
    ok(blk.indexOf('var(--color-ring)') >= 0, sel + ' 要走 --color-ring（荧光描边色）');
    ok(blk.indexOf('var(--color-primary)') < 0,
      sel + ' 不该再直接用 primary —— 粉帽下那是陶土橘，就是用户嫌的那圈棕框');
    const sh = blk.indexOf('box-shadow:');
    const seg = sh < 0 ? '' : blk.slice(sh, blk.indexOf(';', sh));
    ok(seg.split(',').length >= 2,
      sel + ' 的选中要「实色细圈 + 柔光」两段 —— 只有实色一圈就又变成粗框了');
  });
  // 角色：默认 = primary（其它三套主题颜色不变，只是效果升级成荧光）
  ['clayWarm', 'seaSaltFoam', 'retroTin'].forEach((k) => {
    equal(themes.roles(k).ring, themes.get(k).primary,
      k + ' 未声明 ring ⇒ 选中环必须仍是 primary（零影响）');
  });
  equal(String(themes.roles('gingerbreadHat').ring).toLowerCase(), '#f8c8c6', '粉帽的选中环 = 樱花粉');
  ok(themes.styleOf('gingerbreadHat').indexOf('--color-ring:') >= 0, 'styleOf 要发 --color-ring');
  ok(themes.roles('不存在的主题').ring, 'roles 对坏 key 也要回默认（不许 undefined）');
});

test('⑳ 青提可露丽·绿带：色板四色各有落点 + 绿带走拼色 + 它是**常规**主题', () => {
  // 用户 2026-10-13 发来色板图（#C2E391 / #9BB336 / #9F6634 / #FFEC96）：
  //   「按这个配色，再加一个主题 和姜饼小熊一样上下撞色的」。
  const th = themes.THEMES.matchaCanele;
  ok(th, '要有这套主题');
  const tk = th.tokens;
  equal(th.name, '青提可露丽·绿带');

  // ① 主色 = 色板原色（中绿），一个字不改（同 ⑤ 的口径）
  equal(tk.primary.toLowerCase(), '#9bb336', '主色 = 色板的中绿，不许压深');
  // ② 另外两色的落点
  equal(tk['text-1'].toLowerCase(), '#9f6634', '棕 → 正文 / 结构色');
  equal(tk.accent.toLowerCase(), '#ffec96', '浅黄 → 次强调（accent）');
  // ③ 浅绿是**拼色**（顶部色带），不进 token —— 与姜饼同一条口径：拼色只是背景，不是结构
  ok(th.bgSplit && String(th.bgSplit.color).toLowerCase() === '#c2e391', '浅绿 → 顶部色带');
  const vals = Object.keys(tk).map((k) => String(tk[k]).toLowerCase());
  equal(vals.indexOf('#c2e391'), -1, '浅绿不许混进 13 个 token —— 拼色只是背景');
  ok(!('at' in th.bgSplit) && !('side' in th.bgSplit), 'bgSplit 只带 color（V116 口径：它是颜色，不是结构）');

  // ④ 上下撞色 = 顶部固定带走 bgSplit（与粉帽同机制）
  const r = themes.roles('matchaCanele');
  equal(String(r.band).toLowerCase(), '#c2e391', '顶部固定带 = 浅绿（用户要的"上下撞色"就是这一条）');

  // ⑤ **必须**是常规主题（不声明 contrast）—— 这条是算出来的，不是偏好：
  //    绿主色在奶白底上只有 2.32，而撞色分支要求主色在底/卡面上 ≥4.5 ⇒ 声明了会当场判红。
  //    它的底与主色本来就同色调区间（奶黄 ~46° vs 中绿 ~71°，差 25°）⇒ 走 ⑨ 的原分支才对。
  equal(!!th.contrast, false, '本套走常规分支（底与主色同色调）');
  const hueOf = (hex) => {
    const rr = parseInt(hex.substr(1, 2), 16) / 255, gg = parseInt(hex.substr(3, 2), 16) / 255, bb = parseInt(hex.substr(5, 2), 16) / 255;
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    if (mx === mn) return 0;
    const d = mx - mn;
    let h;
    if (mx === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (mx === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    return h * 60;
  };
  const hd = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  ok(hd(hueOf(tk.bg), hueOf(tk.primary)) <= 30,
    '底与主色同色调 ⇒ 本来就该走常规分支（真声明 contrast 反而过不了 4.5）');

  // ⑥ 主色上的字色：中绿太浅（配白字只有 2.36），按"改字色不改用户的色"择深棕
  const cOn = contrastOf(tk.primary, tk['primary-on']);
  ok(cOn >= 2.8, '主色上的字要读得出来，实际 ' + cOn.toFixed(2));
  ok(contrastOf(tk.primary, '#FFFFFF') < 2.8,
    '自检：白字本来就不够（所以 primary-on 才必须择深棕，而不是随手用白）');

  // ⑦ 点睛卡（排单卡）用浅黄 —— 让色板第四色在**界面上**真的用上，而不只是选择器里那块色块
  equal(String(r.highlight).toLowerCase(), '#ffec96', '排单卡 = 浅黄');
  equal(String(r.highlightOn).toLowerCase(), '#9f6634', '浅黄卡上的字 = 棕');
  ok(contrastOf(r.highlight, r.highlightOn) >= 2.8,
    '浅黄底上的字要读得出来，实际 ' + contrastOf(r.highlight, r.highlightOn).toFixed(2));
  ok(contrastOf(r.highlight, tk['text-2']) < 2.8,
    '自检：浅黄底上 text-2 确实太浅（所以副信息也要用棕 —— 与粉帽同款判断）');

  // ⑧ 色带上的元素也要读得出来：棕胶囊 / 浅绿加号 / 棕字
  ok(contrastOf(r.chip, r.chipOn) >= 2.8, '棕胶囊上的米黄字，实际 ' + contrastOf(r.chip, r.chipOn).toFixed(2));
  ok(contrastOf(r.chip, r.band) >= 2.8, '色带上的棕字，实际 ' + contrastOf(r.chip, r.band).toFixed(2));
});

test('㉑ 苹果爱丽丝·红带：四色落在**用户点名的位置** + 深色带必须走 band-ink（都是算出来的）', () => {
  // 用户 2026-10-14 发来色板图（#BF0A2D 深红 / #F0F9F8 浅青白 / #FBEC8E 浅黄 / #69ACD7 天蓝）；
  // 看过第一版之后把落点**直接点名**：「**我要顶部是红色 背景是黄色，加号是蓝色**」；
  // 又追加一句「**红色黄色都稍微淡一点点**」⇒ 红、黄两支保色相提亮（V155），边界由判据 ㉒ 钉住。
  const th = themes.THEMES.appleAlice;
  ok(th, '要有这套主题');
  const tk = th.tokens;
  equal(th.name, '苹果爱丽丝·红带');

  // ① 主色 = 色板的红**按用户要求提亮后**的值（色板原值 #BF0A2D 见 ⑤ 的注释）
  equal(tk.primary.toLowerCase(), '#d31035', '主色 = 用户点名的"淡一点"之后的值（不许谁再顺手改）');
  // ② ★ 用户点名的三个落点 —— 这三条就是本轮的全部需求
  ok(th.bgSplit && String(th.bgSplit.color).toLowerCase() === '#d31035', '顶部色带 = 红（用户："顶部是红色"）');
  equal(tk.bg.toLowerCase(), '#faf1b8', '页面底 = 浅黄（用户："背景是黄色"；V155 提亮）');
  equal(String(themes.roles('appleAlice').fab).toLowerCase(), '#69acd7', '加号 = 天蓝（用户："加号是蓝色"）');
  // ③ 剩下那一色（浅青白）也得有落点 —— 四色一个不剩是铁律
  equal(tk.surface.toLowerCase(), '#f0f9f8', '卡面 = 浅青白（第四色的落点）');
  // ④ 深红**既是带色又是主色**（允许：它是这套的"钱与动作"，用户又指定它当顶部）——
  //    但"拼色那支不进 token"那条仍然成立：这里不是把拼色塞进 token，而是同一支色两用。
  equal(String(th.bgSplit.color).toLowerCase(), tk.primary.toLowerCase(),
    '本套是"带色 = 主色"（同一支两用）—— 别的套不是，所以这条写在本套的判据里');

  // ⑤ 仍是**撞色**主题：页面底是黄（52°）、主色是红（348°），差 63° ⇒ 常规分支（≤30°）过不了
  equal(!!th.contrast, true, '★ 本套必须声明 contrast（底 52° 与主色 348° 差 63°）');
  const hueOf = (hex) => {
    const rr = parseInt(hex.substr(1, 2), 16) / 255, gg = parseInt(hex.substr(3, 2), 16) / 255, bb = parseInt(hex.substr(5, 2), 16) / 255;
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    if (mx === mn) return 0;
    const d = mx - mn;
    let h;
    if (mx === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (mx === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    return h * 60;
  };
  const hd = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  ok(hd(hueOf(tk.bg), hueOf(tk.primary)) > 30, '自检：底与主色确实差得远（否则"必须撞色"的前提不成立）');
  ok(contrastOf(tk.primary, tk.bg) >= 4.5, '撞色分支：主色在页面底上要 ≥4.5，实际 ' + contrastOf(tk.primary, tk.bg).toFixed(2));
  ok(contrastOf(tk.primary, tk.surface) >= 4.5, '撞色分支：主色在卡面上要 ≥4.5，实际 ' + contrastOf(tk.primary, tk.surface).toFixed(2));

  // ⑥ 主色够深 ⇒ 白字直接用（这套**不需要**像青提那样择 primary-on）
  equal(tk['primary-on'].toUpperCase(), '#FFFFFF', '深红够深（白字 ' + contrastOf(tk.primary, tk['primary-on']).toFixed(2) + '）⇒ 字色就是白');

  // ⑦ ⭐ 深色带的核心：带内前景（bandInk / bandInkOn）—— 本套是第一套深色带
  const band = themes.roles('appleAlice').band;
  equal(String(band).toLowerCase(), '#d31035', '顶部固定带 = 红（"上下撞色"就是这一条）');
  const r = themes.roles('appleAlice');
  const ink = th.bandInk, inkOn = th.bandInkOn;
  ok(ink && inkOn, '本套必须声明 bandInk / bandInkOn（深色带的前景）');
  const inkC = contrastOf(tk[ink] || ink, band);
  ok(inkC >= 2.8, '带上前景（' + ink + '）在红带上要读得出来，实际 ' + inkC.toFixed(2));
  const inkOnC = contrastOf(tk[inkOn] || inkOn, tk[ink] || ink);
  ok(inkOnC >= 2.8, '浅块上的字（' + inkOn + '）要读得出来，实际 ' + inkOnC.toFixed(2));

  // ⑧ ⭐⭐ **反证**：这就是"为什么必须有带内前景"的证据 —— 不是审美，是可见性
  const oldText = contrastOf(tk['text-3'], band);        // 带内小字原样（三级文字压在带上）
  const oldBlock = contrastOf(tk.primary, band);         // 带内实心块原样（主色块压在带上）
  ok(oldText < 2.8, '自检：三级文字压在红带上确实读不出来（' + oldText.toFixed(2) + '）');
  ok(oldBlock < 1.2, '自检：**主色实心块压在红带上等于没有**（' + oldBlock.toFixed(2) +
    '）—— 「批量入库」入口就是这么消失的');

  // ⑨ 点睛卡与加号都是天蓝：卡上的字要读得出来，且 text-2 在蓝上确实太浅（所以副信息用深青）
  ok(contrastOf(r.highlight, r.highlightOn) >= 2.8, '天蓝卡上的字要读得出来，实际 ' + contrastOf(r.highlight, r.highlightOn).toFixed(2));
  ok(contrastOf(r.highlight, tk['text-2']) < 2.8,
    '自检：天蓝底上 text-2 确实太浅（所以副信息也用深青 —— 与粉帽 / 青提同款判断）');
  ok(contrastOf(r.fabOn, r.fab) >= 2.8, '蓝圆上的加号要看得清，实际 ' + contrastOf(r.fabOn, r.fab).toFixed(2));
});

test('㉒ 苹果爱丽丝的「淡」是**算到边界**的（红黄各差一两档就撞判据 —— 这不是口味题）', () => {
  // 用户 2026-10-14 追加：「红色黄色都稍微淡一点点」。
  // ⚡ 这句听着是审美，实际是**硬约束题**：
  //    · 红提亮 ⇒ 红的明度升 ⇒「主色 / 页面底」的分子分母**同时**往上抬 ⇒ 掉得比想象快；
  //    · 黄提亮 ⇒ 页面底变亮 ⇒「卡面 / 页面底」的明度差**被吃掉**（卡片会慢慢糊在页面里）。
  // ⇒ 本轮先扫边界再定值（工作区 _probe_v155*.js），这条判据把边界钉住：
  //   它不测"好不好看"，只测两件事 ——"**这次确实淡了**"和"**为什么不能再淡了**"。
  // ⚠️ 它的两条"现行值"断言与 ㉑ 重叠（口径相同，留着好读）；真正的增量是下面那几条**反证**。
  const tk = themes.get('appleAlice');
  const rgbs = (hex) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
  const toHsl = (hex) => {
    const [r, g, b] = rgbs(hex).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) { if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  };
  const fromHsl = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let a; if (h < 60) a = [c, x, 0]; else if (h < 120) a = [x, c, 0]; else if (h < 180) a = [0, c, x];
    else if (h < 240) a = [0, x, c]; else if (h < 300) a = [x, 0, c]; else a = [c, 0, x];
    return '#' + a.map((v) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0')).join('');
  };
  // 保色相提亮（与本轮口径一致：一并略降饱和 —— themes.js 注释里写了为什么）
  const lighten = (hex, d) => { const [h, s, l] = toHsl(hex); return fromHsl(h, Math.max(0.5, s - d * 0.8), l + d); };

  // ① "确实淡了"—— 两支明度都高于色板原值，且**色相没被带跑**（这是用户那句话的字面要求）
  ok(lumOf(tk.primary) > lumOf('#BF0A2D'), '红要比色板原值 #BF0A2D 亮（用户："红淡一点点"）');
  ok(lumOf(tk.bg) > lumOf('#FBEC8E'), '黄要比色板原值 #FBEC8E 亮（用户："黄淡一点点"）');
  // ⚠️ 比色相要**留容差**：hex 只有 8 位，提亮后重新取整会让 HSL 色相漂零点几度
  //    （实测 #BF0A2D 348.4° → #D31035 348.6°）。写死相等会假红 —— 这里问的是"色相没被带跑"，
  //    不是"一位小数都一样"（V155 第一版就栽在这 0.2° 上）。
  ok(Math.abs(toHsl(tk.primary)[0] - toHsl('#BF0A2D')[0]) < 2,
    '提亮必须**保色相**（不许把红调成别的颜色）：原色 ' + toHsl('#BF0A2D')[0].toFixed(1) +
    '° → 现值 ' + toHsl(tk.primary)[0].toFixed(1) + '°');

  // ② 黄的边界：现行值在线上；再淡一档仍在线上；再淡**三档**卡面就糊进页面
  // ⚠️ **顺序有讲究**：黄这条必须写在红那条**前面**。两支是**耦合**的 ——
  //    黄越淡 ⇒ 页面底越亮 ⇒「主色 / 页面底」越宽松 ⇒ 红那条的"再淡两档就跌破"会先红；
  //    反过来写的话，"黄被淡过头"这种注入永远轮不到黄自己的断言去抓（V155 验牙时撞上这个）。
  ok(Math.abs(lumOf(tk.surface) - lumOf(tk.bg)) >= 0.035,
    '现行值要过 0.035，实际 ' + Math.abs(lumOf(tk.surface) - lumOf(tk.bg)).toFixed(3));
  ok(Math.abs(lumOf(tk.surface) - lumOf(lighten(tk.bg, 0.02))) >= 0.035,
    '自检：黄再淡一档仍在线上 —— 边界是"三档"');
  ok(Math.abs(lumOf(tk.surface) - lumOf(lighten(tk.bg, 0.06))) < 0.035,
    '★ 黄再淡三档，卡面与底的明度差只剩 ' + Math.abs(lumOf(tk.surface) - lumOf(lighten(tk.bg, 0.06))).toFixed(3) +
    '（<0.035）—— 卡片会糊在页面里，这就是"黄只能淡到这里"的证据');

  // ③ 红的边界：现行值在线上；再淡**一档**仍在线上（所以边界是"两档"）；再淡两档就跌破 4.5
  ok(contrastOf(tk.primary, tk.bg) >= 4.5, '现行值要过 4.5，实际 ' + contrastOf(tk.primary, tk.bg).toFixed(2));
  ok(contrastOf(lighten(tk.primary, 0.01), tk.bg) >= 4.5,
    '自检：红再淡一档仍在线上（' + contrastOf(lighten(tk.primary, 0.01), tk.bg).toFixed(2) +
    '）—— 边界是"两档"，写成一档会假红');
  ok(contrastOf(lighten(tk.primary, 0.02), tk.bg) < 4.5,
    '★ 红再淡两档就跌破 4.5（' + contrastOf(lighten(tk.primary, 0.02), tk.bg).toFixed(2) +
    '）—— 这就是"红只能淡到这里"的证据，别再往上加');
});
