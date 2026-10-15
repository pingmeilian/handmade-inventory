// tests/cut-preview.test.js —— 剪裁区的绿红拆分（2026-09-30 V83）
//
// 用户定的语义（D105）：
//   · 剪裁区**完全落在能用的地方** → 整块绿
//   · 拖到**压住缺口 / 越出布边** → 放不下的那部分**红**，能放下的部分仍**绿**
// 也就是：绿 = 这块料在布上确实存在的部分；红 = 不存在的那部分。
// 页面按这两组矩形直接画，不需要自己判断。
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const sheets = require('../utils/sheets.js');

const area = (rects) => (rects || []).reduce((s, r) => s + r.length * r.width, 0);
const R = (x, y, length, width) => ({ x: x, y: y, length: length, width: width });
// 240×150 的整布；第二个带一个左下角缺口（38×83）
const plain = () => ({ base: R(0, 0, 240, 150), holes: [] });
const nicked = () => ({ base: R(0, 0, 240, 150), holes: [R(0, 0, 38, 83)] });

group('剪裁区 · 绿红拆分');

test('① 完全放得下 → 全绿、一点红都没有', () => {
  const r = sheets.splitByFree(plain(), R(50, 50, 40, 30));
  equal(r.ok, true, '整块放得下 → ok');
  equal(r.red.length, 0, '没有红块');
  near(area(r.green), 40 * 30, 0.01, '绿 = 剪裁区本身');
});

test('★ ② 拖到压住缺口 → 压住的那截红、其余绿', () => {
  const r = sheets.splitByFree(nicked(), R(10, 10, 50, 50));
  equal(r.ok, false, '沾红 → 不算放得下');
  // 缺口在 x∈[0,38]、y∈[0,83]；剪裁区 x∈[10,60]、y∈[10,60]
  //   压在缺口上的那截 = x∈[10,38] × y∈[10,60] = 28×50 = 1400
  near(area(r.red), 28 * 50, 0.01, '红 = 压在缺口上的那截');
  near(area(r.green), 50 * 50 - 28 * 50, 0.01, '绿 = 剪裁区 − 红');
  equal(r.green.length > 0 && r.red.length > 0, true, '两块都要有（页面要分别画）');
});

test('★ ③ 拖到越出布边 → 出界的那截红、界内绿', () => {
  const r = sheets.splitByFree(plain(), R(220, 100, 60, 40));
  // 界内 x∈[220,240] = 20 宽，y∈[100,140] = 40 → 800
  near(area(r.green), 20 * 40, 0.01, '绿 = 界内的那部分');
  near(area(r.red), 60 * 40 - 20 * 40, 0.01, '红 = 出界的那部分');
  equal(r.ok, false);
});

test('④ 整块都在布外 → 全红、没有绿', () => {
  const r = sheets.splitByFree(plain(), R(300, 200, 40, 30));
  equal(r.ok, false);
  equal(r.green.length, 0, '一点都放不下');
  near(area(r.red), 40 * 30, 0.01, '整块都是红的');
});

test('★ ⑤ 不变量：绿 + 红 的面积**永远等于剪裁区面积**（拖到哪都成立）', () => {
  const sh = nicked();
  const cases = [
    R(0, 0, 30, 30), R(20, 20, 60, 60), R(200, 120, 60, 60),
    R(-20, -20, 50, 50), R(300, 200, 20, 20), R(38, 83, 40, 30),
    R(-10, 50, 300, 40)
  ];
  cases.forEach((c) => {
    const r = sheets.splitByFree(sh, c);
    near(area(r.green) + area(r.red), c.length * c.width, 0.01,
      '绿+红 必须守恒（' + JSON.stringify(c) + '）');
  });
});

test('⑥ 红块不许和绿块重叠（页面叠着画会看不出谁是谁）', () => {
  const r = sheets.splitByFree(nicked(), R(10, 10, 50, 50));
  r.green.forEach((g) => {
    r.red.forEach((d) => {
      ok(!sheets.overlap(g, d), '绿块与红块不能相交');
    });
  });
});

test('⑦ 边界情形：贴着缺口边、贴着布边 → 都算放得下（贴边合法）', () => {
  const r1 = sheets.splitByFree(nicked(), R(38, 0, 40, 40));   // 紧贴缺口右边
  equal(r1.ok, true, '贴着缺口摆是合法的（现实里就是挨着裁）');
  const r2 = sheets.splitByFree(plain(), R(200, 110, 40, 40)); // 正好贴着右上角
  equal(r2.ok, true, '贴着布边摆也是合法的');
});

test('⑧ 脏数据不炸：没有 base / 无效矩形', () => {
  equal(sheets.splitByFree(null, R(0, 0, 10, 10)).ok, false);
  equal(sheets.splitByFree(plain(), null).ok, false);
  equal(sheets.splitByFree(plain(), R(0, 0, 0, 10)).green.length, 0);
  const r = sheets.splitByFree({ base: null, holes: [] }, R(0, 0, 10, 10));
  equal(r.ok, false);
  near(area(r.red), 100, 0.01, '连布都没有 → 整块红');
});
