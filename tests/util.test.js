// tests/util.test.js —— utils/util.js 特征测试（按现行为断言）
const { test, group, ok, equal, near } = require('./harness.js');
const util = require('../utils/util.js');
require('./wx-stub.js');

group('util · 日期');

test('fmtDate 补零到 YYYY-MM-DD', () => {
  equal(util.fmtDate(new Date(2026, 0, 5)), '2026-01-05');
  equal(util.fmtDate(new Date(2026, 11, 31)), '2026-12-31');
});

// 为什么需要"带到分钟"的格式：云端两个还原点同一天，只显示到"日"时两条一模一样，
// 用户根本分不清该恢复哪一份（真机反馈 2026-09-26）。
test('fmtDateTime 补零到 YYYY-MM-DD HH:mm', () => {
  equal(util.fmtDateTime(new Date(2026, 8, 26, 16, 40)), '2026-09-26 16:40');
  equal(util.fmtDateTime(new Date(2026, 0, 5, 9, 3)), '2026-01-05 09:03');
  equal(util.fmtDateTime(new Date(2026, 11, 31, 23, 59)), '2026-12-31 23:59');
  equal(util.fmtDateTime(new Date(2026, 0, 1, 0, 0)), '2026-01-01 00:00');
});

test('addDays 跨月 / 跨年', () => {
  equal(util.addDays('2026-03-31', 1), '2026-04-01');
  equal(util.addDays('2026-01-01', -1), '2025-12-31');
  equal(util.addDays('2024-02-28', 1), '2024-02-29', '2024 是闰年');
  equal(util.addDays('2026-02-28', 1), '2026-03-01', '2026 非闰年');
});

test('diffDays 为 b - a', () => {
  equal(util.diffDays('2026-01-01', '2026-01-31'), 30);
  equal(util.diffDays('2026-01-31', '2026-01-01'), -30);
  equal(util.diffDays('2026-01-01', '2026-01-01'), 0);
});

group('util · 数值格式化');

test('round 保留指定小数位，不强制补零', () => {
  equal(util.round(1.234, 2), 1.23);
  equal(util.round(1.2, 2), 1.2);
  equal(util.round(1.999, 2), 2);
  equal(util.round('abc', 2), 0, '非数字按 0 处理');
});

test('money 千分位 + 固定两位小数', () => {
  equal(util.money(1234.5), '1,234.50');
  equal(util.money(0), '0.00');
  equal(util.money(null), '0.00');
});

test('percent 乘 100 并按位数取整', () => {
  equal(util.percent(0.255, 1), '25.5%');
  equal(util.percent(0.25), '25%');
  equal(util.percent(null), '0%');
});

group('util · 单位换算（内部统一 cm / cm²）');

test('toCm：米放大 100 倍', () => {
  equal(util.toCm(1.5, 'm'), 150);
  equal(util.toCm(1.5, 'cm'), 1.5);
  equal(util.toCm('2', 'm'), 200);
});

test('fromCm：厘米换算回米', () => {
  equal(util.fromCm(150, 'm'), 1.5);
  equal(util.fromCm(150, 'cm'), 150);
});

test('面积 cm² 与 m² 互转', () => {
  equal(util.areaToM2(10000), 1);
  equal(util.areaToM2(15000), 1.5);
  equal(util.areaFromM2(1.5), 15000);
});

// ---------------------------------------------------------------
// 2026-09-27（V72）用户提出：不要再让人自己选 cm² 还是 m² ——
// 「大于这个数，平方厘米的可读性就比较差，就换成平方米。平方米的可读性比较差，
//   就换成平方厘米」。于是面积显示改为**按临界值自动选单位**。
// ---------------------------------------------------------------
group('util · 面积显示单位（临界值自动切换）');

test('★ 临界值 = 0.01m²（100cm²）：不小于它用 m²，小于它用 cm²', () => {
  equal(util.AREA_M2_THRESHOLD, 100,
    '临界值应为 100cm² —— 即 0.01 m²（2026-09-27 用户指定「临界值按 0.01 平方米」）');

  // 小于临界值：cm² 好读（换 m² 会变成 0.0099 这种）
  equal(util.fmtArea(99), '99 cm²');
  equal(util.fmtArea(40), '40 cm²');
  // 临界值本身起用 m²
  equal(util.fmtArea(100), '0.01 m²');
  equal(util.fmtArea(120), '0.012 m²');
  equal(util.fmtArea(10000), '1 m²');
  // 大数值：38500 要数位数，3.85 一眼可读
  equal(util.fmtArea(38500), '3.85 m²');
});

test('fmtArea 去掉多余的小数 0，但不能把末尾的 0 误删', () => {
  equal(util.fmtArea(40000), '4 m²', '4.0000 → 4');
  equal(util.fmtArea(38500), '3.85 m²');
  equal(util.fmtArea(90), '90 cm²', '「90」不能被剥成「9」—— 去 0 只针对小数部分');
  equal(util.fmtArea(50), '50 cm²');
  equal(util.fmtArea(12.5), '12.5 cm²');
});

test('fmtArea 兜住脏数据：undefined / null / 负数 都不炸、不出现 NaN', () => {
  equal(util.fmtArea(undefined), '0 cm²');
  equal(util.fmtArea(null), '0 cm²');
  equal(util.fmtArea(''), '0 cm²');
  equal(util.fmtArea('abc'), '0 cm²');
  ok(util.fmtArea(NaN).indexOf('NaN') < 0, '不能把 NaN 显示给用户');
  equal(util.fmtArea(-20000), '-2 m²', '负数按绝对值判断单位，符号保留');
});

test('areaAuto 同时给出数值与单位（页面需要拆开用，不能只给拼好的串）', () => {
  equal(util.areaAuto(50).value, 50);
  equal(util.areaAuto(50).unit, 'cm²');
  equal(util.areaAuto(200).value, 0.02);
  equal(util.areaAuto(200).unit, 'm²');
});

group('util · 数字输入校验');

test('hasIllegalNum 只判断不改正（用户拍板保留原输入）', () => {
  equal(util.hasIllegalNum('', false), false, '空串不算非法');
  equal(util.hasIllegalNum('12', true), false);
  equal(util.hasIllegalNum('1a', true), true, '整数框混入字母');
  equal(util.hasIllegalNum('1.2.3', false), true, '多个小数点');
  equal(util.hasIllegalNum('1.2', false), false);
  equal(util.hasIllegalNum('1a2', false), true);
});

test('sanitizeNum 清洗能力保留（当前不被自动调用）', () => {
  equal(util.sanitizeNum('1.2.3', false), '1.23', '只保留第一个小数点');
  equal(util.sanitizeNum('.5', false), '0.5', '避免 Number(".") 得 NaN');
  equal(util.sanitizeNum('12a3', true), '123', '整数模式剔除所有非数字');
  equal(util.sanitizeNum('１２３', false), '123', '全角数字转半角');
});

group('util · 流水来源标签（收敛为唯一来源）');

test('⭐ 每个来源都有中文标签 —— 自动扫描 store.js，防新增来源时漏配', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'utils', 'store.js'), 'utf8');
  const found = new Set();
  const re = /source:\s*'([a-zA-Z_]+)'/g;
  let m;
  while ((m = re.exec(src))) found.add(m[1]);

  ok(found.size > 0, '扫描应至少识别出一个 source 值');
  found.forEach((s) => {
    ok(util.FLOW_SOURCE_LABELS[s],
      '来源「' + s + '」缺少中文标签 —— 请补 utils/util.js 的 FLOW_SOURCE_LABELS');
  });
});

test('未知来源回退为「其他」，不暴露英文键名', () => {
  equal(util.flowSourceLabel('whatever'), '其他');
  equal(util.flowSourceLabel(undefined), '其他');
});

test('已覆盖销毁 / 盘库（原先显示英文原文的两种）', () => {
  equal(util.flowSourceLabel('destroy'), '销毁');
  equal(util.flowSourceLabel('stocktake'), '盘库');
});


group('util · uid');

test('uid 带前缀且不重复', () => {
  const a = util.uid('m'), b = util.uid('m');
  ok(a.startsWith('m_'), '应带前缀');
  ok(a !== b, '两次调用应不同');
});
