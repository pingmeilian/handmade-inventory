// tests/guard-module-scope.test.js —— 模块语义守卫（V115b）
//
// 起因（2026-10-05 白屏，真机/工具都白）：`utils/themes.js` 里 `function roles` 被写成了**两份**。
//   · Node（脚本语义）**放行** ⇒ `node -c` 过、947 条测试全绿
//   · 微信编译器按**模块语义** ⇒ `Error: Identifier 'roles' has already been declared` ⇒ 整包编译不过
//     ⇒ 所有页面"没有注册"（Page has not been registered yet）⇒ 白屏
// 📌 教训：**「Node 能跑」≠「微信能编译」** —— 测试必须按模块语义再验一遍。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['utils', 'services', 'components', 'custom-tab-bar', 'pages'];
const MODULE_DIRS = ['utils', 'services', 'custom-tab-bar'];

function jsFiles(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') jsFiles(p, out); }
    else if (f.endsWith('.js')) out.push(p);
  });
  return out;
}

// 顶层声明名（缩进为 0 的那些行）：function / const / let / var / class
function topDecls(src) {
  const names = [];
  src.split('\n').forEach((line) => {
    const m = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|class\s+([A-Za-z_$][\w$]*))/.exec(line);
    if (m) names.push(m[1] || m[2] || m[3]);
  });
  return names;
}

group('V115b · 模块语义守卫（防"Node 放行、微信判死"）');

test('① 顶层不许有重复声明（function/const/let/var/class 同名）', () => {
  const files = [];
  SCAN_DIRS.forEach((d) => jsFiles(path.join(ROOT, d), files));
  files.push(path.join(ROOT, 'app.js'));
  ok(files.length > 30, '前置：至少扫到 30 个源文件（实际 ' + files.length + '）');
  let n = 0;
  files.forEach((f) => {
    const names = topDecls(fs.readFileSync(f, 'utf8'));
    const seen = {};
    names.forEach((nm) => {
      if (seen[nm]) {
        n++;
        ok(false, path.relative(ROOT, f) + ' 顶层重复声明 `' + nm + '` —— 微信按模块语义会判死（整包编译不过⇒白屏）');
      }
      seen[nm] = 1;
    });
  });
  if (!n) ok(true, '全部 ' + files.length + ' 个源文件无顶层重复声明');
  // 注入法自检：把"两份 function roles"喂进判据，必须能被抓出来
  const dup = 'function roles(a) {\n  return a;\n}\nfunction roles(b) {\n  return b;\n}\n';
  const names = topDecls(dup);
  ok(names.length === 2 && names[0] === names[1], '自检失败：重复声明的样例没被识别');
});

test('② 共享目录必须能按**模块语义**解析（node --check 成 .mjs —— 微信就是这么判的）', () => {
  const files = [];
  MODULE_DIRS.forEach((d) => jsFiles(path.join(ROOT, d), files));
  ok(files.length > 5, '前置：共享目录至少 5 个文件（实际 ' + files.length + '）');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-mod-'));
  const bad = [];
  files.forEach((f, i) => {
    const tmp = path.join(tmpDir, 'f' + i + '.mjs');
    fs.writeFileSync(tmp, fs.readFileSync(f));
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      bad.push(path.relative(ROOT, f) + ' → ' + String(e.stderr).split('\n').slice(0, 3).join(' ').slice(0, 160));
    }
  });
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  ok(bad.length === 0, '按模块语义解析失败（微信会整包编译不过）：\n    ' + bad.join('\n    '));

  // 注入法自检：重复 function 声明的样例在模块语义下必须被判死
  const tmp = path.join(os.tmpdir(), 'mp-dup-check-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, 'function foo() { return 1; }\nfunction foo() { return 2; }\n');
  let caught = false;
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { caught = true; }
  try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
  ok(caught, '自检失败：重复声明的样例在模块语义下没被 node --check 抓住 —— 这条守卫没有牙');
});
