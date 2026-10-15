// components/ph-input/ph-input.js
// 全局统一占位输入组件：
// 规则1 默认展示灰色占位提示（纯视觉，不进表单值）
// 规则2 点击激活输入框，占位文字清空
// 规则3 激活但未输入直接失焦，自动恢复灰色占位
// 规则4 仅用户手动输入的内容才会通过 bind:input 提交保存
// 数字输入清洗放在 utils/util.js（sanitizeNum），可单测、且别处也能复用
const util = require('../../utils/util.js');

Component({
  externalClasses: ['phClass'],
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    type: { type: String, value: 'text' },
    multiline: { type: Boolean, value: false },
    maxlength: { type: Number, value: 200 },
    disabled: { type: Boolean, value: false },
    autofocus: { type: Boolean, value: false },
    focus: { type: Boolean, value: false },      // 兼容原生 focus 写法
    confirmType: { type: String, value: 'done' }, // search/done/next/go/send
    // 悬浮气泡标签：为空则不启用（默认不影响其它页面）
    // 聚焦→上浮固定；失焦且无内容→收回框内；有内容→永久悬浮在输入框上方
    bubble: { type: String, value: '' },
    // V121：键盘弹起时是否自动上推页面 —— **默认 false 保持存量行为**（本组件原先写死 false）；
    //   整屏固定布局的页面（如裁剪页 height:100vh）必须显式开 true，否则键盘会盖住输入框。
    adjustPosition: { type: Boolean, value: false },
    // V121：光标与键盘的间距（rpx/px 原生单位）—— 聚焦时给输入框留出呼吸位。
    cursorSpacing: { type: Number, value: 0 },
    size: { type: String, value: '' },        // '' | compact | mini（紧凑档，教程模块用）
    tall: { type: Boolean, value: false },     // 更高输入框（弹窗/教程卡用，96rpx）
    autoHeight: { type: Boolean, value: false }, // 多行自动增高
    ds: { type: Object, value: {} }            // 透传业务数据（替代原生 data-*），emit 进事件 detail
  },
  // V121：selStart/selEnd 是给原生 input/textarea 的**选区**（-1 = 交原生自己管）。
  //   聚焦时置为 [0, 内容长度] ⇒ 已有内容呈"全选"态，用户一输入就**整个替换**；
  //   输入一次后复位为 -1，避免"每敲一位都替换掉上一位"。
  data: { focused: false, selStart: -1, selEnd: -1 },
  observers: {
    value() { /* 受控：父组件回写值即可，占位显隐由 focused + 原生逻辑处理 */ }
  },
  methods: {
    // V121（用户 2026-10-06）：聚焦即**全选已有内容** —— 想改尺寸时直接输入就整个覆盖，
    //   不会再拼成 5030（50+30）。
    //   ⚠️ 只选中、**不改值**：用户原话「点了之后没输入 就还是预设值」⇒ 绝不能靠清空实现。
    //   ⚠️ 空内容不设选区（-1）—— 免得出现"选中 0 个字符"的怪异光标。
    //   值可能是 Number（裁剪页就是这么传的）⇒ 统一 String() 后取长度，别拿 undefined.length 崩。
    onFocus() {
      const raw = this.data.value;
      const s = (raw === undefined || raw === null) ? '' : String(raw);
      this.setData({
        focused: true,
        selStart: s.length ? 0 : -1,
        selEnd: s.length ? s.length : -1
      });
      this.triggerEvent('focus');
    },
    onBlur() {
      // V121：失焦顺带把选区复位（一次 setData 跨桥，别分两次）——
      //   留着 [0, n] 万一被某些基础库在未聚焦时套用，会看到"没点它却全选"的怪态。
      //   ⚠️ 值**一个字都不动**：用户原话「点了之后没输入 就还是预设值」。
      this.setData({ focused: false, selStart: -1, selEnd: -1 });
      this.checkNum();
      this.triggerEvent('blur');
    },
    onInput(e) {
      const v = e.detail.value;
      // V121：输入过一次就把选区**复位**（交回原生管光标）——
      //   不复位的话，选区停在 [0, n] 会让"每敲一位都替换掉上一位"，两位数根本打不出来。
      if (this.data.selStart !== -1 || this.data.selEnd !== -1) {
        this.setData({ selStart: -1, selEnd: -1 });
      }
      // 数字框：**不改写用户的输入**（用户拍板：别偷偷清洗，格式不对就提醒），
      // 值原样抛给页面，由页面在保存时按 Number() 解析；这里只负责提醒。
      this.checkNum(v);
      this.triggerEvent('input', { value: v, ds: this.data.ds });
    },
    // 混进非数字字符时提醒一次；连续输入时不要连环弹
    checkNum(val) {
      const t = this.data.type;
      if (t !== 'digit' && t !== 'number') return;
      const v = val === undefined ? this.data.value : val;
      if (!util.hasIllegalNum(v, t === 'number')) return;
      const now = Date.now();
      if (this._warnAt && now - this._warnAt < 1600) return;
      this._warnAt = now;
      util.toast(t === 'number' ? '这里只能填整数' : '这里只能填数字');
    },
    onConfirm(e) {
      this.checkNum(e.detail.value);
      this.triggerEvent('confirm', { value: e.detail.value, ds: this.data.ds });
    },
    onLineChange(e) { this.triggerEvent('linechange', e.detail); }
  }
});
