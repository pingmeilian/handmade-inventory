// services/draft.js —— 列表页「新增」弹窗 ⇄ 详细编辑页 之间的一次性草稿 + 回程信号
//   （V138 去程：把弹窗里已填的内容带进编辑页；V139 回程：编辑页保存成功后，让列表把弹窗关掉；
//     V140 回程提速：**立刻**关，别等列表页 onShow —— 否则用户会看到弹窗闪一下）
//
// 为什么要有它：灵感 / 想做列表的「＋ 新增」是一个**小弹窗**（只有标题 + 图片 [+ 链接]），
//   里面有一行「详细编辑 ›」通往完整编辑页。**改前那一步什么都不带** ——
//   用户在弹窗里填好标题、传好图，一点「详细编辑」全没了，只能在新页面重填一遍。
//   （用户 2026-10-11 报的 bug：「填好了标题和图片之后，点详细编辑，标题和图片就消失了」）
//
// 为什么不用 URL 参数带：
//   · 图片是最多 6~9 条**路径**，标题也可能很长，拼进 `navigateTo` 的 query 长度不可控；
//   · 中文与特殊字符还要 encodeURIComponent，多一层出错面。
//   ⇒ 用**内存里的一次性草稿**最稳：不落存储、不碰 URL。
//
// 语义（刻意做成"取一次就没了"）：
//   `set(kind, draft)`  写入（同 kind 覆盖上一次）
//   `take(kind)`        取出**并清空**；kind 不匹配 / 没有 ⇒ 返回 null
//   `peek()`            只看不取（仅供测试与排查）
//
// ⚠️ 只有**真正从弹窗进来**的那一次才该 `take`。编辑页用 `?from=add` 区分，
//   否则「上一次没被取走的草稿」会串到下一次普通新增里（那是很难查的脏数据）。
const KINDS = ['inspiration', 'want'];

let pending = null;

function set(kind, draft) {
  if (KINDS.indexOf(kind) < 0) return null;      // 白名单：拼错 kind 直接不写，别留半个草稿
  pending = Object.assign({ kind: kind }, draft || {});
  return pending;
}

function take(kind) {
  if (!pending || pending.kind !== kind) return null;
  const d = pending;
  pending = null;
  return d;
}

function peek() { return pending; }

/* ---------- V139：回程信号「这条草稿已经落库了」 ----------
   用户报的 bug：「我新增想做界面点详细编辑，编辑好后保存，保存后返回**还是这个新增想做界面**，
   再点一次保存就会重新保存一次」。

   根因：列表页的「新增」弹窗在点「详细编辑」之后**没关**（showAdd 还是 true、字段还留着）。
   用户在编辑页保存成功、返回时，弹窗原样摆在眼前；再点它下面的「保存」⇒ **再存一条**。

   ⇒ 用一个"回程信号"：编辑页**真的把内容落库了**（保存 / 转成品都算）就 `markSaved(kind)`；
     列表页 `onShow` 里 `takeSaved(kind)`，真为 true 才**把弹窗关掉并清空**。

   ⚠️ 为什么不是"点详细编辑就顺手把弹窗关掉"：那样用户若在编辑页**中途返回**（没保存），
      弹窗里的标题 / 图片就**白白丢了**。现在只在"确实保存了"时才关 —— 没保存 ⇒ 弹窗原样留着，
      内容还在，可以再点一次「详细编辑」接着改。 */
let saved = {};

function markSaved(kind) {
  if (KINDS.indexOf(kind) < 0) return false;
  saved[kind] = true;
  return true;
}

function takeSaved(kind) {
  if (!saved[kind]) return false;
  delete saved[kind];
  return true;
}

/* ---------- V140：回程要「立刻关」，不能等列表页 onShow ----------
   用户报的 bug：「在编辑页点完保存之后，会返回，但是那个弹窗还能看见，会闪一下」。

   根因：返回时列表页是带着**上一次就已经渲染好的 DOM** 先显示出来的（弹窗还在），
   而 `onShow` 里的 setData 要等这一帧之后才生效 ⇒ 用户看到弹窗**闪一下**才消失。
   （V139 的 `takeSaved` 逻辑本身没错，错在"关得太晚" —— 那时页面已经画出来了。）

   ⇒ 在编辑页**落库成功的那一刻**就隔着页面栈把下层列表页的弹窗收掉：
     那时列表页还是**隐藏**的，渲染层先更新好，返回时一上来就是"没有弹窗"的样子。
     `takeSaved` 保留作**保底**（拿不到页面栈等极端情况下，onShow 仍会关一次）。

   ⚠️ 只认 `p.data.showAdd === true` 的页面，且必须自带 `closeAdd()`：
     没开弹窗的页面一律不碰 —— 正常返回路径下就是"什么都不做"。
   ⚠️ 万一某页 closeAdd 抛错，也不许影响"已经保存成功"这件事 ⇒ try/catch 吞掉。
   ⚠️ 从栈顶往下找：此刻栈顶是编辑页（它没有 showAdd），第一个命中的就是列表页。 */
function closeAddOnStack() {
  let pages = [];
  try { pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []; } catch (e) { pages = []; }
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i];
    if (!p || !p.data || p.data.showAdd !== true) continue;
    if (typeof p.closeAdd !== 'function') continue;
    try { p.closeAdd(); }
    catch (e) { console.error('[draft] 收起下层弹窗失败', e); }
    return true;
  }
  return false;
}

function clear() { pending = null; saved = {}; }

module.exports = { set, take, peek, clear, markSaved, takeSaved, closeAddOnStack, KINDS };
