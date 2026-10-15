// tests/material-fabric-flag.test.js —— 「面料标记只认显式值」+ 面料规格区结构
//
// 背景（2026-10-09 用户反馈，两次）：
//   ① 「物料分类选『布标』，为什么还会带出『按批估量』+ 长/幅宽？不是只有面料才有的吗」
//   ② 「面料类的规格与价格，把单位直接去掉（单位就是米），按批估量往左移」
//
// ①的根因：`services/migrations.js` 那条兼容迁移按**名字**打标记 ——
//   `if (name.includes('面料') || name.includes('布')) c.isFabric = true`
//   ⇒ **「布标」含「布」⇒ 被打成面料**（全新安装也会中，已在测试环境复现）。
//   ⚠️ 讽刺的是 `utils/store.js` 的物料级判定早就注释写明
//      「不再把带"布"字的都当面料，避免"布标/纽扣布"被误判」—— 两处规则不一致，迁移那处漏改。
//
// 用户拍板的修法（13:31）：
//   「预置分类就那么几个，面料勾上、其余不勾就完了；用户自己加分类时自己选就可以了，
//     **哪里需要系统自己去匹配**」
//   ⇒ **完全删掉"按名字猜"**，`isFabric` 只来自**显式标记**：
//      · 种子显式给（面料 true / 其余 false）
//      · 用户在「预设设置 → 物料分类 → 面料类」自己勾（该开关新增与编辑时都在）
//   ⇒ 另加**一次性纠正迁移**，把已经被错规则翻上去的分类**改回 false**。
//   ⚠️ 必须与"删规则"同批落地：`SCHEMA_VERSION` +1 会让整条迁移链重跑，
//      光升版本号会把布标**再翻一次**。
//
// 本守卫盯四件事：
//   ① 种子 + 全量迁移后，**只有「面料」是面料**；
//   ② 纠正迁移：把错规则命中过的**关掉**，且**不误伤**其它自建分类（只关不开）；
//   ③ 迁移里**不许再出现"把某分类自动变成面料"**的代码（堵住以后有人手痒再加模糊匹配）；
//   ④ 面料规格区的结构：单位行按 isFabric 分流、「按批估量」独立成行、开关色走主题。

const path = require('path');
const fs = require('fs');
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const migrations = require('../services/migrations.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const catOf = (list, name) => list.find((c) => c.name === name);

group('面料标记 · 只认显式值');

test('★★ 全新安装：种子 + 全量迁移跑完后，只有「面料」是面料（布标必须不是）', () => {
  stub.resetStorage();
  store.ensureSeed();
  store.runMigrations();

  const list = store.getListAll('materialCategory');
  const fabric = list.filter((c) => c.isFabric).map((c) => c.name);
  equal(
    fabric.join('/'), '面料',
    '★ 除「面料」外不该有第二个分类被当成面料 —— 本次就是「布标」被那条\n' +
    '  按名字打标记的迁移（includes("布")）误伤的。实际命中：' + fabric.join('、')
  );
  equal(!!(catOf(list, '布标') || {}).isFabric, false, '★「布标」必须不是面料');
});

test('★★ 老设备：纠正迁移把被错规则翻上去的关掉，且不误伤其它分类（只关不开）', () => {
  stub.resetStorage();
  store.ensureSeed();

  // 模拟"已经被旧规则改坏"的设备：布标被翻成面料；用户自建的两个也一并被翻
  const list = store.getListAll('materialCategory').map((c) => Object.assign({}, c));
  catOf(list, '布标').isFabric = true;
  list.push({ id: 'mc_my_bu', name: '布料', categoryId: 'bc_default', defaultUnit: '米', isFabric: true, attrDimensions: [] });
  list.push({ id: 'mc_my_xue', name: '雪纺', categoryId: 'bc_default', defaultUnit: '米', isFabric: true, attrDimensions: [] });
  storage.set(KEYS.MATERIAL_CATEGORIES, list);
  storage.set(KEYS.SCHEMA_VERSION, 3);   // 老设备：那条错迁移已经跑过了

  store.runMigrations();                 // 版本升上去后应当重跑并做纠正

  const after = store.getListAll('materialCategory');
  equal(!!catOf(after, '布标').isFabric, false,
    '★ 被错规则翻上去的「布标」必须关掉（否则用户得自己一个个手动关）');
  equal(!!catOf(after, '布料').isFabric, false,
    '★ 用户自建的「布料」同样是被错规则翻上去的，也要关掉');
  equal(!!catOf(after, '面料').isFabric, true, '「面料」本来就该是面料，不能被纠正掉');
  equal(!!catOf(after, '雪纺').isFabric, true,
    '★ 纠正迁移必须**只关不开、且不误伤**：名字不含「布」的「雪纺」是用户自己勾的，\n' +
    '   没有证据说明它错，就不许动它（不然纠正迁移本身又变成一个"猜"）');
});

test('★ 标记说了算：名字叫「面料」但没勾，就不是面料（删掉名字兜底后的语义）', () => {
  stub.resetStorage();
  store.ensureSeed();
  const list = store.getListAll('materialCategory').map((c) => Object.assign({}, c));
  catOf(list, '面料').isFabric = false;              // 用户在预设设置里手动取消了
  list.push({ id: 'mc_named_fabric', name: '面料', categoryId: 'bc_default', defaultUnit: '米', isFabric: false, attrDimensions: [] });
  storage.set(KEYS.MATERIAL_CATEGORIES, list);
  storage.set(KEYS.SCHEMA_VERSION, 3);
  store.runMigrations();

  equal(!!catOf(store.getListAll('materialCategory'), '面料').isFabric, false,
    '★ 显式标记说了算：迁移不许因为"名字叫面料"就把它改回 true');

  const m = { id: 'm1', name: '雪纺布', materialCategoryId: 'mc_named_fabric' };
  equal(store.isMaterialFabric(m), false,
    '★ 名字含「面料」不该被当作面料 —— 判定只认分类上的显式标记');
});

test('★ 布料分类下的物料不会被判成面料（名字含「布」不构成证据）', () => {
  stub.resetStorage();
  store.ensureSeed();
  const lbl = catOf(store.getListAll('materialCategory'), '布标');
  const m = { id: 'm2', name: '主标', materialCategoryId: lbl.id };
  equal(store.isMaterialFabric(m), false, '「布标」分类下的物料不是面料');
  const fab = catOf(store.getListAll('materialCategory'), '面料');
  equal(store.isMaterialFabric({ id: 'm3', materialCategoryId: fab.id }), true, '「面料」分类下的物料是面料');
});

group('面料标记 · 源码级守卫（堵住"以后再加模糊匹配"）');

test('★★ 迁移里不许再出现"把某分类自动变成面料"（本次 bug 的形态）', () => {
  const code = stripComments(read('services/migrations.js'));
  const offenders = [];
  if (/isFabric\s*[:=]\s*true/.test(code)) offenders.push('迁移里仍存在 isFabric = true 的赋值');
  if (/migrateMaterialCategories/.test(code)) offenders.push('按名字打标记的 migrateMaterialCategories 仍在');

  // 注入法自检：老写法必须能被判出来，否则这条守卫没有牙
  const oldWay = "list.forEach(c => { if (name.includes('面料') || name.includes('布')) c.isFabric = true; });";
  ok(/isFabric\s*[:=]\s*true/.test(oldWay), '自检失败：注入的老写法没被检出 —— 这条守卫没有牙');

  equal(offenders.length, 0,
    '★ 目录里只该有"往下关"的纠正迁移；任何"自动变成面料"的代码都会重复本次事故：\n' + offenders.join('\n'));
});

test('★ store 的面料判定不再按名字兜底；edit 页不再调不存在的函数', () => {
  const storeSrc = stripComments(read('utils/store.js'));
  const iFn = storeSrc.indexOf('function isMaterialFabric(');
  ok(iFn > 0, '找不到 isMaterialFabric（切片锚点漂了）');
  const body = storeSrc.slice(iFn, storeSrc.indexOf('\n}', iFn));
  ok(!/includes\s*\(/.test(body) && !/\.test\s*\(/.test(body),
    '★ isMaterialFabric 里不许有按名字判断（name.includes / 正则 test）—— 只认 mc.isFabric');
  ok(/mc\.isFabric/.test(body), 'isMaterialFabric 仍应以分类的显式标记为准');

  const editSrc = stripComments(read('pages/materials/edit.js'));
  ok(editSrc.indexOf('isMaterialFabricByCategory') < 0,
    '★ pages/materials/edit.js 不许再引用 store.isMaterialFabricByCategory —— 那个函数全项目不存在，\n' +
    '   它的存在会让"改了函数却没生效"看起来像是生效了');
});

group('面料规格区 · 结构');

const wxmlLines = read('pages/materials/edit.wxml').split('\n');

// 从标记所在行往上找最近的 spec-row 开标签
function rowOpenerFor(marker) {
  const i = wxmlLines.findIndex((l) => l.indexOf(marker) >= 0);
  if (i < 0) return '';
  for (let k = i; k >= 0 && k >= i - 8; k--) {
    const t = wxmlLines[k].trim();
    if (/^<view[^>]*class="spec-row/.test(t)) return t;
  }
  return '';
}

test('★ 面料时不渲染「单位」选择器；其它分类照旧（单位是给它们用的）', () => {
  const opener = rowOpenerFor('单位<span class="req">');
  ok(!!opener, '找不到「单位」那一行的开标签（切片锚点漂了）');
  ok(/wx:if="\{\{!isFabric\}\}"/.test(opener),
    '★ 「单位」行必须挂 wx:if="{{!isFabric}}" —— 面料的单位恒为米，给选择器等于让用户选错；\n' +
    '   实际开标签：' + opener);
});

test('★「按批估量」独立成行（不再和单位抢同一行）', () => {
  const opener = rowOpenerFor('按批估量</text>');
  ok(!!opener, '找不到「按批估量」那一行的开标签（切片锚点漂了）');
  ok(/spec-batch-row/.test(opener),
    '★ 「按批估量」要有自己的行（class 含 spec-batch-row）—— 与 96rpx 的输入框同排必然高度不齐；\n' +
    '   实际开标签：' + opener);
});

test('★ 说明文字不再被 flex:none 的容器挤到截断', () => {
  const wxml = read('pages/materials/edit.wxml');
  ok(wxml.indexOf('spec-batch-inline') < 0,
    '★ 那个 `flex: none` 的 .spec-batch-inline 已废弃：它把「按批估量 + 开关 + 说明」\n' +
    '   硬塞在单位行右侧，说明文字因此被截断（用户截图里就是切掉的）');
  const opener = rowOpenerFor('按批估量</text>');
  const tipAt = wxmlLines.findIndex((l) => l.indexOf('spec-head-tip') >= 0 && l.indexOf('刀口布') >= 0);
  ok(tipAt >= 0, '说明文字（刀口布按总重/片数计价）应当留在按批估量那一行里');
});

test('★ 开关的颜色走主题（全项目扫描，不再硬编码）', () => {
  // 原生 <switch> 的 color 是**组件属性**，吃不到 CSS 变量 ⇒ 只能由 js 从主题 token 取色值传下去。
  // 全项目扫一遍：既防"新写一个写死的"，也防"绑了变量但页面没给值"（那会渲染成空色）。
  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach((f) => {
      if (f === 'node_modules' || f === '.git' || f === 'tests' || f === 'tools'
        || f === 'docs' || f === 'cloudfunctions' || f === '.workbuddy') return;
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.wxml$/.test(f)) files.push(p);
    });
  })(ROOT);

  const hardcoded = [];
  const missingColor = [];
  files.forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    // ⚠️ 先去掉 HTML 注释：注释里写「原生 <switch> 约 62rpx」这种说明文字很常见，
    //    不剥掉会被当成真的 switch 元素误报（第一版就踩了）。
    const wxml = fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const switches = wxml.match(/<switch[^>]*\/?>/g) || [];
    switches.forEach((s) => {
      if (/color="#/.test(s)) hardcoded.push(rel + ' → ' + s.trim());
      else if (!/color="\{\{switchColor\}\}"/.test(s)) missingColor.push(rel + ' → ' + s.trim());
    });
    if (/color="\{\{switchColor\}\}"/.test(wxml)) {
      const jsPath = p.replace(/\.wxml$/, '.js');
      const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
      ok(/switchColor/.test(js),
        '★ ' + rel + ' 绑了 color="{{switchColor}}"，但同名 js 里没给它赋值（会渲染成空色）'
        + ' —— 应在 onShow 里 setData({ switchColor: themePage.tokens().primary })');
    }
  });

  // 注入法自检：确认这条守卫抓得住老写法
  ok(/color="#/.test('<switch checked="{{x}}" color="#C28E72" />'),
    '自检失败：老写法（写死色值）没被检出 —— 这条守卫没有牙');

  equal(hardcoded.length, 0,
    '★ switch 不许写死色值（换主题时它不会变色，违反"色值走主题变量"）：\n' + hardcoded.join('\n'));
  equal(missingColor.length, 0,
    '★ switch 的 color 必须绑 data.switchColor（不许干脆不写 —— 那样用的是微信默认绿，与主题无关）：\n'
    + missingColor.join('\n'));
});
