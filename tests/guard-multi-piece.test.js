// tests/guard-multi-piece.test.js —— 「一个物料多块布」不得退回"只认一片"（V122）
//
// 用户 2026-10-06 报的三连，根因是**四个断点**都在"只认一片"：
//   A 存：面积/长宽只记主片      B 显示：只画一组长宽
//   C 回填：白名单漏 chosenSchemes  D 扣料：保存与生产都只扣一刀
// 本守卫盯的是"四道断点各自的**行为证据**"（读片清单 / 逐片处理），不是变量名 ——
// 与 V112「判据锚证据」、V113b「别从展示条目反推」同源。
//
// ⚠️ 本文件不用正则 / 无反斜杠。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const countOf = (s, sub) => s.split(sub).length - 1;

group('V122 · 一个物料多块布（四道断点的守卫）');

test('① 存：编辑页面积必须按片清单求和，并把片清单带进成品记录', () => {
  const js = read('pages/products/edit.js');
  ok(js.indexOf('pieceList') >= 0, 'buildProduct 要取出这一行的片清单');
  ok(js.indexOf('sumArea') >= 0, '面积要按各片求和 —— 只写 lenCm*widCm 就是"只认一片"');
  ok(js.indexOf('line.chosenSchemes') >= 0,
    '片清单必须跟着成品记录走（否则下游既不能逐片扣、也回填不出来）');
  const i = js.indexOf('const sumArea');
  const seg = i < 0 ? '' : js.slice(Math.max(0, i - 400), i + 200);
  ok(seg.indexOf('pieceList') >= 0 && seg.indexOf('reduce') >= 0,
    '求和的输入必须是片清单（reduce 遍历 pieceList）');
  const oldWay = 'lenCm * widCm : (Number(b.area0';
  ok(oldWay.indexOf('sumArea') < 0, '自检失败：老写法里竟然有求和 —— 判据没有牙');
});

test('② 显示：规格与列表都要说得出"几片"', () => {
  const calc = read('utils/calc.js');
  ok(calc.indexOf('b.chosenSchemes') >= 0, 'bomLineSpec 要认片清单（详情页/教程/CSV 共用）');
  ok(calc.indexOf(' 片 · ') >= 0, '规格文案要多片口径（几片 · 每片多大 · 总面积）');
  const wxml = read('pages/products/edit.wxml');
  ok(wxml.indexOf('bom-piece-text') >= 0, '编辑页物料行要有片摘要（用户就是在这里说"只有一片"）');
  const js = read('pages/products/edit.js');
  ok(js.indexOf('pieceText') >= 0, '片摘要要有数据来源（recompute 里补）');
  ok(js.indexOf('bomChanged') >= 0, '片摘要只在变化时才 setData（别每次重算都整表重渲染）');
});

test('③ 回填：从成品读回 BOM 时必须带片清单（跨会话不丢）', () => {
  const js = read('pages/products/edit.js');
  const i = js.indexOf('area0: isBatch ? 0 : (b.area || 0)');
  ok(i >= 0, '找不到回填处（守卫失效，请检查锚点）');
  const seg = i < 0 ? '' : js.slice(i, i + 400);
  ok(seg.indexOf('chosenSchemes:') >= 0,
    '回填白名单必须包含 chosenSchemes —— 漏了它，一保存再打开多片方案就永久丢'
    + '（用户「保存成品后打开该成品也只有一片布」）');
});

test('④ 扣料：保存与生产两处都必须逐片（不能只扣主片）', () => {
  const store = read('utils/store.js');
  ok(countOf(store, '.pieces') >= 2, 'saveProduct 要认 newRect.pieces');
  ok(store.indexOf('piecesSig') >= 0,
    '判断"方案有没有变"要把片清单算进去 —— 只看主片长宽的话，第二片变了会被当成没变而漏扣');
  ok(store.indexOf('pc.length, pc.width') >= 0, '逐片扣：按每片自己的尺寸挖');
  const perPieceCalls = countOf(store, 's2.id, pc.length, pc.width');
  ok(perPieceCalls >= 2,
    '两条扣料分支都要逐片扣，实际只有 ' + perPieceCalls + ' 处（漏一处就会在某些路径上只扣一片）');
  const i = store.indexOf('const own = (Array.isArray(b.chosenSchemes)');
  ok(i >= 0, '生产时没人显式给方案，也要用行上自带的片清单逐片扣（用户「增加成品数量也只扣一片布」）');
  const seg = i < 0 ? '' : store.slice(i, i + 600);
  ok(seg.indexOf('own.forEach') >= 0 && seg.indexOf('at: null') >= 0,
    '按件复制方案时，后续件要清掉位置 —— 照抄位置会压到刚挖的洞上（真机报"你摆的位置裁不出来"）');
});

test('⑤ 队列：进裁剪页前要按片数展开（用户才看得到"这件要裁两片"）', () => {
  const calc = read('utils/calc.js');
  const i = calc.indexOf('function cutQueueFor');
  ok(i >= 0, '找不到 cutQueueFor');
  const seg = i < 0 ? '' : calc.slice(i, calc.indexOf('function ', i + 10));
  ok(seg.indexOf('b.chosenSchemes') >= 0, '队列要读片清单 —— 只按主片生成，用户永远只看到一片');
  ok(seg.indexOf('specs.forEach') >= 0, '每片各生成一条队列项');
  ok(seg.indexOf('redLen: sp.redLen') >= 0, '队列项的尺寸取自展开后的 specs（不是直接拿主片）');
});
