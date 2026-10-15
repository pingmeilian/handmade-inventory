// tests/add-dialog-carry.test.js —— 「新增」弹窗 ⇄ 详细编辑页：来回一整趟都不许掉链子
//   （V138 去程：内容要带过去；V139 回程：保存成功要把弹窗关掉（别重复入库）；
//     V140 回程提速：这个"关"必须在**返回之前**完成 —— 否则用户会看到弹窗闪一下）
//
// 用户报的 bug（原话）：
//   ① 「我新增灵感，填好了标题和图片之后，点详细编辑，标题和图片就消失了　标题和图片应该带在里边」
//   ② 「我新增想做界面点详细编辑 编辑好后保存 保存后返回还是这个新增想做界面　再点一次保存就会重新保存一次」
//   ③ 「在编辑页点完保存之后，会返回，但是那个弹窗还能看见，会闪一下」（2026-10-11 跟进）
//
// 查实：灵感列表与想做列表的「＋ 新增」是一个小弹窗（标题 + 图片 [+ 链接]），
//   里面那行「详细编辑 ›」**绑的是 `goEdit`**，而 `goEdit` 就是一句裸跳
//   （`util.navTo('/pages/inspiration/edit')`，不带任何参数）
//   ⇒ 弹窗里填的东西全丢，用户到了详细编辑页只能重填。
//
// 修法：弹窗的「详细编辑」改走 `goAddDetail`，把已填内容写进**一次性草稿**
//   （`services/draft.js`），并带 `?from=add` 跳过去；编辑页只在带标记时取用（take 会清空）。
//   ⚠️ 为什么不用 URL 参数：图片最多 6~9 条路径、标题也可能很长，拼进 query 长度不可控。
//
// ⚠️ 两条最容易写错的地方，本文件专门钉住：
//   ① **只有从弹窗进来才许取草稿** —— 否则"上一次没被取走的草稿"会串到下一次普通新增里；
//   ② **草稿是"取一次就没了"** —— 否则同一份内容会反复灌进下一次新建。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const F = require('./fixtures.js');
const wxStub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');

const draft = require('../services/draft.js');
const util = require('../utils/util.js');
const store = F.store;

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// 取「详细编辑」那一行（两个列表页各一处）
function addMoreLine(rel) {
  const w = stripWxml(read(rel));
  const m = /<view class="add-more"[^>]*>/.exec(w);
  return m ? m[0] : '';
}

function navCount() { return wxStub.navs('navigateTo').length; }

group('新增弹窗 → 详细编辑页 · 内容带过去（V138）');

test('★ ① 「详细编辑」必须绑 `goAddDetail`（不是裸跳的 goEdit）', () => {
  [['pages/inspiration/list.wxml', 'pages/inspiration/list.js'],
    ['pages/want/list.wxml', 'pages/want/list.js']].forEach(([wxmlRel, jsRel]) => {
    const line = addMoreLine(wxmlRel);
    ok(!!line, wxmlRel + ' 里找不到「详细编辑」那一行（class="add-more"）—— 锚点漂了就更新这条');
    ok(/bindtap="goAddDetail"/.test(line),
      '★ ' + wxmlRel + ' 的「详细编辑」应绑 goAddDetail，实际：' + line);
    ok(!/bindtap="goEdit"/.test(line),
      '★ 不许再绑 goEdit —— 它是裸跳，会把弹窗里填的标题 / 图片丢掉（本次 bug 的原因）');

    const js = stripJs(read(jsRel));
    ok(/goAddDetail\s*\(/.test(js), jsRel + ' 里应有 goAddDetail()');
    ok(/draft\.set\(/.test(js), '★ goAddDetail 必须把已填内容写进草稿（否则照样丢）');
    ok(/products|inspiration|want/.test(js) && /from=add/.test(js),
      '★ 跳转必须带 `?from=add` —— 编辑页靠它区分"是不是从弹窗来的"');
  });

  // 注入自检：老写法必须能被判出来
  const oldLine = '<view class="add-more" bindtap="goEdit">详细编辑 ›</view>';
  ok(!/bindtap="goAddDetail"/.test(oldLine), '自检失败：老的裸跳写法没被检出 —— 这条守卫没有牙');
});

test('★ ② 灵感列表：点「详细编辑」→ 草稿里有标题与图片，且跳到 /pages/inspiration/edit?from=add', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/inspiration/list.js');
  page.setData({ addTitle: '亲亲亲亲', addPhotos: ['p_a.jpg', 'p_b.jpg'] });

  const before = navCount();
  page.goAddDetail();

  const d = draft.peek();
  ok(!!d, '★ 点了「详细编辑」之后必须留下草稿（改前什么都没有）');
  equal(d.kind, 'inspiration');
  equal(d.title, '亲亲亲亲', '★ 标题要带过去（用户填的就是它）');
  equal(d.photos.length, 2, '★ 图片要带过去（用户传的就是它）');

  const nav = wxStub.navs('navigateTo')[before];
  ok(!!nav, '应发生一次跳转');
  equal(nav.url, '/pages/inspiration/edit?from=add', '★ 跳到详细编辑页并带 from=add');
});

test('★★ ③ 灵感编辑页：带 from=add 进来 ⇒ 标题与图片回填，且草稿被清空', () => {
  F.reset();
  draft.clear();
  draft.set('inspiration', { title: '亲亲亲亲', photos: ['p_a.jpg', 'p_b.jpg'] });

  const page = loadPage('../pages/inspiration/edit.js');
  page.onLoad({ from: 'add' });

  equal(page.data.title, '亲亲亲亲', '★ 标题必须回填（本次 bug 的正面断言）');
  equal(page.data.photos.length, 2, '★ 图片必须回填');
  equal(page.data.isEdit, false, '这仍然是"新增"，不是编辑既有记录');
  equal(draft.peek(), null, '★ 草稿是"取一次就没了" —— 否则同一份会反复灌进下一次新建');
});

test('★★ ④ 普通新增（不带 from=add）不许取草稿 —— 防"旧草稿串台"', () => {
  F.reset();
  draft.clear();
  draft.set('inspiration', { title: '别人的草稿', photos: ['x.jpg'] });

  const page = loadPage('../pages/inspiration/edit.js');
  page.onLoad({});                      // 例如从空态按钮 / 别处进来
  equal(page.data.title, '', '★ 普通新增必须是空的，不许被旧草稿污染');
  equal(page.data.photos.length, 0, '★ 图片也一样');
  ok(!!draft.peek(), '★ 而且草稿**不该被消费掉**（没消费才说明真的没取）');

  const page2 = loadPage('../pages/inspiration/edit.js');
  page2.onLoad({ from: 'other' });      // 未知来源同理
  equal(page2.data.title, '', '未知 from 一律当作普通新增');
});

test('⑤ 草稿语义：取一次就没了；kind 不匹配取不到；非法 kind 写不进', () => {
  draft.clear();
  ok(draft.take('inspiration') === null, '空草稿 ⇒ take 返回 null（不许返回 undefined 让调用方踩）');

  draft.set('want', { title: 'T' });
  ok(draft.take('inspiration') === null, '★ kind 不匹配 ⇒ 取不到（灵感页不该拿到想做的草稿）');
  equal(draft.peek().kind, 'want', '而且不匹配时**不许**把草稿清掉');
  equal(draft.take('want').title, 'T', '匹配才取得到');
  ok(draft.peek() === null, '★ 取走之后必须清空');

  draft.clear();
  ok(draft.set('bogus', { title: 'X' }) === null, '★ 非法 kind 直接不写（白名单）');
  ok(draft.peek() === null, '非法 kind 不许留下半个草稿');
});

test('★ ⑥ 想做列表：同样带过去（标题 + 链接 + 图片）', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/want/list.js');
  page.setData({ addTitle: '侧翻方法', addLink: 'https://example.com/v/1', addPhotos: ['w1.jpg'] });

  const before = navCount();
  page.goAddDetail();
  equal(wxStub.navs('navigateTo')[before].url, '/pages/want/edit?from=add', '跳到想做编辑页并带 from=add');

  const d = draft.take('want');
  equal(d.title, '侧翻方法');
  equal(d.link, 'https://example.com/v/1', '★ 想做弹窗里还有链接，也要带过去');
  equal(d.photos.length, 1);

  const edit = loadPage('../pages/want/edit.js');
  draft.set('want', { title: '侧翻方法', link: 'https://example.com/v/1', photos: ['w1.jpg'] });
  edit.onLoad({ from: 'add' });
  equal(edit.data.title, '侧翻方法', '想做编辑页：标题回填');
  equal(edit.data.link, 'https://example.com/v/1', '想做编辑页：链接回填');
  equal(edit.data.photos.length, 1, '想做编辑页：图片回填');
});

test('⑦ 只填了图、没填标题 ⇒ 图片照样带过去（不该因为标题空就整份丢掉）', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/inspiration/list.js');
  page.setData({ addTitle: '', addPhotos: ['only.jpg'] });
  page.goAddDetail();

  const edit = loadPage('../pages/inspiration/edit.js');
  edit.onLoad({ from: 'add' });
  equal(edit.data.title, '', '标题就是空的（用户没填）');
  equal(edit.data.photos.length, 1, '★ 但图片必须在 —— "标题空"不是丢掉图片的理由');
});

test('⑧ 两个列表页的空态按钮仍走 goEdit（不许被误改）', () => {
  // 空态那一下是「+ 添加」，本来就没有草稿可带 —— 保持裸跳
  ['pages/inspiration/list.wxml', 'pages/want/list.wxml'].forEach((rel) => {
    const w = stripWxml(read(rel));
    ok(/bind:action="goEdit"/.test(w), rel + ' 的空态按钮应仍是 goEdit');
  });
});

/* ===================== V139：回程信号（保存成功 ⇒ 回来把弹窗关掉） =====================
   用户报的 bug：「我新增想做界面点详细编辑，编辑好后保存，保存后返回**还是这个新增想做界面**，
   再点一次保存就会重新保存一次」。
   根因：点「详细编辑」时列表页的弹窗**没关**（showAdd 仍 true、字段还留着）⇒ 从编辑页返回时
   弹窗原样摆在眼前，再点它下面的「保存」就**又存一条**。
   ⇒ 编辑页**真的落库了**才发一个回程信号（`draft.markSaved`），列表页 `onShow` 里
     `takeSaved` 收到才关弹窗；**没保存就不许关**（否则中途返回会把用户填的东西弄丢）。 */

group('新增弹窗 · 保存后回程信号（V139）');

test('★ ⑨ markSaved / takeSaved 语义：收到一次就清掉；非法 kind 不置位', () => {
  draft.clear();
  equal(draft.takeSaved('want'), false, '什么都没标记 ⇒ false');
  equal(draft.markSaved('want'), true);
  equal(draft.takeSaved('want'), true, '★ 标记过 ⇒ 第一次取到 true');
  equal(draft.takeSaved('want'), false, '★ 取过一次就清掉（否则每次 onShow 都会关一次弹窗）');
  equal(draft.markSaved('bogus'), false, '非法 kind 不许置位');
  equal(draft.takeSaved('inspiration'), false, 'want 的信号不许被 inspiration 取走');
});

test('★★ ⑩ 想做列表：收到回程信号 ⇒ 弹窗关掉且字段清空（再也不会"再点一次又存一条"）', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/want/list.js');
  page.setData({ showAdd: true, addTitle: '侧翻方法', addPhotos: ['w1.jpg'] });

  draft.markSaved('want');
  page.onShow();

  equal(page.data.showAdd, false, '★ 弹窗必须关掉（改前它一直在，用户再点保存就重复存一条）');
  equal(page.data.addTitle, '', '★ 标题要清空（否则下次打开弹窗还带着旧内容）');
  equal(page.data.addPhotos.length, 0, '图片也要清空');
});

test('★★ ⑪ 没保存就返回 ⇒ 弹窗必须原样留着（内容不许被弄丢）', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/want/list.js');
  page.setData({ showAdd: true, addTitle: '还没保存呢', addPhotos: ['w1.jpg'] });

  page.onShow();   // 什么都没标记

  equal(page.data.showAdd, true, '★ 用户中途返回（没保存）⇒ 弹窗要还在');
  equal(page.data.addTitle, '还没保存呢', '★ 内容也不能丢 —— 这是"只在真保存后才关"的理由');
  equal(page.data.addPhotos.length, 1);
});

test('★ ⑫ 想做编辑页：从弹窗进来 + 保存成功 ⇒ 发回程信号', () => {
  F.reset();
  draft.clear();
  const page = loadPage('../pages/want/edit.js');
  page.onLoad({ from: 'add' });
  page.setData({ title: '侧翻方法' });
  page.save();

  equal(store.getWants().filter(x => x.title === '侧翻方法').length, 1, '记录确实存下来了');
  equal(draft.takeSaved('want'), true, '★ 保存成功要发回程信号（列表页靠它关弹窗）');
});

test('★ ⑬ 想做编辑页：标题为空被拦下 ⇒ **不许**发信号（弹窗要留着）', () => {
  F.reset();
  draft.clear();
  const before = store.getWants().length;
  const page = loadPage('../pages/want/edit.js');
  page.onLoad({ from: 'add' });
  page.setData({ title: '' });
  page.save();

  equal(store.getWants().length, before, '没标题 ⇒ 没存进去');
  equal(draft.takeSaved('want'), false, '★ 没保存成功就不该关弹窗（否则用户填的内容就没了）');
});

test('★ ⑭ 不是从弹窗进来的（如空态按钮）⇒ 保存后**不许**动列表页的弹窗', () => {
  F.reset();
  draft.clear();
  const list = loadPage('../pages/want/list.js');
  list.setData({ showAdd: true, addTitle: '别人开着的弹窗', addPhotos: ['other.jpg'] });
  const page = loadPage('../pages/want/edit.js');
  page.onLoad({});                     // 普通新增
  page.setData({ title: '普通新增' });

  // ⚠️ 把开着的弹窗放在页面栈里：改前"普通新增"确实不碰它，但守卫得能证明这一点
  //   （否则将来有人把 closeAddOnStack 挪到 if 外面，这条就悄悄失效了）
  withStack([list, page], () => page.save());

  ok(store.getWants().some(x => x.title === '普通新增'), '记录照常存下来');
  equal(draft.takeSaved('want'), false, '★ 没走弹窗这条路 ⇒ 不该给列表页发信号');
  equal(list.data.showAdd, true, '★ 也不许去关别人开着的弹窗（普通新增跟它没关系）');
  equal(list.data.addTitle, '别人开着的弹窗', '★ 内容更不许被清掉');
});

test('★ ⑮ 回程信号必须挂在 `_ensureSaved` 里（所有落库路径的唯一出口）', () => {
  [['pages/want/edit.js', 'want'], ['pages/inspiration/edit.js', 'inspiration']].forEach(([rel, kind]) => {
    const js = stripJs(read(rel));
    const start = js.indexOf('_ensureSaved() {');
    const end = js.indexOf('save() {', start);
    ok(start > 0 && end > start, rel + ' 里找不到 _ensureSaved() 函数体 —— 锚点漂了就更新这条');
    const body = js.slice(start, end);
    ok(body.indexOf("markSaved('" + kind + "')") > 0,
      '★ ' + rel + ' 的 `_ensureSaved` 里必须发回程信号 —— 它是「保存」和「转为成品」**两条**落库路径的共同出口；' +
      '只写在「保存」按钮里，走「转为成品」时就会漏（弹窗又留在那儿）');
    ok(/this\._fromAdd/.test(body), '★ 而且要判 `this._fromAdd`：不是从弹窗进来的就不该发信号');
  });
});

test('★ ⑯ 灵感侧同样：列表关弹窗 + 编辑页发信号', () => {
  F.reset();
  draft.clear();
  const list = loadPage('../pages/inspiration/list.js');
  list.setData({ showAdd: true, addTitle: '亲亲亲亲', addPhotos: ['p.jpg'] });
  draft.markSaved('inspiration');
  list.onShow();
  equal(list.data.showAdd, false, '灵感列表：收到信号要把弹窗关掉');
  equal(list.data.addTitle, '', '灵感列表：字段清空');

  const edit = loadPage('../pages/inspiration/edit.js');
  edit.onLoad({ from: 'add' });
  edit.setData({ title: '亲亲亲亲' });
  edit.save();
  equal(draft.takeSaved('inspiration'), true, '灵感编辑页：保存成功也要发信号');
});

/* ===================== V140：回程要「立刻关」，不可以闪一下 =====================
   用户报的 bug：「在编辑页点完保存之后，会返回，但是那个弹窗还能看见，会闪一下」。

   根因：返回时列表页是带着**上一次就已经渲染好的 DOM** 先显示出来的（弹窗还在），
   而 `onShow` 里的 setData 要等这一帧之后才生效 ⇒ 用户看到弹窗**闪一下**才消失。
   （V139 的 `takeSaved` 逻辑本身没错，错在"关得太晚"。）

   ⇒ 编辑页在**落库那一刻**就隔着页面栈把下层列表页的弹窗收掉（`draft.closeAddOnStack`），
     `takeSaved` 保留作保底。 ⚠️ 所以本组最要紧的一条是 ⑲：**在返回之前**弹窗就必须已经是关的。 */

group('新增弹窗 · 回程不闪（立刻关）（V140）');

// 页面栈桩：测试期间替换，结束一定还原（整个跑测是同一个进程，别污染别的文件）
function withStack(pages, fn) {
  const orig = global.getCurrentPages;
  global.getCurrentPages = () => pages;
  try { return fn(); } finally { global.getCurrentPages = orig; }
}

test('★ ⑰ closeAddOnStack：栈里开着弹窗的那一页被收掉（关 + 清字段），返回 true', () => {
  F.reset();
  draft.clear();
  const list = loadPage('../pages/want/list.js');
  list.setData({ showAdd: true, addTitle: '侧翻方法', addLink: 'https://e.com/1', addPhotos: ['w1.jpg'] });
  const top = { data: {} };            // 栈顶是编辑页：没有 showAdd，不该被碰

  const r = withStack([list, top], () => draft.closeAddOnStack());

  equal(r, true, '收到了一页 ⇒ 返回 true（能知道自己真做了事）');
  equal(list.data.showAdd, false, '★ 弹窗必须关掉');
  equal(list.data.addTitle, '', '★ 字段也要清 —— 只关一半会把旧标题留到下次开弹窗');
  equal(list.data.addLink, '');
  equal(list.data.addPhotos.length, 0);
  ok(!top.setData, '栈顶那页没有 showAdd ⇒ 一个字节都不该动它');
});

test('★ ⑱ 没开着弹窗 / 空栈 / 拿不到页面栈 ⇒ 返回 false，且不去调任何 closeAdd', () => {
  F.reset();
  draft.clear();
  let called = 0;
  const spy = { data: { showAdd: false }, closeAdd() { called++; } };

  equal(withStack([spy], () => draft.closeAddOnStack()), false, '弹窗本来就没开 ⇒ false');
  equal(called, 0, '★ 没开弹窗的页面不许被调用 closeAdd（正常返回路径下应当"什么都不做"）');

  equal(withStack([], () => draft.closeAddOnStack()), false, '空栈 ⇒ false，不许抛');
  equal(withStack([{ data: { showAdd: true } }], () => draft.closeAddOnStack()), false,
    '开着弹窗但这一页没有 closeAdd 能力 ⇒ 跳过，不许抛');

  // 真机上 getCurrentPages 极少数情况下不可用 —— 保存成功这件事不能被它带崩
  const orig = global.getCurrentPages;
  delete global.getCurrentPages;
  try {
    equal(draft.closeAddOnStack(), false, '拿不到页面栈 ⇒ 安静地返回 false');
  } finally { global.getCurrentPages = orig; }

  // 还有更凶的一种：拿得到、但一调就抛。**保存成功**已经发生了，不能被它带崩
  global.getCurrentPages = () => { throw new Error('boom'); };
  try {
    equal(draft.closeAddOnStack(), false, '页面栈取用抛错 ⇒ 吞掉并返回 false（弹窗由 onShow 保底去关）');
  } finally { global.getCurrentPages = orig; }
});

test('★★ ⑲ 想做编辑页：保存成功的那一刻，列表页的弹窗**在返回之前**就已经关了', () => {
  F.reset();
  draft.clear();
  const list = loadPage('../pages/want/list.js');
  list.setData({ showAdd: true, addTitle: '侧翻方法', addPhotos: ['w1.jpg'] });
  const edit = loadPage('../pages/want/edit.js');
  edit.onLoad({ from: 'add' });
  edit.setData({ title: '侧翻方法' });

  withStack([list, edit], () => edit.save());

  // ⚠️ 关键：这里**没有**调 list.onShow() —— 模拟的就是"返回还没发生（或刚好发生）"的时刻。
  //   改前这会儿 showAdd 还是 true ⇒ 页面一显示出来就看得见弹窗 ⇒ 用户说"会闪一下"。
  equal(list.data.showAdd, false, '★ 落库那一刻列表页的弹窗就必须已经关掉（这就是"不闪"的全部含义）');
  equal(list.data.addTitle, '', '★ 字段一并清掉');
  equal(store.getWants().filter(x => x.title === '侧翻方法').length, 1, '记录照常存下来');
  equal(draft.takeSaved('want'), true, '★ 保底信号也照旧发（拿不到页面栈时靠它兜）');
});

test('★ ⑳ 两个编辑页：`_ensureSaved` 里"发信号 + 立刻收弹窗"必须成对出现', () => {
  const pairs = [['pages/want/edit.js', 'markSaved(\'want\')'], ['pages/inspiration/edit.js', 'markSaved(\'inspiration\')']];
  pairs.forEach(([rel, mark]) => {
    const js = stripJs(read(rel));
    const start = js.indexOf('_ensureSaved() {');
    const end = js.indexOf('save() {', start);
    ok(start > 0 && end > start, rel + ' 里找不到 _ensureSaved() 函数体 —— 锚点漂了就更新这条');
    const body = js.slice(start, end);
    ok(body.indexOf(mark) > 0, '★ ' + rel + ' 的 _ensureSaved 里要发回程信号（保底）');
    ok(body.indexOf('draft.closeAddOnStack()') > 0,
      '★ ' + rel + ' 的 _ensureSaved 里还必须**当场**把下层弹窗收掉 —— 只发信号的话，' +
      '列表页要等返回后的 onShow 才关，那时它已经画出来了 ⇒ 弹窗会闪一下（本次 bug）');
    ok(/this\._fromAdd/.test(body), '★ 两条都要判 `this._fromAdd`：不是从弹窗进来的就不该动列表页');
  });
});

test('★ ㉑ 两个列表页的 `closeAdd` 必须是"彻底收起"（关 + 清字段）', () => {
  const insp = loadPage('../pages/inspiration/list.js');
  insp.setData({ showAdd: true, addTitle: '亲亲亲亲', addPhotos: ['p.jpg'] });
  insp.closeAdd();
  equal(insp.data.showAdd, false, '灵感列表：closeAdd 要关掉弹窗');
  equal(insp.data.addTitle, '', '★ 灵感列表：closeAdd 还要清标题（它现在会被编辑页隔着页面栈调用）');
  equal(insp.data.addPhotos.length, 0, '★ 灵感列表：图片也要清');

  const want = loadPage('../pages/want/list.js');
  want.setData({ showAdd: true, addTitle: 'T', addLink: 'https://e.com/1', addPhotos: ['w.jpg'] });
  want.closeAdd();
  equal(want.data.showAdd, false, '想做列表：closeAdd 要关掉弹窗');
  equal(want.data.addTitle, '', '★ 想做列表：标题要清');
  equal(want.data.addLink, '', '★ 想做列表：链接要清');
  equal(want.data.addPhotos.length, 0, '★ 想做列表：图片要清');
});

