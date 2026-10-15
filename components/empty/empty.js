// components/empty/empty.js
Component({
  properties: {
    title: { type: String, value: '这里还空空的' },
    desc: { type: String, value: '' },
    btnText: { type: String, value: '' }
  },
  methods: {
    onTap() { this.triggerEvent('action'); }
  }
});
