import {
  getBindablePlansForToday,
  getPlanById,
  getToday,
  saveTimedCompletion,
  type Plan,
} from '../../utils/data'
import { canPublishFocusPresence, clearFocusPresence, publishFocusPresence } from '../../utils/focus-presence'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { addPlanTagOption, getPlanTagNames } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'

interface BindablePlanView {
  id: string
  tag: string
  timeLabel: string
  subtitle: string
}

const formatSeconds = (seconds: number) => {
  const safeSeconds = Math.max(seconds, 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainSeconds = safeSeconds % 60
  const pad = (value: number) => `${value}`.padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

const formatClock = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => `${value}`.padStart(2, '0')

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDurationLabel = (minutes: number) => {
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (rest === 0) {
    return `${hours}h`
  }

  return `${hours}h ${rest}m`
}

const buildPlanTimeLabel = (plan: Plan) => {
  if (plan.startTime && plan.endTime) {
    return `${plan.startTime}-${plan.endTime}`
  }

  if (plan.timeText && plan.timeText !== '今天') {
    return plan.timeText
  }

  return '全天'
}

const toBindablePlanView = (plan: Plan): BindablePlanView => ({
  id: plan.id,
  tag: plan.tag,
  timeLabel: buildPlanTimeLabel(plan),
  subtitle: plan.remark || plan.title,
})

const buildTimePreviewText = (startedAt: number, completedAt: number, elapsedSeconds: number) => {
  const actualMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60))

  return `${formatClock(startedAt)} - ${formatClock(completedAt)} · ${formatDurationLabel(actualMinutes)}`
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
const MIN_FOCUS_SECONDS = 5

const lockFocusPage = () => {
  wx.enableAlertBeforeUnload({
    message: FOCUS_LEAVE_MESSAGE,
  })
}

const unlockFocusPage = () => {
  wx.disableAlertBeforeUnload()
}

const MORPH_DURATION_MS = 780

Component({
  timer: 0 as number,
  focusPresenceTick: 0,
  leavingFocus: false,
  focusStartedAt: 0,
  accumulatedElapsedMs: 0,
  focusSegmentStartedAt: 0,
  tagScrollViewportWidth: 0,
  planScrollViewportWidth: 0,
  data: {
    safeTopPx: 0,
    backGuardShow: true,
    timeText: '00:00:00',
    hintText: '准备好后再开始',
    ringAngle: 0,
    canLeave: false,
    controlsPhase: 'idle' as 'idle' | 'morphing' | 'active',
    isRunning: false,
    isPaused: false,
    isFinishPanelVisible: false,
    isFinishPanelClosing: false,
    isShortFocusConfirmVisible: false,
    isShortFocusConfirmClosing: false,
    linkedPlanId: '',
    selectedTag: '英语',
    detail: '',
    tags: getPlanTagNames(),
    isTagCreateVisible: false,
    elapsedSeconds: 0,
    focusCompletedAt: 0,
    timePreviewText: '',
    bindablePlans: [] as BindablePlanView[],
    showTagScrollFadeLeft: false,
    showTagScrollFadeRight: false,
    showPlanScrollFadeLeft: false,
    showPlanScrollFadeRight: false,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    detached() {
      this.stopTick()
      unlockFocusPage()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      if (this.data.isRunning && !this.data.isPaused) {
        this.refreshElapsedDisplay()
      }

      if (this.data.isRunning && !this.data.canLeave) {
        lockFocusPage()
        this.setData({ backGuardShow: true })
      } else if (this.data.controlsPhase === 'morphing') {
        lockFocusPage()
      } else {
        unlockFocusPage()
      }
    },
  },
  methods: {
    getElapsedSeconds() {
      if (this.data.isPaused || !this.data.isRunning || !this.focusSegmentStartedAt) {
        return Math.floor(this.accumulatedElapsedMs / 1000)
      }

      return Math.floor((this.accumulatedElapsedMs + Date.now() - this.focusSegmentStartedAt) / 1000)
    },
    sealRunningElapsed() {
      if (!this.data.isRunning || this.data.isPaused || !this.focusSegmentStartedAt) {
        return
      }

      this.accumulatedElapsedMs += Date.now() - this.focusSegmentStartedAt
      this.focusSegmentStartedAt = 0
    },
    refreshElapsedDisplay() {
      const elapsedSeconds = this.getElapsedSeconds()

      this.setData({
        elapsedSeconds,
        timeText: formatSeconds(elapsedSeconds),
        ringAngle: getRingAngle(elapsedSeconds),
      })
    },
    onLoad(options?: Record<string, string | undefined>) {
      this.leavingFocus = false
      unlockFocusPage()
      this.initPageInsets()
      this.setData({
        backGuardShow: true,
        controlsPhase: 'idle',
        hintText: '准备好后再开始',
        isRunning: false,
        isPaused: false,
        canLeave: false,
      })

      const planId = options?.planId || ''
      if (planId) {
        const plan = getPlanById(planId)
        if (plan) {
          this.setData({
            linkedPlanId: planId,
            selectedTag: plan.tag,
            detail: plan.remark || plan.title,
          })
        }
      }
    },
    initPageInsets() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)
      this.setData({ safeTopPx: statusBarHeight + gapPx })
    },
    onBackGuardLeave() {
      if (this.leavingFocus) {
        return
      }

      if (this.data.canLeave || this.data.controlsPhase === 'idle') {
        this.leaveFocusPage()
        return
      }

      this.setData({ backGuardShow: true })
    },
    exitFocus() {
      if (this.data.controlsPhase !== 'idle') {
        return
      }

      this.leaveFocusPage()
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
    syncFocusPresence() {
      if (!canPublishFocusPresence() || !this.data.isRunning) {
        return
      }

      void publishFocusPresence({
        tag: this.data.selectedTag,
        detail: this.data.detail,
        startedAt: this.focusStartedAt,
        isPaused: this.data.isPaused,
        elapsedSeconds: this.getElapsedSeconds(),
      })
    },
    startTimer() {
      if (this.data.controlsPhase !== 'idle') {
        return
      }

      this.stopTick()
      this.leavingFocus = false
      this.focusStartedAt = Date.now()
      this.accumulatedElapsedMs = 0
      this.focusSegmentStartedAt = 0
      this.focusPresenceTick = 0
      lockFocusPage()

      this.setData({
        controlsPhase: 'morphing',
        backGuardShow: true,
        canLeave: false,
        isPaused: false,
        elapsedSeconds: 0,
        timeText: '00:00:00',
        ringAngle: 0,
        hintText: getHintText(true, false),
      })

      setTimeout(() => {
        this.focusSegmentStartedAt = Date.now()
        this.setData({
          controlsPhase: 'active',
          isRunning: true,
        })
        this.startTick()
        this.syncFocusPresence()
      }, MORPH_DURATION_MS)
    },
    onMorphLeftTap() {
      if (this.data.controlsPhase !== 'active') {
        return
      }

      this.togglePause()
    },
    onMorphRightTap() {
      if (this.data.controlsPhase !== 'active') {
        return
      }

      this.finishFocus()
    },
    togglePause() {
      if (!this.data.isRunning) {
        return
      }

      const nextPaused = !this.data.isPaused

      if (nextPaused) {
        this.sealRunningElapsed()
        this.refreshElapsedDisplay()
        this.stopTick()
      } else {
        this.focusSegmentStartedAt = Date.now()
      }

      this.setData({
        isPaused: nextPaused,
        hintText: getHintText(true, nextPaused),
      })

      if (!nextPaused) {
        this.startTick()
      }

      this.syncFocusPresence()
    },
    finishFocus() {
      if (!this.data.isRunning) {
        return
      }

      this.sealRunningElapsed()
      const elapsedSeconds = this.getElapsedSeconds()

      if (elapsedSeconds < MIN_FOCUS_SECONDS) {
        this.stopTick()
        this.refreshElapsedDisplay()
        openModal(this, 'isShortFocusConfirmVisible', 'isShortFocusConfirmClosing')
        return
      }

      this.stopTick()
      unlockFocusPage()
      void clearFocusPresence()

      const focusCompletedAt = Date.now()
      const bindablePlans = getBindablePlansForToday('me').map(toBindablePlanView)
      let linkedPlanId = this.data.linkedPlanId

      if (linkedPlanId) {
        const linkedPlan = getPlanById(linkedPlanId)
        const isLinkedValid = Boolean(
          linkedPlan &&
            linkedPlan.date === getToday() &&
            linkedPlan.status !== 'completed' &&
            linkedPlan.status !== 'cancelled',
        )

        if (!isLinkedValid) {
          linkedPlanId = ''
        } else if (!bindablePlans.some((plan) => plan.id === linkedPlanId) && linkedPlan) {
          bindablePlans.unshift(toBindablePlanView(linkedPlan))
        }
      }

      openModal(this, 'isFinishPanelVisible', 'isFinishPanelClosing', {
        canLeave: true,
        isRunning: false,
        isPaused: false,
        hintText: getHintText(false, false),
        tags: getPlanTagNames(),
        focusCompletedAt,
        elapsedSeconds,
        timeText: formatSeconds(elapsedSeconds),
        ringAngle: getRingAngle(elapsedSeconds),
        timePreviewText: buildTimePreviewText(this.focusStartedAt, focusCompletedAt, elapsedSeconds),
        bindablePlans,
        linkedPlanId,
      })
      this.updateTagScrollFades()
      this.updatePlanScrollFades()
    },
    updateTagScrollFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.finish-tag-scroll').boundingClientRect()
        query.select('.finish-tag-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          this.tagScrollViewportWidth = viewportWidth
          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showTagScrollFadeLeft: fades.showLeft,
            showTagScrollFadeRight: fades.showRight,
          })
        })
      })
    },
    onTagScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = this.tagScrollViewportWidth || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        showTagScrollFadeLeft: fades.showLeft,
        showTagScrollFadeRight: fades.showRight,
      })
    },
    updatePlanScrollFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.finish-plan-scroll').boundingClientRect()
        query.select('.finish-plan-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          this.planScrollViewportWidth = viewportWidth
          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showPlanScrollFadeLeft: fades.showLeft,
            showPlanScrollFadeRight: fades.showRight,
          })
        })
      })
    },
    onPlanScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = this.planScrollViewportWidth || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        showPlanScrollFadeLeft: fades.showLeft,
        showPlanScrollFadeRight: fades.showRight,
      })
    },
    startTick() {
      this.stopTick()
      this.refreshElapsedDisplay()

      this.timer = setInterval(() => {
        this.focusPresenceTick += 1
        this.refreshElapsedDisplay()

        if (this.focusPresenceTick % 30 === 0) {
          this.syncFocusPresence()
        }
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
    openTagCreateSheet() {
      this.setData({
        isTagCreateVisible: true,
      })
    },
    closeTagCreateSheet() {
      this.setData({
        isTagCreateVisible: false,
      })
    },
    onTagCreateConfirm(e: WechatMiniprogram.CustomEvent<{ name: string; color: string }>) {
      const { name, color } = e.detail
      const result = addPlanTagOption(name, color)

      if (!result.ok) {
        wx.showToast({
          title: result.message || '添加失败',
          icon: 'none',
        })
        return
      }

      const trimmedName = name.trim()

      this.setData({
        isTagCreateVisible: false,
        tags: getPlanTagNames(),
        selectedTag: trimmedName,
      })
      wx.showToast({
        title: '已添加主题',
        icon: 'success',
      })
      this.updateTagScrollFades()
    },
    onDetailInput(e: WechatMiniprogram.Input) {
      this.setData({
        detail: e.detail.value,
      })
    },
    selectLinkedPlan(e: WechatMiniprogram.BaseEvent) {
      const planId = e.currentTarget.dataset.id as string | undefined

      if (!planId) {
        return
      }

      if (planId === this.data.linkedPlanId) {
        this.clearLinkedPlan()
        return
      }

      const plan = getPlanById(planId)

      if (!plan) {
        return
      }

      this.setData({
        linkedPlanId: planId,
        selectedTag: plan.tag,
        detail: plan.remark || plan.title,
      })
    },
    clearLinkedPlan() {
      this.setData({
        linkedPlanId: '',
      })
    },
    cancelShortFocusConfirm() {
      dismissModal(this, 'isShortFocusConfirmVisible', 'isShortFocusConfirmClosing', {
        onDismissed: () => {
          if (this.data.isRunning && !this.data.isPaused) {
            this.focusSegmentStartedAt = Date.now()
            this.startTick()
          }
        },
      })
    },
    confirmShortFocusEnd() {
      dismissModal(this, 'isShortFocusConfirmVisible', 'isShortFocusConfirmClosing', {
        onDismissed: () => {
          this.stopTick()
          unlockFocusPage()
          void clearFocusPresence()
          this.setData({
            canLeave: true,
            isRunning: false,
            isPaused: false,
            isFinishPanelVisible: false,
            isFinishPanelClosing: false,
          })
          this.leaveFocusPage()
        },
      })
    },
    closeFinishPanel() {
      dismissModal(this, 'isFinishPanelVisible', 'isFinishPanelClosing', {
        onDismissed: () => {
          this.leaveFocusPage()
        },
      })
    },
    saveCompletion() {
      const elapsedSeconds = this.getElapsedSeconds()

      if (elapsedSeconds < MIN_FOCUS_SECONDS) {
        wx.showToast({
          title: '未满 5 秒无法保存',
          icon: 'none',
        })
        return
      }

      const actualMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60))

      saveTimedCompletion({
        tag: this.data.selectedTag,
        detail: this.data.detail,
        actualMinutes,
        startedAt: this.focusStartedAt,
        completedAt: this.data.focusCompletedAt || Date.now(),
        planId: this.data.linkedPlanId || undefined,
      })

      dismissModal(this, 'isFinishPanelVisible', 'isFinishPanelClosing', {
        onDismissed: () => {
          wx.showToast({
            title: '已记录',
            icon: 'success',
          })
          this.leaveFocusPage({ home: true })
        },
      })
    },
    noop() {
      // Keep modal gestures from scrolling the page behind it.
    },
  },
})
