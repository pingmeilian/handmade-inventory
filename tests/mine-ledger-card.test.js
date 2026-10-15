// tests/mine-ledger-card.test.js —— 「我的」页「累计总账」卡（V134）
//
// 用户（2026-10-10 真机截图，红框逐一圈出）：「这些都删掉」——
//   ① 标题右侧「自记账至今」　②「总计消费」后的「累计投入」
//   ③「总计收入」后的「售出 + 已交付」　④ 底部的「点这张卡看明细」。
// 保留：标题、两个大数字、底部「已耗成本 ≈ … · 起算日期」、整卡可点（› 箭头）。
const fs = require('fs');
const path = require('path');
const { test, group, ok } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// 把一个选择器的**所有**规则块连起来（同一选择器可能分散在多处）
function cssBlocks(src, selector) {
  const out = [];
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/\./g, '\\.') + '\\s*\\{', 'g');
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('}', m.index);
    if (end > 0) out.push(src.slice(m.index, end + 1));
  }
  return out.join('\n');
}

// 取「累计总账」卡的完整片段（class 含 ledger-card 的那个 view，含嵌套）
function cardSrc() {
  const w = stripHtml(read('pages/mine/mine.wxml'));
  const i = w.indexOf('ledger-card');
  ok(i >= 0, '找不到「我的」页的总账卡（class 含 ledger-card）—— 锚点漂了就更新这条');
  const start = w.lastIndexOf('<view', i);
  const re = /<(\/?)view\b[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(w))) {
    if (m[2] === '/') continue;
    if (m[1] === '/') { depth--; if (depth === 0) return w.slice(start, m.index + m[0].length); }
    else depth++;
  }
  return w.slice(start);
}

// 用户红框圈出、要求删掉的四段文字
const GONE = ['自记账至今', '累计投入', '售出 + 已交付', '点这张卡看明细'];

group('「我的」页·累计总账卡（V134）');

test('★ ① 这四处小字必须全部删掉（用户红框逐一圈出的）', () => {
  const card = cardSrc();
  GONE.forEach((t) => {
    ok(card.indexOf(t) < 0, '★ 卡上仍有「' + t + '」—— 用户截图红框圈出并要求删掉');
  });

  // 注入自检：老写法必须能被判出来（否则这条守卫没牙）
  const oldCard = '<view class="ledger-foot">已耗成本 ≈ ¥0.00　·　2026-10-10 起　·　点这张卡看明细</view>'
    + '<view class="loss-title">累计总账 <text class="sub">自记账至今</text></view>'
    + '<text class="ledger-k">总计消费<text class="ledger-hint">累计投入</text></text>'
    + '<text class="ledger-k">总计收入<text class="ledger-hint">售出 + 已交付</text></text>';
  const caught = GONE.filter((t) => oldCard.indexOf(t) >= 0).length;
  ok(caught === GONE.length,
    '自检失败：老写法只被检出 ' + caught + '/' + GONE.length + ' 处 —— 这条守卫没牙');
});

test('★ ② 删小字不能连带把信息删掉：标题、两个数字、已耗成本、起算日期都要在', () => {
  const card = cardSrc();
  ok(card.indexOf('累计总账') > 0, '标题「累计总账」应保留');
  ok(card.indexOf('总计消费') > 0, '「总计消费」标签应保留');
  ok(card.indexOf('总计收入') > 0, '「总计收入」标签应保留');
  ok(/\{\{\s*ledger\.spendAText\s*\}\}/.test(card), '总计消费的数字绑定应保留');
  ok(/\{\{\s*ledger\.incomeText\s*\}\}/.test(card), '总计收入的数字绑定应保留');
  ok(card.indexOf('已耗成本') > 0, '★ 底部「已耗成本 ≈ …」应保留 —— 它是 B 口径在这张卡上的唯一出口');
  ok(/\{\{\s*ledger\.rangeText\s*\}\}/.test(card), '起算日期应保留');
});

test('★ ③ 卡片仍可点进明细（删了提示语，入口不能跟着丢）', () => {
  const card = cardSrc();
  ok(/bindtap="goLedger"/.test(card),
    '★ 整卡仍要绑 goLedger —— 删掉「点这张卡看明细」后，进明细就只剩这一个入口了');
  ok(/loss-arrow/.test(card), '应保留 › 箭头（它是"可点"的视觉提示，替代被删掉的那句话）');
  ok(/goLedger\s*\(/.test(read('pages/mine/mine.js')), 'mine.js 里要有 goLedger 实现');
});

test('★ ④ 模板绑定的字段，js 必须真的产出（防绑了个不存在的字段）', () => {
  const card = cardSrc();
  const used = {};
  const re = /\{\{\s*ledger\.([A-Za-z_$][\w$]*)\s*\}\}/g;
  let m;
  while ((m = re.exec(card))) used[m[1]] = 1;
  const usedKeys = Object.keys(used);
  ok(usedKeys.length >= 3, '卡上应至少绑定 3 个 ledger 字段（实际 ' + usedKeys.length + ' 个）');

  const js = read('pages/mine/mine.js');
  const i = js.indexOf('ledger = {');
  ok(i > 0, 'mine.js 里应有 `ledger = {` 赋值块');
  const block = js.slice(i, js.indexOf('};', i));
  const missing = usedKeys.filter((k) => !new RegExp('\\b' + k + '\\s*:').test(block));
  ok(missing.length === 0,
    '★ 模板用了但 js 没产出的字段：' + missing.join(', ') +
    '（本项目踩过同类坑：绑了个不存在的字段，页面空白还不报错）');
});

test('⑤ 删掉的类不留死样式（.ledger-hint 只被这一处用过）', () => {
  const others = ['pages/mine/mine.wxml', 'pages/ledger/ledger.wxml']
    .filter((f) => read(f).indexOf('ledger-hint') >= 0);
  ok(others.length === 0, '还有文件在用 ledger-hint：' + others.join(', ') + '（删样式会误伤）');
  ok(read('pages/mine/mine.wxss').indexOf('.ledger-hint') < 0,
    '★ 没有任何 wxml 再用 ledger-hint 了 ⇒ mine.wxss 里那条样式应一并删掉（别留死样式）');
});

test('★ ⑥ 这张卡要更矮 —— 只收间距，不许靠压字（V135）', () => {
  const s = read('pages/mine/mine.wxss');
  const card = cssBlocks(s, '.ledger-card');

  // 用户：「这个卡片在里边的字不拥挤的情况下高度再窄一点」
  // ⇒ 只压**卡片上下留白 + 组间间距**，字号与行高一律不动。
  ok(/padding\s*:\s*22rpx/.test(card),
    '★ 卡片上下留白应收到 22rpx（原来沿用 --card-padding = 32rpx）—— 这是"变矮"的主要来源');
  ok(/margin-top\s*:\s*10rpx/.test(cssBlocks(s, '.ledger-foot')),
    '底部那行的上间距应收到 10rpx（原 16rpx）');
  ok(/margin-top\s*:\s*4rpx/.test(cssBlocks(s, '.ledger-v')),
    '数字的上间距应收到 4rpx（原 6rpx）');

  // 反向：字号必须原样 —— 否则就是"把字压小了"，不是"把卡压矮了"
  ok(/font-size\s*:\s*40rpx/.test(cssBlocks(s, '.ledger-v')),
    '★ 数字字号必须保持 40rpx（不许用缩小字号来"变矮"）');
  ok(/font-size\s*:\s*22rpx/.test(cssBlocks(s, '.ledger-k')),
    '★ 标签字号必须保持 22rpx');
  ok(!/line-height/.test(cssBlocks(s, '.ledger-v')) && !/line-height/.test(cssBlocks(s, '.ledger-k')),
    '★ 不许给这两处加 line-height 压行距（行距一压，字就贴在一起了）');
});
