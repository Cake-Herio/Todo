import {
  getBindablePlansForToday,
  buildTimedCompletion,
  getPlanById,
  getToday,
  saveTimedCompletionLocally,
  type Plan,
} from '../../utils/data'
import {
  endActivitySmithSession,
  isActivitySmithEnabled,
  registerActivitySmithSession,
} from '../../utils/activitysmith'
import {
  endBarkFocusSession,
  isBarkEnabled,
  notifyRoomFocusChange,
  registerBarkFocusSession,
} from '../../utils/bark'
import { canPublishFocusPresence, clearFocusPresence, fetchOwnFocusPresence, publishFocusPresence } from '../../utils/focus-presence'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { addPlanTagOption, getPlanTagNames } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'
import { saveTimedCompletionOnCloud } from '../../utils/cloud-sync'

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

const MIN_FOCUS_SECONDS = 5

interface LocalFocusSession {
  focusStartedAt: number
  accumulatedElapsedMs: number
  focusSegmentStartedAt: number
  isPaused: boolean
  selectedTag: string
  detail: string
  linkedPlanId: string
  savedAt: number
}

const LOCAL_FOCUS_KEY = 'myforest_local_focus_session'
const LOCAL_FOCUS_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 小时过期
const PENDING_STATS_TOAST_KEY = 'myforest_pending_stats_toast'

const saveLocalFocusSession = (component: WechatMiniprogram.Component.TrivialInstance) => {
  const data = component.data as Record<string, unknown>
  // 只在计时真正活跃时保存（running 或 morphing）；已结束 / idle 不保存
  if (!data.isRunning && data.controlsPhase !== 'morphing') {
    return
  }

  const inst = component as unknown as Record<string, unknown>

  const session: LocalFocusSession = {
    focusStartedAt: inst.focusStartedAt as number,
    accumulatedElapsedMs: inst.accumulatedElapsedMs as number,
    focusSegmentStartedAt: inst.focusSegmentStartedAt as number,
    isPaused: data.isPaused as boolean,
    selectedTag: (data.selectedTag as string) || '',
    detail: (data.detail as string) || '',
    linkedPlanId: (data.linkedPlanId as string) || '',
    savedAt: Date.now(),
  }

  wx.setStorageSync(LOCAL_FOCUS_KEY, session)
}

const getLocalFocusSession = (): LocalFocusSession | null => {
  const saved = wx.getStorageSync(LOCAL_FOCUS_KEY) as LocalFocusSession | ''
  if (!saved || typeof saved !== 'object') {
    return null
  }

  if (Date.now() - saved.savedAt > LOCAL_FOCUS_MAX_AGE_MS) {
    wx.removeStorageSync(LOCAL_FOCUS_KEY)
    return null
  }

  return saved
}

const clearLocalFocusSession = () => {
  wx.removeStorageSync(LOCAL_FOCUS_KEY)
}

const lockFocusPage = () => {
  wx.enableAlertBeforeUnload({
    message: '计时进行中，请先点击结束',
  })
}

const unlockFocusPage = () => {
  wx.disableAlertBeforeUnload()
}

const MORPH_DURATION_MS = 780

Component({
  timer: 0 as number,
  leavingFocus: false,
  focusStartedAt: 0,
  accumulatedElapsedMs: 0,
  focusSegmentStartedAt: 0,
  activitySmithSyncedMinute: -1,
  tagScrollViewportWidth: 0,
  idleTagScrollViewportWidth: 0,
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
    isSavingCompletion: false,
    isShortFocusConfirmVisible: false,
    isShortFocusConfirmClosing: false,
    linkedPlanId: '',
    selectedTag: '',
    detail: '',
    tags: getPlanTagNames(),
    isTagCreateVisible: false,
    elapsedSeconds: 0,
    focusCompletedAt: 0,
    timePreviewText: '',
    bindablePlans: [] as BindablePlanView[],
    centerIdleTags: false,
    showTagScrollFadeLeft: false,
    showTagScrollFadeRight: false,
    showIdleTagScrollFadeLeft: false,
    showIdleTagScrollFadeRight: false,
    showPlanScrollFadeLeft: false,
    showPlanScrollFadeRight: false,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      this.updateIdleTagScrollFades()
    },
    detached() {
      saveLocalFocusSession(this)
      this.stopTick()
      unlockFocusPage()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      if (this.data.controlsPhase === 'idle') {
        this.setData({ tags: getPlanTagNames() })
        this.updateIdleTagScrollFades()
      }

      if (this.data.isRunning && !this.data.isPaused) {
        this.refreshElapsedDisplay()
        if (!this.timer) {
          this.startTick()
        }
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
      const elapsedMinutes = Math.floor(elapsedSeconds / 60)

      if (
        isActivitySmithEnabled() &&
        this.data.isRunning &&
        elapsedMinutes !== this.activitySmithSyncedMinute
      ) {
        this.activitySmithSyncedMinute = elapsedMinutes
        this.syncActivitySmithPresence()
      }

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

      const isResuming = options?.resume === '1'

      this.setData({
        backGuardShow: true,
        controlsPhase: isResuming ? 'active' : 'idle',
        hintText: isResuming ? '正在恢复...' : '准备好后再开始',
        isRunning: false,
        isPaused: false,
        canLeave: isResuming,
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

      if (options?.resume === '1' || canPublishFocusPresence()) {
        void this.tryRestoreFocusSession()
      }

      this.updateIdleTagScrollFades()
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

      // 始终阻止侧滑返回手势：不做任何操作，page-container 的 show=true 会阻止退出。
      // 用户应通过页面上的「退出」按钮（exitFocus）或完成专注后来离开页面。
      // 所有离开操作都应通过 leaveFocusPage() 以编程方式完成（wx.navigateBack / wx.switchTab）。
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
    leaveFocusPage(options?: { home?: boolean; stats?: boolean }) {
      if (this.leavingFocus) {
        return
      }

      this.leavingFocus = true
      saveLocalFocusSession(this)
      unlockFocusPage()
      this.stopTick()

      const finishLeave = () => {
        this.leavingFocus = false
      }

      if (options?.stats) {
        wx.reLaunch({
          url: '/pages/stats/stats',
          fail: () => {
            wx.switchTab({
              url: '/pages/stats/stats',
              fail: finishLeave,
            })
          },
        })
        return
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
    getFocusPresencePayload() {
      return {
        sessionStartedAt: this.focusStartedAt,
        accumulatedSeconds: Math.floor(this.accumulatedElapsedMs / 1000),
        segmentStartedAt: this.data.isPaused ? 0 : this.focusSegmentStartedAt,
        isPaused: this.data.isPaused,
        tag: this.data.selectedTag.trim(),
      }
    },
    getActivitySmithSessionPayload() {
      return {
        ...this.getFocusPresencePayload(),
        tag: this.data.selectedTag,
        detail: this.data.detail,
      }
    },
    getBarkSessionPayload() {
      return {
        ...this.getFocusPresencePayload(),
        tag: this.data.selectedTag,
        detail: this.data.detail,
      }
    },
    syncFocusPresence() {
      if (!this.data.isRunning) {
        return
      }

      if (canPublishFocusPresence()) {
        void publishFocusPresence(this.getFocusPresencePayload())
      }

      this.syncActivitySmithPresence()
      this.syncBarkFocusSession()
    },
    syncActivitySmithPresence() {
      if (!isActivitySmithEnabled() || !this.data.isRunning) {
        return
      }

      void registerActivitySmithSession(this.getActivitySmithSessionPayload())
    },
    syncBarkFocusSession() {
      if (!isBarkEnabled() || !this.data.isRunning) {
        return
      }

      if (!`${this.data.selectedTag || ''}`.trim()) {
        return
      }

      void registerBarkFocusSession(this.getBarkSessionPayload())
    },
    /**
     * 通知同组成员当前专注状态变化（仅在 sharedSpace 模式下生效）
     */
    notifyRoomFocusEvent(eventType: 'start' | 'pause' | 'resume' | 'end') {
      if (!canPublishFocusPresence()) {
        return
      }

      const elapsedMinutes = Math.floor(this.accumulatedElapsedMs / 60000)

      void notifyRoomFocusChange({
        eventType,
        tag: this.data.selectedTag || undefined,
        elapsedMinutes,
      })
    },
    clearActivitySmithPresence(elapsedSeconds?: number) {
      if (!isActivitySmithEnabled()) {
        return
      }

      void endActivitySmithSession({
        accumulatedSeconds: elapsedSeconds ?? this.getElapsedSeconds(),
        tag: this.data.selectedTag,
        detail: this.data.detail,
      })
    },
    clearBarkFocusSession() {
      if (!isBarkEnabled()) {
        return
      }

      void endBarkFocusSession()
    },
    async tryRestoreFocusSession() {
      if (this.data.isRunning) {
        return
      }

      const resetToIdle = () => {
        this.setData({
          controlsPhase: 'idle',
          hintText: '准备好后再开始',
          isRunning: false,
          isPaused: false,
          canLeave: false,
        })
      }

      // 优先尝试云 session（sharedSpace 模式）
      try {
        const ownFocus = await fetchOwnFocusPresence()
        if (ownFocus) {
          const { restore } = ownFocus
          this.stopTick()
          this.leavingFocus = false
          this.focusStartedAt = restore.sessionStartedAt
          this.accumulatedElapsedMs = restore.accumulatedSeconds * 1000
          this.focusSegmentStartedAt = restore.isPaused ? 0 : restore.segmentStartedAt || Date.now()

          this.setData({
            controlsPhase: 'active',
            backGuardShow: true,
            canLeave: true,
            isRunning: true,
            isPaused: restore.isPaused,
            hintText: getHintText(true, restore.isPaused),
          })

          clearLocalFocusSession()

          const targetSeconds = this.getElapsedSeconds()
          this.animateTimerRestore(targetSeconds, restore.isPaused)

          this.syncFocusPresence()
          return
        }
      } catch (error) {
        console.warn('[focus] cloud restore failed, trying local', error)
      }

      // 共享专注状态尚不可用时，回退到本地保存的进行中计时。
      const local = getLocalFocusSession()
      if (local) {
        this.stopTick()
        this.leavingFocus = false
        this.focusStartedAt = local.focusStartedAt
        this.accumulatedElapsedMs = local.accumulatedElapsedMs
        // 本地 session 如果是 running 状态，从保存时刻起算已过时间
        this.focusSegmentStartedAt = local.isPaused ? 0 : local.focusSegmentStartedAt || local.savedAt

        this.setData({
          controlsPhase: 'active',
          backGuardShow: true,
          canLeave: true,
          isRunning: true,
          isPaused: local.isPaused,
          selectedTag: local.selectedTag,
          detail: local.detail,
          linkedPlanId: local.linkedPlanId,
          hintText: getHintText(true, local.isPaused),
        })

        const targetSeconds = this.getElapsedSeconds()
        this.animateTimerRestore(targetSeconds, local.isPaused)

        this.syncFocusPresence()
        return
      }

      // 无任何可恢复的 session
      resetToIdle()
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
      this.activitySmithSyncedMinute = -1

      this.setData({
        controlsPhase: 'morphing',
        backGuardShow: true,
        canLeave: true,
        isPaused: false,
        elapsedSeconds: 0,
        timeText: '00:00:00',
        ringAngle: 0,
        hintText: getHintText(true, false),
      })

      // 立即创建云端 session，即使用户在 morph 动画期间退出也能恢复
      if (canPublishFocusPresence()) {
        void publishFocusPresence({
          sessionStartedAt: this.focusStartedAt,
          accumulatedSeconds: 0,
          segmentStartedAt: 0,
          isPaused: false,
          tag: this.data.selectedTag.trim(),
        })
      }
      this.notifyRoomFocusEvent('start')

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
        this.notifyRoomFocusEvent('pause')
      } else {
        this.focusSegmentStartedAt = Date.now()
        this.notifyRoomFocusEvent('resume')
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
      clearLocalFocusSession()
      this.notifyRoomFocusEvent('end')
      void clearFocusPresence()
      this.clearActivitySmithPresence(elapsedSeconds)
      this.clearBarkFocusSession()

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
    updateIdleTagScrollFades(scrollLeft = 0) {
      if (this.data.controlsPhase !== 'idle') {
        return
      }

      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.focus-idle-tag-scroll').boundingClientRect()
        query.select('.focus-idle-tag-content').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const contentWidth = res[1]?.width || 0
          this.idleTagScrollViewportWidth = viewportWidth
          const fades = getScrollFadeState(scrollLeft, contentWidth, viewportWidth)
          this.setData({
            centerIdleTags: contentWidth <= viewportWidth,
            showIdleTagScrollFadeLeft: fades.showLeft,
            showIdleTagScrollFadeRight: fades.showRight,
          })
        })
      })
    },
    onIdleTagScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = this.idleTagScrollViewportWidth || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        centerIdleTags: scrollWidth <= viewportWidth,
        showIdleTagScrollFadeLeft: fades.showLeft,
        showIdleTagScrollFadeRight: fades.showRight,
      })
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
        this.refreshElapsedDisplay()
      }, 1000) as unknown as number
    },
    stopTick() {
      if (!this.timer) {
        return
      }

      clearInterval(this.timer)
      this.timer = 0
    },
    /**
     * 从 0 平滑动画过渡到目标秒数（恢复计时时消除数字跳变）
     */
    animateTimerRestore(targetSeconds: number, isPaused: boolean) {
      if (targetSeconds <= 0) {
        this.refreshElapsedDisplay()
        if (!isPaused) {
          this.startTick()
        }
        return
      }

      this.stopTick()

      const DURATION = Math.min(targetSeconds * 18, 560)
      const startMs = Date.now()

      const step = () => {
        const elapsed = Date.now() - startMs
        const progress = Math.min(elapsed / DURATION, 1)
        // ease-out 曲线：快到终点时减速
        const eased = 1 - Math.pow(1 - progress, 3)
        const displaySeconds = Math.round(targetSeconds * eased)

        this.setData({
          elapsedSeconds: displaySeconds,
          timeText: formatSeconds(displaySeconds),
          ringAngle: getRingAngle(displaySeconds),
        })

        if (progress < 1) {
          this.timer = setTimeout(step, 16) as unknown as number
        } else {
          // 动画结束，切回实时计时
          this.refreshElapsedDisplay()
          if (!isPaused) {
            this.startTick()
          }
        }
      }

      step()
    },
    selectTag(e: WechatMiniprogram.BaseEvent) {
      const tag = e.currentTarget.dataset.tag as string

      this.setData({
        selectedTag: this.data.selectedTag === tag ? '' : tag,
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
    async onTagCreateConfirm(e: WechatMiniprogram.CustomEvent<{ name: string; color: string }>) {
      const { name, color } = e.detail
      const result = await addPlanTagOption(name, color, 'private')

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
      this.updateIdleTagScrollFades()
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
          clearLocalFocusSession()
          this.notifyRoomFocusEvent('end')
          void clearFocusPresence()
          this.clearActivitySmithPresence()
          this.clearBarkFocusSession()
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
      if (this.data.isSavingCompletion) {
        return
      }

      dismissModal(this, 'isFinishPanelVisible', 'isFinishPanelClosing', {
        onDismissed: () => {
          this.leaveFocusPage()
        },
      })
    },
    async saveCompletion() {
      if (this.data.isSavingCompletion) {
        return
      }

      if (!`${this.data.selectedTag || ''}`.trim()) {
        wx.showToast({
          title: '请先选择一个标签',
          icon: 'none',
        })
        return
      }

      const elapsedSeconds = this.getElapsedSeconds()

      if (elapsedSeconds < MIN_FOCUS_SECONDS) {
        wx.showToast({
          title: '未满 5 秒无法保存',
          icon: 'none',
        })
        return
      }

      const actualMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60))

      const draft = buildTimedCompletion({
        tag: this.data.selectedTag,
        detail: this.data.detail,
        actualMinutes,
        startedAt: this.focusStartedAt,
        completedAt: this.data.focusCompletedAt || Date.now(),
        planId: this.data.linkedPlanId || undefined,
      })

      this.setData({ isSavingCompletion: true })
      try {
        await saveTimedCompletionOnCloud(draft)
      } catch (error) {
        this.setData({ isSavingCompletion: false })
        wx.showToast({
          title: error instanceof Error ? error.message : '云端保存失败，请稍后重试',
          icon: 'none',
        })
        return
      }

      saveTimedCompletionLocally(draft)

      dismissModal(this, 'isFinishPanelVisible', 'isFinishPanelClosing', {
        onDismissed: () => {
          this.setData({ isSavingCompletion: false })
          wx.setStorageSync(PENDING_STATS_TOAST_KEY, 'recorded')
          this.leaveFocusPage({ stats: true })
        },
      })
    },
    noop() {
      // Keep modal gestures from scrolling the page behind it.
    },
  },
})
