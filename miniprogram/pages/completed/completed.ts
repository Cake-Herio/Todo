Component({
  pageLifetimes: {
    show() {
      wx.setStorageSync('calendar_view_mode', 'completed')
      wx.switchTab({
        url: '/pages/calendar/calendar',
      })
    },
  },
})
