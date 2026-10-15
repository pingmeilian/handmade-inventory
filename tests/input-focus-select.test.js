// tests/input-focus-select.test.js —— 数字输入框「聚焦全选 + 键盘不遮挡」（V121）
//
// 用户 2026-10-06 报两件事：
//   ①「剪裁界面输入长宽的输入框 弹出输入法就看不到框里的数字了」
//      → ph-input 的 input/textarea 写死了 adjust-position="false"（主动关掉自动上推），
//        而裁剪页是整屏固定布局（.editor height:100vh），键盘一弹就把底部长宽输入框盖住。
//   ②「加一片之后…第一片布是 50x40…输完 30 和 20 之后，长宽变成 5030 和 4020」
//      → 加片继承上一片尺寸（有意），但聚焦时光标落在**已有文本末尾**、旧值没被选中，
//        输入就变成"旧值 + 新值"拼接。
// 用户拍板：**所有输入框都生效**，且「点了之后没输入 就还是预设值」（全选但不动值）。
//
// ⚠️ 本文件不用正则 / 无反斜杠（写文件的通道会吃掉反斜杠）：判据一律 indexOf / 纯字符串。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 载入 ph-input 组件定义（小程序里是 Component({...})，本地用 global.Component 接住）
function loadComponent() {
  require('./wx-stub.js').resetStorage();
  let cfg = null;
  const orig = global.Component;
  global.Component = (o) => { cfg = o; return o; };
  delete require.cache[require.resolve('../components/ph-input/ph-input.js')];
  require('../components/ph-input/ph-input.js');
  global.Component = orig;
  return cfg;
}

// 造一个能跑组件 methods 的最小实例（properties 会被注入 data，这里直接合并）
function instance(cfg, props) {
  const inst = { data: Object.assign({}, cfg.data, props || {}), _ev: [] };
  inst.setData = function (o) { Object.assign(this.data, o); };
  inst.triggerEvent = function (n, d) { this._ev.push({ n: n, d: d }); };
  Object.keys(cfg.methods).forEach((k) => { inst[k] = cfg.methods[k].bind(inst); });
  return inst;
}

group('V121 · 输入框：聚焦全选 + 键盘不遮挡');

test('① 聚焦即全选已有内容（一输就覆盖，不再拼成 5030）', () => {
  const cfg = loadComponent();
  const inst = instance(cfg, { value: '50', type: 'digit' });
  inst.onFocus();
  equal(inst.data.selStart, 0, '★ 聚焦必须从 0 开始全选 —— 否则光标停在末尾，输入就变成 50+30=5030');
  equal(inst.data.selEnd, 2, '★ 选中到已有内容的末尾（50 是两位）');
  equal(inst.data.value, '50', '★ 只选中、**不改值** —— 用户要求「点了之后没输入 就还是预设值」');
  equal(inst.data.focused, true, '聚焦态照旧置位（气泡/占位逻辑靠它）');

  const empty = instance(cfg, { value: '', type: 'digit' });
  empty.onFocus();
  equal(empty.data.selEnd, -1, '空值时 selEnd = -1（不设选区，交给原生）');

  const num = instance(cfg, { value: 40, type: 'digit' });
  num.onFocus();
  equal(num.data.selEnd, 2, '值是数字 40 时按 40 的长度 2 算（别拿 undefined.length 崩）');
});

test('② 输入一次后必须复位选区（否则每敲一位都替换掉上一位）', () => {
  const cfg = loadComponent();
  const inst = instance(cfg, { value: '50', type: 'digit' });
  inst.onFocus();
  inst.onInput({ detail: { value: '3' } });
  equal(inst.data.selStart, -1, '★ 输入后选区复位为 -1（交回原生管光标）');
  equal(inst.data.selEnd, -1, '★ 同上 —— 不复位就会输一位换一位，两位数根本打不出来');
  const ins = inst._ev.filter(function (x) { return x.n === 'input'; });
  equal(ins.length, 1, '输入事件照旧抛给页面（值原样，不偷偷清洗）');
  equal(ins[0].d.value, '3', '抛出的仍是用户输入的原文');
});

test('③ 组件侧：选区要绑在 data 上、键盘上推要可配（不许再写死 false）', () => {
  const w = read('components/ph-input/ph-input.wxml');
  ok(w.indexOf('selection-start=') >= 0, '★ 输入框要绑 selection-start（否则设了全选也没用）');
  ok(w.indexOf('selection-end=') >= 0, '★ 输入框要绑 selection-end');
  ok(w.indexOf('selection-start="{{selStart}}"') >= 0 &&
     w.indexOf('selection-end="{{selEnd}}"') >= 0,
     '选区的两个属性必须指向组件 data（否则写死值 = 永远全选或永不生效）');
  ok(w.indexOf('textarea') > 0 && w.indexOf('selection-start=', w.indexOf('textarea')) > 0,
     '多行（textarea）也要一起改 —— 用户要求「所有生效」');

  ok(w.indexOf('adjust-position="{{false}}"') < 0,
     '★ 不许再写死 adjust-position=false —— 那正是"弹键盘就看不见输入框"的原因');
  ok(w.indexOf('adjust-position="{{adjustPosition}}"') >= 0,
     '键盘上推要做成可配属性（默认保持现状，需要的页面显式开）');
  ok(w.indexOf('cursor-spacing="{{cursorSpacing}}"') >= 0,
     '光标与键盘的间距也要可配（聚焦时留出呼吸位）');

  const js = read('components/ph-input/ph-input.js');
  ok(js.indexOf('adjustPosition') >= 0, '组件要暴露 adjustPosition 属性');
  ok(js.indexOf('cursorSpacing') >= 0, '组件要暴露 cursorSpacing 属性');
  ok(js.indexOf('adjustPosition: { type: Boolean, value: false }') >= 0,
     'adjustPosition 默认 false（不动存量页面的行为 —— 与"加能力不改存量"一致）');
});

test('④ 裁剪页：长宽输入框必须开启键盘上推（不然弹键盘就看不见框）', () => {
  const w = read('pages/cut-editor/cut-editor.wxml');
  const i = w.indexOf('class="part-field"');
  ok(i >= 0, '找不到裁剪页的长宽输入区');
  const seg = i < 0 ? '' : w.slice(i, w.indexOf('part-cm', i));
  ok(seg.length > 0, '取不到长宽输入区片段（守卫失效，请检查选择器）');
  ok(seg.indexOf('adjust-position="{{true}}"') >= 0,
     '★ 裁剪页的长宽输入框要开启键盘上推 —— 否则键盘一弹就把框盖住（整屏固定布局）');
  ok(seg.indexOf('cursor-spacing=') >= 0, '要给它一个光标与键盘的间距');
  ok(seg.split('adjust-position="{{true}}"').length - 1 === 2,
     '长、宽**两个**输入框都要开（只改一个 = 另一个还会被盖住）');
});

test('⑤ 失焦也要复位选区，且值一个字都不动（「没输入就还是预设值」）', () => {
  const cfg = loadComponent();
  const inst = instance(cfg, { value: '50', type: 'digit' });
  inst.onFocus();
  inst.onBlur();
  equal(inst.data.selStart, -1, '失焦复位选区（别留着\"没点它却全选\"的怪态）');
  equal(inst.data.selEnd, -1, '同上');
  equal(inst.data.focused, false, '聚焦态照旧还原');
  equal(inst.data.value, '50', '★ 值原封不动 —— 用户要求「点了之后没输入 就还是预设值」');
});

test('⑥ 全项目没有绕过组件的原生输入框（改组件 = 所有输入框生效）', () => {
  // 用户 2026-10-06：这个行为要「所有生效」。本项目的输入框全部走 ph-input，
  // 所以改组件即全覆盖 —— 这条守卫防的是"以后有人图省事写个原生 input"，那一个就会漏掉。
  const walk = (dir, out) => {
    fs.readdirSync(dir).forEach((f) => {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) walk(fp, out);
      else if (f.endsWith('.wxml')) out.push(fp);
    });
    return out;
  };
  const files = walk(path.join(ROOT, 'pages'), []).concat(
    walk(path.join(ROOT, 'components'), []));
  const bad = [];
  files.forEach((fp) => {
    const t = fs.readFileSync(fp, 'utf8');
    const marks = ['<input ', '<textarea '];
    marks.forEach((m) => {
      let i = t.indexOf(m);
      while (i >= 0) {
        const seg = t.slice(i, t.indexOf('>', i) + 1);
        // 组件自己是允许的；页面里的原生输入框要报出来
        if (fp.indexOf(path.join('components', 'ph-input')) < 0 && seg.indexOf('ph-input') < 0) {
          bad.push(path.relative(ROOT, fp));
        }
        i = t.indexOf(m, i + 1);
      }
    });
  });
  ok(bad.length === 0,
    '这些文件里有绕过 ph-input 的原生输入框（会漏掉聚焦全选/键盘上推）：' + bad.join(', '));
  // 注入法自检：造一段原生 input，判据必须认得出
  const fake = '<view><input type="digit" value="1" /></view>';
  ok(fake.indexOf('<input ') >= 0, '自检失败：原生 input 判据没牙');
});
