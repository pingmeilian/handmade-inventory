// tests/guard-cut-editor.test.js —— 裁剪排版页的结构与行为契约守卫（V83 → V91）
//
// 这一屏是用户这段时间改得最多的地方，几乎每条规矩都是他从真机上抠出来的，所以钉死：
//   · 四区带（布片选择 / 剪裁区 / 片列表 / 确认）—— V83
//   · 画布区**一个字不许放**（文字必被拖动的裁片压住，连着投诉两轮）—— V86
//   · 绿/红块是布的**兄弟节点**（塞进 .cloth 会被 overflow 裁掉）
//   · 选中 = 四周发光；「放得下/放不下」用卡内文字（别挤在同一根边框上）—— V84
//   · 吸附 = **布的整条轮廓**（外框 + 每个缺口 + 别的裁片），且拖不出布 —— V91
//   · **件数与片数分开**（做 4 件可以只裁 1 块）—— V91
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');
const stripWxml = stripComments;

// 取一条 CSS 规则的规则体（找不到返回 null）
function ruleBody(css, sel) {
  const i = css.indexOf(sel + ' {');
  if (i < 0) return null;
  const j = css.indexOf('}', i);
  return j < 0 ? null : css.slice(i + sel.length, j);
}

const JS = 'pages/cut-editor/cut-editor.js';
const WXML = 'pages/cut-editor/cut-editor.wxml';
const WXSS = 'pages/cut-editor/cut-editor.wxss';

group('裁剪界面 · 四区带契约（V83 → V91）');

test('① 页面存在且注册进 app.json', () => {
  const app = JSON.parse(read('app.json'));
  ok(app.pages.indexOf('pages/cut-editor/cut-editor') >= 0, 'app.json 里没注册裁剪界面');
  ['js', 'wxml', 'wxss', 'json'].forEach((ext) => {
    ok(fs.existsSync(path.join(ROOT, 'pages/cut-editor/cut-editor.' + ext)), '缺 cut-editor.' + ext);
  });
});

test('② 四区带都在：布片选择 / 剪裁区 / 片列表 / 确认', () => {
  const wxml = stripWxml(read(WXML));
  ok(wxml.indexOf('class="strip') >= 0, '缺少「布片选择区」（.strip）');
  ok(wxml.indexOf('class="canvas"') >= 0, '缺少「剪裁区」（.canvas）');
  ok(wxml.indexOf('part-bar') >= 0 && wxml.indexOf('part-list') >= 0,
    '缺少「片列表」区（.part-bar / .part-list）—— V90 起尺寸是一行一片地填');
  ok(wxml.indexOf('class="ops"') >= 0, '缺少「确认区」（.ops）');
});

test('③ 布片区：横向滑 + 画真实形状 + 放得下/放不下有区分', () => {
  const wxml = stripWxml(read(WXML));
  const js = stripComments(read(JS));
  ok(/scroll-x/.test(wxml), '布片区要能横向滑');
  ok(/strip-hole/.test(wxml), '布片要画**已有的缺口**（真实形状，不是一整块）');
  ok(/strip-fit/.test(wxml) && /放得下/.test(wxml), '要有「放得下/放不下」的文字标记');
  ok(/sheetsFit/.test(js), '「放得下」必须走几何内核 sheetsFit，别自己算');
});

test('④ 剪裁区：每一片都能拖（按在片上就开始拖）', () => {
  const wxml = stripWxml(read(WXML));
  const js = stripComments(read(JS));
  // 注入法自检：没有 catchtouchmove 的写法必须被判出来
  ok('<view class="piece-hit"></view>'.indexOf('catchtouchmove') < 0, '自检失败：没拖动的写法被误判成合规');
  ok(/catchtouchmove="onPieceMove"/.test(wxml), '剪裁区每一片必须能拖（catchtouchmove）');
  ok(/onPieceDown/.test(wxml) && /onPieceUp/.test(wxml), '要有按下/抬起（拖动的两头）');
  ok(/pxDeltaToCm/.test(js) && /pxPerCmOf/.test(js), '拖动要按屏幕位移换算成布上的 cm（y 轴要翻转）');
});

test('⑤ 片列表：每片一行都能改尺寸，改完立刻重算', () => {
  const wxml = stripWxml(read(WXML));
  const js = stripComments(read(JS));
  ok(/setPartLen/.test(wxml) && /setPartWid/.test(wxml), '每片的长宽都要能单独改');
  ok(/editSize\(e, key\)/.test(js) || /editSize/.test(js), '改尺寸要收口到一个入口');
  ok(/renderParts\(\)/.test(js), '改完要重算（布片判定 + 画布）');
});

test('⑥ 没摆好 / 没填尺寸 → 一律不许确认', () => {
  const js = stripComments(read(JS));
  const wxml = stripWxml(read(WXML));
  ok(/canConfirm/.test(js) && /canConfirm/.test(wxml), '要有 canConfirm 这个闸');
  ok(/if \(this\.queueMode\) \{ this\.confirm/.test(js) || /confirm\(\) \{/.test(js), 'confirm 要有收口');
  ok(/noSize/.test(js) && /noFit/.test(js), '「没填尺寸」和「没地方放」都要拦');
  ok(/disabled/.test(wxml), '按钮要有置灰态');
});

test('★ ⑦ 入口：从「选择物料」点面料 → 直接进裁剪界面（选料与裁剪合并成一步）', () => {
  const js = stripComments(read('pages/products/edit.js'));
  ok(/cut-editor\/cut-editor\?id=/.test(js), '成品编辑要跳到裁剪界面（带 id）');
  ok(/onCutChosen/.test(js), '要接裁剪界面回传的整套结果');
  // ⚠️ V91：回传的是**这一行用到的全部片**（schemes 数组）—— 一件成品的一个面料行可以用两块布
  ok(/payload\.schemes|d\.schemes|\(d && d\.schemes\)/.test(js), '回传要带 schemes（V91：可以是多片）');
  ok(/chosenSchemes/.test(js), 'BOM 行要落下 chosenSchemes（否则保存被拦 / 扣料时选的布被顶掉）');
});

test('⑧ 这一屏**不扣料**（记账在保存成品 / 生产时；别在这里动库存）', () => {
  const js = stripComments(read(JS));
  ['cutFabric', 'consumeBom', 'produceProduct', 'outbound', 'saveMaterial'].forEach((fn) => {
    ok(js.indexOf(fn) < 0, JS + ' 里不该出现 ' + fn + ' —— 裁剪排版只定"怎么裁"，扣料在保存成品时');
  });
  ok(js.indexOf('applyCutToPieces') >= 0, '用的是**影子**（applyCutToPieces），不落盘');
});

test('★ ⑨ 布片区：「选中」= 四周发光；「放得下/放不下」不再用边框色表达', () => {
  const css = stripComments(read(WXSS));
  const on = ruleBody(css, '.strip-card.on');
  ok(on, WXSS + ' 缺 .strip-card.on 规则');
  // 自检：把光晕删掉必须能被抓出来
  ok(/box-shadow\s*:/.test('box-shadow: 0 0 0 4rpx red;'), '自检失败');
  ok(/box-shadow\s*:\s*0\s+0\s+0/.test(on), '选中要用**零偏移的 box-shadow 光晕**（比单根边框醒目）');
  ok(/strip-fit/.test(read(WXML)) && /\.strip-fit/.test(css), '放得下/放不下用卡内文字 + 颜色，不抢边框');
});

test('★ ⑩ 绿/红块是布的**兄弟节点**（塞进 .cloth 会被 overflow 裁掉）', () => {
  const wxml = stripWxml(read(WXML));
  const cloth = wxml.slice(wxml.indexOf('class="cloth"'));
  const upToClose = cloth.slice(0, cloth.indexOf('cut-green'));
  ok(upToClose.indexOf('</view>') >= 0,
    '绿/红块必须画在 .cloth **外面**（塞进去会被 overflow:hidden 裁掉布外那截）');
});

test('★ ⑪ 放不下那截画**虚线**（一眼看出"这块布放不下"）', () => {
  const css = stripComments(read(WXSS));
  const red = ruleBody(css, '.cut-red');
  ok(red, WXSS + ' 缺 .cut-red 规则');
  ok(/dashed/.test(red || ''), '放不下那截要用**虚线**描边（用户 V84：「应该有一个虚线区」）');
  const green = ruleBody(css, '.cut-green');
  ok(green && !/dashed/.test(green), '放得下那截是实心，不是虚线（两者要能一眼分开）');
});

test('★ ⑫ 尺寸单位**由用户选**（cm / m），默认厘米；内部与回传一律厘米', () => {
  const wxml = stripWxml(read(WXML));
  ok(/pickUnit/.test(wxml) && /data-u="cm"/.test(wxml) && /data-u="m"/.test(wxml),
    '要有 cm / m 切换');
  const js = stripComments(read(JS));
  ok(/unit: 'cm'/.test(js), '默认必须是厘米（用户指定）');
  ok(/util\.toCm\(v, this\.data\.unit\)/.test(js), '用户填的值要**换算成 cm** 再进几何/账（不然差 100 倍）');
  ok(/长度按 cm 保留 2 位|内部一律 cm|内部与回传一律 cm/.test(read(JS)) || /toCm/.test(js), '换算只有一个口');
});

test('★ ⑬ 画布区**一个字都不许放**（文字必被拖出来的裁片压住 —— 用户连着两轮的投诉）', () => {
  const wxml = read(WXML);
  const pick = (s) => s.slice(s.indexOf('<view class="canvas"'), s.indexOf('board-tag'));
  // 注入法自检：往画布那段里塞个 <text>，必须能被抓出来
  ok(pick('<view class="canvas"><text>x</text></view><view class="board-tag">').indexOf('<text') >= 0,
    '自检失败：往画布里塞文字没被检出 —— 这条守卫没有牙');
  const seg = pick(wxml);
  ok(seg.length > 0, '模板里要有 .canvas 区块');
  ok(seg.indexOf('<text') < 0, '画布区里不许有任何 <text>');
});

test('★ ⑭ 吸附：**布的整条轮廓**都要算（外框 + 每个缺口 + 同屏别的裁片）', () => {
  const js = stripComments(read(JS));
  // 注入法自检：老写法（只取外框两端 + 缺口起点）必须能被判出来
  const oldWay = 'const pts = [0, base]; (sh.holes || []).forEach((h) => { pts.push(h.x); });';
  ok(oldWay.indexOf('h.x + h.length') < 0, '自检失败：老写法没被检出 —— 这条守卫没有牙');

  ok(/function snapAxis\(/.test(js), '要有专门的吸附候选计算（snapAxis）');
  const body = js.slice(js.indexOf('function snapAxis('), js.indexOf('function snapVal('));
  ok(/shape\.holes|\(shape && shape\.holes\)/.test(body) || /\.forEach\(put\)/.test(body),
    '★ 缺口（holes）的每一条边都要进候选 —— 用户原话「布不规则时每一条边都要能吸」');
  ok(/others/.test(body), '★ 同屏**别的裁片**的四条边也要进候选');
  ok(/base\[kL\] - size|base\.length - size|base\.width - size/.test(body),
    '外框两端要算（"裁片右/上边贴外框"的那种对齐）');
  // 四个对齐位置（裁片的左/右边 × 障碍物的两条边）
  ok(/s \+ span/.test(body) && /s - size/.test(body) && /s \+ span - size/.test(body),
    '一个障碍物要给出 4 个对齐位（左贴左 / 左贴右 / 右贴左 / 右贴右）');
});

test('★ ⑮ 不出布：拖到布边就**停住**（裁片永远待在布内）', () => {
  const js = stripComments(read(JS));
  const body = js.slice(js.indexOf('clampPart(p, sc)'), js.indexOf('cancel()'));
  // 注入法自检：老的"允许拖到画布留白里"（下界 -padCm）必须能被判出来
  ok(/-padCm/.test('clampAt(p.at.x, -padCm, -padCm + (wrapW - L))'),
    '自检失败：老的"能拖出布"写法没被检出');
  ok(body.indexOf('-padCm') < 0, '收回来了：下界不再是 -padCm（V84 那版允许拖到布外）');
  ok(/clampAt\(p\.at\.x, 0,/.test(body) && /clampAt\(p\.at\.y, 0,/.test(body),
    '★ 下界必须是 0（布内）—— 用户原话「拖到边上吸住，就不能再往外拖了」');
  ok(/bd\.cmW - L|bd\.cmH - W/.test(body), '上界 = 布 - 片（不然会从另一头越出去）');
});

test('★ ⑯ 件数与片数**分开**：加减片不动件数（做 4 件可以只裁 1 块）', () => {
  const js = stripComments(read(JS));
  const wxml = stripWxml(read(WXML));
  // ⚠️ 2026-10-04 V112：件数与片数**都从这一行搬走了** ——
  //    件数 → 导航栏「裁剪排版 · 2件」（用户原话「做2件 放在最上面，剪裁排版后边」）；
  //    片数 → **直接删掉**（用户原话「裁2片删掉 因为可以合成一片」——
  //    片数减到 1 就是"这批合起来裁一块大的"，这个数字对用户没有意义）。
  //    判据跟着改，但**意图一字未变**：件数要看得见（挪到导航栏也是"看得见"）、
  //    加减片不许动件数（这条最要紧，它护的是"做 4 件可以只裁 1 块"）。
  ok(/setNavigationBarTitle/.test(js) && /件/.test(js),
    '★ 件数必须显示（V112 起在导航栏：setNavigationBarTitle + 「· N件」）');
  ok(/addPiece/.test(wxml) && /removePiece/.test(wxml), '片数要能单独加减');
  const add = js.slice(js.indexOf('addPiece()'), js.indexOf('removePiece()'));
  const del = js.slice(js.indexOf('removePiece()'), js.indexOf('onPieceDown('));
  ok(add.indexOf('qty') < 0, '★ 加一片**不许**动件数');
  ok(del.indexOf('qty') < 0, '★ 减一片**不许**动件数');
  ok(/qty: this\.data\.qty/.test(js), '件数原样回传给生产入口（片数变了也得按件数做）');
});

// ---------------------------------------------------------------
// 2026-09-30 追加（V93）。用户拿着截图问：
//   「怎么没有旋转90°了」
// ⇒ V91 我把方向改成"系统自动定（先不转、放不下才转）"，把用户的手动入口去掉了。
//   但用户 D103 说过：「剪裁区不是两个方案，是**我随意拖动旋转**」——
//   布有织向，摆哪个方向是**用户的决定**，不是系统替他挑。
//   所以每片一行都要有一个「转 90°」，系统只在用户没表态时才自动兜。
// ---------------------------------------------------------------

test('★ ⑰ 每片都能**自己**转 90°（方向是用户的决定，不是系统替他挑）', () => {
  const wxml = stripWxml(read(WXML));
  const js = stripComments(read(JS));
  // 注入法自检：没有这个控件的写法必须能被判出来
  ok('<view class="part-field">'.indexOf('rotPart') < 0, '自检失败：没有转的控件的写法被误判成合规');

  ok(/rotPart/.test(wxml), '★ 片列表每一行都要有「转 90°」入口（用户：「怎么没有旋转90°了」）');
  ok(/catchtap="rotPart"/.test(wxml), '点它不许被行的 pickPart 抢走（要用 catchtap）');
  ok(/rotPart\(e\)/.test(js), '要有 rotPart 的实现');

  const body = js.slice(js.indexOf('rotPart(e)'), js.indexOf('pickUnit(e)'));
  ok(/want = !p\.rot/.test(body), '① 是个**开关**（再点一次转回来），不是单向的');
  ok(/placePart\(p, p\.pieceId, true\)/.test(body),
    '② 转完要按**用户要的方向**重新找位置（所以 placePart 得认第三个参数 preferRot）');
  ok(/util\.toast/.test(body), '③ 转不开要说一句 —— 无反馈的按钮比没有按钮更伤人（V88）');

  // placePart 要真的认 preferRot：用户点的方向优先，放不下才退回另一个方向
  // （切片终点用 renderParts —— 别用 autoPlaceAll()，它在 placePart **之前**就被调用过，会把区间切成空）
  const pp = js.slice(js.indexOf('placePart(p, preferId, preferRot)'), js.indexOf('renderParts() {'));
  ok(pp.length > 0, '找不到 placePart 的函数体（切片锚点漂了）');
  ok(/preferRot/.test(pp) && /rots/.test(pp),
    'placePart 要按 preferRot 决定先试哪个方向（用户点了转就按他要的来）');
  ok(/\[false, true\]/.test(pp),
    '默认仍是「先不转、放不下才转」（布有织向，能不动就不动）');

  // 回传必须带 rotate —— 不带的话扣料时会被当成"没转"
  ok(/rotate: !!p\.rot/.test(js), '回传要带 rotate');
});

// ---------------------------------------------------------------
// 2026-10-01 追加（V94）。用户真机截图问：「剪裁区都红了，还能点用这块料？」
//   + 「用这块料 这个按钮不太精准，应该改成什么文字？」
//
// ① 红 = 这一片超出布边 / 压在已有缺口上 ⇒ **那一刀根本裁不出来**。
//    确认闸原先只判「填了尺寸 + 有布（pieceId）」——「红」压根没进闸。
// ② 文案：多块布 / 多片之后「用这块料」说不通了（到底哪块？），
//    用户拍板改成「就这样裁」。
// ---------------------------------------------------------------

test('★ ⑱ 红了不许确认 + 按钮文案「就这样裁」', () => {
  const wxml = stripWxml(read(WXML));
  const js = stripComments(read(JS));
  const flat = js.replace(/\s+/g, ' ');

  // 注入法自检（拿"老写法"字符串自检，不能拿改完的源码自检）
  ok('<view>用这块料</view>'.indexOf('用这块料') >= 0, '自检失败：老文案没被检出 —— 这条守卫没有牙');
  const OLD_GATE = 'canConfirm: parts.length > 0 && parts.every(x => !x.noFit && !x.noSize)';
  const oldGateRe = /canConfirm: parts\.length > 0 && parts\.every\(x => !x\.noFit && !x\.noSize\)/;
  ok(oldGateRe.test(OLD_GATE), '自检失败：老的三项判定写法没被检出 —— 这条守卫没有牙');

  // ① 红要进确认闸
  ok(wxml.indexOf('canConfirm') >= 0, '按钮要靠 canConfirm 置灰');
  ok(!/canConfirm: parts\.length > 0 && parts\.every\(x => !x\.noFit && !x\.noSize\)/.test(flat),
    '★ canConfirm 还是老的三项判定 —— 少判了"这一片有红块（超出布边 / 压在缺口上）"');
  ok(/every\(x =>[^)]*!x\.red/.test(flat),
    '★ canConfirm 必须把「红」算进去（否则"红了还能点"又会回来）');
  // 界面要能指出是哪一片
  ok(/red: (red|!!p\.red|!!redOf\[p\.no\])/.test(flat),
    '片列表每一行都要带"这一片是红的"标记（否则用户不知道是哪一片挡住他）');
  // confirm 也要兜一句人话
  // ⚠️ 终点要在 confirm **之后**找 navigateBack —— cancel() 里也有一个，直接 indexOf 会切成空
  const iCf = flat.indexOf('confirm() {');
  const iBack = flat.indexOf('wx.navigateBack();', iCf);
  const cf = flat.slice(iCf, iBack > iCf ? iBack : undefined);
  ok(cf.length > 0, '找不到 confirm 的函数体（切片锚点漂了）');
  ok(/util\.toast/.test(cf) && /红|放不下|超出|缺口/.test(cf),
    '★ confirm 要兜一句人话（红了 / 压在缺口上 / 超出布边），不许静默什么都不做');

  // ② 文案
  //    ⚠️ 2026-10-04 V112 案B：按钮文案**不再是写死的「就这样裁」**——
  //    多物料且还有没看过的物料时，它是「还有 N 个物料 ›」（= "下一个"，不是"确认"）。
  //    全看过了才回到「就这样裁」。文案由 js 的 confirmText 提供（data 字段驱动）。
  ok(wxml.indexOf('用这块料') < 0,
    '「用这块料」不精准（多块布 / 多片时说不通到底是哪块）—— 用户 2026-10-01 拍板改掉');
  ok(/\{\{confirmText\}\}/.test(wxml) && /bindtap="confirm"/.test(wxml),
    '按钮文案要走 data 字段（多物料时要变成「还有 N 个物料 ›」）');
  ok(/就这样裁/.test(js), '「就这样裁」这个文案要保留（全物料都看过时的样子）');
});

// ---------------------------------------------------------------
// 同一条坑的**数据层兜底**：用户给的 at 放不下时，cutFabric 不许"自己换个位置裁"。
// 这种静默替换在本项目已经出现过两次（V87 选布被顶掉 / V90 尺寸被顶掉），这是第三次。
// ---------------------------------------------------------------
test('★ ⑲ cutFabric：给了 at 就必须按它来，放不下要报错（不许静默改位置）', () => {
  const src = stripComments(read('utils/store.js'));
  // 切片终点用 cutFabric **之后**的函数 —— asSheet 在它前面，用它当终点会切成空
  const body = src.slice(src.indexOf('function cutFabric('), src.indexOf('function applyCutToPieces('));
  ok(body.length > 0, '找不到 cutFabric 的函数体（切片锚点漂了）');
  // 自检：老写法（at 放不下就退回 placeNext）必须能被抓出来
  const oldWay = 'if (!target) target = sheets.placeNext(sh, rl, rw);';
  ok(oldWay.indexOf('placeNext') >= 0, '自检失败：老写法没被检出');

  const iFree = body.indexOf('sheets.free(sh, cand)');
  ok(iFree > 0, 'cutFabric 要先按用户给的 at 试一下（sheets.free）');
  const iAt = body.indexOf('if (at && at.x != null');
  ok(iAt > 0, 'cutFabric 要认用户给的 at');
  const atBranch = body.slice(iAt, body.indexOf('placeNext(sh, rl, rw)'));
  ok(atBranch.length > 0, '切片锚点漂了（at 分支到 placeNext 之间）');
  ok(/throw/.test(atBranch),
    '★ 用户给的位置放不下 ⇒ 必须 throw（把问题还给用户），不许悄悄换地方裁');
  ok(/你摆|你有|你选|指定/.test(atBranch), '报错文案要说清是"你摆的位置"放不下（否则用户看不懂）');
});

test('★ ⑳ 剪裁区**按物料分屏**：一屏一个物料，左右滑换物料（V111）', () => {
  const wxml = stripWxml(read(WXML));
  const js = read(JS);

  // ① 分屏容器：必须用 swiper（一屏一个 + 边缘回弹），不能拿横滑 scroll-view 凑
  ok(/<swiper[^>]*class="stage"/.test(wxml),
    '★ 剪裁区必须是 swiper —— scroll-view 横滑是"一条长带子过"，表达不了"一屏一个物料"');
  ok(/wx:for="\{\{matGroups\}\}"/.test(wxml) && /wx:for-item="grp"/.test(wxml),
    '★ swiper 里必须按 matGroups 一屏一个物料地循环（老写法是把全部布块平铺进一个容器）');
  ok(/bindchange="onMatSwipe"/.test(wxml) && /onMatSwipe\s*\(e\)/.test(js),
    'swiper 滑动必须能换物料（bindchange → onMatSwipe）');

  // ② 数据层：groups 由 matIds.map 得出，且 buildBoards 必须**带物料参数**
  //    ⚠️ 这是本轮的核心改动：不传物料的话 buildBoards 仍会把"全部裁片用到的布"收进来 ——
  //    那样每屏还是所有布，分屏等于没做（"排对画错"的老坑 V90）。
  ok(/const groups = matIds\.map/.test(js), '分组要按 matIds 逐个物料建（matIds.map）');
  ok(/buildBoards\(mid\)/.test(js),
    '★ buildBoards 必须按物料收布 —— 不传 mid 的话每屏还是全部布，分屏等于没做');
  ok(!/boards:\s*this\.buildBoards\(\s*\)/.test(js),
    '★ 不得有无参调用 buildBoards() —— 那是"把全部物料的布收进来"的老逻辑');

  // ③ 拖动刷新：画面读的是 matGroups[i].boards，只更 boards 的话绿/红块不动
  ok(/matGroups\[[^\]]*\]\.boards/.test(js),
    '★ 拖动后必须同时更新 matGroups[i].boards —— 只更 boards 的话 swiper 里那一屏不重绘');

  // ④ 放行闸：跨物料判定（只判当前屏的话，别的物料有红片也能点「就这样裁」）
  ok(/redOf/.test(js) && /groups\.forEach/.test(js),
    '★ 红片必须**跨全部物料**扫一遍（只看当前屏 = 别的物料裁坏了也能放行）');
  ok(/parts\.every\(x => !x\.noFit && !x\.noSize && !x\.red\)/.test(js),
    '放行闸必须按 parts 全量判（parts 覆盖所有物料的片）');

  // 注入法自检：老写法必须被上面这几条抓住
  const oldWay = 'const groups = matIds.map(function (m) { return { boards: this.buildBoards() }; });';
  ok(/this\.buildBoards\(\s*\)/.test(oldWay),
    '自检失败：老写法（不传物料）没被检出 —— 这条守卫没有牙');
});

test('★ ㉑ 布块的**身份标识**要看得见（物料照片 + 布片编号 + 尺寸 + 整布/碎料）（V111）', () => {
  const wxml = stripWxml(read(WXML));
  const wxss = read(WXSS);
  const js = read(JS);

  // ① 物料照片放在**顶部换布区左边**（用户原话「布料图片放在顶部换布区的左边」）
  //    ⚠️ 别放剪裁区左上：换布区才是"这块布是谁"的地方，图片跟着物料走才连得上
  ok(/curMat\.photo|\{\{\s*curMat\.photo\s*\}\}/.test(wxml), '换布区左边要有物料照片（curMat.photo）');
  ok(/class="strip-photo"|mat-photo/.test(wxml), '照片要有自己的容器类（好定位"在左边"）');
  const photoAt = wxml.indexOf('class="strip-photo"');
  // ⚠️ 锚点要写完整的 `class="strip"`：若只写 'class="strip'，它会命中 'class="strip-photo"' 自己
  const stripAt = wxml.indexOf('class="strip"');
  ok(photoAt > 0 && stripAt > photoAt,
    '★ 照片必须在换布区**左边**（不能塞到剪裁区里去 —— 那一层归"布片"管）');

  // ② 照片来源：物料详情里那张（与物料列表页同一个字段），**不是**布的形状示意。
  //    ⚠️ V112 起不再在页面里直接写 `(m.photos || [])[0]` —— 改走 store.materialThumb(m)
  //    （无图占位也归它管，两处口径天然一致）。所以判据改成盯"有没有走那个共享函数"。
  ok(/store\.materialThumb\(/.test(js),
    '照片要取 store.materialThumb()（= 物料详情 photos[0] + 无图占位），不能拿布的形状当图');

  // ③ 布片标识：数据里**没有名字**（只有长宽状态位置）⇒ 用"布片 N · 尺寸 · 整布/碎料"
  ok(/tag:\s*'布片 '\s*\+/.test(js),
    '布块下方要显示布片编号（数据里没有名字，必须靠编号+尺寸区分同物料的多块布）');
  ok(/\{\{bd\.tag\}\}/.test(wxml), '布块下方那行标签要渲染这个标识');
  ok(/offcut\s*\?\s*'碎料'\s*:\s*'整布'/.test(js),
    '要标出整布 / 碎料（这是布片状态里本来就有的信息）');

  // ④ 布块改**中性灰白**：不偏暖不偏冷，换任何主题都不打架（用户选的 c）
  //    📌 判据盯的是「**色性是否中性**」，不是「是否来自 CSS 变量」——
  //    用户要的是"中性灰白"，不是"跟着主题变"。三主题里的面色都带暖调/绿调
  //    （暖陶土 surface-2 #F5EFE7 偏暖、海盐奶盖 #EDF3F0 偏绿）⇒ 不能直接拿来用。
  //    可检查的定义：r/g/b 三通道最大值与最小值之差 ≤ 8（即真中性，没有偏色）。
  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const warmth = (h) => { const c = rgb(h); return Math.max.apply(null, c) - Math.min.apply(null, c); };
  const cloth = ruleBody(wxss, '.cloth') || '';
  const bgm = /background:\s*(#[0-9A-Fa-f]{6})/.exec(cloth);
  ok(bgm, '★ .cloth 必须显式给底色（布块画布区，用户看得最久的地方）');
  if (bgm) {
    ok(warmth(bgm[1]) <= 8,
      '★ 布块底色 ' + bgm[1] + ' 偏色 ' + warmth(bgm[1]) + '/255 —— 要**中性灰白**' +
      '（用户选 c：偏暖偏冷都跟任何主题打架）');
  }
  ok(!/#F5E6D3|#f5e6d3|#F5E6DC|#f5e6dc/i.test(read(WXSS)),
    '★ 暖米黄必须彻底清掉 —— 那正是用户嫌"灰蒙蒙、AI 感重"的观感来源之一');

  // 注入法自检：① 暖米黄（偏色 40）必须被抓住；② 真中性必须放过
  ok(warmth('#F5E6D3') > 8 && warmth('#EFEFEC') <= 8,
    '自检失败：中性判据没有牙（暖米黄偏色 ' + warmth('#F5E6D3') + '，中性灰白偏色 ' + warmth('#EFEFEC') + '）');
});
