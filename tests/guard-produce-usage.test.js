// tests/guard-produce-usage.test.js —— 「这批实际用料」两处入口不许漂移（2026-09-27 V74）
//
// 背景：这个功能有**两个入口**（成品列表的操作菜单、库存管理页），
// 而本项目历史上最贵的一类 bug 就是「同一件事在两处各写一遍、然后走偏」
// （V72 的两个时间列、V73 的排单备注都是这么来的）。
// 所以这里立三件事：
//   ① 两个入口都必须用 calc 里的同一份计算（不许页面自己写乘法）
//   ② 两个入口都必须把「改过的行」作为覆盖传给 produceProduct（传漏 = 用户改了却没生效）
//   ③ 两处界面都要有这块 UI（只做一处 = 另一个入口静默按老逻辑扣料）
const fs = require('fs');
const path = require('path');
const { test, group, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 一律先剥注释再判定 —— 注释里引用旧写法会把守卫骗过去（V67/V68 踩过两次）
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

const PAGES = ['pages/products/list.js', 'pages/products/instances.js'];
const PANELS = ['pages/products/list.wxml', 'pages/products/instances.wxml'];

group('这批实际用料 · 两个入口必须同源');

test('① 两个入口都用 calc 的同一份行计算（页面不许自己算「每件用量 × 数量」）', () => {
  // 注入法自检：页面自己写乘法必须能被抓出来
  const selfMath = /(b\.batchUsage|b\.usage|b\.area)\s*\*\s*(qty|q)\b/;
  ok(selfMath.test('const need = b.usage * qty;'),
    '自检失败：页面自算用量的写法没被检出 —— 这条守卫没有牙');
  ok(!selfMath.test('const lines = calc.produceUsageLines(p.bom, q);'),
    '自检失败：正常写法被误判');

  PAGES.forEach((rel) => {
    const src = stripComments(read(rel));
    ok(src.indexOf('calc.produceUsageLines') >= 0,
      rel + ' 应调用 calc.produceUsageLines —— 行计算只能有一处口径');
    ok(src.indexOf('calc.produceOverrides') >= 0,
      rel + ' 应调用 calc.produceOverrides —— 只把改过的行作为覆盖');
    ok(src.indexOf('calc.retuneUsageLines') >= 0,
      rel + ' 应在数量变化时调用 calc.retuneUsageLines（否则用户改了用量、再改数量就被冲掉）');
    ok(!selfMath.test(src), rel + ' 里出现了页面自算用量的乘法 —— 口径必须回到 calc');
  });
});

test('★ ② 两个入口都把「实际用料」传给了 produceProduct（传漏 = 用户改了却没生效）', () => {
  PAGES.forEach((rel) => {
    const src = stripComments(read(rel));
    // 形如 store.produceProduct(id, q, 方案, 目标, ov) —— 2026-09-29 起后面还可跟逐件选择 perPiece
    const calls = src.match(/store\.produceProduct\([^)]*\)/g) || [];
    ok(calls.length > 0, rel + ' 里找不到 produceProduct 调用');
    calls.forEach((c) => {
      ok(/,\s*ov\s*[,)]/.test(c),
        rel + ' 的调用没带上覆盖参数：' + c + ' —— 用户改的实际用料会被丢掉');
    });
    ok(src.indexOf('checkBomStock(prod, q, ov)') >= 0 || src.indexOf('checkBomStock(p, q, ov)') >= 0,
      rel + ' 的库存预检也要按实际用量校验（否则预检过了、扣料时才炸）');
    ok(/calc\.cutQueueFor\(/.test(src),
      rel + ' 的裁剪队列必须走 calc.cutQueueFor（别在页面里自己判）');
  });
});

test('★ ⑥ cutQueueFor 必须「每件一条」（不许退回「每个物料一条」）', () => {
  // 背景：用户要的是**逐件确认** ——
  //   「每一件都由我来剪裁，都由我来确定，不是只确定一件、其他的都跟他一样」。
  // 队列若退回「每个物料一条」，选片页就只能让他选一次，后面几件又被系统替着剪了。
  const src = stripComments(read('utils/calc.js'));
  const body = /function cutQueueFor\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  ok(!!body, 'utils/calc.js 里找不到 cutQueueFor 函数体');

  ok(/pieceNo/.test(body[1]),
    'cutQueueFor 必须给每条打上 pieceNo —— 选片页按它分组、一件一件让用户确认');
  ok(/for\s*\([^)]*(<=|<)\s*q/.test(body[1]),
    'cutQueueFor 必须按件数 q 展开（每件一条）—— 否则又退回「只确认一件」的老行为');

  // 注入法自检：不按件展开的写法必须抓得出来
  ok(!/pieceNo/.test('function cutQueueFor() { const t = []; return t; }'),
    '自检失败：不按件展开的写法没被检出 —— 这条守卫没有牙');
});

test('③ 两处界面都要有这块 UI（只做一处 = 另一个入口静默按老逻辑扣料）', () => {
  PANELS.forEach((rel) => {
    const wxml = stripWxml(read(rel));
    ok(wxml.indexOf('usageLines') >= 0 && wxml.indexOf('onUsageInput') >= 0,
      rel + ' 缺少「这批实际用料」区块');
  });
});

// ---------------------------------------------------------------
// 2026-09-28 追加（V76）。真机截图反馈：「这UI做的什么东西」——
// 面板里物料名被挤成一列（「亚麻」只剩「亚」），输入框压在文字上。
//
// 真因：ph-input 组件根节点自带 width:100%（components/ph-input/ph-input.wxss）。
//   把它裸放进 .usage-row 这个 flex 行，它就吃掉整行宽度，
//   把 .usage-info（flex:1; min-width:0）压成 0 宽 —— 字号颜色都没错，
//   纯粹是「flex 行里塞了个 100% 宽的块」。修法：外面包一层定宽容器。
// ---------------------------------------------------------------

const countUsageInput = (s) => (s.match(/<ph-input ph-class="usage-input"/g) || []).length;
const countInputWrap = (s) => (s.match(/<view class="usage-input-wrap">/g) || []).length;

test('④ 「实际用料」的每个输入框都必须包在定宽容器里（裸放 = 撑爆 flex 行）', () => {
  // 注入法自检：裸放的写法必须能被"数量对不上"抓出来
  ok(countUsageInput('<ph-input ph-class="usage-input" />') === 1 &&
     countInputWrap('<ph-input ph-class="usage-input" />') === 0,
    '自检失败：裸放的输入框没被算出差额 —— 这条守卫没有牙');
  ok(countUsageInput('<view class="usage-input-wrap"><ph-input ph-class="usage-input" /></view>') === 1 &&
     countInputWrap('<view class="usage-input-wrap"><ph-input ph-class="usage-input" /></view>') === 1,
    '自检失败：包好的被误判成不合规');

  PANELS.forEach((rel) => {
    const wxml = stripWxml(read(rel));
    const inputs = countUsageInput(wxml);
    const wraps = countInputWrap(wxml);
    ok(inputs > 0, rel + ' 里找不到「这批实际用料」的输入框（区块是不是被删了？）');
    ok(inputs === wraps,
      rel + ' 里有 ' + inputs + ' 个输入框、却只有 ' + wraps + ' 个定宽容器 —— ' +
      'ph-input 自带 width:100%，裸放进 flex 行会撑满整行、把物料名压成一列（2026-09-28 真机崩版）');
  });
});

test('⑤ 定宽容器必须真的有宽度且不被拉伸（flex:none + 明确 width）', () => {
  PANELS.forEach((rel) => {
    const cssRel = rel.replace(/\.wxml$/, '.wxss');
    const css = stripComments(read(cssRel));
    const m = /\.usage-input-wrap\s*\{([^}]*)\}/.exec(css);
    ok(!!m, cssRel + ' 没有定义 .usage-input-wrap —— 容器没有宽度，等于没包');
    ok(/flex\s*:\s*none/.test(m[1]),
      cssRel + ' 的 .usage-input-wrap 需要 flex:none，否则仍会被 flex 容器拉伸');
    ok(/width\s*:\s*\d+rpx/.test(m[1]),
      cssRel + ' 的 .usage-input-wrap 需要明确宽度（组件内部 width:100% 靠它定尺寸）');
  });
});

// ---------------------------------------------------------------
// 2026-09-29 追加（V77）。用户把需求说清楚了：
//   「第一种就是布料尺寸，按照成品编辑时的尺寸来，一个一个做 —— 做几个就要剪几次；
//     第二种就是一起做，把布料合在一起…… 需要自己填布料长乘宽」
// ⇒ 面料几何行两种剪法（一件一件剪 / 合起来剪）。
//   这是本项目的老坑：同一件事有两个入口（成品列表 / 库存管理），一处漏做就静默走老逻辑。
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 2026-09-30 追加（V92）。用户看着「增加成品数量」的弹窗说：
//   「那现在这个界面的实际用量就不用了，删掉」
//   追问后拍板：「**只删面料那部分**」（面板留着管非面料）。
//
// 为什么现在可以删：V91 的裁剪界面把"面料怎么裁"整个接过去了 ——
//   每片各自填长宽、各自选布，片数减到 1 就是"这批合起来裁一块大的"
//   （V77 当初做「一件一件剪 / 合起来剪」就是为了这件事）。
// ⇒ 面板只留**不走裁剪界面**的行；有长宽的几何行一律不再出现。
//   底层那条 `{ mode:'merged' }` 覆盖路也一并收口（避免"两套并存"）。
// ---------------------------------------------------------------

test('★ ⑦ 「这批实际用料」里不许再有面料剪法（那套 UI 归裁剪界面）', () => {
  // 注入法自检：老控件必须能被抓出来（否则这条守卫没有牙）
  const oldWxml = '<view class="usage-cutmode"><text class="cm-chip">一件一件剪</text></view>';
  ok(oldWxml.indexOf('cm-chip') >= 0, '自检失败：老的「一件一件剪 / 合起来剪」控件没被检出');
  const oldMerged = '<view class="usage-merged"><ph-input ph-class="usage-input" /></view>';
  ok(oldMerged.indexOf('usage-merged') >= 0, '自检失败：老的「合起来剪」输入区没被检出');

  PANELS.forEach((rel) => {
    const wxml = stripWxml(read(rel));
    ok(wxml.indexOf('cm-chip') < 0, rel + ' 又出现了「一件一件剪 / 合起来剪」的切换控件');
    ok(wxml.indexOf('usage-merged') < 0, rel + ' 又出现了「合起来剪」的长×宽输入区');
  });
  PAGES.forEach((rel) => {
    const src = stripComments(read(rel));
    ok(src.indexOf('onCutMode') < 0, rel + ' 还留着剪法切换的处理（界面已无该控件）');
    ok(src.indexOf('onMergedInput') < 0, rel + ' 还留着「合起来剪」输入的处理');
  });

  // 底层也收口：不许再有 { mode: 'merged' } 那条路（产生了也没人报这个尺寸）
  const mergedRe = /mode\s*:\s*['"]merged['"]/;
  ok(mergedRe.test("out[id] = { mode: 'merged', length: 1, width: 1 };"), '自检失败：merged 写法没被检出');
  ok(!mergedRe.test(stripComments(read('utils/calc.js'))),
    'utils/calc.js 里还留着 mode:merged 的产生处（已无人调用）');
  ok(!mergedRe.test(stripComments(read('utils/store.js'))),
    'utils/store.js 里还留着 mode:merged 的分支（已无人调用）');
});


// ---------------------------------------------------------------
// 2026-09-29 追加（V78）。用户把要求说死了：
//   「我说的一件一件，是每一件都由我来剪裁，都由我来确定
//     不是只确定一件剪裁，其他的都跟他一样」
// 2026-09-30（V89→V90）用户把"怎么表达这份决定权"改了两次，最后定成：
//   「增加成品数量…当数量大于1的时候，在剪裁界面 可以自定义大小和片数」
//   「不是每一片都是一样的大小，可以每一片自定义长宽」
//   「不同的裁片也可以选不同的布片放」
// ⇒ 承载"每一片由我决定"的界面从**逐件确认**换成**一屏排完**：
//   这一屏列出这批的每一片，每片各自填长宽、各自选布，摆好一次确认。
//   —— 变的只是"确认几次"，不变的是"**每一片都得由用户自己定**"。
//   所以这条守卫测的核心从来不是"点了 N 次"，而是：**每片能不能单独定**。
// ---------------------------------------------------------------

test('★ ⑧ 裁剪界面必须让每一片都能单独定（不许退回「选一次，其余自动沿用」）', () => {
  const wxml = stripWxml(read('pages/cut-editor/cut-editor.wxml'));
  const js = stripComments(read('pages/cut-editor/cut-editor.js'));

  // ⚠️ 2026-10-04 V112：`queueMode` 这个锚点失效了 —— 「做 N 件」搬去导航栏后，
  //    模板那一行里不再有它。这条要护的是「**排片模式下每片都能单独定**」，
  //    那件事的证据不是那个变量名，而是：片列表 + 每片各自的尺寸输入 + 每片自己的转 90°。
  ok(/wx:for="\{\{parts\}\}"/.test(wxml) && /setPartLen/.test(wxml) && /rotPart/.test(wxml),
    '排片模式要有独立分支（片列表 + 每片各自的尺寸输入 + 转 90°）');
  ok(wxml.indexOf('自动沿用') < 0,
    '又出现「后续自动沿用最优」这类提示了 —— 那正是用户明确否掉的做法');

  // 页面：片列表，且每片都能改尺寸 / 换布（用户 V90 的两句原话就是这两件事）
  ok(/parts/.test(wxml), 'wxml 里要有「这批要裁的每一片」这个列表');
  ok(/setPartLen/.test(wxml) && /setPartWid/.test(wxml),
    '片列表里每片都要能**单独**改长宽（「可以每一片自定义长宽」）');
  ok(/pickBoard/.test(wxml), '每片都要能**单独**换布（「不同的裁片也可以选不同的布片放」）');
  // V91：加减的是**片**（片数与件数分开）——「做 4 件只裁 1 块」就靠它
  ok(/addPiece/.test(wxml) && /removePiece/.test(wxml), '片数要能加减（「可以自定义…片数」）');

  // js：影子布片（同屏多片不许互相叠着）+ 每片各自找落脚处 + 入参
  ok(/applyCutToPieces/.test(js), '要更新影子布片（同屏内两片叠着也算"放得下"就白算了）');
  ok(/placePart/.test(js), '每片要各自找落脚处');
  ok(/passQueue/.test(js), '入参必须是队列 passQueue');
  ok(js.indexOf('passTasks') < 0, '旧的「每个物料一条」入口要彻底去掉，别两套并存');

  // 注入法自检：老写法必须抓得出来
  const old = "qtyHint: multi ? '（增加多件时，首件按所选方案，后续自动沿用最优）' : ''";
  ok(old.indexOf('自动沿用') >= 0, '自检失败：老提示语没被检出 —— 这条守卫没有牙');
});
