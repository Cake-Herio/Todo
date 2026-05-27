Component({
  data: {
    sharedTags: ['英语', '写代码', '运动'],
    privateTags: ['阅读', '复盘'],
  },
  methods: {
    addTag() {
      wx.showToast({
        title: '后续接入新增标签',
        icon: 'none',
      })
    },
  },
})
