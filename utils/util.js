// utils/util.js —— 通用工具函数

// V97：弹窗确认色跟随主题。
// ⚠️ 这里只 require themes + state（两者都不依赖 store），所以不会形成循环依赖。
const themes = require('./themes.js');
const tstate = require('../services/state.js');
function modalColor() {
  try { return themes.get(tstate.getTheme()).primary; } catch (e) { return themes.get(themes.DEFAULT).primary; }
}

// 生成唯一 id
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 当前日期 YYYY-MM-DD
function today() {
  const d = new Date();
  return fmtDate(d);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

// 带时分。为什么需要它：云端两个还原点常常是**同一天**的，
// 只显示到"日"时两条记录长得一模一样，用户根本分不清该恢复哪一份（真机反馈 2026-09-26）。
function fmtDateTime(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return fmtDate(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 日期加减（天）
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

// 两个日期相差天数（b - a）
function diffDays(a, b) {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86400000);
}

// 金额格式化（千分位 + 2 位小数）
function money(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 百分比格式化
function percent(n, digits) {
  const num = Number(n) || 0;
  const d = digits == null ? 0 : digits;
  return (num * 100).toFixed(d) + '%';
}

// 保留 n 位小数（不强制补零）
function round(n, d) {
  const f = Math.pow(10, d || 0);
  return Math.round((Number(n) || 0) * f) / f;
}

// 轻提示
function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 2000 });
}

// 二次确认
// 二次确认。
// 真机事故（2026-09-12）：微信 showModal 的按钮文字上限 4 个汉字，超限会直接 fail；
//   而旧实现没有 fail 回调 → Promise 永不 resolve → 调用方静默卡死（表现为「点了没反应」）。
//   现在两道保险：①按钮文字强制截断到 4 字；②fail 时 resolve(false) 并留痕，绝不挂起。
//   防回归守卫见 tests/confirm-text.test.js
const MODAL_BTN_MAX = 4;
function _safeBtnText(t, tag) {
  const s = String(t == null ? '' : t);
  if (s.length <= MODAL_BTN_MAX) return s;
  // 带上调用方标签：confirm 与 alert 共用这个守卫，日志里不能一律打成 confirm
  console.warn('[' + (tag || 'util') + '] 弹窗按钮文字超过 4 字被截断：', s);
  return s.slice(0, MODAL_BTN_MAX);
}
function confirm(title, content, confirmText) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      wx.showModal({
        title: title,
        content: content,
        confirmText: _safeBtnText(confirmText || '确定'),
        cancelText: '取消',
        confirmColor: modalColor(),
        success(res) { finish(res.confirm === true); },
        fail(err) {
          console.error('[util.confirm] showModal 失败，按未确认处理：', err);
          finish(false);
        }
      });
    } catch (e) {
      console.error('[util.confirm] showModal 异常，按未确认处理：', e);
      finish(false);
    }
  });
}

// 单按钮说明弹窗（只有「知道了」，没有「取消」）
// 为什么另起一个：用 confirm 做"说明"会多渲染一个「取消」按钮，用户会以为还有一步撤销操作。
// 纪律与 confirm 同源：①按钮文字 ≤4 字（微信硬约束）②任何失败路径都 resolve，绝不静默挂起。
function alert(title, content, confirmText) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    try {
      wx.showModal({
        title: title,
        content: content,
        showCancel: false,
        confirmText: _safeBtnText(confirmText || '知道了'),
        confirmColor: modalColor(),
        success() { finish(); },
        fail(err) {
          console.error('[util.alert] showModal 失败，按已读处理：', err);
          finish();
        }
      });
    } catch (e) {
      console.error('[util.alert] showModal 异常，按已读处理：', e);
      finish();
    }
  });
}

// ===== 长度 / 面积单位换算（内部统一以 cm / cm² 存储）=====
// 输入 val 为用户填写数值（或字符串），unit 为用户选择的单位 'cm' | 'm'
function toCm(val, unit) {
  const n = Number(val) || 0;
  // m -> cm 放大 100；cm 保持。统一保留 2 位小数（cm 精度）
  return unit === 'm' ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}
// 内部 cm 值 → 用户视角显示值（按 unit）
function fromCm(val, unit) {
  const n = Number(val) || 0;
  // m = cm / 100；cm 保持（2 位小数）
  return unit === 'm' ? Math.round(n * 100) / 10000 : Math.round(n * 100) / 100;
}
// 面积 cm² → m²（4 位小数）
function areaToM2(cm2) { return round((Number(cm2) || 0) / 10000, 4); }
// 面积 m² → cm²
function areaFromM2(m2) { return round((Number(m2) || 0) * 10000, 2); }

// ===== 面积显示：按临界值自动选单位（2026-09-27 V72/V73）=====
// 内部一律以 cm² 存储。展示时**不再让人自己选** cm² 还是 m² —— 按数值大小自动决定：
//   ≥ AREA_M2_THRESHOLD → 用 m²（否则会出现 20000cm² 这种要一位一位数过去的写法）
//   <  AREA_M2_THRESHOLD → 用 cm²（否则会出现 0.0041m² 这种更读不出来的写法）
// 临界值 = 0.01 m² = 100 cm²（用户 2026-09-27 指定「临界值按 0.01 平方米」）：
//   0.01 m² 以上的布料用 m²；更小的碎布头（几厘米见方）才回落到 cm²。
const AREA_M2_THRESHOLD = 100;

// 去掉小数末尾多余的 0：3.8500 → 3.85、4.0000 → 4
// ⚠️ 只在「有小数点」时才剥：'100' 直接删末尾的 0 会变成 '1'（整数部分一个字符都不能动）
function trimNum(n, maxDec) {
  const s = round(Number(n) || 0, maxDec).toFixed(maxDec);
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

// 面积 → { value, unit, decimals }：单位按临界值自动选。
// 返回拆开的数值与单位（而不是只给拼好的串），因为页面需要"数字归数字、单位归单位"地渲染。
function areaAuto(cm2) {
  const v = Number(cm2);
  const n = isNaN(v) ? 0 : v;   // 脏数据（undefined / null / '' / 'abc' / NaN）按 0 —— 绝不把 NaN 显示给用户
  return Math.abs(n) >= AREA_M2_THRESHOLD
    ? { value: round(n / 10000, 4), unit: 'm²', decimals: 4 }
    : { value: round(n, 2), unit: 'cm²', decimals: 2 };
}

// 面积显示串：'1.2 m²' / '320 cm²'
function fmtArea(cm2) {
  const a = areaAuto(cm2);
  return trimNum(a.value, a.decimals) + ' ' + a.unit;
}

// 数字输入清洗：type="digit"（小数）只留数字和一个小数点；type="number"（整数）只留数字。
// ⚠️ 现在**不再自动调用**（用户拍板：不要偷偷改写用户输入）。保留此函数供单测与按需使用。
function sanitizeNum(raw, integer) {
  let s = String(raw == null ? '' : raw);
  // 全角数字 / 全角句点 → 半角
  s = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[．。]/g, '.');
  if (integer) return s.replace(/[^0-9]/g, '');
  s = s.replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ''); // 只保留第一个小数点
  if (s.charAt(0) === '.') s = '0' + s;                                  // .5 → 0.5，避免 Number('.') = NaN
  return s;
}

// 数字框里是否混进了不该有的字符。
// 只用于**提示用户**，绝不改写输入（用户要求：格式不对就提醒，别自作主张清洗）。
function hasIllegalNum(raw, integer) {
  const s = String(raw == null ? '' : raw);
  if (!s) return false;
  if (integer) return /[^0-9]/.test(s);
  if (/[^0-9.]/.test(s)) return true;
  return s.split('.').length - 1 > 1;   // 多个小数点
}

// 流水「来源」中文标签 —— 唯一来源（single source of truth）
// ⚠️ 原先是流水列表页与 CSV 导出各维护一份，已经漂移过（缺 destroy/stocktake 导致显示英文）。
//    现收敛到此处，新增 source 类型只需改这一个地方，测试会扫描 store.js 自动校验完整性。
const FLOW_SOURCE_LABELS = {
  manual: '手动',
  cut: '成品裁剪',
  sale: '售出',
  commission: '排单履约',
  destroy: '销毁',
  stocktake: '盘库',
  reversal: '冲销',
  calibration: '期初校准'
};

// 取来源标签；未知来源回退为「其他」而不是暴露英文键名
function flowSourceLabel(source) {
  return FLOW_SOURCE_LABELS[source] || '其他';
}

// 安全跳转（Day 3 任务 3.3）：
// 微信页面栈上限 10 层，超限后 wx.navigateTo 直接失败且**静默无反应**——
// 用户只会觉得「点了没反应」，然后反复猛戳。
// 现在栈满时自动改用 redirectTo（替换当前页）：跳转必然有响应，只是
// 返回时少退一层 —— 远好于无反应。参数形态与 wx.navigateTo 完全一致。
function navTo(options) {
  let depth = 0;
  try {
    const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
    depth = pages.length;
  } catch (e) { depth = 0; }
  if (depth >= 10) {
    try { wx.redirectTo(options); return; } catch (e) { /* 降级失败再走 navigateTo，让它报出错误 */ }
  }
  wx.navigateTo(options);
}

// BOM 行是否「按批估量」（刀口布）：按每件用量(kg/片)扣料，不裁剪、不计面积。
// 放在 util 里是因为它是**零依赖的纯判定**，而 store.js 与 calc.js 互相依赖
// （calc → store），两边都要用这个判定，只能下沉到共同依赖 util，避免循环 require。
//
// 为什么必须收口成一个判定：历史上到处手写 `b.isFabric` 当「要裁剪的面料」，
// 漏掉 stockMode==='batch'，同一个根因连出 6 个 bug（编辑页被拦、生产强制裁剪、
// 生产写裁剪红区脏数据、交付漏扣料、退产生成假余料、导出显示 0cm²）——2026-09-12 真机反馈。
// 兼容旧数据：行上没有 stockMode 快照时，回落到物料当前值。
function bomIsBatchLine(b, material) {
  if (b && b.stockMode) return b.stockMode === 'batch';
  return !!(material && material.stockMode === 'batch');
}

/* ===================== 剪贴板：收口所有失败路径（绝不静默） =====================
 * 根因记录（2026-09-14）：项目里 4 处 `wx.setClipboardData` **全都没接 fail 回调**。
 * 真机上它会失败，失败时什么都不发生 —— 用户感知就是「点了没反应」（既不跳转、也没提示）。
 * 这与「前往原视频」报的现象一致。
 *
 * ⚠️ 而真机上它到底为什么失败？**因为剪贴板是隐私接口**（官方文档 + 社区一致）：
 *   errno 104    privacy permission is not authorized      → 用户没同意隐私授权
 *   errno 104179 api scope is not declared in the privacy agreement
 *                                                          → 小程序后台《用户隐私保护指引》
 *                                                            里没声明「剪切板」用途
 * 前者能靠"主动拉起授权 + 重试"救回来；后者只能去后台补声明（代码无能为力，所以要把话讲明白）。
 *
 * 另外两个坑：
 *  ① 空内容也要有反馈（旧实现只在页面里判断，漏一处就等于静默）。
 *  ② 微信在 setClipboardData 成功后会**自带一个"内容已复制"系统提示**，它可能把我们
 *     紧接着调用的 showToast 盖掉。所以"必须被看见"的场合用 alert（弹窗），别用 toast。
 *
 * 返回 Promise<boolean>：调用方可以按结果决定后续动作。
 */

// 剪贴板失败分类（纯函数，可单测）。不同基础库字段不一致，所以 errno 与 errMsg 都要认。
// ⚠️ userText 是**给最终用户看**的，所以不出现"后台/隐私指引"这类开发者术语
//    （那些精确原因走 console.error，让开发者能看到）；
//    而两种隐私失败的"用户能做什么"其实一样：只能长按手动复制。
function clipboardFailInfo(err) {
  const msg = String((err && (err.errMsg || err.message)) || '');
  const errno = Number((err && err.errno) || 0);
  if (errno === 104179 || /scope is not declared/i.test(msg)) {
    return { kind: 'decl', userText: '复制功能未开通，可长按链接手动复制' };
  }
  if (errno === 104 || errno === 104180 || /privacy/i.test(msg) || /not authorized/i.test(msg)) {
    return { kind: 'auth', userText: '未授权复制，可长按链接手动复制' };
  }
  return { kind: 'other', userText: '' };      // 交给调用方的 failText 兜底
}

function copyText(text, opts) {
  const o = opts || {};
  const s = String(text == null ? '' : text);
  const failMsg = o.failText || '复制失败，请长按文本手动复制';
  const okMsg = o.okText || '已复制到剪贴板';
  return new Promise((resolve) => {
    if (!s.trim()) {                       // 空内容不静默
      toast(o.emptyText || '没有可复制的内容');
      resolve(false);
      return;
    }
    const done = () => {
      // ⚠️ 返回值语义：resolve 的是"是否真的写进了剪贴板"，**不代表用户已确认任何事**。
      //    弹窗（alert）是异步的，这里在弹窗关闭前就 resolve 了 —— 调用方别拿它当"用户点了确定"。
      if (o.alert) alert(o.alertTitle || '已复制', o.alertContent || okMsg);
      else toast(okMsg, 'success');
      resolve(true);
    };

    // retried：只允许重试一次（隐私授权成功后），避免死循环
    const write = (retried) => {
      try {
        wx.setClipboardData({
          data: s,
          success: done,
          fail: (err) => {
            const info = clipboardFailInfo(err);
            console.error('[util.copyText] 剪贴板写入失败：', err,
              info.kind === 'decl' ? '→ 需要在小程序后台的《用户隐私保护指引》里声明「剪切板」用途'
                : (info.kind === 'auth' ? '→ 用户未授权隐私（下面会主动拉起一次授权并重试）' : ''));
            // 「未授权」是可以救的：主动拉起隐私授权弹窗，用户同意后重试一次。
            // 「没声明」救不了（弹窗也没用），所以不重试，直接把原因讲明白。
            if (info.kind === 'auth' && !retried && typeof wx.requirePrivacyAuthorize === 'function') {
              wx.requirePrivacyAuthorize({
                success: () => write(true),
                fail: (e2) => {
                  console.warn('[util.copyText] 隐私授权未通过：', e2);
                  toast(info.userText || failMsg);
                  resolve(false);
                }
              });
              return;
            }
            toast(info.userText || failMsg);
            resolve(false);
          }
        });
      } catch (e) {                        // 同步异常同样要有反馈
        console.error('[util.copyText] 剪贴板调用异常：', e);
        toast(failMsg);
        resolve(false);
      }
    };
    write(false);
  });
}

/* ===================== 外链归一化（「前往原视频」用） =====================
 * 小程序里没有 window.open，也**无法打开任意外部网页**：
 * `<web-view>` 要求该域名是自己在后台备案并配置的业务域名（抖音/B站这类站外域名配不了），
 * 硬跳会落到 web-view 的错误页。所以站外视频只能"复制链接 + 指引用户去 App/浏览器打开"。
 * 归一化的意义：把"用户实际粘贴的东西"变成"一个确定可用的链接"，并把坏输入讲清楚。
 *
 * 返回 { ok, url, reason, extracted }
 *   reason: '' | 'empty' 空 | 'no-url' 认不出链接 | 'scheme' 协议不允许 | 'malformed' 格式错
 *   extracted: 是否从一段文本里"抠"出来的（用户粘的是整段分享文案）
 */
const URL_ZW = /[\u200b-\u200d\ufeff]/g;          // 零宽字符（复制夹带）
const RE_HTTP = /https?:\/\/[^\s<>"'）】]+/i;      // 链接主体：到空白或常见收尾标点为止
const RE_CJK = /[\u3400-\u9fff\uf900-\ufaff]/;     // 中日韩字符（含扩展 A / 兼容区）
// 这些字符不可能是一个链接的**结尾** —— 出现了就说明它是被切断的半个链接。
// 宁可报"格式不对"让用户检查，也不要复制出去一个打不开的东西（那才是真正的静默失败）。
const RE_CUT = /[?&#=,:]$/;

function _normRaw(v) {
  // 全角冒号/斜杠是中文输入法下的常见产物，先归一化再判断协议
  return String(v == null ? '' : v).replace(URL_ZW, '').replace(/：/g, ':').replace(/\uFF0F/g, '/').trim();
}

// 主机是否合法：IPv4 直连、内网下划线主机、常规域名都放行；
// ⚠️ 这里宁松勿紧 —— 把合法链接误判成"格式错"比漏放行更糟（用户明明填对了却被告知填错）
function _hostOk(host) {
  if (!host || /[^\x21-\x7e]/.test(host)) return false;         // 非 ASCII（含中文）不算域名
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;        // IPv4，如 192.168.1.10
  const parts = host.split('.');
  if (parts.length < 2) return false;
  if (parts.some((p) => !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/i.test(p))) return false;
  return /^[a-z0-9-]{2,}$/i.test(parts[parts.length - 1]);
}

function _check(url) {
  const m = /^([a-z][a-z0-9+.\-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return { ok: false, reason: 'malformed' };
  const scheme = m[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'scheme' };
  let host = m[2];
  const at = host.lastIndexOf('@');                             // userinfo（user:pass@host）不算主机
  if (at >= 0) host = host.slice(at + 1);
  const colon = host.lastIndexOf(':');                          // 允许带端口（:8080），别误杀
  if (colon >= 0) {
    const port = host.slice(colon + 1);
    host = host.slice(0, colon);
    if (!/^\d{1,5}$/.test(port)) return { ok: false, reason: 'malformed' };
  }
  if (!_hostOk(host)) return { ok: false, reason: 'malformed' };
  return { ok: true, url: url };
}

// 链接尾部的标点**不是链接的一部分**：粘贴"看看这个 https://v.douyin.com/abc/。"时，
// 中文句号会被一起复制走 → 用户拿到一个打不开的链接（静默失败的另一种形态）。
// 成对括号另算：右括号比左括号多才当标点丢（`...(disambiguation)` 这种要保持完整）。
const TAIL_PUNCT = /[。，、；：？！…·"'，,;!]/;
const PAIRS = [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']'], ['《', '》'], ['「', '」'], ['『', '』']];

function _trimTail(u) {
  let s = u;
  for (let guard = 0; guard < 8 && s.length; guard++) {
    const last = s[s.length - 1];
    if (TAIL_PUNCT.test(last)) { s = s.slice(0, -1); continue; }
    const pair = PAIRS.filter((p) => p[1] === last)[0];
    if (pair) {
      const open = s.split(pair[0]).length - 1;
      const close = s.split(pair[1]).length - 1;
      if (close > open) { s = s.slice(0, -1); continue; }
    }
    break;
  }
  return s;
}

function normalizeUrl(raw) {
  const text = _normRaw(raw);
  if (!text) return { ok: false, url: '', reason: 'empty', extracted: false };

  const m = RE_HTTP.exec(text);
  if (m) {
    // 链接是"一段文案的一部分"吗？决定两件事：要不要在中文处截断、要不要提示"已提取"
    const isPart = m.index > 0 || (m.index + m[0].length) < text.length;
    let frag = m[0];
    // 文案里紧跟链接的中文几乎一定是文案（真实链接基本是百分号编码的）→ 在第一个中文处截断；
    // 而"整串就是一条链接"时保留中文路径（浏览器会自动编码，那是合法链接，不该误杀）
    if (isPart) {
      const cjk = frag.search(RE_CJK);
      if (cjk > 0) frag = frag.slice(0, cjk);
    }
    frag = _trimTail(frag);
    if (RE_CUT.test(frag)) return { ok: false, url: '', reason: 'malformed', extracted: isPart };
    const c = _check(frag);
    if (!c.ok) return { ok: false, url: '', reason: c.reason, extracted: isPart };
    return { ok: true, url: c.url, reason: '', extracted: isPart || frag.length < text.length };
  }

  // 没有 http(s):// 前缀（或前缀存在但后面不成形）：
  // 先把"不允许的协议"讲明白，再看能不能当裸域名补全
  const m2 = /^([a-z][a-z0-9+.\-]*):/i.exec(text);
  if (m2) {
    const sc = m2[1].toLowerCase();
    // 协议本身是对的（http/https）却还是没匹配上 → 是残缺/写坏，不是"协议不允许"，
    // 提示要能区分开：前者让用户"检查格式"，后者告诉用户"只支持 http(s)"
    return { ok: false, url: '', reason: (sc === 'http' || sc === 'https') ? 'malformed' : 'scheme', extracted: false };
  }

  // 裸域名：只认"整串就是域名"。带空白/中文说明这是文案 → 归到 no-url，
  // 让提示语准确地告诉用户"把完整链接（以 http 开头）粘进来"，而不是含糊地说格式错
  if (!/\s/.test(text) && /^[^/?#\s]+\./.test(text)) {
    const bare = _trimTail(text);
    if (RE_CUT.test(bare)) return { ok: false, url: '', reason: 'malformed', extracted: false };
    const c = _check('https://' + bare);
    if (c.ok) return { ok: true, url: c.url, reason: '', extracted: false };
    return { ok: false, url: '', reason: c.reason, extracted: false };
  }
  return { ok: false, url: '', reason: 'no-url', extracted: false };
}

// V123：把"缺料清单"变成一句人话（生产前总检用）。
//   ⚠️ 为什么必须有它：store.checkBomStock() 返回的是**数组、不抛错**，而页面历史上只 try/catch
//      ⇒ 校验形同虚设（用户 2026-10-08：辅料不够时"系统不会提醒"，还让人白跑一趟裁剪页、
//        最后提示随页面一起关闭 ⇒ "没有任何提示"）。
//   收口在这里，两处入口（成品列表页 / 成品详情页）共用 —— 免得两处再漂移。
function shortageMessage(list) {
  if (!list || !list.length) return '';
  const head = list.slice(0, 4)
    .map(x => ((x && x.name) ? x.name : '未知物料') + ' 缺 ' + ((x && x.lack != null) ? x.lack : ''))
    .join('；');
  return list.length > 4 ? (head + ' 等 ' + list.length + ' 项') : head;
}

module.exports = {
  uid, today, fmtDate, fmtDateTime, addDays, diffDays, money, percent, round, toast, confirm, alert,
  shortageMessage,
  toCm, fromCm, areaToM2, areaFromM2, sanitizeNum, hasIllegalNum,
  AREA_M2_THRESHOLD, areaAuto, fmtArea, trimNum,
  FLOW_SOURCE_LABELS, flowSourceLabel, navTo, bomIsBatchLine,
  copyText, normalizeUrl, clipboardFailInfo
};
