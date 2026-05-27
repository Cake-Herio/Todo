import { getFontPageStyle } from '../../utils/font-preference'

Component({
  data: {
    pageStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      this.refresh()
    },
  },
  pageLifetimes: {
    show() {
      this.refresh()
    },
  },
  methods: {
    refresh(pageStyle?: string) {
      const style = pageStyle || getFontPageStyle()

      this.setData({ pageStyle: '' }, () => {
        wx.nextTick(() => {
          this.setData({ pageStyle: style })
        })
      })
    },
  },
})
