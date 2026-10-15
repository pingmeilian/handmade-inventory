// tests/guard-flow-display.test.js —— 流水展示口径守卫（2026-09-27 V72）
//
// 这一轮用户提的几件事，根子是同一个：**同一件事在两个地方各写了一遍，然后走偏了**
//   ① 物料出入库导出的「时间」和「日期」是同一个值   → 两列各算各的
//   ② 排单交付的备注是「排单#c_k3j9f2 交付」一串乱码 → 直接拼了内部 id
//   ③ 面积单位要用户自己选（两个页面各挂一个切换控件）
// 所以守卫的重点不是"某个字符串对不对"，而是**口径只有一个**：
//   · 用户可见文案里不得出现内部 id
//   · 面积单位由 util.areaAuto / store.flowDisplay 决定，页面不得再放手动切换控件
//   · 导出必须复用 store.flowDisplay，不得自己另算一套换算
const fs = require('fs');
const path = require('path');
const { test, group, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ⭐ 一律先剥注释再判定。原因：改动的原因往往需要**引用旧写法**才讲得清
//   （例如"原来这里写着 remark: '排单#' + c.id"），不剥注释的话守卫会被自己的文档骗过去 ——
//   本项目已经真踩过两次这个坑（V67、V68），别再来第三次。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripWxmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

group('流水展示 · 用户可见文案不得含内部 id');

test('① 流水备注不得拼接内部 id（用户看到的就是乱码）', () => {
  // 判定：remark 的值里出现 " + xxx.id" 这种拼接 —— id 形如 c_k3j9f2 / m_ab12cd，不是给用户看的
  const idConcat = /remark\s*:[^\n]*\+\s*[A-Za-z_$][\w$]*\.id\b/;

  // 注入法自检：旧写法必须能被抓出来，正常写法不能误报
  ok(idConcat.test("remark: '排单#' + c.id + ' 交付',"),
    '自检失败：旧的「remark 拼内部 id」写法没被检出 —— 这条守卫没有牙');
  ok(!idConcat.test("remark: '排单交付 · ' + (c.client || '未记录客户'),"),
    '自检失败：正常写法被误判');

  ok(!idConcat.test(stripComments(read('utils/store.js'))),
    'utils/store.js 里又有流水备注拼了内部 id —— 导出到 Excel 就是一串乱码（用户 2026-09-27 反馈过）');
});

group('流水展示 · 面积单位只能有一个口径');

test('② 面积单位不再由用户手动切：两个页面都不得再有切换控件 / 处理器', () => {
  const targets = [
    ['pages/materials/detail.js', 'pages/materials/detail.wxml', 'onToggleAreaUnit'],
    ['pages/settings/history.js', 'pages/settings/history.wxml', 'switchAreaUnit']
  ];
  targets.forEach(([js, wxml, handler]) => {
    // 注入法自检：处理器真的存在过，说明这条规则不是凭空写的
    ok(('x ' + handler + '(e) {}').indexOf(handler) >= 0, '自检失败：规则里没有处理器名');

    ok(stripComments(read(js)).indexOf(handler) < 0,
      js + ' 又出现了面积单位切换处理器 ' + handler +
      ' —— 用户 2026-09-27 拍板「不要让人自己选单位，按数值自动换」');

    const wxmlCode = stripWxmlComments(read(wxml));
    ok(wxmlCode.indexOf('area-toggle') < 0 && wxmlCode.indexOf('unit-toggle') < 0,
      wxml + ' 又出现了单位切换控件');
  });
});

test('③ 导出与页面共用 store.flowDisplay（不得各写一套换算）', () => {
  // 注入法自检：把调用去掉后必须判为「未使用」
  const uses = (s) => s.indexOf('store.flowDisplay') >= 0;
  ok(!uses('const qty = f.qty / 10000;'), '自检失败：没调用 flowDisplay 的代码应判为「未使用」');

  ['utils/csv.js', 'pages/settings/history.js', 'pages/materials/detail.js'].forEach((rel) => {
    ok(uses(stripComments(read(rel))),
      rel + ' 应复用 store.flowDisplay —— 否则导出与页面各算一套，迟早对不上');
  });
});

test('④ 面积临界值只有一处定义（0.01m² = 100cm²），不得散落魔法数字', () => {
  ok(read('utils/util.js').indexOf('const AREA_M2_THRESHOLD = 100') >= 0,
    'util.js 应定义 AREA_M2_THRESHOLD = 100（即 0.01 m²）—— 面积单位自动切换的唯一定义处');

  // 页面/导出里不得再出现「除以 10000 另算面积」的换算（改单位时必须回到 util）。
  // ⚠️ 只禁除法：`* 10000` 是把 元/cm² 换算成 元/m² 的单价换算，与面积显示无关，不算违规。
  ['pages/materials/detail.js', 'pages/settings/history.js', 'utils/csv.js'].forEach((rel) => {
    ok(!/\/\s*10000/.test(stripComments(read(rel))),
      rel + ' 里出现了写死的 /10000 面积换算 —— 面积单位必须走 util.areaAuto / util.fmtArea');
  });
});
