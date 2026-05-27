const formatSeconds = (seconds: number) => {
  const safeSeconds = Math.max(seconds, 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainSeconds = safeSeconds % 60
  const pad = (value: number) => `${value}`.padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

const getRingAngle = (elapsedSeconds: number) => (elapsedSeconds * 6) % 360

const getHintText = (isRunning: boolean, isPaused: boolean) => {
  if (!isRunning) {
    return '准备好后再开始'
  }

  if (isPaused) {
    return '已暂停，回来后可以继续'
  }

  return '保持稳定呼吸，慢慢推进'
}

const FOCUS_LEAVE_MESSAGE = '计时进行中，请先点击结束'

const lockFocusPage = () => {
  wx.enableAlertBeforeUnload({
    message: FOCUS_LEAVE_MESSAGE,
  })
}

const unlockFocusPage = () => {
  wx.disableAlertBeforeUnload()
}

Component({
  timer: 0 as number,
  leavingFocus: false,
  data: {
    backGuardShow: true,
    timeText: '00:00:00',
    hintText: '保持稳定呼吸，慢慢推进',
    ringAngle: 0,
    canLeave: false,
    isRunning: false,
    isPaused: false,
    isFinishPanelVisible: false,
    selectedTag: '英语',
    detail: '',
    tags: ['英语', '写代码', '阅读', '运动'],
    elapsedSeconds: 0,
  },
  lifetimes: {
    detached() {
      this.stopTick()
      unlockFocusPage()
    },
  },
  pageLifetimes: {
    show() {
      if (!this.data.canLeave) {
        lockFocusPage()
        this.setData({ backGuardShow: true })
      }
    },
  },
  methods: {
    onLoad() {
      this.leavingFocus = false
      lockFocusPage()
      this.setData({ backGuardShow: true })
      this.startTimer()
    },
    onBackGuardLeave() {
      if (this.leavingFocus) {
        return
      }

      if (this.data.canLeave) {
        this.leaveFocusPage()
        return
      }

      this.setData({ backGuardShow: true })
    },
    onBackGuardAfterLeave() {
      if (this.leavingFocus || this.data.canLeave) {
        return
      }

      this.setData({ backGuardShow: true })
    },
    leaveFocusPage(options?: { home?: boolean }) {
      if (this.leavingFocus) {
        return
      }

      this.leavingFocus = true
      unlockFocusPage()
      this.stopTick()

      const finishLeave = () => {
        this.leavingFocus = false
      }

      if (options?.home) {
        wx.switchTab({
          url: '/pages/index/index',
          fail: () => {
            wx.navigateBack({
              fail: finishLeave,
            })
          },
        })
        return
      }

      wx.navigateBack({
        fail: () => {
          wx.switchTab({
            url: '/pages/index/index',
            fail: finishLeave,
          })
        },
      })
    },
    startTimer() {
      this.stopTick()
      this.leavingFocus = false
      lockFocusPage()
      this.setData({
        backGuardShow: true,
        canLeave: false,
        isRunning: true,
        isPaused: false,
        elapsedSeconds: 0,
        timeText: '00:00:00',
        ringAngle: 0,
        hintText: getHintText(true, false),
      })
      this.startTick()
    },
    togglePause() {
      if (!this.data.isRunning) {
        return
      }

      const nextPaused = !this.data.isPaused
      this.setData({
        isPaused: nextPaused,
        hintText: getHintText(true, nextPaused),
      })

      if (nextPaused) {
        this.stopTick()
      } else {
        this.startTick()
      }
    },
    finishFocus() {
      if (!this.data.isRunning) {
        return
      }

      this.stopTick()
      unlockFocusPage()
      this.setData({
        canLeave: true,
        isRunning: false,
        isPaused: false,
        isFinishPanelVisible: true,
        hintText: getHintText(false, false),
      })
    },
    startTick() {
      this.stopTick()
      this.timer = setInterval(() => {
        const elapsedSeconds = this.data.elapsedSeconds + 1
        this.setData({
          elapsedSeconds,
          timeText: formatSeconds(elapsedSeconds),
          ringAngle: getRingAngle(elapsedSeconds),
        })
      }, 1000) as unknown as number
    },
    stopTick() {
      if (!this.timer) {
        return
      }

      clearInterval(this.timer)
      this.timer = 0
    },
    selectTag(e: WechatMiniprogram.BaseEvent) {
      this.setData({
        selectedTag: e.currentTarget.dataset.tag,
      })
    },
    onDetailInput(e: WechatMiniprogram.Input) {
      this.setData({
        detail: e.detail.value,
      })
    },
    closeFinishPanel() {
      this.setData({
        isFinishPanelVisible: false,
      })
      this.leaveFocusPage()
    },
    saveCompletion() {
      this.setData({
        isFinishPanelVisible: false,
      })
      wx.showToast({
        title: '已记录',
        icon: 'success',
      })
      this.leaveFocusPage({ home: true })
    },
    noop() {
      // Keep modal gestures from scrolling the page behind it.
    },
  },
})
