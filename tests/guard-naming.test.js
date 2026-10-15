// tests/guard-naming.test.js —— 命名守卫（2026-09-27）
//
// 背景：用户提出「物料大类」跟「手作空间」长得像、容易混，要求改名 →
// 定为「物料分类」。
//
// 改名最容易出的问题**不是"改错"，而是"改一半"** —— 界面上一处叫「物料分类」、
// 另一处还叫「物料大类」，或者提示语里留着旧词。人眼很难发现，
// 守卫能。所以锁两件事：
//   ① 源码与界面文案里不得再出现「物料大类」（它与「手作空间」同形，是混淆源头）
//   ② 新名「物料分类」必须在关键位置全部到位（漏一处 = 改了一半）
//   ③ 不再指引用户去找不存在的「分类管理」（见下）

const path = require('path');
const fs = require('fs');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

// ⭐ 一律先剥注释再判定。注释里**天然会**提到旧名字（"原先叫物料大类，与手作空间
//    混"是解释改名的必要信息），不剥的话守卫会被自己的文档骗过去 ——
//    这个坑在 guard-preset-entries 已踩过一次，这里直接前置解决。
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')          // wxml
  .replace(/\/\*[\s\S]*?\*\//g, '')         // /* */（js / wxss）
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');    // 行注释（避开 http://）

// 收集源码文件：界面 + 逻辑（不含 tests 自身，也不含文档）
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(wxml|js|json|wxss)$/.test(name)) out.push(full);
    }
  };
  ['pages', 'utils', 'services', 'components'].forEach((d) => walk(path.join(ROOT, d)));
  ['app.js', 'app.json', 'app.wxss'].forEach((f) => out.push(path.join(ROOT, f)));
  return out.filter((f) => fs.existsSync(f));
}

const OLD = '物料大类';
const NEW = '物料分类';

group('命名 · 「物料大类」→「物料分类」（避免与「手作空间」混淆）');

test('① 源码里不得再出现旧名「物料大类」', () => {
  // 注入法自检：这个词必须能被抓出来
  const sample = '请选择手作空间与物料大类';
  ok(sample.indexOf(OLD) >= 0, '自检失败：旧名没被识别 —— 这条守卫没有牙');

  const hits = sourceFiles()
    .filter((f) => stripComments(fs.readFileSync(f, 'utf8')).indexOf(OLD) >= 0)
    .map((f) => path.relative(ROOT, f));

  equal(hits.length, 0,
    '仍在使用旧名「物料大类」（与「手作空间」同形，用户明确要求改名）：\n' +
    hits.map((f) => '    · ' + f).join('\n'));
});

test('② 新名「物料分类」必须在关键位置到位（防"只改一半"）', () => {
  const must = [
    ['pages/settings/presets.wxml', '预设设置页的入口文案'],
    ['pages/settings/listEditor.js', 'listEditor 的 label（导航栏 / 新建按钮都用它）'],
    ['pages/materials/edit.wxml', '物料编辑页的字段标签'],
    ['utils/csv.js', 'CSV 表头']
  ];

  // 注入法自检：缺失判定必须真的能抓出"没改到的位置"
  const missingIn = (text) => text.indexOf(NEW) < 0;
  ok(missingIn('这里还是旧名字') === true, '自检失败：没改到的文案没被检出');
  ok(missingIn('这里已经是物料分类') === false, '自检失败：改好的文案被误判为缺失');

  const missing = must.filter(([rel]) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8').indexOf(NEW) < 0);

  equal(missing.length, 0,
    '这些位置没改到新名（界面会一会儿「物料分类」一会儿别的）：\n' +
    missing.map(([rel, why]) => '    · ' + rel + '（' + why + '）').join('\n'));
});

test('③ 不再指引用户去找不存在的「分类管理」', () => {
  // 「手作空间管理」页原本写着「切换当前空间请在「物料库 → 分类管理」」，
  // 但物料库页**没有**这个入口（顶部就是空间 pills，直接点选）。
  // 而且「分类管理」会与新的「物料分类」撞车 —— 用户会以为那是管分类的。
  const rel = 'pages/settings/categories.wxml';
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  ok(src.indexOf('分类管理') < 0,
    rel + ' 仍指引「物料库 → 分类管理」，但物料库页没有这个入口；' +
    '而且「分类管理」会与新的「物料分类」撞车');
});

test('③B ★ 切换空间的指引必须指向**真的有点击入口**的页面（三向一致）', () => {
  // 2026-10-04：用户要求「物料库和成品库最上边的经营大类按钮删掉，只在看板留」⇒
  //   那句"去物料库顶部点选"的提示语**第二次失效**（第一次是「分类管理」那次）。
  // ⇒ 这条守卫把"指引"与"实际入口"绑在一起验，三个方向都要对：
  //     ① 看板**必须真有**那颗胶囊（否则提示语是空指向）
  //     ② 物料库 / 作品集**必须真没有**（本轮要求删干净）
  //     ③ 提示语**必须指向**看板
  //   📌 只验其中一向都会漏：只验③的话，看板哪天被删了胶囊，提示语照样"写得对"。
  const rel = 'pages/settings/categories.wxml';
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  ok(src.indexOf('「看板」') >= 0, rel + ' 的切换提示要指向「看板」（现在切空间的唯一入口）');
  ok(src.indexOf('「物料库」') < 0, rel + ' 的提示语仍指向「物料库」—— 那儿已经没有切换入口了');

  const dash = stripComments(fs.readFileSync(path.join(ROOT, 'pages/dashboard/dashboard.wxml'), 'utf8'));
  ok(dash.indexOf('space-pill') >= 0,
    '★ 看板页没有空间胶囊 —— 那提示语就是在骗人（指向不存在的东西）');

  ['pages/materials/list.wxml', 'pages/products/list.wxml'].forEach((p) => {
    const s = stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    ok(s.indexOf('space-pill') < 0,
      p + ' 还挂着空间切换胶囊 —— 本轮要求删掉、只在看板留一处');
  });
});

group('命名 · 「出入库历史」→「物料出入库」（只含物料，别让人以为含成品）');

test('④ 该页标题必须叫「物料出入库」', () => {
  // 系统里没有成品流水表（成品的进/出记在成品对象上，已单独做成「成品出入库」页）⇒
  // 这一页只含物料。叫「出入库历史」会让人以为它也包着成品。
  const rel = 'pages/settings/history.json';
  const title = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).navigationBarTitleText;
  equal(title, '物料出入库', rel + ' 的标题应为「物料出入库」（它只含物料流水）');
});

test('⑤ 「我的」页必须有「成品出入库」入口（成品进出的唯一总入口）', () => {
  // 2026-09-27 V73：该页由「销售记录」改名「成品出入库」（它同时含生产与销售两条）
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'pages/mine/mine.wxml'), 'utf8'));
  ok(src.indexOf('/pages/settings/sales') >= 0,
    '「我的」页缺少成品出入库入口 —— 成品卖出去之后，就没有一处能汇总看的地方了');
});

group('命名 · 「经营大类」→「手作空间」（2026-10-04 用户：这个名字太商业，要叫手作空间）');

test('⑥ 源码里不得再出现旧名「经营大类」', () => {
  // 2026-10-04 用户：「把经营大类的名字改成手作空间」。
  // ⚠️ 这次跟「物料大类」那次**不一样**：那次是因为两个词长得像（注释里要解释改名缘由，
  //    所以守卫必须剥注释）；这次纯粹是**产品改叫法**，注释里也该跟着走，
  //    否则代码与产品脱节。⇒ 这条**不剥注释**（剥了反而放走一批该改的）。
  const OLDNAME = '经营大类';
  // 注入法自检：旧名必须能被抓出来
  ok('请选择经营大类'.indexOf(OLDNAME) >= 0, '自检失败：旧名没被识别 —— 这条守卫没有牙');

  const hits = sourceFiles()
    .filter((f) => fs.readFileSync(f, 'utf8').indexOf(OLDNAME) >= 0)
    .map((f) => path.relative(ROOT, f));

  equal(hits.length, 0,
    '仍在使用旧名「' + OLDNAME + '」（用户要求改叫「手作空间」）：\n' +
    hits.map((f) => '    · ' + f).join('\n'));
});

test('⑦ 新名「手作空间」必须在关键位置到位（防"只改一半"）', () => {
  const NEWNAME = '手作空间';
  const must = [
    ['pages/settings/categories.wxml', '管理页的标题与按钮'],
    ['pages/settings/categories.json', '管理页导航栏标题'],
    ['pages/mine/mine.wxml', '「我的」页的入口'],
    ['utils/csv.js', 'CSV 表头（导出的表格里也有这一列）'],
    ['pages/materials/edit.js', '物料编辑页的校验提示']
  ];
  // 注入法自检：缺失判定要真能抓出"没改到的位置"
  ok('这里还是旧名字'.indexOf(NEWNAME) < 0, '自检失败：没改到的文案没被检出');
  ok('这里已经是手作空间'.indexOf(NEWNAME) >= 0, '自检失败：改好的文案被误判为缺失');

  const missing = must.filter(([rel]) => fs.readFileSync(path.join(ROOT, rel), 'utf8').indexOf(NEWNAME) < 0);
  equal(missing.length, 0,
    '这些位置没改到新名（界面会一会儿「手作空间」一会儿别的）：\n' +
    missing.map(([rel, why]) => '    · ' + rel + '（' + why + '）').join('\n'));
});
