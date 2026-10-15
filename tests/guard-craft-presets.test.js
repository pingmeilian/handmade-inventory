// tests/guard-craft-presets.test.js —— 出厂预设的**结构守卫**（V150）
//
// 为什么除了行为测试还要源码守卫：
//   行为测试盯的是"这一次的结果对不对"，但**下一个新增预设的人**很容易：
//     · 顺手把分类表又抄一份到 migrations.js（V145 就是这么漂的）；
//     · 把 UNIT_PRESETS / ATTR_PRESETS 的字面量搬回 utils/store.js；
//     · 给 presets.js 加个 require（它是 store 与 migrations 的公共依赖，加依赖就有成环风险）；
//     · 忘了配迁移（老用户看不到 —— 这条最难发现，因为本地测试全绿）。
//   这些都不会让测试红，所以要用源码守卫盯着。
//
// 每条都带**注入法自检**：把"老写法"塞进去，必须能被这条规则抓出来。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const presets = require('../services/presets.js');

const PRESETS = 'services/presets.js';
const STORE = 'utils/store.js';
const MIGRATIONS = 'services/migrations.js';

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}

group('出厂预设 · 结构守卫（V150，每条都带注入法自检）');

test('★ ① 唯一源：presets.js 零依赖（不许 require 任何东西）', () => {
  // 它是 store 与 migrations 的**公共**依赖；一旦它自己再依赖谁，
  // 就有可能绕回 store（store → presets → … → store），形成循环引用。
  const js = stripComments(read(PRESETS));
  ok(js.indexOf('require(') < 0,
    '★ presets.js 必须是纯数据、零依赖 —— 它是 store 与 migrations 共用的，不能带依赖链');
  // 注入自检
  const bad = "const util = require('../utils/util.js');\n" + js;
  ok(bad.indexOf('require(') >= 0, '自检失败：加了 require 却没被检出');
});

test('★ ② 唯一源：migrations.js 不许再出现任何"分类名"字面量', () => {
  // V145 的教训：同一个语义（哪个分类有哪些维度）写在 store 与 migrations 两处，
  // 迁移那处漏改 ⇒ 用户数据里就是错的。⇒ 分类表只许存在于 presets.js。
  const js = stripComments(read(MIGRATIONS));
  const names = [];
  presets.SPACES.forEach((sp) => {
    names.push(sp.name);
    (sp.materialCategories || []).forEach((c) => names.push(c.name));
    (sp.productCategories || []).forEach((c) => names.push(c.name));
  });
  // 「其他」这种过于通用的词不查（会在别处正常出现）
  const probe = names.filter((n) => n && n.length >= 2 && n !== '其他');

  // ⚠️ **例外清单**（加例外必须改这个数组 ⇒ 逼作者显式做个决定，而不是悄悄放过）：
  //   · 「面料」—— migrateFixMaterialFabricFlag 里那条**清理历史误判**的规则用它做**名字匹配**
  //     （`名称含「布」且不含「面料」就关掉面料标记`）。它是针对**任意用户命名**的文本规则，
  //     不是"出厂分类表"，从 presets 取反而不对。
  const ALLOW = ['面料'];
  const hits = probe.filter((n) => ALLOW.indexOf(n) < 0
    && (js.indexOf("'" + n + "'") >= 0 || js.indexOf('"' + n + '"') >= 0));
  equal(hits.join('、'), '', '★ migrations.js 里不许出现分类名字面量（要从 presets.js 派生）：' + hits.join('、'));
  equal(ALLOW.join(','), '面料', '★ 例外清单变了 ⇒ 请确认新例外真的有必要，再改这一行');
  // 注入自检
  const bad = js + "\nconst x = '花边';";
  ok(bad.indexOf("'花边'") >= 0, '自检失败：抄了分类名却没被检出');
});

test('★ ③ 唯一源：utils/store.js 只做转发，不再持有预设字面量', () => {
  const js = stripComments(read(STORE));
  ok(js.indexOf('require(\'../services/presets.js\')') >= 0, 'store 要从唯一源取');
  ok(js.indexOf('const ATTR_PRESETS = presets.ATTR_PRESETS;') >= 0, 'ATTR_PRESETS 必须是转发');
  ok(js.indexOf('const UNIT_PRESETS = presets.UNIT_PRESETS;') >= 0, 'UNIT_PRESETS 必须是转发');
  ok(js.indexOf("const ATTR_PRESETS = {") < 0, '不许再自己写一份 ATTR_PRESETS 字面量');
  ok(js.indexOf("'个', '件', '只'") < 0, '不许再自己写一份 UNIT_PRESETS 字面量');
  // 注入自检
  const bad = js.replace('const UNIT_PRESETS = presets.UNIT_PRESETS;', "const UNIT_PRESETS = ['个', '件', '只'];");
  ok(bad.indexOf("'个', '件', '只'") >= 0, '自检失败：搬回了单位字面量却没被检出');
});

test('★ ④ 新增预设必须配迁移（不配的话老用户看不到，而本地测试全绿）', () => {
  const js = stripComments(read(MIGRATIONS));
  ok(js.indexOf('MIGRATED_CRAFT_PRESETS') >= 0, '★ 要有"只补一次"的幂等标记');
  ok(js.indexOf('presets.SPACES') >= 0, '★ 迁移要从唯一源取空间清单（不许自己列一遍）');
  ok(/SCHEMA_VERSION\s*=\s*6/.test(js), '★ 加了迁移步骤就要升版本号（不升 ⇒ 版本门短路，老用户永远跑不到）');
  // 注入自检：把版本号退回去
  const bad = js.replace(/SCHEMA_VERSION = 6/, 'SCHEMA_VERSION = 5');
  ok(!/SCHEMA_VERSION\s*=\s*6/.test(bad), '自检失败：版本号被退回却没被检出');
});

test('★ ⑤ 数据不变量：所有出厂分类 id 全局唯一', () => {
  // 配置列表是"一张大表 + 按空间过滤"⇒ 两个空间用同一个 id，find() 会取到另一条。
  const dup = (list) => {
    const seen = {};
    return list.filter((x) => { const k = String(x && x.id); if (seen[k]) return true; seen[k] = true; return false; });
  };
  const all = [];
  presets.SPACES.forEach((sp) => {
    (sp.materialCategories || []).forEach((c) => all.push(c));
    (sp.productCategories || []).forEach((c) => all.push(c));
  });
  equal(dup(all).map((c) => c.id).join('、'), '', '★ 有重号 id');
  // 注入自检：造一个重号
  equal(dup([{ id: 'a' }, { id: 'a' }]).length, 1, '自检失败：重号没被查出');
});

test('★ ⑥ 数据不变量：每个出厂空间都要有「其他」（删分类的兜底靠它）', () => {
  presets.SPACES.forEach((sp) => {
    ok((sp.materialCategories || []).some((c) => c.name === '其他'),
      sp.name + ' 缺「其他」物料分类 —— 删分类时无处可归');
    ok((sp.productCategories || []).some((c) => c.name === '其他'),
      sp.name + ' 缺「其他」成品品类');
  });
});

test('★ ⑦ 克隆必须交出**新数组**（否则用户在页面上改一下，出厂数据就被改了）', () => {
  const src = presets.SPACES.filter((s) => s.id === 'bc_default')[0].materialCategories.filter((c) => c.id === 'mc_lace')[0];
  const clone = presets.cloneMaterialCategory(src, 'bc_default');
  clone.attrDimensions[0].options.push('__污染__');
  ok(src.attrDimensions[0].options.indexOf('__污染__') < 0,
    '★ 改克隆体不该影响出厂数据（模块级单例被就地改掉，第二次装机就拿到被改过的"出厂值"）');
  ok(clone.attrDimensions !== src.attrDimensions, 'attrDimensions 要是新数组');
  equal(clone.id, src.id, 'id 默认沿用（装回自己那个空间时）');
  equal(presets.cloneMaterialCategory(src, 'bc_x', 'mc_lace_bc_x').id, 'mc_lace_bc_x',
    '装到别的空间时可以派生新 id（避免跨空间重号）');
});

test('★ ⑧ 删分类的兜底不许再写死 `mc_other` / `pc_other`', () => {
  // 改前写死的是**缝纫空间**的 id ⇒ 在新空间里删分类，引用会被指到缝纫那条
  // （在拼豆里显示成空白，缝纫那边平白多一条）。
  const js = stripComments(read(STORE));
  ok(js.indexOf("const toId = 'mc_other'") < 0, '★ 不许再写死 mc_other');
  ok(js.indexOf("const toId = 'pc_other'") < 0, '★ 不许再写死 pc_other');
  ok(js.indexOf('fallbackCategoryIdOf(') >= 0, '要走"按空间找「其他」"的收口函数');
  // 注入自检
  const bad = js.replace('fallbackCategoryIdOf(\'productCategory\', fromId)', "'pc_other'");
  ok(bad.indexOf('fallbackCategoryIdOf(') >= 0, '自检失败：锚点没变（函数名改了要同步这条）');
  const bad2 = js.replace(/const toId = fallbackCategoryIdOf\('productCategory', fromId\);/, "const toId = 'pc_other';");
  ok(bad2.indexOf("const toId = 'pc_other'") >= 0, '自检失败：写死 pc_other 却没被检出');
});

test('★ ⑨ 新增分类必须**追加在末尾**（缩略图配色按下标取）', () => {
  const sewing = presets.SPACES.filter((s) => s.id === 'bc_default')[0].materialCategories;
  // 判据做成一个可复用的"前 6 个是谁"，这样注入自检才有意义
  const head6 = (list) => list.slice(0, 6).map((c) => c.id).join(',');
  const EXPECT = 'mc_fabric,mc_label,mc_zipper,mc_bead,mc_cotton,mc_other';
  equal(head6(sewing), EXPECT, '★ 既有 6 个分类的位置不许动（插到中间会让老用户看到"颜色全变了"）');
  const sorts = sewing.map((c) => c.sort);
  equal(sorts.slice(0, 6).join(','), '0,1,2,3,4,5', '既有 6 个的 sort 也不许动');
  equal(sorts.slice(6).join(','), '6,7,8,9,10,11,12', '新增 7 个接在后面');
  // 注入自检：把新增的「花边」插到第 2 位 —— 上面那条判据必须能看出来
  const injected = [sewing[0], sewing[6]].concat(sewing.slice(1));
  ok(head6(injected) !== EXPECT, '自检失败：插队没被看出来');
});
