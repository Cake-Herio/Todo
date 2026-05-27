import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'

Component({
  data: {
    sharedTags: ['英语', '写代码', '运动'],
    privateTags: ['阅读', '复盘'],
    pageFontStyle: getFontPageStyle(),
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
    },
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
