Component({
  data: {
    voiceText: '',
    placeholder: '边说边显示识别文本...',
  },
  methods: {
    reset() {
      if (this.data.voiceText) {
        this.setData({ voiceText: '' })
      }
    },
    updateText(text: string) {
      const nextText = text || ''
      if (nextText === this.data.voiceText) {
        return
      }
      this.setData({ voiceText: nextText })
    },
  },
})
