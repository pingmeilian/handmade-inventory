// tests/guard-catch-var.test.js —— 「catch 变量名与引用不一致」的防回归守卫
//
// 背景（2026-09-13 兜底审计发现）：pages/products/edit.js 教程步骤图的图片保存处，
// 写成了 `catch (err) { util.toast((e && e.msg) ...) }` —— catch 参数是 err，body 里却引用 e。
// 后果：store.savePhoto 失败（存储满/写入失败）时，本该弹「图片保存失败」，
// 实际却抛 ReferenceError（e 未定义），异常在 async 回调里变成未捕获的 Promise 拒绝 →
// 用户看到「点了没反应」，且 for 循环中断、后续图片全部不处理。
// 这是「静默失败」里最阴的一类：代码没崩在明面上，但用户永远收不到错误提示。
//
// 本守卫扫描源码：catch(参数A) 的同一行块内，若出现 `.msg` / `.message` 却挂在
// 另一个变量名（A 之外）上，即判定为变量名写错。err / e 是项目里最常见的两个名字，
// 故只拦这两个的错配（覆盖所有已知风险，又不至于过度设计）。

const path = require('path');
const fs = require('fs');
const { test, group, equal } = require('./harness.js');

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

group('catch 变量名一致性 · 源码扫描守卫');

test('catch(err) 块内不得引用 e.msg/e.message；catch(e) 块内不得引用 err.msg/err.message', () => {
  const offenders = [];
  walk(ROOT, []).forEach((p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel.indexOf('tests/') !== 0 && rel.indexOf('tools/') !== 0 && rel.indexOf('.workbuddy/') !== 0) {
      const code = stripComments(fs.readFileSync(p, 'utf8'));
      // 同一条语句内：catch(参数) 与 .msg/.message 的接收者不一致
      if (/catch\s*\(\s*err\s*\)\s*\{[^{}]*\be\.(?:msg|message)/.test(code)) offenders.push(rel + '  (catch err 却用 e)');
      if (/catch\s*\(\s*e\s*\)\s*\{[^{}]*\berr\.(?:msg|message)/.test(code)) offenders.push(rel + '  (catch e 却用 err)');
    }
  });
  equal(
    offenders.length, 0,
    '以下文件的 catch 变量名与引用不一致，会在异常路径上抛 ReferenceError 造成静默失败：\n' + offenders.join('\n')
  );
});
