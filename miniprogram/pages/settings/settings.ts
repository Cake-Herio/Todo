Component({
  data: {
    inviteCode: 'FOREST2026',
    items: [
      { label: '标签管理', desc: '共用 / 私人标签' },
      { label: '通知授权', desc: '计划开始前 5 分钟提醒' },
      { label: '默认计时模式', desc: '计时' },
      { label: '关于 MyForest', desc: '两人共享计划与专注' },
    ],
  },
  methods: {
    onItemTap(e: WechatMiniprogram.BaseEvent) {
      const label = e.currentTarget.dataset.label

      if (label === '标签管理') {
        wx.navigateTo({
          url: '/pages/tags/tags',
        })
        return
      }

      wx.showToast({
        title: '后续接入设置项',
        icon: 'none',
      })
    },
  },
})
