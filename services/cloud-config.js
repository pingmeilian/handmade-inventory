// services/cloud-config.js —— 云开发配置的**唯一来源**
//
// 环境 ID 由用户在微信开发者工具「云开发」控制台创建后提供（2026-09-21）。
//
// ⭐ 硬要求（见《16-云备份实施计划》完成标准第 2 条）：
//    云未配置 / 运行环境不支持时，云功能必须**完整降级为纯本地** ——
//    也就是"接了云"绝不能比"不接云"更差。所有云调用方都要先问 isEnabled()。

// ⚠️⚠️ 云功能总闸（2026-09-27 用户拍板：先不开云，代码全部保留）
//
// 占位符形式（'__xxx__'）即视为「未配置」→ isEnabled() 返回 false
// → app.js 的 if (cloud.init()) 不成立 → 云模块全部不初始化、**零云开销**。
//
// 要重新开启：把下面这行改回真实环境 ID（改完需**重新上传 + 提审**）。
// ⚠️ 注意：云环境若已到期销毁，需先在控制台重建（免费环境注销后需满 1 个月才能再建），
//    并重新部署 cloudfunctions/ 下的 3 个云函数（getOpenid / backupIndex / photoIndex）。
//
// 原值（2026-09-21 创建）备查：'cloudbase-d1geyhbj6bc91eaaf'
const ENV_ID = '__disabled__';

// ── 测试态环境 ID ──
// 测试环境（tests/wx-stub.js 加载时）会把它装进下面的 override，
// 让 72 条云测试照常覆盖云代码 —— **这是必需的能力**：
// 总闸一关，若没有这条通道，云代码就完全失去测试保护了。
const TEST_ENV = 'cloudbase-stub-env';

// 仅测试使用的覆盖值。undefined = 未覆盖（用生产 ENV_ID）。
// 传 null 可模拟「生产的关闭态」（hasEnv() 会返回 false）。
let testEnvOverride;

function setEnvForTest(v) { testEnvOverride = v; }
function resetEnvForTest() { testEnvOverride = undefined; }

// 当前生效的环境 ID。
// ⚠️ 生产路径上 testEnvOverride 恒为 undefined（没有任何生产代码会调用 setEnvForTest，
//    有源码守卫 tests/guard-cloud-offline.test.js 盯着）→ 永远返回生产 ENV_ID。
function currentEnvId() {
  return testEnvOverride === undefined ? ENV_ID : testEnvOverride;
}

function hasEnv() {
  const id = currentEnvId();
  return !!id && id.indexOf('__') !== 0;
}

// 运行环境是否具备云能力（真机/开发者工具才有 wx.cloud；Node 测试环境由 wx-stub 提供）
function isSupported() {
  return typeof wx !== 'undefined' && !!wx.cloud && typeof wx.cloud.init === 'function';
}

// 总开关：调用方一律用它判断，不要自己拼条件
function isEnabled() {
  return hasEnv() && isSupported();
}

module.exports = {
  // getter：读到的永远是「当前生效」的环境 ID。
  // 云代码原本写的是 config.ENV_ID，用 getter 后无需改动即可自动跟随测试注入。
  get ENV_ID() { return currentEnvId(); },
  TEST_ENV: TEST_ENV,
  hasEnv: hasEnv,
  isSupported: isSupported,
  isEnabled: isEnabled,
  // 仅测试用：生产代码禁止调用（有源码守卫盯着）
  setEnvForTest: setEnvForTest,
  resetEnvForTest: resetEnvForTest
};
