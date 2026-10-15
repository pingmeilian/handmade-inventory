// tests/convert-to-edit.test.js —— V137 两条（2026-10-11 用户真机反馈 + 拍板）
//
// 一、**按钮高度**：用户（真机截图，排单详情 / 想做详情）「这两个界面下面按钮为什么高度这么窄，
//     改成和其他界面按钮一样的高度」。
//     根因不是"窄"，是**没有高度**：全局 `.btn` 只给圆角与左右内边距，
//     高度**全靠尺寸类**（btn-large 88 / btn-medium 72 / btn-small 56rpx）。
//     这两页是全项目**仅有**两页漏写尺寸类的；次要按钮还用了**别页才定义**的
//     `btn-ghost` / `btn-danger-ghost`（=`pages/settings/listEditor.wxss` 里的页面级类）
//     ⇒ 在外页等于没样式、渲染成纯文字。
//     ⇒ 本轮统一成 `btn-medium` + 全局标准变体类。本文件第①～④条就是防"再漏一个"。
//
// 二、**转成品改"预填编辑页"**：用户原话
//     「想做清单和灵感转成成品的时候，**不是直接转成成品就可以了**，而是把名字之类的信息
//      **填到成品编辑里**，之后的**物料选择之类的信息我还要填呢**，要不然成品保存了，
//      **物料那一栏都是空的**」。
//     拍板：① 取消「样品 / 待售」二选一弹窗；② **保存成功才**标「已完成/已填坑」；
//          ③ 图片与（隐藏的）图文教程照旧带过去。
//     ⇒ 旧实现 `convertWant / convertInspiration`（当场 saveProduct({bom:[]})）已删除；
//        换成 buildProductDraftFromSource（只产出预填草稿，不写库）+ markSourceConverted（保存后标记）。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const F = require('./fixtures.js');
const wxStub = require('./wx-stub.js');
const { loadPage } = require('./page-helper.js');

const store = F.store;
const util = F.util;
const K = store.KEYS;

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// 收集全项目页面 wxml
function pageWxmls() {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d).forEach((n) => {
      const a = path.join(d, n);
      if (fs.statSync(a).isDirectory()) { walk(a); return; }
      if (/\.wxml$/.test(n)) out.push({ rel: path.relative(ROOT, a).split(path.sep).join('/'), src: stripWxml(fs.readFileSync(a, 'utf8')) });
    });
  })(path.join(ROOT, 'pages'));
  return out;
}
// 取一个 wxml 里所有「带独立 btn 类」的元素（注意：`fp-btn` / `photo-btn` 这类**不算**，
// 它们是页面自己定义的另一套按钮，有自己的高度）
function btnElements(src) {
  const out = [];
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const tokens = m[1].split(/\s+/).filter(Boolean);
    if (tokens.indexOf('btn') >= 0) out.push({ raw: m[1], tokens });
  }
  return out;
}
function missingSize(src) {
  return btnElements(src).filter((b) => !b.tokens.some((t) => /^btn-(large|medium|small)$/.test(t)));
}

// ⚠️ 必须剥掉注释再查：这两页的注释里**故意**写了 `btn-ghost` 说明历史原因，
//    不剥的话守卫会被自己的注释绊倒（第一次就是这么红的）。
const wantDetail = () => stripWxml(read('pages/want/detail.wxml'));
const commissionDetail = () => stripWxml(read('pages/commission/detail.wxml'));
const toastTitles = () => wxStub.toastsOnly().map((t) => t.title);
// 新建时 store 会**强制**写入默认状态（想做 'todo' / 灵感 'draft'）⇒ 断言一律跟"改之前"比，
// 别把默认值写死在测试里（写死过一次，红得很冤）。
const wantStatus = (id) => (store.getWants().find((x) => x.id === id) || {}).status;
const inspirationStatus = (id) => (store.getInspirations().find((x) => x.id === id) || {}).status;

/* ===================== 一、按钮尺寸类 ===================== */

group('按钮尺寸类（V137：全项目不再有"没高度的按钮"）');

test('★ ① 全项目页面：带 `.btn` 的按钮**必须**带尺寸类（漏一个就红）', () => {
  const bad = [];
  pageWxmls().forEach((f) => missingSize(f.src).forEach((b) => bad.push(f.rel + ' :: ' + b.raw)));
  equal(bad.length, 0,
    '★ 这些按钮没有尺寸类 ⇒ 高度会塌成文字那么高（本次用户报的现象）：\n     ' + bad.join('\n     '));

  // 注入自检：改造前那种写法必须能被抓出来
  const oldStyle = '<view class="btn btn-primary btn-block">交付出库</view>';
  equal(missingSize(oldStyle).length, 1, '自检失败：旧的"缺尺寸类"写法没被检出 —— 这条守卫没有牙');
});

test('★ ② 排单详情 / 想做详情：每个按钮都要 `btn-medium`（与其它详情页同档）', () => {
  [['pages/commission/detail.wxml', commissionDetail()], ['pages/want/detail.wxml', wantDetail()]]
    .forEach(([rel, src]) => {
      const bs = btnElements(src);
      ok(bs.length >= 4, rel + ' 的按钮数量看起来不对（' + bs.length + '）—— 锚点漂了就更新这条');
      bs.forEach((b) => {
        ok(b.tokens.indexOf('btn-medium') >= 0,
          '★ ' + rel + ' 的按钮应为 btn-medium（72rpx，与灵感/物料/成品详情一致）：' + b.raw);
      });
    });
});

test('★ ③ 这两页不得再用**别页才定义**的类（btn-ghost / btn-danger-ghost）', () => {
  [['排单详情', commissionDetail()], ['想做详情', wantDetail()]].forEach(([name, src]) => {
    ['btn-ghost', 'btn-danger-ghost'].forEach((c) => {
      ok(src.indexOf(c) < 0,
        '★ ' + name + ' 仍在用 ' + c + ' —— 该类的定义在 pages/settings/listEditor.wxss（**页面级**），' +
        '在这里等于没有样式、会渲染成纯文字（这就是截图里"按钮变成几行字"的原因）');
    });
  });
  // 反向自检：老写法必须能被判出来
  const oldStyle = '<view class="btn btn-ghost btn-block">编辑</view>';
  ok(oldStyle.indexOf('btn-ghost') >= 0, '自检失败：老写法没被检出');
});

test('④ 全项目只允许用"有定义"的按钮变体类（防下一个 btn-xxx-ghost）', () => {
  // 全局（app.wxss）真正定义过的变体
  const app = read('app.wxss');
  const defined = new Set();
  (app.match(/\.btn-[a-z-]+/g) || []).forEach((c) => defined.add(c.slice(1)));
  ok(defined.has('btn-medium') && defined.has('btn-large'), 'app.wxss 里应能看到尺寸类定义');

  const offenders = [];
  pageWxmls().forEach((f) => {
    btnElements(f.src).forEach((b) => {
      // 页面自己 wxss 里定义过的类也算数（如 listEditor 的 btn-ghost、want 的 btn-disabled）
      const pageCss = f.rel.replace(/\.wxml$/, '.wxss');
      const css = fs.existsSync(path.join(ROOT, pageCss)) ? read(pageCss) : '';
      b.tokens.filter((t) => /^btn-/.test(t)).forEach((t) => {
        if (defined.has(t)) return;
        if (new RegExp('\\.' + t + '\\b').test(css)) return;
        // 动态类名（{{...}}）不算
        if (/[{}$]/.test(t)) return;
        offenders.push(f.rel + ' :: ' + t);
      });
    });
  });
  equal(offenders.length, 0,
    '★ 这些按钮类在全局与所在页都没定义 ⇒ 形同没样式：\n     ' + offenders.join('\n     '));
});

/* ===================== 二、转成品 = 预填编辑页 ===================== */

group('转为成品 · 预填编辑页（V137）');

// 造一条「想做」+ 一个"样板成品"（用它回填出来的 BOM 行形状最真实）
function seedWant() {
  return store.saveWant({
    title: '测试想做', desc: '参考视频里的做法', photos: ['wxfile://tmp_a.jpg'],
    categoryId: 'bc_default', status: 'pending'
  });
}
function seedSampleProduct() {
  const m = F.simpleMaterial({ name: '拉链', quantity: 10, unitPrice: 2 });
  F.seedMaterials([m]);
  const p = F.product({ name: '样板', bom: [{ materialId: m.id, materialName: m.name, usage: 1, isFabric: false }] });
  F.seedProducts([p]);
  const seedPage = loadPage('../pages/products/edit.js');
  seedPage.onLoad({ id: p.id });
  return JSON.parse(JSON.stringify(seedPage.data.bom[0]));   // 真实形状的 BOM 行
}

test('★ ⑤ 旧的两条"直接落库"函数必须消失（它们就是"物料栏全空"的来源）', () => {
  const js = read('utils/store.js');
  ['function convertWant', 'function convertInspiration',
    'function ingressFromWant', 'function ingressFromInspiration'].forEach((sig) => {
      ok(js.indexOf(sig) < 0, '★ utils/store.js 里仍有 ' + sig + '() —— 那是"当场建成品、BOM 空"的老路');
    });
  const pageJs = ['pages/want/detail.js', 'pages/want/edit.js',
    'pages/inspiration/detail.js', 'pages/inspiration/edit.js'].map(read).join('\n');
  ['convertWant', 'convertInspiration', 'ingressFrom'].forEach((n) => {
    ok(pageJs.indexOf(n) < 0, '★ 四个入口里还有页面在调 ' + n + '（半改比不改更糟）');
  });
  // 反向自检
  const oldStyle = 'const p = store.convertWant(id, kind);';
  ok(/store\.convertWant\(/.test(oldStyle), '自检失败：老调用没被检出');
});

test('★ ⑥ buildProductDraftFromSource 只产出草稿，**不写任何存储**', () => {
  F.reset();
  const w = seedWant();
  const before = store.getProducts().length;
  const statusBefore = wantStatus(w.id);      // 想做新建默认 'todo'（别写死，以真实值为准）
  const draft = store.buildProductDraftFromSource('want', w.id);

  equal(draft.name, '测试想做', '名称带过来');
  equal(draft.photos.length, 1, '图片带过来');
  ok(draft.tutorial && draft.tutorial.steps.length > 0, '教程带过来（正文取自原描述）');
  equal(draft.notes, '由想做转入', '出处标记');
  equal(draft.sourceKind, 'want');
  equal(draft.sourceId, w.id);

  equal(store.getProducts().length, before, '★ 取草稿**不许**建成品');
  equal(wantStatus(w.id), statusBefore, '★ 取草稿**不许**动来源状态');
});

test('⑦ 来源不存在 / 参数是脏的 ⇒ 返回 null（绝不半填、绝不抛）', () => {
  F.reset();
  equal(store.buildProductDraftFromSource('want', 'no_such_id'), null);
  equal(store.buildProductDraftFromSource('bogus', 'x'), null);
  equal(store.buildProductDraftFromSource('want', ''), null);
});

test('★ ⑧ markSourceConverted 才标记来源（done + 回填关联 id）', () => {
  F.reset();
  const w = seedWant();
  store.markSourceConverted('want', w.id, 'p_new');
  const after = store.getWants().find(x => x.id === w.id);
  equal(after.status, 'done', '标已完成（页面显示「已填坑」）');
  equal(after.convertedProductId, 'p_new', '回填关联成品 id');

  // 非法入参不许写坏数据
  ok(store.markSourceConverted('want', '', 'p') === null, '空 sid ⇒ 不写');
  ok(store.markSourceConverted('want', w.id, '') === null, '空 productId ⇒ 不写');
});

test('★ ⑨ 四个入口都必须跳到成品编辑页，且带对 from', () => {
  const cases = [
    ['pages/want/detail.js', 'want'],
    ['pages/want/edit.js', 'want'],
    ['pages/inspiration/detail.js', 'inspiration'],
    ['pages/inspiration/edit.js', 'inspiration']
  ];
  cases.forEach(([rel, from]) => {
    const js = stripJs(read(rel));
    ok(/products\/edit\?from=/.test(js), '★ ' + rel + ' 的「转为成品」必须跳到成品编辑页（带 from）');
    ok(new RegExp("products/edit\\?from=" + from + "&sid=").test(js),
      '★ ' + rel + ' 应带 from=' + from + '&sid=…');
    ok(js.indexOf('showActionSheet') < 0,
      '★ ' + rel + ' 不该再弹「样品 / 待售」二选一（用户拍板取消；编辑页本来就有那个开关）');
  });
});

test('★★ ⑩ 进编辑页只预填、**不建成品**；来源仍是"待填坑"', () => {
  F.reset();
  seedSampleProduct();
  const w = seedWant();
  const beforeCount = store.getProducts().length;
  const statusBefore = wantStatus(w.id);

  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ from: 'want', sid: w.id });

  equal(page.data.name, '测试想做', '名称预填');
  equal(page.data.photos.length, 1, '图片预填');
  equal(page.data.notes, '由想做转入', '出处标记预填');
  ok(page.data.tutorial.title.indexOf('测试想做') >= 0, '教程标题预填');
  ok(page.data.isEdit === false, '这是"新建成品"，不是编辑既有成品');
  equal(page.data.id, '', 'id 必须为空（否则会覆盖别人的成品）');

  equal(store.getProducts().length, beforeCount, '★ 进编辑页**不许**新建成品');
  equal(wantStatus(w.id), statusBefore,
    '★ 进编辑页**不算**已填坑（' + statusBefore + '）—— 用户中途退出时不该显示"已完成"');
  ok(!store.getWants().find(x => x.id === w.id).convertedProductId, '关联 id 也必须还是空的');
});

test('★★ ⑪ 保存成功 ⇒ 才建成品 + 标已填坑 + 回填关联', () => {
  F.reset();
  const row = seedSampleProduct();
  const w = seedWant();
  const beforeCount = store.getProducts().length;

  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ from: 'want', sid: w.id });
  page.setData({ bom: [row] });     // 模拟用户「选了物料」
  page.save();

  const after = store.getWants().find(x => x.id === w.id);
  equal(store.getProducts().length, beforeCount + 1, '保存后才新增一条成品');
  equal(after.status, 'done', '★ 保存成功后才标「已填坑」');
  ok(!!after.convertedProductId, '★ 要回填关联成品 id');
  ok(store.getProduct(after.convertedProductId), '回填的 id 必须真能取到成品');
  equal(store.getProduct(after.convertedProductId).notes, '由想做转入', '出处标记存进去了');
  ok(store.getProduct(after.convertedProductId).photos.length === 1, '图片带过去了');

  // 落点：保存后直接进成品详情（沿用改造前的落点）
  ok(/redirectTo\(\{\s*url:\s*'\/pages\/products\/detail\?id='/.test(stripJs(read('pages/products/edit.js'))),
    '★ 从来源转过来保存后，应 redirectTo 成品详情 —— 别让用户自己去找那条刚建的成品');
});

test('★★ ⑫ 没选物料就保存 ⇒ 被拦下，**不建成品也不标已填坑**（这条正是用户抱怨的场景）', () => {
  F.reset();
  seedSampleProduct();
  const w = seedWant();
  const beforeCount = store.getProducts().length;
  const statusBefore = wantStatus(w.id);

  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ from: 'want', sid: w.id });
  page.save();      // 没 setData bom ⇒ 空 BOM

  ok(toastTitles().some((t) => /物料/.test(t)),
    '应提示「请至少添加一项物料(BOM)」，实际：' + toastTitles().join(' / '));
  equal(store.getProducts().length, beforeCount, '★ 不许建出"物料栏全空"的成品（本次需求要杜绝的正是这个）');
  equal(wantStatus(w.id), statusBefore, '★ 被拦下 ⇒ 来源仍是"待填坑"（' + statusBefore + '）');
});

test('⑬ 参数无效时按"普通新建"处理（不崩、不半填）', () => {
  F.reset();
  seedSampleProduct();
  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ from: 'want', sid: 'no_such_id' });
  equal(page.data.name, '', '取不到来源 ⇒ 名称保持空，不填垃圾');
  equal(page.data.photos.length, 0, '图片保持空');
  equal(page.data.notes, '', '出处标记保持空');
  equal(page.data.isEdit, false, '仍是"新建"');

  const page2 = loadPage('../pages/products/edit.js');
  page2.onLoad({ from: 'bogus', sid: 'x' });
  equal(page2.data.name, '', '未知的 from 一律忽略');
});

test('⑭ 灵感 → 成品：同样只预填、不落库（两个来源口径一致）', () => {
  F.reset();
  const ins = store.saveInspiration({
    title: '测试灵感', desc: '草图想法', photos: [], categoryId: 'bc_default', status: 'pending'
  });
  const before = store.getProducts().length;
  const statusBefore = inspirationStatus(ins.id);
  const page = loadPage('../pages/products/edit.js');
  page.onLoad({ from: 'inspiration', sid: ins.id });

  equal(page.data.name, '测试灵感', '名称预填');
  equal(page.data.notes, '由灵感转入', '出处标记');
  equal(store.getProducts().length, before, '★ 不落库');
  equal(inspirationStatus(ins.id), statusBefore, '★ 来源状态不动（' + statusBefore + '）');
});
