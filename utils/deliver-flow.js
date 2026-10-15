// utils/deliver-flow.js —— 排单交付的公共流程（V149）
//
// 为什么单独抽一层：交付有**两个入口**（排单详情页的「交付出库」按钮、排单列表页左滑的「快速交付」）。
// 两处各写一遍 = 迟早变成「同一个功能两种行为」（本项目 2026-09-14 定的「快速交付」口径就是这么来的）。
// 所以：**界面在各自页面，流程收口在这里**。
//
// V149 之前：交付 = 校验物料库存 → **系统按面积 FIFO 自动刨布** → 扣料 → 排单减量。
//   · 不扣成品在库、不写销售记录；
//   · 而且它是全项目唯一一条「用户没得选从哪块布上裁」的扣面料路径
//     （生产 / 物料详情出库都是用户逐件选的）。
//
// V149 起：交付前**先选「货从哪来」**——
//   product  ：从成品在库出 —— 货早就做好了；只出库（写销售记录 + 在库−N），**不再扣料**。
//   material ：现做现交 —— 走「生产」那条路：需要裁剪的面料**必须**由用户在裁剪页逐件选，
//              扣料只发生一次（在生产里），随后出库。
//              即：料只扣一遍、货如实入库再出库，三笔账（物料/在库/销售）天然对上。
//
// ⚠️ 铁律：需要裁剪的行**绝不在这里自动刨布**。宁可不交，也不替用户决定「从哪块布上裁」。
const store = require('./store.js');
const calc = require('./calc.js');
const util = require('./util.js');

// 交付失败的统一说法（两处入口共用，避免一处列缺料清单、另一处只弹「失败」）
function reportError(err) {
  if (err && err.code === 'SHORT') {
    const lacks = (err.shortages || []).map(s => s.name + ' 缺 ' + s.lack).join('；');
    util.confirm('库存不足', '无法交付：' + lacks, '知道了').then(() => {});
    return;
  }
  if (err && err.code === 'NEEDCUT') {
    // 走到这儿说明上层没把用户带进裁剪页（正常流程不该出现）—— 如实说，别假装成功
    util.toast('这一单要裁剪面料，请先选好每片从哪块布上裁');
    return;
  }
  util.toast((err && err.msg) || '交付失败');
}

// 这一单**要不要**先排裁剪？（决定交付弹窗里要不要提示、以及走不走裁剪页）
// 刀口布（按批估量）不算 —— 与 calc.cutQueueFor 同一判据（V92 真机反馈修过）
function needsCut(productId, qty) {
  const p = store.getProduct(productId);
  if (!p) return false;
  return calc.cutQueueFor(p.bom, qty).length > 0;
}

// 交付主流程。
// opts: { commissionId, productId, qty, fromStock, onSuccess(n) }
//   onSuccess 只在**真的落账**后回调（裁剪页那条路是异步的，回调里再刷新页面）
function deliver(opts) {
  const o = opts || {};
  const qty = util.round(Math.max(0, Number(o.qty) || 0), 2);
  if (!(qty > 0)) { util.toast('数量需大于0'); return; }
  const fromStock = o.fromStock === 'product' ? 'product' : 'material';
  const p = store.getProduct(o.productId);
  if (!p) { util.toast('关联成品不存在'); return; }

  // —— A · 从成品在库出：只出库，不碰裁剪 ——
  if (fromStock === 'product') {
    try {
      store.assignCommission(o.commissionId, qty, { fromStock: 'product' });
    } catch (err) { reportError(err); return; }
    if (o.onSuccess) o.onSuccess(qty);
    return;
  }

  // —— B · 现做现交 ——
  // ① 先在**进裁剪页之前**把「料够不够」说清楚（V123 的教训：等用户排完裁剪再拦，
  //    提示会随裁剪页一起关闭 ⇒ 什么都看不见，人还白跑一趟）
  let short = [];
  try { short = store.checkBomStock(p, qty, null) || []; }
  catch (err) { util.toast(err.msg || '物料库存不足'); return; }
  if (short.length) { util.alert('物料不够，先补货', util.shortageMessage(short)); return; }

  // ② 需要裁剪的行 → 进裁剪排版页逐件选布片/摆法，选完才落账
  const queue = calc.cutQueueFor(p.bom, qty);
  if (queue.length) {
    util.navTo({
      url: '/pages/cut-editor/cut-editor?mode=queue',
      events: {
        onChoose: (data) => {
          const n = Math.max(1, Number(data && data.qty) || qty);
          try {
            store.assignCommission(o.commissionId, n, { fromStock: 'material', perPiece: data.chosen });
          } catch (err) { reportError(err); return; }
          if (o.onSuccess) o.onSuccess(n);
        }
      },
      success: (res) => {
        if (res.eventChannel) res.eventChannel.emit('passQueue', { queue: queue, qty: qty });
      }
    });
    return;
  }

  // ③ 没有面料行（辅料单、或全是刀口布）：直接交付
  try {
    store.assignCommission(o.commissionId, qty, { fromStock: 'material' });
  } catch (err) { reportError(err); return; }
  if (o.onSuccess) o.onSuccess(qty);
}

module.exports = { deliver, needsCut, reportError };
