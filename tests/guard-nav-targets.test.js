// tests/guard-nav-targets.test.js —— 页面跳转目标的存在性守卫（两个方向）
//
// 背景（2026-09-14）：把看板「排单交付倒计时」改造成堆叠卡片时，发现
// `pages/commission/list`（排单列表页）**在 app.json 里注册了，但全项目没有任何地方跳过去**
// —— 是个用户到不了的"孤岛页"。连带副作用：App 里没有"全部排单"的入口、
// 页面上那套筛选（进行中/已完成/已取消）形同不存在。
// 顺手全项目扫了一遍，又发现 `pages/materials/category` 同样是孤岛。
//
// 这类问题**没有任何报错**：注册了不报错、链接指错了也不报错（点下去就是"没反应"）。
// 所以用守卫把两个方向都锁住：
//   ① 正向：所有 `/pages/xxx` 跳转目标必须在 app.json 里注册 —— 防"链到不存在的页"
//   ② 反向：app.json 注册的页面必须有人能跳到 —— 防"孤岛页"（用户看不到却还在维护）
//
// ⚠️ 页面间跳转如果不用字符串字面量（例如把路径拼出来），本守卫扫不到 ——
//    所以项目里请一律写字面量 `/pages/xxx/yyy`（现有代码都是这么写的）。

const path = require('path');
const fs = require('fs');
const { test, group, equal, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const BS = String.fromCharCode(92);

// 已知的孤岛页（登记在案、待用户决定去留），放行以免守卫长期红着。
// 新出现的孤岛页仍然会被拦下。
const KNOWN_ORPHANS = [
  'pages/materials/category'   // 手作空间（空间）切换页 —— 已被「我的 → 手作空间管理」(settings/categories) 取代
];

function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (f) {
    if (f === 'node_modules' || f === '.git' || f === 'tests' || f === 'tools') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

function registeredPages() {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const pages = appJson.pages.map(function (x) { return '/' + x; });
  const tabPages = ((appJson.tabBar && appJson.tabBar.list) || []).map(function (x) { return '/' + x.pagePath; });
  return { pages: pages, tabPages: tabPages };
}

// 扫出所有被引用的页面路径（只认字符串字面量）
function referencedTargets() {
  const targets = new Map();
  walk(ROOT, []).forEach(function (p) {
    if (!/\.(js|wxml)$/.test(p)) return;
    const rel = path.relative(ROOT, p).split(BS).join('/');
    const src = fs.readFileSync(p, 'utf8');
    const re = /['"](\/pages\/[A-Za-z0-9_\-\/]+)/g;
    let m;
    while ((m = re.exec(src))) {
      if (!targets.has(m[1])) targets.set(m[1], new Set());
      targets.get(m[1]).add(rel);
    }
  });
  return targets;
}

group('页面跳转 · 导航目标守卫');

test('① 所有跳转目标都必须在 app.json 里注册（防止链到不存在的页）', () => {
  const reg = registeredPages();
  const registered = new Set(reg.pages.concat(reg.tabPages));
  const offenders = [];
  referencedTargets().forEach(function (files, url) {
    if (!registered.has(url)) offenders.push(url + '  <- ' + Array.from(files).join(', '));
  });
  equal(
    offenders.length, 0,
    '以下跳转指向未注册的页面（点下去会静默无反应）：\n' + offenders.join('\n')
  );
});

test('② app.json 注册的页面必须有人能跳到（防止"孤岛页"）', () => {
  const reg = registeredPages();
  const targets = referencedTargets();
  const skip = new Set(reg.tabPages);
  const offenders = [];
  reg.pages.forEach(function (url) {
    if (skip.has(url)) return;                                  // tabBar 页由框架进入，不需要代码跳
    if (KNOWN_ORPHANS.indexOf(url.replace(/^\//, '')) >= 0) return;
    if (!targets.has(url)) offenders.push(url);
  });
  equal(
    offenders.length, 0,
    '以下页面注册了但没有任何入口（用户永远看不到，却还在跟着重构一起维护）：\n' + offenders.join('\n') +
    '\n要么补入口，要么从 app.json 摘掉（含对应文件）。'
  );
});

test('守卫自检：确实读到了页面清单与跳转引用（防止守卫读空而恒绿）', () => {
  const reg = registeredPages();
  ok(reg.pages.length > 10, '应从 app.json 读到页面清单，实际 ' + reg.pages.length + ' 条');
  ok(referencedTargets().size > 10, '应扫到跳转引用，实际 ' + referencedTargets().size + ' 条');
});
