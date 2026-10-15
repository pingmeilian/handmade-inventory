// tests/page-helper.js —— 页面级测试的公共脚手架
//
// 为什么需要：服务层测试证明不了「页面按钮真的接对了」。真机上我们又无法自动回归，
// 所以把页面当作普通对象加载进来、直接调它的方法，跑真实用户路径。
//
// 用法：
//   const page = loadPage('../pages/materials/edit.js');
//   page.onLoad({ id: 'm1' });
//   page.save();
//   await stub.flush();
//
// 说明：stub 里 global.Page 只是 (o) => o（不注册），所以这里包一层把配置对象截下来，
// 并补上 setData（微信运行时由框架提供）。

function loadPage(rel) {
  let captured = null;
  const orig = global.Page;
  global.Page = (o) => { captured = o; return o; };
  try {
    delete require.cache[require.resolve(rel)];
    require(rel);
  } finally {
    global.Page = orig;
  }
  if (!captured) throw new Error(rel + ' 未能捕获 Page 配置（文件里没有调用 Page(...) ？）');
  if (!captured.setData) {
    captured.setData = function (obj) {
      Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; });
    };
  }
  return captured;
}

module.exports = { loadPage: loadPage };
