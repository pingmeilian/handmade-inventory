// tests/harness.js —— 零依赖测试运行器
// 为什么自己写：项目本身零第三方依赖，测试也不该引入 npm 包。

const cases = [];
let currentGroup = '';

function group(name) { currentGroup = name; }

function test(name, fn) {
  cases.push({ group: currentGroup, name, fn });
}

// ---------- 断言 ----------
// 小程序代码习惯 throw { code, msg }（不是 Error），这里统一转成可读文本
function errText(e) {
  if (e == null) return String(e);
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const parts = [];
    if (e.code) parts.push('[' + e.code + ']');
    if (e.msg) parts.push(e.msg);
    if (e.message) parts.push(e.message);
    return parts.length ? parts.join(' ') : JSON.stringify(e);
  }
  return String(e);
}

function fail(msg) { throw new Error(msg || '断言失败'); }

function ok(cond, msg) { if (!cond) fail(msg || '期望为真，实际为 ' + JSON.stringify(cond)); }

function equal(actual, expected, msg) {
  if (actual !== expected) {
    fail((msg ? msg + ' —— ' : '') + '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

// 浮点比较：金额一律两位小数，避免 0.1+0.2 这类噪声
function near(actual, expected, eps, msg) {
  const e = eps == null ? 0.005 : eps;
  if (typeof actual !== 'number' || Math.abs(actual - expected) > e) {
    fail((msg ? msg + ' —— ' : '') + '期望约 ' + expected + '（±' + e + '），实际 ' + JSON.stringify(actual));
  }
}

function deepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) fail((msg ? msg + ' —— ' : '') + '期望 ' + b + '，实际 ' + a);
}

function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) fail(msg || '期望抛出错误，但没有');
}

// ---------- 执行 ----------
// run() 支持异步用例：test 的 fn 返回 Promise 时会被 await
// （Day 4 备份恢复全链路依赖 wx 文件回调，必须异步跑）
async function run() {
  const C = { reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m', gray: '\u001b[90m', bold: '\u001b[1m' };
  let pass = 0, failCount = 0;
  const failures = [];
  let lastGroup = null;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.group && c.group !== lastGroup) {
      console.log('\n' + C.bold + c.group + C.reset);
      lastGroup = c.group;
    }
    try {
      await c.fn();
      pass++;
      console.log('  ' + C.green + '✓' + C.reset + ' ' + c.name);
    } catch (e) {
      failCount++;
      failures.push({ name: c.name, group: c.group, err: e });
      console.log('  ' + C.red + '✗' + C.reset + ' ' + c.name);
    }
  }

  console.log('\n' + '─'.repeat(56));
  if (failCount) {
    console.log(C.red + C.bold + '失败详情' + C.reset);
    failures.forEach((f) => {
      console.log('\n' + C.red + '✗ ' + (f.group ? f.group + ' › ' : '') + f.name + C.reset);
      console.log('  ' + (f.err && f.err.message ? f.err.message : errText(f.err)));
      if (f.err && f.err.stack && f.err instanceof Error) {
        const line = f.err.stack.split('\n').slice(1, 4).join('\n');
        console.log(C.gray + line + C.reset);
      }
    });
    console.log('');
  }
  const summary = 'PASS ' + pass + ' / FAIL ' + failCount + ' / TOTAL ' + cases.length;
  console.log(failCount ? C.red + C.bold + summary + C.reset : C.green + C.bold + summary + C.reset);
  return failCount === 0;
}
module.exports = { test, group, ok, equal, near, deepEqual, throws, fail, run, cases };
