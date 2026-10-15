// tests/craft-presets.test.js —— 出厂预设扩充与"补齐"迁移（V150）
//
// 用户要求（原话）：
//   「还有物料预设，加**花边嵌条**等等的，你自己去搜一下这些缝纫需要用到的预设 以及他们属性
//     **拼豆、粘土、钩织、串珠这些空间也加一些默认的预设**，你自己在网上搜一下」
//
// 所以本次交付两样东西：
//   ① 缝纫空间加 7 个辅料分类（花边 / 嵌条与包边 / 织带与绳带 / 松紧带 / 纽扣 / 衬布 / 装饰辅料）；
//   ② 新增 4 个手作空间（拼豆 / 粘土 / 钩织 / 串珠），各自带物料分类与成品品类。
//   各分类的属性维度都要**真的能用**（联网查过各门类区分规格时到底看哪些字段）。
//
// 本文件盯四件事：
//   · **新装**拿到的出厂值对不对（含"既有分类一个字没动"的回归绊线）；
//   · **老用户**跑迁移后能不能看到（出厂预设只对新装生效，老数据必须靠迁移）；
//   · **不动用户的东西**（自建的同名空间 / 同名分类 / 改过的名字 / 自己的单位）；
//   · **只补一次**（用户删掉的出厂项不许被"复活"）。
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const presets = require('../services/presets.js');
const palette = require('../utils/palette.js');

// ---------- 小助手 ----------
function fresh() { stub.resetStorage(); store.ensureSeed(); }
function catsOf(spaceId) { return store.getListAll('materialCategory').filter(c => c.categoryId === spaceId); }
function pcsOf(spaceId) { return store.getListAll('productCategory').filter(c => c.categoryId === spaceId); }
function unitsOf(spaceId) { return store.getListAll('unit').filter(c => c.categoryId === spaceId); }
function cat(id) { return store.getListAll('materialCategory').filter(c => c.id === id)[0]; }
function dimNames(c) { return (c.attrDimensions || []).map(d => d.name); }

// 还原成"V149 时代的老用户"：只有缝纫空间 + 原来那 6 个分类 + 只有一条单位，版本号退回 4
function legacy() {
  fresh();
  storage.set(KEYS.BUSINESS_CATEGORIES, [{ id: 'bc_default', name: '缝纫', sort: 0, createdAt: '2026-01-01' }]);
  storage.set(KEYS.MATERIAL_CATEGORIES, [
    { id: 'mc_fabric', name: '面料', categoryId: 'bc_default', defaultUnit: '米', isFabric: true, sort: 0,
      attrDimensions: [{ name: '颜色', options: ['粉色', '蓝色'] }, { name: '材质', options: ['纯棉', '粗布'] }] },
    { id: 'mc_label', name: '布标', categoryId: 'bc_default', defaultUnit: '个', sort: 1, attrDimensions: [] },
    { id: 'mc_other', name: '其他', categoryId: 'bc_default', defaultUnit: '个', sort: 5, attrDimensions: [] }
  ]);
  storage.set(KEYS.PRODUCT_CATEGORIES, [{ id: 'pc_other', name: '其他', categoryId: 'bc_default', sort: 4 }]);
  storage.set(KEYS.UNITS, [{ id: 'u_my', name: '自定义单位', sort: 0, categoryId: 'bc_default' }]);
  storage.set(KEYS.MIGRATED_CRAFT_PRESETS, false);
  storage.set(KEYS.SCHEMA_VERSION, 4);
}

// ==================== 新装 ====================
group('出厂预设 · 新装（V150）');

test('★ 五个手作空间：缝纫打头，拼豆 / 粘土 / 钩织 / 串珠跟上', () => {
  fresh();
  const list = store.getBusinessCategories();
  equal(list.length, 5, '出厂 5 个空间，实际 ' + list.map(x => x.name).join('、'));
  equal(list.map(x => x.name).join('/'), '缝纫/拼豆/粘土/钩织/串珠');
  equal(list[0].id, 'bc_default', '默认空间 id 不许改（多处逻辑认它）');
  equal(list.map(x => x.sort).join(','), '0,1,2,3,4');
});

test('★ 缝纫：既有 6 个分类一个字没动，新增 7 个排在**后面**', () => {
  // 这条是本文件的回归绊线：缩略图配色是按**下标**取的（utils/palette.js），
  // 新分类插到中间会让老用户看到"颜色全变了"⇒ 必须追加在末尾。
  fresh();
  const list = catsOf('bc_default');
  equal(list.map(c => c.name).join('、'),
    '面料、布标、拉链、珠饰、棉花、其他、花边、嵌条与包边、织带与绳带、松紧带、纽扣、衬布、装饰辅料',
    '顺序即配色下标，不许乱');
  equal(list.slice(0, 6).map(c => c.id).join(','),
    'mc_fabric,mc_label,mc_zipper,mc_bead,mc_cotton,mc_other',
    '既有 6 个的 id 与顺序必须与 V149 完全一致');
  equal(list.slice(-7).map(c => c.id).join(','),
    'mc_lace,mc_binding,mc_webbing,mc_elastic,mc_button,mc_interlining,mc_trim');
});

test('★ 配色回归：新分类追加在末尾 ⇒ 既有分类的取色下标不变', () => {
  fresh();
  const all = catsOf('bc_default');
  all.slice(0, 6).forEach((c) => {
    const withNew = palette.colorOf(all, c.id, 0);
    const withoutNew = palette.colorOf(all.slice(0, 6), c.id, 0);
    equal(withNew.bg, withoutNew.bg, c.name + ' 的缩略图底色不该因为新增分类而变');
  });
});

test('每个空间都有物料分类与成品品类，且都以「其他」兜底', () => {
  fresh();
  presets.SPACES.forEach((sp) => {
    const mc = catsOf(sp.id);
    const pc = pcsOf(sp.id);
    ok(mc.length >= 4, sp.name + ' 的物料分类太少（' + mc.length + '）');
    ok(pc.length >= 5, sp.name + ' 的成品品类太少（' + pc.length + '）');
    ok(mc.some(c => c.name === '其他'), sp.name + ' 必须有「其他」物料分类 —— 删分类时的兜底靠它');
    ok(pc.some(c => c.name === '其他'), sp.name + ' 必须有「其他」成品品类');
    ok(unitsOf(sp.id).length >= 8, sp.name + ' 的单位预设要给（不给的话预设设置里那页是空的）');
  });
});

test('★ 每个分类的 id 全局唯一（配置列表是"一张大表 + 按空间过滤"）', () => {
  fresh();
  [KEYS.MATERIAL_CATEGORIES, KEYS.PRODUCT_CATEGORIES].forEach((key) => {
    const ids = storage.get(key, []).map(c => c.id);
    equal(new Set(ids).size, ids.length, key + ' 里有重复 id ⇒ find() 会取到别的空间那条');
  });
});

test('★ 每个分类的属性维度都"真的能用"：维度名唯一、非空、选项够用', () => {
  fresh();
  store.getListAll('materialCategory').forEach((c) => {
    if (c.name === '其他') { equal((c.attrDimensions || []).length, 0, '「其他」不带维度'); return; }
    const dims = c.attrDimensions || [];
    ok(dims.length >= 1, c.name + ' 至少要有一个属性维度');
    const names = dims.map(d => d.name);
    equal(new Set(names).size, names.length, c.name + ' 里有重名维度：' + names.join('、'));
    dims.forEach((d) => {
      ok(d.name, c.name + ' 有空名维度');
      ok(Array.isArray(d.options), c.name + ' · ' + d.name + ' 的 options 不是数组');
      ok(d.options.length >= 2, c.name + ' · ' + d.name + ' 只有 ' + d.options.length + ' 个选项（没意义）');
    });
  });
});

test('★ 缝纫新分类的属性对齐行业口径（宽度 / 材质 / 类型三维）', () => {
  fresh();
  const lace = cat('mc_lace');
  equal(dimNames(lace).join('、'), '类型、材质、宽度、颜色');
  ok(lace.attrDimensions.find(d => d.name === '宽度').options.indexOf('9mm') >= 0,
    '花边宽度要含 7/9/12mm 这类实际规格');
  equal(cat('mc_binding').defaultUnit, '米', '嵌条与包边按米买');
  ok(dimNames(cat('mc_binding')).indexOf('类型') >= 0, '嵌条要能分"单折/双折/嵌线"');
  ok(dimNames(cat('mc_button')).indexOf('孔数') >= 0, '纽扣要能分 2 孔 / 4 孔');
  ok(dimNames(cat('mc_interlining')).indexOf('克重') >= 0, '衬布按克重区分');
  ok(dimNames(cat('mc_webbing')).indexOf('宽度') >= 0, '织带按宽度区分');
});

test('★ 四个新空间各自带"门类专用"维度（不是照抄缝纫那套）', () => {
  fresh();
  // 拼豆：尺寸分档（Mini 2.6 / 中颗 3 / Midi 5 / Maxi 10）是行业口径
  const bead = cat('mc_perler_bead');
  ok(dimNames(bead).indexOf('尺寸') >= 0, '拼豆要按尺寸分档');
  ok(bead.attrDimensions.find(d => d.name === '尺寸').options.join('|').indexOf('2.6mm') >= 0, '要有 2.6mm（迷你）');
  ok(dimNames(bead).indexOf('色号体系') >= 0, '拼豆要能记色号体系（COCO291 / Perler / Hama…）');
  // 粘土：泥种分开成分类（固化方式完全不同，混在一起必买错）
  ok(catsOf('bc_clay').some(c => c.name === '超轻粘土'), '粘土要有超轻粘土分类');
  ok(catsOf('bc_clay').some(c => c.name === '软陶'), '粘土要有软陶分类（它要烤箱、别的不需要）');
  ok(dimNames(cat('mc_clay_polymer')).indexOf('品牌') >= 0, '粘土的品牌是选购关键（FIMO/Sculpey/爱乐陶…）');
  // 钩织：线材与钩针号是配套关系
  ok(dimNames(cat('mc_yarn')).indexOf('规格') >= 0, '毛线要能记股数 / 蕾丝线号');
  ok(dimNames(cat('mc_hook')).indexOf('直径') >= 0, '钩针要能记 mm 直径');
  // 串珠：孔径与线材直径必须能对上（新手第一个坑）
  ok(dimNames(cat('mc_bead_stone')).indexOf('孔径') >= 0, '珠子要能记孔径');
  ok(dimNames(cat('mc_bead_thread')).indexOf('直径') >= 0, '线材要能记直径');
});

test('★ 新分类的默认单位必须都在单位预设名单里（否则编辑页下拉选不中）', () => {
  fresh();
  const units = store.getUnitPresets();
  store.getListAll('materialCategory').forEach((c) => {
    ok(units.indexOf(c.defaultUnit) >= 0,
      c.name + ' 的默认单位「' + c.defaultUnit + '」不在单位预设里 ⇒ 编辑页会退回第一个单位');
  });
});

// ==================== 老用户迁移 ====================
group('出厂预设 · 老用户迁移（V150）');

test('★★ 迁移：老用户拿到 4 个新空间 + 缝纫那 7 个新分类', () => {
  legacy();
  store.runMigrations();
  const names = store.getBusinessCategories().map(x => x.name);
  ['拼豆', '粘土', '钩织', '串珠'].forEach((n) => ok(names.indexOf(n) >= 0, '老用户升级后要有「' + n + '」空间'));
  const sewing = catsOf('bc_default').map(c => c.name);
  ['花边', '嵌条与包边', '织带与绳带', '松紧带', '纽扣', '衬布', '装饰辅料']
    .forEach((n) => ok(sewing.indexOf(n) >= 0, '缝纫要补上「' + n + '」'));
  ok(unitsOf('bc_perler').length > 0, '新空间的单位也要补（否则预设设置里那页是空的）');
});

test('★ 迁移不动用户的任何东西：改过的名字 / 已有分类的内容一字不改', () => {
  legacy();
  // 用户把「面料」改名为「外层布」并自己加过一个分类
  const list = storage.get(KEYS.MATERIAL_CATEGORIES, []);
  list[0].name = '外层布';
  list.push({ id: 'mc_mine', name: '我自己的分类', categoryId: 'bc_default', defaultUnit: '个', sort: 9, attrDimensions: [] });
  storage.set(KEYS.MATERIAL_CATEGORIES, list);
  store.runMigrations();

  equal(cat('mc_fabric').name, '外层布', '★ 用户改过的名字不许被改回去');
  ok(cat('mc_mine'), '用户自建的分类还在');
  // V145 那条迁移仍照旧给「材质」维度补项（与本条迁移互不干扰）
  equal(cat('mc_fabric').attrDimensions.find(d => d.name === '颜色').options.join('、'), '粉色、蓝色', '用户填过的选项不许动');
});

test('★★ 幂等：连跑两次、版本退回再跑，集合一个字不变', () => {
  legacy();
  store.runMigrations();
  const snapMc = JSON.stringify(store.getListAll('materialCategory'));
  const snapBc = JSON.stringify(store.getBusinessCategories());
  store.runMigrations();
  storage.set(KEYS.SCHEMA_VERSION, 0);
  store.runMigrations();
  equal(JSON.stringify(store.getListAll('materialCategory')), snapMc);
  equal(JSON.stringify(store.getBusinessCategories()), snapBc);
});

test('★ 只补一次：用户后来删掉的出厂分类不会被"复活"', () => {
  legacy();
  store.runMigrations();
  // 用户删掉「装饰辅料」
  storage.set(KEYS.MATERIAL_CATEGORIES, store.getListAll('materialCategory').filter(c => c.id !== 'mc_trim'));
  storage.set(KEYS.SCHEMA_VERSION, 0);   // 逼整条迁移链重跑
  store.runMigrations();
  equal(!!cat('mc_trim'), false, '★ 幂等标记生效：迁移不许把用户删掉的东西补回来');
});

test('★★ 用户已自建名叫「拼豆」的空间 ⇒ 补到他那一条，不新建同名的', () => {
  legacy();
  const bcs = storage.get(KEYS.BUSINESS_CATEGORIES, []);
  bcs.push({ id: 'bc_x', name: '拼豆', sort: 1, createdAt: '2026-05-01' });
  storage.set(KEYS.BUSINESS_CATEGORIES, bcs);
  store.runMigrations();

  const all = store.getBusinessCategories();
  equal(all.filter(x => x.name === '拼豆').length, 1, '★ 不许出现两个「拼豆」');
  ok(all.some(x => x.id === 'bc_x'), '用户那条还在');
  ok(catsOf('bc_x').length >= 5, '拼豆预设要补到**用户那条**空间里');
  equal(catsOf('bc_perler').length, 0, '不该另外再建一个 bc_perler');
});

test('★ 用户已有同名分类（不同 id）⇒ 不重复添加', () => {
  legacy();
  const list = storage.get(KEYS.MATERIAL_CATEGORIES, []);
  list.push({ id: 'mc_my_lace', name: '花边', categoryId: 'bc_default', defaultUnit: '米', sort: 20, attrDimensions: [] });
  storage.set(KEYS.MATERIAL_CATEGORIES, list);
  store.runMigrations();
  const lace = catsOf('bc_default').filter(c => c.name === '花边');
  equal(lace.length, 1, '★ 同名只留一条（用户自建的那条优先，不去加出厂的 mc_lace）');
  equal(lace[0].id, 'mc_my_lace', '保留的是用户自己那条');
});

test('★ 用户自己的单位 / 平台名单不被覆盖', () => {
  legacy();
  store.runMigrations();
  const u = unitsOf('bc_default');
  equal(u.filter(x => x.id === 'u_my').length, 1, '用户那条自定义单位还在');
  ok(u.some(x => x.name === '自定义单位'), '名字没被改');
});

// ==================== 恢复出厂预设 ====================
group('恢复出厂预设 · V150 补齐（文案承诺什么就得做到）');

test('★★ 页面文案承诺「把被删掉的默认空间 / 分类补回来」⇒ 删一条也要能补回', () => {
  // 改前：只在整个列表为空时才回填 ⇒ 删掉其中一条，点"恢复"是没反应的（文案与行为不符）。
  fresh();
  storage.set(KEYS.MATERIAL_CATEGORIES, store.getListAll('materialCategory').filter(c => c.id !== 'mc_lace'));
  storage.set(KEYS.BUSINESS_CATEGORIES, store.getBusinessCategories().filter(x => x.id !== 'bc_perler'));

  const r = store.restoreFactoryPresets();
  ok(cat('mc_lace'), '★ 被删的「花边」要补回来');
  ok(store.getBusinessCategories().some(x => x.id === 'bc_perler'), '★ 被删的「拼豆」空间要补回来');
  ok(r.restored.indexOf('手作空间') >= 0, '要把补了什么报给用户看');
});

test('★ 恢复出厂不动用户自建项，且幂等', () => {
  fresh();
  const list = storage.get(KEYS.MATERIAL_CATEGORIES, []);
  list.push({ id: 'mc_mine', name: '我的分类', categoryId: 'bc_default', defaultUnit: '个', sort: 99, attrDimensions: [] });
  storage.set(KEYS.MATERIAL_CATEGORIES, list);

  const r1 = store.restoreFactoryPresets();
  ok(cat('mc_mine'), '用户自建的分类不许动');
  equal(r1.restored.length, 0, '都在的时候不该报"恢复了什么"，实际：' + r1.restored.join('、'));
  const snap = JSON.stringify(store.getListAll('materialCategory'));
  store.restoreFactoryPresets();
  equal(JSON.stringify(store.getListAll('materialCategory')), snap, '连跑两次无变化');
});

// ==================== 手建同名空间 ====================
group('手建空间 · 名字对得上就给预设（V150）');

test('★ 手建一个叫「串珠」的空间 → 自带串珠预设；别的名字 → 空空间', () => {
  fresh();
  const s = store.addBusinessCategory('串珠');
  ok(catsOf(s.id).length >= 4, '「串珠」空间要自带预设');
  equal(pcsOf(s.id).length >= 5, true, '成品品类也要给');

  const x = store.addBusinessCategory('我的怪名字');
  equal(catsOf(x.id).length, 0, '对不上的名字给空空间（不硬塞预设）');
});

test('改名不会触发补预设（只认新建那一步）', () => {
  fresh();
  const x = store.addBusinessCategory('随便');
  equal(catsOf(x.id).length, 0, '新建时是空的');
  store.updateBusinessCategory(x.id, '拼豆');
  equal(catsOf(x.id).length, 0, '★ 改个名就冒出十几个分类会更吓人 ⇒ 改名不补');
});

// ==================== 删分类的兜底 ====================
group('删分类 · 归入**本空间**的「其他」（V150 修）');

test('★★ 在新空间里删分类：引用要归到**该空间**的「其他」，不许指到缝纫空间', () => {
  // 改前把目标写死成 'mc_other' / 'pc_other' —— 那是**缝纫空间**的 id。
  // 单空间时看不出问题，起了 4 个新空间之后：在拼豆里删一个分类，
  // 物料的子分类会被指到缝纫空间那条 ⇒ 在拼豆里显示成空白。
  fresh();
  const beadCat = cat('mc_perler_bead');
  store.saveMaterial({
    name: '5mm 白豆', categoryId: 'bc_perler', materialCategoryId: beadCat.id,
    unit: '颗', quantity: 100, price: 0.05
  });
  const m = store.getMaterials().filter(x => x.materialCategoryId === beadCat.id)[0];
  ok(m, '前置：物料建好了');

  store.reassignMaterialCategoryRefs(beadCat.id);
  const after = store.getMaterial(m.id);
  const target = cat(after.materialCategoryId);
  ok(target, '归到的分类必须真实存在，实际 id=' + after.materialCategoryId);
  equal(target.categoryId, 'bc_perler', '★ 必须归到**拼豆空间**的「其他」，不是缝纫那条');
  equal(target.name, '其他');
});

test('★ 成品品类同理，且该空间的「其他」被删光时会当场补一条', () => {
  fresh();
  const pc = pcsOf('bc_perler').filter(c => c.name !== '其他')[0];
  store.saveProduct({ name: '钥匙扣', categoryId: 'bc_perler', productCategoryId: pc.id });
  const p = store.getProducts().filter(x => x.productCategoryId === pc.id)[0];

  // 极端情况：用户连「其他」也删了
  storage.set(KEYS.PRODUCT_CATEGORIES, store.getListAll('productCategory')
    .filter(c => !(c.categoryId === 'bc_perler' && c.name === '其他')));
  store.reassignProductCategoryRefs(pc.id);

  const after = store.getProduct(p.id);
  const target = store.getListAll('productCategory').filter(c => c.id === after.productCategoryId)[0];
  ok(target, '★ 引用不许悬空（分类名显示不出来等于没兑现"归入其他"）');
  equal(target.categoryId, 'bc_perler');
  equal(target.name, '其他');
});
