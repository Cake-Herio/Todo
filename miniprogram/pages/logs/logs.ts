// logs.ts
// const util = require('../../utils/util.js')
import { formatTime } from '../../utils/util'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'

Component({
  data: {
    logs: [],
    pageFontStyle: getFontPageStyle(),
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
    },
  },
  lifetimes: {
    attached() {
      this.setData({
        logs: (wx.getStorageSync('logs') || []).map((log: string) => {
          return {
            date: formatTime(new Date(log)),
            timeStamp: log
          }
        }),
      })
    }
  },
})
