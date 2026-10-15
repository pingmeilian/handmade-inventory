// tests/guard-export-page.test.js —— 导出页文案 与「成品出入库」命名（2026-09-27 V73）
//
// 用户两条反馈，都属"容易被好心改回去"的类型，所以立守卫：
//   ① 「数据导出的导出说明太长了，不需要，用户根本不会看这些东西」
//      ⇒ 说明只留一行；别再有人"为了讲清楚"把技术细节堆回去
//   ② 「销售记录改成成品出入库」
//      ⇒ 页面标题 / 「我的」入口 / 导出项 **三处必须同名**（叫法不一致正是用户最烦的）
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 先剥 wxml 注释：解释改动时免不了引用旧文案，不剥的话守卫会被自己的文档骗过去
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

group('导出页 · 说明文案必须极简');

test('① 说明只有一行，且不出现技术术语', () => {
  const wxml = stripWxml(read('pages/settings/export.wxml'));
  const all = wxml.match(/<view class="t-body">([^<]*)<\/view>/g) || [];

  // 注入法自检：拿"被砍掉的那段原文"当样本，必须能被字数规则抓出来
  const longSample = '上面 4 项各自导出为 CSV（UTF-8 带 BOM，中文不乱码）：点击后内容会复制到剪贴板，' +
    '可直接粘贴进表格软件，同时文件也已存到本机。';
  ok(longSample.length > 60, '自检失败：规则里的字数上限没有判别力（样本只有 ' + longSample.length + ' 字）');

  equal(all.length, 1, '导出页应只有一处 t-body 说明（现在 ' + all.length + ' 处）');
  const text = /<view class="t-body">([^<]*)<\/view>/.exec(wxml)[1].trim();
  ok(text.length > 0, '说明不能空 —— 至少要告诉用户"导出后会复制下来、能直接粘贴"');
  ok(text.length <= 60,
    '说明应控制在一行内（现在 ' + text.length + ' 字）—— 用户明确说「太长了，用户根本不会看这些东西」');

  ['UTF-8', 'BOM', 'xlsx', '.xlsx', '工作表', '剪贴板'].forEach((t) => {
    ok(text.indexOf(t) < 0, '说明里不该出现技术术语「' + t + '」（用户不看这些）');
  });
});

group('命名 · 「销售记录」→「成品出入库」');

test('② 三处同名：页面标题 / 「我的」入口 / 导出项', () => {
  const title = JSON.parse(read('pages/settings/sales.json')).navigationBarTitleText;
  equal(title, '成品出入库',
    '该页含"成品出（销售）+ 成品进（生产）"，叫「销售记录」名不副实；' +
    '且要与「物料出入库」对称、与导出表同名');

  const mine = stripWxml(read('pages/mine/mine.wxml'));
  ok(/<text class="row-title">成品出入库<\/text>/.test(mine),
    '「我的」页入口文案应为「成品出入库」—— 与上一行「物料出入库」对称');

  const exp = stripWxml(read('pages/settings/export.wxml'));
  ok(exp.indexOf('成品出入库') >= 0, '导出页也应有同名项（三处叫法必须一致）');
});
