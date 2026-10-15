// tests/guard-chart-axis.test.js —— V142 趋势曲线：量程 / 刻度 / 图形与数据的匹配
//
// 用户报（真机截图，物料出入库页）：
//   「趋势曲线太丑了，根本看不到有用的信息，为什么只有一个 2.0K，
//     也不知道具体的哪天是哪天，上面那么多圆，点也点不了」
// 查实是三件事叠在一起，本文件逐条钉住：
//   ① **算好的东西没画**：布局层一直产出 yTicks / xTicks / dots[].showDot / dots[].tip，
//      而 components/line-chart 的模板只画了"最后一个值" ⇒ 一个刻度、两个日期、30 个点不动的圆；
//   ② **量程把曲线压平**：改前"全正数就从 0 起"，库存这种 2000 上下动几十的数据 ⇒ 贴顶一条平线；
//   ③ **图形与数据性质不匹配**：库存是存量（水位）⇒ 折线；入库/出库是流量（离散事件、多为 0）⇒ 柱状。
//      而这两条还走着"快照 + 前向填充"（只在当天打开过小程序才写快照）⇒ 画的是"上次打开那天的量"。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');
const { loadPage } = require('./page-helper.js');

const statChart = require('../utils/stat-chart.js');
const calc = require('../utils/calc.js');
const util = require('../utils/util.js');
const store = F.store;

const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

// 相对今天的日期（测试不许写死日期：跑测的日子会变）
const day = (back) => util.addDays(util.today(), -back);

// 近 30 天、几乎不动的一组数（库存的典型样子：2000 上下只动 8）
function flatSeries() {
  const out = [];
  for (let i = 0; i < 30; i++) out.push({ date: day(29 - i), value: i >= 25 ? 1992 : 2000 });
  return out;
}

function flow(over) {
  return Object.assign({
    id: util.uid('f'), categoryId: 'bc_default', date: day(3), type: 'in',
    qty: 1, unit: '片', materialId: 'm_test_link', materialName: '测试织带',
    // V142b：曲线按**金额**聚合 —— 每条流水都要有 totalPrice（真实数据也是这样：
    //   入库=本次采购总价、出库=按均价扣减的成本、盘库/校准/冲销都会写）
    totalPrice: 0,
    source: 'manual', createdAt: Date.now()
  }, over);
}

group('V142 趋势曲线 · 量程与刻度（算法层）');

test('① niceScale：步长归一到 1/2/5×10^k，且量程一定包住数据', () => {
  [[0, 100], [1900, 2000], [3, 7], [0, 0.35], [12345, 67890]].forEach(([lo, hi]) => {
    const sc = statChart.niceScale(lo, hi, 3);
    ok(sc.min <= lo && sc.max >= hi, '量程要包住数据：[' + lo + ',' + hi + '] → ' + sc.min + '~' + sc.max);
    const norm = sc.step / Math.pow(10, Math.floor(Math.log(sc.step) / Math.LN10));
    ok([1, 2, 5, 10].indexOf(Math.round(norm * 100) / 100) >= 0,
      '步长必须归一到 1/2/5×10^k，实际 ' + sc.step);
  });
  const flat = statChart.niceScale(2000, 2000, 3);
  ok(flat.max > flat.min, '全等值（平线）也要有一个非零量程，否则线会贴在某条边上');
});

test('★★ ② 量程自适应：库存那种"几乎不动"的数据必须被拉开（改前是一条贴顶平线）', () => {
  const pts = flatSeries();                       // 最高 2000、最低 1992
  const W = 300, H = 180;
  const plotH = H - 18 - 26;                      // padT=18 / padB=26
  const L = statChart.lineLayout(pts, W, H, { unit: '¥', unitPos: 'pre' });
  const dy = Math.abs(L.dots[29].y - L.dots[0].y);

  ok(dy >= 30, '★ 首末两点在图上要拉开（≥30px），实际 ' + dy.toFixed(1) + 'px —— ' +
    '改前量程从 0 起，这条 8/2000 的波动只有 0.5px，看着就是一条平线');

  // 注入法自检：把旧口径（0 基线）算一遍，必须得出"平线"的结论 —— 否则这条守卫的参照算错了
  const oldDy = Math.abs(((1992 / 2000) - 1) * plotH);
  ok(oldDy < 1, '自检失败：旧口径本该把这条曲线压到 1px 以内，实际 ' + oldDy.toFixed(2) + 'px');

  // 也不能"放大到看不出真实量级"：刻度必须如实写出数值
  ok(L.yTicks[0].text.indexOf('¥') === 0, '金额刻度要带 ¥：' + L.yTicks[0].text);
  equal(L.yTicks.length, 3, '折线纵轴 3 档刻度');
});

test('★★ ③ 纵轴刻度三档**文本必须互不相同**（防"¥2.0k / ¥2.0k / ¥1.9k"这种看不出差别的刻度）', () => {
  const L = statChart.lineLayout(flatSeries(), 300, 180, { unit: '¥', unitPos: 'pre' });
  const texts = L.yTicks.map((t) => t.text);
  equal(texts.length, 3);
  ok(texts[0] !== texts[1] && texts[1] !== texts[2],
    '★ 三档刻度不许有两档写成同一个字符串，实际：' + texts.join(' / '));

  // 大额时反而**必须**压缩：'100,000' 这种长标签在 44px 的刻度栏里放不下
  const big = statChart.lineLayout([
    { date: day(2), value: 0 }, { date: day(1), value: 40000 }, { date: day(0), value: 82000 }
  ], 300, 180, { unit: '¥', unitPos: 'pre' });
  ok(/w$/.test(big.yTicks[0].text), '上万的量级要压成 w（否则标签太长画不下），实际 ' + big.yTicks[0].text);

  // 注入法自检：一律走 k 压缩（改前那种写法）时必须出现**重复档** —— 证明这条守卫有牙
  const kTexts = [2000, 1950, 1900].map((v) => '¥' + (v / 1000).toFixed(1) + 'k');
  const dup = kTexts.filter((t, i) => kTexts.indexOf(t) !== i);
  ok(dup.length > 0, '自检失败：小步长硬走 k 压缩本该出现重复档，实际 ' + kTexts.join(' / '));
  ok(texts.join() !== kTexts.join(), '现在必须已经不再是那种写法了');
});

test('★ ④ 横轴 4 档日期，坐标递增且位置由布局层给（不再靠三个类名凑）', () => {
  const L = statChart.lineLayout(flatSeries(), 300, 180, { unit: '¥', unitPos: 'pre' });
  const xs = L.xTicks.map((t) => t.x);
  ok(L.xTicks.length >= 3 && L.xTicks.length <= 4, '日期刻度 3~4 档（点数少时会去重），实际 ' + L.xTicks.length);
  for (let i = 1; i < xs.length; i++) ok(xs[i] > xs[i - 1], '日期刻度的 x 必须递增：' + xs.join(','));
  L.xTicks.forEach((t) => {
    ok(/left:\s*-?[\d.]+px/.test(t.style), '每档都要自带 left 坐标：' + t.style);
    ok(/^\d{2}-\d{2}$/.test(t.text), '刻度写"月-日"，实际 ' + t.text);
  });
  ok(xs[0] < 50 && xs[xs.length - 1] > 250, '首尾要落在绘区两端（padL=44 / padR=16）');
});

test('★ ⑤ 圆点收敛：30 天里只画"有变化"的那几个点（改前 30 个全画）', () => {
  const L = statChart.lineLayout(flatSeries(), 300, 180, { unit: '¥', unitPos: 'pre' });
  const shown = L.dots.filter((d) => d.showDot).length;
  ok(shown <= 8, '★ 30 天的曲线不该糊满圆点，实际画了 ' + shown + ' 个');
  ok(L.dots[0].showDot && L.dots[29].showDot, '首尾两个点必须在（不然用户不知道从哪到哪）');

  const few = statChart.lineLayout(flatSeries().slice(0, 5), 300, 180, {});
  equal(few.dots.filter((d) => d.showDot).length, 5, '点少（≤14）时全画，不做收敛');
});

test('★ ⑥ 柱状布局：**0 基线**、空日留空、峰值唯一且最高', () => {
  const bars = [];
  for (let i = 0; i < 30; i++) {
    bars.push({ date: day(29 - i), value: i === 5 ? 12 : (i === 12 ? 5 : 0), count: i === 5 ? 2 : 0 });
  }
  const B = statChart.barLayout(bars, 300, 180, { unit: '片', unitPos: 'post' });
  equal(B.bars.length, 30, '一天一根（含空日）');
  equal(B.bars.filter((b) => b.empty).length, 28, '没有量的那天留空 —— 空档本身就是信息');
  B.bars.filter((b) => b.empty).forEach((b) => equal(b.h, 0, '空柱高度必须是 0'));

  const peak = B.bars.filter((b) => b.peak);
  equal(peak.length, 1, '峰值只有一个');
  equal(peak[0].value, 12, '峰值是最大的那天');
  ok(B.bars.every((b) => b.value <= peak[0].value), '没有柱子比峰值还高');

  // 柱状图必须 0 基线（截断基线会把 1.1 倍看成 10 倍）
  equal(B.yTicks.length, 4, '柱状纵轴 4 档');
  equal(B.yTicks[B.yTicks.length - 1].value, 0,
    '★ 最下档的**值**必须是 0（不是"文本看着像 0"）—— 这是柱状图的基线');
  ok(B.yTicks[0].value >= peak[0].value,
    '★ 刻度上界必须 ≥ 峰值（否则那根柱子会画到图框外），实际 ' + B.yTicks[0].value);
  // 柱高必须与刻度**同一口径**（都按 0~max 线性映射），否则"到顶的柱 + 写着别的数的刻度"
  // ⚠️ 这里拿刻度上界的**值**当参照（而不是另找个 scale 字段）——
  //    口径的唯一定义处就是刻度本身，多抛一个 scale 就多一份"可能不一致"。
  const plotH = 180 - 18 - 26;
  const peakBar = B.bars.filter((b) => b.peak)[0];
  const yTopValue = B.yTicks[0].value;
  const yTopPx = B.yTicks[0].y;
  near(peakBar.h, (peakBar.value / yTopValue) * plotH, 0.6, '柱高按 0~上界线性映射（与刻度同口径）');
  near(B.baselineY - yTopPx, plotH, 1, '刻度上界的像素位就是绘区顶边');
  equal(B.baselineY, 18 + plotH, '基线就是绘区底边');

  const L = statChart.lineLayout(bars, 300, 180, { unit: '片', unitPos: 'post' });
  ok(!!L, '同一份数据折线布局也要能算（两条分支共用同一批点）');
});

group('V142 趋势曲线 · 模板与数据源');

test('★★ ⑦ 组件模板必须把布局层**算出来的东西都画出来**（本轮 bug 的正面守卫）', () => {
  const wxml = strip(R('components/line-chart/line-chart.wxml'));
  // ⚠️ 必须**按分支**查，不能只数"某个字段出现过几次"：
  //    一次注入验证发现——"拿掉折线分支的纵轴刻度文字"居然过关了，
  //    因为同一分支里的**网格线**也引用了 `layout.yTicks`（次数没降到阈值以下）。
  const parts = wxml.split("type === 'line'");
  const tail = parts.length > 1 ? parts[1] : '';
  const cut = tail.split("type === 'bar'");
  const lineBlock = cut.length > 1 ? cut[0] : '';
  const barBlock = cut.length > 1 ? cut[1] : '';
  ok(lineBlock.length > 120 && barBlock.length > 120,
    '折线 / 柱状两个分支都要在模板里（锚点漂了就更新这条）');
  // 折线分支：线段 / 面积 / 圆点收敛 / 纵轴刻度文字 / 日期刻度
  ['layout.segs', 'layout.areaClip', 'item.showDot', 'layout.xTicks'].forEach((k) => {
    ok(lineBlock.indexOf(k) >= 0,
      '★ 折线分支必须画 ' + k + ' —— 改前 lineLayout 算了 yTicks/xTicks/showDot 却一个都没画，' +
      '于是"只有一个 2.0K、只有两个日期、30 个点不动的圆"（用户报的就是这个）');
  });
  // 刻度**文字**必须来自 yTicks（不能用"网格线也引用过"蒙混过关）
  const snip = (block) => {
    const at = block.indexOf('class="lc-y"');
    return at >= 0 ? block.slice(at, at + 130) : '';
  };
  ok(snip(lineBlock).indexOf('layout.yTicks') >= 0,
    '★ 折线分支的纵轴**刻度文字**必须来自 layout.yTicks（"网格线也用过"不算）');
  // 柱状分支：纵轴刻度文字 / 日期刻度 / 柱子
  ['layout.xTicks', 'layout.bars'].forEach((k) => {
    ok(barBlock.indexOf(k) >= 0, '★ 柱状分支必须画 ' + k);
  });
  ok(snip(barBlock).indexOf('layout.yTicks') >= 0, '★ 柱状分支的纵轴刻度文字也必须来自 layout.yTicks');
  ok(/bindtouchstart/.test(wxml) && /bindtouchmove/.test(wxml),
    '★ 要有触摸绑定 —— 用户："那么多圆，点也点不了"；现在改"按住任意位置吸附读数"');
  ok(/tip \|\| hint/.test(wxml), '顶部要有读数行（默认提示 / 按住出数值）');
  ok(/type === 'bar'/.test(wxml), '模板要按 type 分支（折线 / 柱状）');

  // ★ 空态必须是**独立的 wx:if**，不许写 wx:else ——
  //   本轮自查时踩到的真错：写成 `wx:else` 会跟上面那个"按住才出现"的 block 配对，
  //   于是**平时（没按住）反而一直显示"暂无数据"**。这种错在测试里不报、模板也不报，
  //   只有真机看一眼才发现 ⇒ 只能用守卫钉住。
  ok(/wx:if="\{\{!layout\}\}"/.test(wxml), '★ 空态必须是 wx:if="{{!layout}}"');
  ok(wxml.indexOf('wx:else') < 0,
    '★ 本组件没有 else 链：写 wx:else 会跟上一个"按住才出现"的 block 配对（改前错的那次）');

  const js = strip(R('components/line-chart/line-chart.js'));
  ok(/barLayout\(/.test(js), 'type=bar 时必须调 barLayout');
  ok(/lineLayout\(/.test(js), '折线分支调 lineLayout');
  ok(/indexOf\(i\)/.test(js) || /\.pick\(/.test(js), '要有点位吸附的实现');

  // 注入法自检：拿改前那种"只画最后一个值"的模板，必须判不过
  const old = '<text class="lc-last">{{layout.lastValue}}{{unit}}</text>';
  ok(old.indexOf('layout.yTicks') < 0 && old.indexOf('item.showDot') < 0, '自检失败：老模板本该被判为"缺刻度与圆点控制"');
});

test('★ ⑧ 两条曲线共用的 xTicks 结构，看板统计弹窗的模板也必须跟上（4 档 + 内联定位）', () => {
  const wxml = R('pages/dashboard/dashboard.wxml');
  const line = wxml.split('\n').filter((l) => l.indexOf('lineLayout.xTicks') >= 0)[0] || '';
  ok(!!line, '看板里找不到 xTicks 那一行 —— 锚点漂了就更新这条');
  ok(/item\.style/.test(line), '★ 日期刻度要靠布局层给的像素坐标定位，实际：' + line.trim());
  ok(line.indexOf('item.cls') < 0, '★ 不许再用 lc-x0/lc-xm/lc-x1 那套类名定位 —— 4 档时中间两档会叠在 50% 上');
  const yline = wxml.split('\n').filter((l) => l.indexOf('lineLayout.yTicks') >= 0)[0] || '';
  ok(yline.indexOf('¥{{') < 0, '纵轴刻度文字里不许再写死 ¥（单位由布局层给 —— 一个组件要能画钱也能画数量）');
});

test('★ ⑧b 「总账下钻」那句口径说明不许再说"数量"（V142b 改口径后必须同步）', () => {
  // ⚠️ 这类"写在界面上的口径说明"最容易腐烂：改了口径却忘了改文案，
  //    用户会读到一句与屏幕上显示的东西矛盾的话（屏幕上 ¥、说明里说"这里是数量"）。
  const wxml = R('pages/settings/history.wxml');
  // 说明是「<view class="ledger-note"> … <text>…</text> … </view>」—— 取这一小块
  const at = wxml.indexOf('ledger-note');
  ok(at >= 0, '找不到从总账进来的那句口径说明 —— 锚点漂了就更新这条');
  const block = wxml.slice(at, wxml.indexOf('</view>', at));
  const txt = block.replace(/<!--[\s\S]*?-->/g, '');        // 注释在它上面，别把注释算进来
  ok(txt.indexOf('数量') < 0, '★ 说明里不许再说"显示的是数量"（现在是金额）：' + txt.trim());
  ok(/金额/.test(txt), '说明里要讲清两边都是金额、差别在范围：' + txt.trim());
  ok(/全部/.test(txt), '要讲清本页含全部动账（退料 / 盘盈 / 校准 / 冲销）：' + txt.trim());
});

test('★★ ⑨ buildFlowCurve：按日**真实聚合金额**流水，且**不做前向填充**', () => {
  F.reset();
  F.seedMaterials([F.simpleMaterial({ id: 'm_test_link', name: '测试织带', unit: '片' })]);
  F.seedFlows([
    flow({ date: day(3), qty: 5, totalPrice: 30 }),
    flow({ date: day(3), qty: 7, totalPrice: 42 }),
    flow({ date: day(5), qty: 2, totalPrice: 8 }),
    flow({ date: day(2), type: 'out', qty: 9, totalPrice: 54 })
  ]);
  const fc = calc.buildFlowCurve('inboundAmount', { days: 30, categoryId: 'bc_default' });
  equal(fc.points.length, 30, '铺满 30 天一个不落');
  const at = (back) => fc.points.filter((p) => p.date === day(back))[0];

  equal(at(3).value, 72, '同一天的 30 + 42 要合并成 72');
  equal(at(3).count, 2, '并记下当天的笔数');
  equal(at(5).value, 8);
  equal(at(2).value, 0, '★ 只有出库的那天，入库曲线必须是 0（改前会被"前向填充"塞上一个值）');
  equal(at(4).value, 0, '★ 没流水的日子就是 0 —— 这正是柱状图要留出的空档');
  equal(fc.total, 80, '合计 = 72 + 8');
  equal(fc.activeDays, 2, '只有 2 天有入库');
  equal(fc.peak.value, 72, '峰值 72');
  equal(fc.unit, '¥', '★ 量纲是金额');
  equal(fc.unitPos, 'pre', '金额走前缀');
  equal(fc.flowCount, 3, '笔数如实给出（读数里要用）');

  // ★★ 金额口径**独有的**好处：数量为 0 的流水也能画出来
  //    「期初校准」这类流水 qty=0、只有金额（只对齐金额、不动数量）——
  //    按数量画它**整个消失**，按金额画才看得见。
  F.seedFlows([flow({ date: day(1), qty: 0, totalPrice: 199.5, source: 'calibration' })]);
  const fc2 = calc.buildFlowCurve('inboundAmount', { days: 30, categoryId: 'bc_default' });
  const d1 = fc2.points.filter((p) => p.date === day(1))[0];
  equal(d1.value, 199.5, '★ qty=0 但金额≠0 的校准流水必须画得出来（按数量画会整个消失）');
  equal(d1.count, 1, '它也是"一笔"');
});

test('★★ ⑩ buildFlowCurve：**金额**口径（数量跨单位不能相加，金额可以）', () => {
  F.reset();
  F.seedMaterials([
    F.simpleMaterial({ id: 'm_test_link', name: '测试织带', unit: '片' }),
    F.simpleMaterial({ id: 'm_test_kg', name: '测试珠子', unit: 'kg' })
  ]);
  F.seedFlows([
    flow({ date: day(3), qty: 5, materialId: 'm_test_link', unit: '片', totalPrice: 25 }),
    flow({ date: day(3), qty: 6, materialId: 'm_test_link', unit: '片', totalPrice: 30 }),
    flow({ date: day(3), qty: 1.5, materialId: 'm_test_kg', unit: 'kg', totalPrice: 45 })
  ]);
  const fc = calc.buildFlowCurve('inboundAmount', { days: 30, categoryId: 'bc_default' });
  const d3 = fc.points.filter((p) => p.date === day(3))[0];

  // 用户原话：「出入库的单位应该是金额啊 怎么能按个算」
  equal(fc.unit, '¥', '★ 金额口径');
  equal(d3.value, 100, '★ 三笔金额**全部**进图：25 + 30 + 45（数量是 5片 / 6片 / 1.5kg，本来就不能相加）');
  equal(d3.count, 3, '三笔都算进来（改前只统计"主单位"那两笔，1.5kg 那笔会被排除）');
  equal(fc.mixed, undefined, '★ "期间有几种单位"这个概念已经没了 —— 金额不需要它');
  equal(fc.otherUnits, undefined, '★ "被排除的其它单位"也不该再有');
  deepEq(fc.otherCount, undefined, '★ 更不许再有"未计入的笔数"（金额口径下没有"未计入"这回事）');

  // 源码锚点：聚合必须走 totalPrice；且不许退回"按单位择主单位"那套
  const src = strip(R('utils/calc.js'));
  const fn = src.slice(src.indexOf('function buildFlowCurve'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  ok(/day\.value \+= Number\(f\.totalPrice\)/.test(body),
    '★ 必须按 totalPrice 聚合金额，实际没找到');
  ok(body.indexOf('mainUnit') < 0 && body.indexOf('otherUnits') < 0,
    '★ 不许再留"取笔数最多的单位当主单位、其余排除"那套妥协（金额口径下它没意义了）');
  ok(body.indexOf('flowDisplay') < 0,
    '★ 聚合不该再看数量单位（flowDisplay 是"展示数量"用的）');
});

function deepEq(a, b, msg) { equal(JSON.stringify(a), JSON.stringify(b), msg); }

test('★★ ⑪ 页面：指标决定图形（库存折线 / 入库出库柱状）+ 摘要行给"有用信息"，且**都是金额**', () => {
  F.reset();
  F.seedMaterials([F.simpleMaterial({ id: 'm_test_link', name: '测试织带', unit: '片' })]);
  F.seedFlows([
    flow({ date: day(3), qty: 12, totalPrice: 120 }),
    flow({ date: day(7), qty: 4, totalPrice: 40 })
  ]);
  const page = loadPage('../pages/settings/history.js');
  page.reload();

  equal(page.data.curveMetric, 'inventoryValue', '默认看库存');
  equal(page.data.chartType, 'line', '库存是存量（水位）⇒ 折线');
  equal(page.data.curveLabel, '库存估值');
  equal(page.data.chartUnit, '¥', '库存本来就是金额');
  ok(/期初/.test(page.data.curveSummary) && /期末/.test(page.data.curveSummary),
    '库存摘要要有期初/期末（这才是"有用的信息"）：' + page.data.curveSummary);
  ok(/净/.test(page.data.curveSummary), '还要有净变化，免得用户以为"跌了很多"');

  // 用户原话：「出入库的单位应该是金额啊 怎么能按个算」
  page.switchCurve({ currentTarget: { dataset: { m: 'inboundAmount' } } });
  equal(page.data.chartType, 'bar', '★ 入库是流量（离散事件）⇒ 柱状');
  equal(page.data.curveLabel, '入库金额', '★ 指标标签要说清是金额（改前叫"入库量"）');
  equal(page.data.chartUnit, '¥', '★ 单位必须是金额 —— 这就是用户那条反馈要的');
  equal(page.data.chartUnitPos, 'pre', '金额走前缀（¥120），不是"数量 + 后缀"');
  ok(/2 天有入库/.test(page.data.curveSummary), '摘要要写清多少天有动作：' + page.data.curveSummary);
  ok(/合计 ¥160\.00/.test(page.data.curveSummary), '合计 = 120 + 40，且**带 ¥**：' + page.data.curveSummary);
  ok(/最多/.test(page.data.curveSummary) && page.data.curveSummary.indexOf(day(3).slice(5)) > 0,
    '要指出峰值是哪天：' + page.data.curveSummary);
  ok(page.data.curveNote === '', '金额口径下**不该**再有"图上只画了哪个单位"的说明');
  equal(page.data.curvePoints.length, 30, '曲线仍是 30 天');

  // 列表：每条流水**数量与金额并排**（曲线看钱、明细看料，两边能对上）
  const rows = page.data.flows;
  equal(rows.length, 2, '两条流水');
  ok(/^¥120\.00$/.test(rows.filter((r) => r.date === day(3))[0].amountText),
    '列表要给出这条流水的金额：' + rows.filter((r) => r.date === day(3))[0].amountText);
  equal(rows.filter((r) => r.date === day(3))[0].qtyVal, '+12', '数量照旧保留（"用了几片"本身是有用信息）');

  page.switchCurve({ currentTarget: { dataset: { m: 'outboundAmount' } } });
  equal(page.data.chartType, 'bar', '出库同样是柱状');
  equal(page.data.curveLabel, '出库金额');
  ok(/0 天有出库/.test(page.data.curveSummary), '这段时间没有出库 ⇒ 如实说 0 天：' + page.data.curveSummary);
  ok(page.data.curveEmptyText.indexOf('出库') > 0, '空态文案要跟着指标走：' + page.data.curveEmptyText);
});

test('⑫ 注入法自检：把"从 0 起画"的老口径塞回算法层，② 必须能判出来', () => {
  // 直接用旧公式算一遍 —— 结果必然是"贴顶平线"，说明 ② 的参照是对的
  const pts = flatSeries();
  const vals = pts.map((p) => p.value);
  const min = 0, max = Math.max.apply(null, vals);      // 旧口径：全正数时 min 拉 0
  const plotH = 180 - 18 - 26;
  const yOf = (v) => 18 + plotH - ((v - min) / (max - min)) * plotH;
  const dy = Math.abs(yOf(vals[29]) - yOf(vals[0]));
  ok(dy < 1, '自检失败：旧口径本该压平（实际 ' + dy.toFixed(2) + 'px）—— 那样这条守卫就抓不到回归了');
});

test('★★ ⑬ 布局层返回的字段必须"有人用"（"算了没人用"是本轮 bug 的另一半）', () => {
  // 本轮的 bug 有一半是**算了没人用**：改前 lineLayout 的
  // firstLabel / lastLabel / lastValue / gridCount / summary 全都没有消费方。
  // 这条守卫直接把"布局层的 return"扫出来，逐个字段要求有消费方 ——
  // 以后想加字段，要么用起来、要么别加。
  const js = strip(R('utils/stat-chart.js'));
  const lines = js.split(String.fromCharCode(10));
  const keys = [];
  ['lineLayout', 'barLayout'].forEach((fn) => {
    const start = lines.findIndex((l) => l.indexOf('function ' + fn + '(') >= 0);
    ok(start >= 0, '找不到 ' + fn + ' 的定义 —— 锚点漂了就更新这条');
    // ⚠️ 必须按**缩进**认顶层 return：函数体里的 `map(... => { return {...} })` 也是 `return {`，
    //    上一版就是被它骗了 —— 扒出来一堆内层字段（x / y / tip …），真正该查的字段一个没查。
    const ret = lines.findIndex((l, i) => i > start && l === '  return {');
    ok(ret > start, fn + ' 里找不到顶层的 `  return {`（缩进两格）');
    for (let i = ret + 1; i < lines.length; i++) {
      if (lines[i] === '  };') break;                       // 顶层 return 的收尾也是两格
      const m = /^    ([A-Za-z_$][\w$]*):/.exec(lines[i]);   // 字段也是两格缩进
      if (m) keys.push(fn + ' → ' + m[1]);
    }
  });
  ok(keys.length >= 12, '至少该解析出十来个顶层字段，实际 ' + keys.length + ' 个（解析器坏了就说一声）');

  // 消费方 = 生产代码（**不含测试文件**：测试里提到某个字段名不算"有人用"）
  const consumerText = [
    'components/line-chart/line-chart.wxml',
    'components/line-chart/line-chart.js',
    'pages/settings/history.js',
    'pages/settings/history.wxml',
    'pages/dashboard/dashboard.wxml',
    'pages/dashboard/dashboard.js'
  ].map((f) => R(f)).join(String.fromCharCode(10));

  // 判据：必须被**当作属性取用**（`.yTicks`），不是"这几个字母碰巧出现过"
  const used = (k) => new RegExp('\\.' + k + '\\b').test(consumerText);
  ok(used('yTicks') && used('plot'),
    '自检失败：yTicks / plot 明明有人在用，判据却说没人用（消费方清单或判据写错了）');
  ok(!used('zzzNoConsumerField'),
    '自检失败：这个判据应当能识别"没人用"');

  const dead = keys.filter((k) => !used(k.split(' → ')[1]));
  equal(dead.join(' ｜ '), '',
    '★ 这些字段在布局层算了却没有任何消费方（要么用起来，要么从 return 里删掉）：' + dead.join(' ｜ '));
});

test('★ ⑭ 库存曲线必须把「空间」透传给快照（别偷看全局"当前空间"）', () => {
  F.reset();
  const t = util.today();
  const row = (cid, v) => ({
    date: t, categoryId: cid, inventoryValue: v, sales: 0, profit: 0, inboundAmount: 0, outboundAmount: 0
  });
  store.saveSnapshots([row('bc_default', 100), row('bc_other', 777)]);

  // 当前空间是 bc_default，但显式要 bc_other 时必须读 bc_other 的那条
  // ⚠️ buildCurve 的区间只认 days=7|30 或显式 start/end（传别的 days 会落进 else 分支 ⇒ 空数组）
  const span = [null, day(2), day(0)];
  const other = calc.buildCurve('inventoryValue', span[0], span[1], span[2], 'bc_other');
  equal(other.length, 3, '区间是 3 天（这条自己先别写错）');
  equal(other[other.length - 1].value, 777, '★ 指定了空间就要读那个空间的快照');
  const here = calc.buildCurve('inventoryValue', span[0], span[1], span[2], 'bc_default');
  equal(here[here.length - 1].value, 100, '默认空间照旧');

  // 源码锚点：一旦退回"不带参数"的写法，上面这条就抓不到了（它靠默认值蒙对）
  const src = strip(R('utils/calc.js'));
  ok(/store\.getSnapshots\(categoryId\)/.test(src),
    '★ 库存分支必须是 store.getSnapshots(categoryId) —— 省掉参数＝偷看当前空间这个全局状态' +
    '（与 V136 修掉的摊销/折旧同一个坑）');
});

test('★ ⑮ dashboardMetrics 的入库 / 出库必须是**金额**（改前是把 qty 直接相加）', () => {
  F.reset();
  F.seedFlows([
    flow({ date: util.today(), qty: 5, unit: '片', totalPrice: 25 }),
    flow({ date: util.today(), qty: 1.5, unit: 'kg', totalPrice: 45 })
  ]);
  const m = calc.dashboardMetrics('bc_default');
  equal(m.inboundAmount, 70, '★ 两笔不同单位的流水：金额可以相加（25 + 45）');
  equal(m.inboundQty, undefined, '★ 旧的数量字段该没了 —— 它把"片"和"kg"加在一起，是错的口径');

  const src = strip(R('utils/calc.js'));
  // ⚠️ 查源码锚点前**必须先剥掉整行注释** —— 第一版就是被自己写的注释骗了：
  //    注释里正好写着"改前是 `s + f.qty`……"，断言把注释当成了代码 ⇒ 误报。
  const body = src.slice(src.indexOf('function dashboardMetrics'), src.indexOf('function buildCurve('))
    .split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
  ok(/f\.totalPrice/.test(body), '★ 必须按 totalPrice 聚合');
  ok(!/s \+ f\.qty/.test(body),
    '★ 不许再 `s + f.qty` 把不同单位直接相加（等于把米和斤加起来）—— 这个字段虽然没人读，口径也不能错');
});

test('★★ ⑯ 成品出入库页也要有趋势曲线（与物料页对称），且跟着 tab 换指标', () => {
  // 用户原话：「成品也加个趋势曲线」—— 物料页有曲线、成品页此前只有汇总三格 + 明细，不对称。
  // 这条守卫盯三件事：① 模板里真有曲线组件且组件已注册；② 页面真的算了 30 天的点；
  // ③ tab 一换，指标/单位/空态文案跟着换（销售=销售额、生产=扣料成本）。
  F.reset();
  const today = util.today();
  store.set(store.KEYS.PRODUCTS, [
    { id: 'p1', name: '测试成品', categoryId: 'bc_default', nature: 'merchandise',
      sellableStock: 1, sampleStock: 0,
      sales: [
        // ★ 10 天前那笔专门用来验"曲线**不跟随**页面的日期筛选"（见下面那条断言）
        { id: 's0', qty: 1, price: 30, date: day(10), client: '老客户' },
        { id: 's1', qty: 2, price: 45, date: today, client: '小美' }
      ],
      productions: [{ id: 'pp1', qty: 5, cost: 12.5, unitCost: 2.5, date: today }] }
  ]);
  const page = loadPage('../pages/settings/sales.js');
  page.onShow();
  const at = (back) => page.data.curvePoints.filter((p) => p.date === day(back))[0];

  // ① 模板 + 组件注册
  const wxml = strip(R('pages/settings/sales.wxml'));
  ok(/<line-chart/.test(wxml), '★ 成品页模板里要有 <line-chart>');
  ok(/type="bar"/.test(wxml), '★ 销售/生产都是离散事件 ⇒ 柱状');
  const json = JSON.parse(R('pages/settings/sales.json'));
  ok(!!(json.usingComponents || {})['line-chart'], '★ sales.json 要注册 line-chart，否则真机上组件渲染不出来');

  // ② 页面算了 30 天的点（固定窗口，不跟随日期筛选）
  equal(page.data.curvePoints.length, 30, '★ 曲线固定近 30 天，一天一个槽位');
  equal(at(0).date, today, '最后一天是今天');
  equal(at(0).value, 90, '今天卖了 2 × 45 = 90');
  equal(at(10).value, 30, '10 天前那笔 1 × 30 = 30');

  // ③ 跟随 tab：销售 → 销售额
  equal(page.data.curveLabel, '销售额', '★ tab=销售 ⇒ 销售额');
  equal(page.data.curveUnit, '¥', '★ 金额口径（与 V143 统一后的物料页一致）');
  equal(page.data.curveUnitPos, 'pre');
  ok(/2 天有销售/.test(page.data.curveSummary), '摘要写"多少天有动作"：' + page.data.curveSummary);
  ok(/合计 ¥120\.00/.test(page.data.curveSummary), '合计 = 90 + 30，且带 ¥：' + page.data.curveSummary);
  ok(/共 3 件/.test(page.data.curveSummary), '件数放摘要里（纵轴只放一个量纲）：' + page.data.curveSummary);

  page.switchTab({ currentTarget: { dataset: { t: 'production' } } });
  equal(page.data.curveLabel, '生产扣料成本', '★ 切到生产 ⇒ 指标跟着换');
  equal(page.data.curvePoints[29].value, 12.5, '今天那批扣料 12.5');
  ok(/1 天有生产/.test(page.data.curveSummary), '摘要文案跟着 tab 走：' + page.data.curveSummary);
  ok(/共 5 件/.test(page.data.curveSummary), '生产 5 件：' + page.data.curveSummary);
  ok(page.data.curveEmptyText.indexOf('生产') > 0, '空态文案跟着 tab 走：' + page.data.curveEmptyText);

  // ★ 曲线**不跟随**页面的日期筛选 ——
  //   否则"近 30 天"与"你筛的区间"两个时间概念会在同一张卡里打架（物料页也是这么定的）。
  //   ⚠️ 两个坑都踩过：
  //     ① 必须拿**区间外那笔**来验 —— 若只播当天一笔，"跟随"与"不跟随"结果一样，断言等于没写；
  //     ② 先切回「销售」——上面刚切到生产，不回切就变成了在断生产曲线（值当然是 0）。
  page.switchTab({ currentTarget: { dataset: { t: 'sales' } } });
  page.setData({ dateStart: today, dateEnd: today });
  page.reload();
  equal(page.data.curvePoints.length, 30, '★ 设了筛选区间，曲线仍是 30 天（固定窗口）');
  equal(page.data.curvePoints.filter((p) => p.date === day(10))[0].value, 30,
    '★ 10 天前那笔**照旧在图上** —— 曲线不跟随日期筛选');
  equal(page.data.rows.length, 1, '（明细列表**照旧**跟随筛选 —— 两者分工不同，别一起改）');

  // ★ 但**跟随**成品名筛选（那是"看哪个成品"，不是时间）
  page.setData({ dateStart: '', dateEnd: '', kw: '不存在的成品' });
  page.reload();
  equal(page.data.curvePoints[29].value, 0, '★ 关键词不匹配 ⇒ 曲线也空');
  ok(/已按「不存在的成品」筛选/.test(page.data.curveSummary), '摘要要说明筛了什么：' + page.data.curveSummary);
});
