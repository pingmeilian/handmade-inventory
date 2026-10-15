// cloudfunctions/getOpenid/index.js
// ── 本云函数的唯一职责：把调用者的**真实微信身份**返回给小程序端 ──
//
// 为什么必须放在服务端：
//   取 openid 的正规做法是「wx.login 拿 code → 服务端 code2Session 换 openid」，
//   而 code2Session 需要 **AppSecret** —— 绝不能放进小程序前端（会被反编译拿走）。
//   云函数里用 cloud.getWXContext().OPENID 一行即可拿到，且由平台注入、**无法伪造**。
//
// 为什么云备份离不开它：
//   小程序端本地那串 `oid_xxx` 是随机生成的，换手机/卸载重装就变 → 云端认不出你。
//   真实 openid 跟着微信账号走，换机不变，是"备份属于谁"的唯一可靠依据。

const cloud = require('wx-server-sdk');

// DYNAMIC_CURRENT_ENV = 使用云函数当前所在环境，免去硬编码环境 ID
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID || ''
  };
};
