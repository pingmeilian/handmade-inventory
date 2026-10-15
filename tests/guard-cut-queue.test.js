// tests/guard-cut-queue.test.js —— 裁剪（逐件）的「入口 ↔ 页面」事件契约守卫
//
// 2026-09-30 V89：用户要求「增加成品数量时也改成这种剪裁方式，所有的剪裁都换成现在这种」⇒
//   逐件流程从旧的方案卡片选择器（`pages/cut-picker`，已删）整体搬进裁剪排版页
//   （`pages/cut-editor` 的**逐件模式**：?mode=queue）。
//
// 为什么这类守卫必须留着（V80 的教训）：这件事在 3 个入口各写一遍，
//   当年只改了 2 个入口的事件名，页面就**一条数据都收不到 → 整页空白**（真机截图）。
//   所以这里不只测"当前对不对"，而是把「入口 → 页面」的契约本身钉住：
//   改契约时 3 个入口 + 页面必须一起改，漏一个就红。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');

const PAGE_JS = 'pages/cut-editor/cut-editor.js';
const PAGE_WXML = 'pages/cut-editor/cut-editor.wxml';
// 三个入口：成品列表 / 库存管理 / 成品编辑页
const CALLERS = ['pages/products/list.js', 'pages/products/instances.js', 'pages/products/edit.js'];

function walk(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|wxml)$/.test(name)) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  });
  return out;
}

group('裁剪（逐件）· 入口与页面的事件契约');

test('① 全项目只许有 passQueue 这一个事件名；passTasks 必须绝迹', () => {
  // 注入法自检：旧写法必须抓得出来
  ok(/emit\('passTasks'/.test("res.eventChannel.emit('passTasks', { tasks: [t] });"),
    '自检失败：旧的 passTasks 写法没被检出 —— 这条守卫没有牙');
  ok(!/passTasks/.test("emit('passQueue', { queue: [] })"),
    '自检失败：新写法被误判成旧的');

  const files = walk(path.join(ROOT, 'pages'), [])
    .concat(walk(path.join(ROOT, 'utils'), []))
    .concat(walk(path.join(ROOT, 'services'), []));
  const bad = files.filter((rel) => stripComments(read(rel)).indexOf('passTasks') >= 0);
  equal(bad.length, 0,
    '这些文件还在用废弃的事件名 passTasks（页面只监听 passQueue ⇒ 打开就是空白页）：' + bad.join('、'));
});

test('② 生产入口必须发 passQueue，且队列条数带 pieceNo（页面按它分「第几件」）', () => {
  // 只有两个生产入口走逐件队列（成品编辑页的「剪裁」是单件，直接带 id 进）
  ['pages/products/list.js', 'pages/products/instances.js'].forEach((rel) => {
    const src = stripComments(read(rel));
    ok(src.indexOf("emit('passQueue'") >= 0, rel + ' 没有发 passQueue —— 页面会一片空白');
    ok(/passQueue',\s*\{\s*queue:/.test(src), rel + ' 的 passQueue 里没带 queue 字段');
    // 队列要么走 calc.cutQueueFor（它负责给每条盖 pieceNo），要么自己显式带上 pieceNo；
    // 都不做的话，页面分不出「第几件」⇒ 进度是错的。
    ok(/cutQueueFor\(|pieceNo/.test(src),
      rel + ' 的队列没有 pieceNo（也没走 calc.cutQueueFor）—— 页面没法分辨这是第几件');
    ok(src.indexOf('cut-editor/cut-editor?mode=queue') >= 0,
      rel + ' 必须进裁剪排版页的**逐件模式**（?mode=queue）');
  });
  // 成品编辑页：单件排版，带 id 与尺寸进去（不走队列）
  const editSrc = stripComments(read('pages/products/edit.js'));
  ok(/cut-editor\/cut-editor\?id=/.test(editSrc), 'edit.js 的单件排版要带 id 进裁剪排版页');
});

test('③ 页面必须监听 passQueue，并且在逐件模式下才能用', () => {
  const src = stripComments(read(PAGE_JS));
  ok(/channel\.on\('passQueue'/.test(src) || /\.on\('passQueue'/.test(src), '页面没有监听 passQueue');
  ok(/mode\s*===\s*'queue'/.test(src), '页面要认 ?mode=queue 才走逐件模式');
});

test('④ 收不到数据时必须显示提示，绝不允许白屏（V80 用户看到过白屏）', () => {
  const js = stripComments(read(PAGE_JS));
  const wxml = stripComments(read(PAGE_WXML));

  // 注入法自检：没有空状态的模板要被判出来
  const bare = '<view wx:for="{{pieces}}">…</view>';
  ok(bare.indexOf('loadErr') < 0, '自检失败：没有空状态的模板被误判成合规');

  ok(/loadErr/.test(js), '页面没有「没收到任务」的兜底标记（loadErr）');
  ok(/loadErr/.test(wxml), '模板没有渲染 loadErr —— 收不到数据时仍是白屏');
  // ⚠️ 2026-10-04 V112：原来的 `queueMode` 锚点失效了 —— 「做 N 件」搬去导航栏，
  //    那一行里就没有 queueMode 了。但**空态分支本身还在**（`wx:if="{{pieces.length}}"`
  //    + `wx:else` 的「这个物料还没有在库的布片」），判据改盯真正要护的东西。
  ok(/pieces\.length/.test(wxml) && /这个物料还没有在库的布片/.test(wxml),
    '模板要有「没有可用布片」的分支');
});

test('⑤ 逐件选择必须真的落到扣料上（不许收下了却当扁平数组用）', () => {
  // 页面发的是**逐件的数组**（每一件一个数组）；接收方当扁平数组用会取到 undefined，
  // 或者干脆把嵌套数组塞给 chosenSchemes ⇒ 用户选的方案被静默忽略（V78/V80 就是这个坑）。
  const storeSrc = stripComments(read('utils/store.js'));
  ok(/function produceProduct\([^)]*perPiece\)/.test(storeSrc),
    'produceProduct 必须能接收「逐件选择」perPiece 参数');
  ok(/perPiece\s*:\s*perPiece/.test(storeSrc),
    'produceProduct 没有把 perPiece 透传给扣料（收下了却不用）');

  ['pages/products/list.js', 'pages/products/instances.js'].forEach((rel) => {
    const src = stripComments(read(rel));
    ok(/onChoose[\s\S]{0,400}?data\.chosen/.test(src),
      rel + ' 的 onChoose 没有处理页面回传的逐件选择');
  });
  // 页面自己：回传必须按「第几件」分组（chosen[件号][面料行]），不能一条平铺。
  // 2026-09-30 V90：界面从"逐件确认"换成"一屏排完"，但**分组结构一个字没变** ——
  // 每片仍记着自己属于第几件（pieceNo），扣料那边是 perPiece[第几件] 取方案的。
  const cutSrc = stripComments(read(PAGE_JS));
  ok(/pieceNo/.test(cutSrc),
    '每片必须记得自己属于第几件（pieceNo）—— 回传按件分组、扣料按件取方案，平铺会取不到');
});

test('★ ⑥ 每片**自己的尺寸和布**必须一路传到扣料（不许拿 BOM 的尺寸去匹配）', () => {
  // V90 用户原话：「可以每一片自定义长宽」「不同的裁片也可以选不同的布片放」。
  // 危险点：扣料原来按 BOM 行的 rect 匹配用户选的方案（findChosen），
  //   尺寸一旦能改，匹配必然落空 ⇒ **静默**退回 pickCutSource 自己挑一块布，
  //   用户在界面上选的布/改的尺寸全被顶掉（账面完全看不出来）。
  const storeSrc = stripComments(read('utils/store.js'));

  // 注入法自检：老写法（拿 rect 去匹配 perPiece）必须抓得出来
  const oldWay = 'const one = perPiece ? findChosen(perPiece[i], b.materialId, rect) : null;';
  ok(/findChosen\(perPiece\[i\]/.test(oldWay), '自检失败：老的按 rect 匹配写法没被检出 —— 这条守卫没有牙');

  const seg = storeSrc.slice(storeSrc.indexOf('perPiece ?'), storeSrc.indexOf('perPiece ?') + 400);
  ok(seg.indexOf('findChosen(perPiece[i]') < 0,
    '扣料又退回「拿 BOM 的 rect 去匹配逐件选择」了 —— 用户改过尺寸后就匹配不上，' +
    '会静默改用系统自己挑的布（用户的操作全丢）');
  ok(/perPiece\[i\]|\(rows \|\| \[\]\)\.forEach/.test(storeSrc) &&
     /c\.materialId === b\.materialId/.test(storeSrc),
    '逐件选择要按 materialId 认「这一件这一行」，而不是按尺寸');
  ok(/useL|useW/.test(storeSrc), '扣料的尺寸要取用户填的那份');
  // V91：一件成品可以用两块布 ⇒ 用户给出的每一刀都要扣
  ok(/cuts\.forEach/.test(storeSrc), '★ 用户给的每一刀都要扣（一件成品可以用两块布）');

  // 页面这边：每片必须带齐 尺寸 + 布 + 摆放
  const cutSrc = stripComments(read(PAGE_JS));
  ok(/length:\s*util\.round\(p\.len/.test(cutSrc), '回传要带**这一片自己的**长');
  ok(/width:\s*util\.round\(p\.wid/.test(cutSrc), '回传要带**这一片自己的**宽');
  ok(/pieceId:\s*p\.pieceId/.test(cutSrc), '回传要带**这一片自己的**布');
});

test('★ ⑦ 数量以**裁剪界面回传的 qty 为准**（片数能改 = 件数能改）', () => {
  // V90 之前：数量是弹窗填的那个 q，一路传到底。现在那一屏能加减片数，
  // 入口若还用 q，用户多加的两件就白排了（片排好了却不生产）—— 静默、账面上看不出来。
  //
  // 注入法自检：老写法必须抓得出来
  ok(/produceProduct\([^)]*,\s*q,\s*null/.test('store.produceProduct(p.id, q, null, null, ov, data.chosen);'),
    '自检失败：老的"直接用 q"写法没被检出 —— 这条守卫没有牙');

  ['pages/products/list.js', 'pages/products/instances.js'].forEach((rel) => {
    const src = stripComments(read(rel));
    // 只看 onChoose 里那一段：**不进裁剪界面**的分支（队列为空）当然还是用 q，那是对的
    const at = src.indexOf('onChoose');
    ok(at >= 0, rel + ' 没有 onChoose 回调');
    const seg = src.slice(at, at + 500);
    ok(/data\.qty/.test(seg), rel + ' 的 onChoose 没用回传的 qty（用户加减的件数会被丢掉）');
    ok(!/produceProduct\([^)]*,\s*q,/.test(seg),
      rel + ' 的 onChoose 还在用弹窗填的 q —— 裁剪界面里加的那几件白排了');
  });
});
