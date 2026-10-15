// tests/guard-fail-errmsg.test.js —— 「fail 回调吞掉 errMsg」的防回归守卫
//
// 背景（2026-09-24 真机）：备份页点「从聊天记录选择备份文件」，不论什么原因失败
// 都弹一句「已取消选择」—— 因为写的是 `fail() { util.toast('已取消选择') }`：
// **fail 连参数都没接**，errMsg 被整个丢掉。
// 后果：把「平台真的失败」伪装成「用户主动取消」，
// 用户以为是自己手滑，排查者也会一路查错方向。
//
// 这个坑本项目已经踩过两次：
//   ① utils/share.js 曾把平台拒绝统一说成"你取消了转发"（已修，注释里留了教训）
//   ② 本次 pages/settings/backup.js 的 chooseMessageFile / readFile（V55 修）
// 两次都属"静默失败"家族，所以立守卫：**fail 回调必须接住 errMsg**。
//
// 判定：出现空参数的 `fail()` 且块内还给了 toast/showModal 结论 ——
// 说明它在**没有原因**的情况下断言了一个结果。
// 正确写法是 `fail(err) { ... }`，哪怕只是 console.error 留痕，也要接住。

const path = require('path');
const fs = require('fs');
const { test, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('fail 回调必须接住 errMsg —— 空参数的 fail() 里不得直接给用户下结论', () => {
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel.indexOf('tests/') === 0 || rel.indexOf('tools/') === 0 || rel.indexOf('.workbuddy/') === 0) return;
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    // 单层花括号块，避免跨块误匹配
    const re = /fail\s*\(\s*\)\s*\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (/toast|showModal/.test(m[1])) {
        offenders.push(rel + '  → ' + m[1].trim().replace(/\s+/g, ' ').slice(0, 70));
      }
    }
  });
  equal(
    offenders.length, 0,
    '以下位置的 fail 回调没接住 errMsg —— 会把「平台失败」伪装成「用户取消」，排查会被带偏：\n' + offenders.join('\n')
  );
});
