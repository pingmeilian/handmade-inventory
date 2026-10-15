// utils/privacy.js —— 微信隐私授权辅助（合规-1 加固）
// 隐私「同意」已统一由 app.js 的 wx.onNeedPrivacyAuthorize 接管：
// 当用户点击相册 / 相机等隐私接口时，微信会自动触发该回调并弹出同意弹窗，
// 用户同意后接口才继续执行。因此**页面层**不再主动拉起 requirePrivacyAuthorize
// （否则会与 onNeedPrivacyAuthorize 冲突、导致同意态不生效）。
//
// ⚠️ 例外（2026-09-14 V49 补充，别误删）：utils/util.js 的 copyText 在
//    `wx.setClipboardData` 因**未授权**（errno 104）失败时，会主动拉起一次
//    requirePrivacyAuthorize 并重试 —— 这与上面的约定**不冲突**：
//      ① 它发生在「用户已点击复制、且已失败一次」之后（不是进页面就弹，不算打扰）；
//      ② requirePrivacyAuthorize 本身就是官方推荐的"补一次授权"用法，
//         它触发的还是 onNeedPrivacyAuthorize 那套弹窗流程，二者是配合而非冲突。
//    所以「页面层不主动拉起」与「copyText 失败后按需补授权」是两条各自成立的规则。
//
// authorize(action) 现在直接执行业务逻辑；接口调用时的同意流程交给微信 + onNeedPrivacyAuthorize。
// 调用方仍需在 chooseMedia 的 fail 分支给出明确提示（后台未配置指引 / 用户拒绝时的兜底）。

function authorize(action) {
  if (typeof action === 'function') action();
}

module.exports = { authorize };
