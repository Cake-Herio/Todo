import { getFallbackAvatarUrl, resolvePartnerAvatarForDisplay, toDisplayAvatarUrl } from '../../utils/avatar-display'
import { addPlan, findTimedScheduleBatchConflictMessage, formatDate, getOwnerAvatarUrl, getPlansByDate, getToday, type OwnerKey, type Plan } from '../../utils/data'
import { refreshWithLocalFirst, bootstrapSharedSpace } from '../../utils/cloud-sync'
import { getDisplayAvatarUrl, getDisplayNickname, getPartnerDisplayAvatarUrl, getPartnerDisplayNickname, getSession, isProfileComplete, isSharedSpaceMode, saveUserProfile, tryRestoreSessionFromCloud } from '../../utils/session'
import { getOwnerFilterStateLocal } from '../../utils/owner-filters'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { fetchOwnFocusPresence, fetchPartnerFocusPresence } from '../../utils/focus-presence'
import { parsePlanTextWithDeepSeek, refinePlanDraftsWithDeepSeek, type AiPlanDraft, type AiDraftRefineSnapshot } from '../../utils/deepseek'
import { addPlanTagOption, DEFAULT_PLAN_TAGS, getPlanTagNames, getPlanTagOptions, resolvePlanTag } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'
import {
  applyEditPlanFormToDraft,
  buildDayOptions,
  buildEditPlanFormFromDraft,
  clampPickerYear,
  formatDateParts,
  formatTimeParts,
  parseDateParts,
  parseTimeParts,
  PERIOD_OPTIONS,
  PICKER_HOURS,
  PICKER_MINUTES,
  PICKER_MIN_YEAR,
  PICKER_MONTHS,
  PICKER_YEARS,
  SCHEDULE_KIND_OPTIONS,
  type PickerSheetKind,
} from '../../utils/plan-edit-form'

const WechatSI = requirePlugin('WechatSI')
const speechManager = WechatSI.getRecordRecognitionManager()

type VoiceLiveTextComponent = WechatMiniprogram.Component.TrivialInstance & {
  reset: () => void
  updateText: (text: string) => void
}

interface AiDraftEntry {
  id: string
  ownerKey: OwnerKey
  plan: AiPlanDraft
}

interface AiDraftCardView {
  id: string
  tag: string
  remark: string
  dateLabel: string
  timeLabel: string
}

interface UpcomingPreviewPlan {
  id: string
  time: string
  title: string
  tag: string
  owner: string
  ownerAvatarUrl: string
  color: 'green' | 'blue'
  statusLabel: string
  statusClass: 'soon' | 'wait'
  hint: string
  minutesUntil: number
}

const getStatusClass = (statusLabel: string): 'soon' | 'wait' =>
  statusLabel === '即将开始' || statusLabel === '即将结束' ? 'soon' : 'wait'

const UPCOMING_WINDOW_MINUTES = 120
/** 主页专注状态轮询间隔（自己 + 对方） */
const FOCUS_PRESENCE_POLL_MS = 60 * 1000

const parseTimeToMinutes = (time: string, treatMidnightAsEnd = false) => {
  const [hourText, minuteText] = time.split(':')
  let hour = Number(hourText)
  const minute = Number(minuteText || '0')

  if (treatMidnightAsEnd && hour === 0 && minute === 0) {
    hour = 24
  }

  return hour * 60 + minute
}

const getNowMinutes = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

const formatMinutesHint = (minutesUntil: number, kind: 'start' | 'end') => {
  if (minutesUntil <= 0) {
    return kind === 'start' ? '马上开始' : '马上结束'
  }

  if (minutesUntil < 60) {
    return `${minutesUntil} 分钟后${kind === 'start' ? '开始' : '结束'}`
  }

  const hours = Math.floor(minutesUntil / 60)
  const minutes = minutesUntil % 60

  if (minutes === 0) {
    return `${hours} 小时后${kind === 'start' ? '开始' : '结束'}`
  }

  return `${hours} 小时 ${minutes} 分钟后${kind === 'start' ? '开始' : '结束'}`
}

const buildUpcomingPreview = (plan: Plan, nowMinutes: number): UpcomingPreviewPlan | null => {
  if (!plan.startTime || !plan.endTime) {
    return null
  }

  const startMin = parseTimeToMinutes(plan.startTime)
  const endMin = parseTimeToMinutes(plan.endTime, true)

  if (nowMinutes < startMin) {
    const minutesUntil = startMin - nowMinutes

    if (minutesUntil > UPCOMING_WINDOW_MINUTES) {
      return null
    }

    return {
      id: plan.id,
      time: `${plan.startTime} 开始`,
      title: plan.tag,
      tag: plan.tag,
      owner: plan.ownerAvatar,
      ownerAvatarUrl: getOwnerAvatarUrl(plan.ownerKey),
      color: plan.color,
      statusLabel: minutesUntil <= 15 ? '即将开始' : '待开始',
      statusClass: getStatusClass(minutesUntil <= 15 ? '即将开始' : '待开始'),
      hint: formatMinutesHint(minutesUntil, 'start'),
      minutesUntil,
    }
  }

  if (nowMinutes < endMin) {
    const minutesUntil = endMin - nowMinutes

    if (minutesUntil > UPCOMING_WINDOW_MINUTES) {
      return null
    }

    return {
      id: plan.id,
      time: `${plan.endTime} 结束`,
      title: plan.tag,
      tag: plan.tag,
      owner: plan.ownerAvatar,
      ownerAvatarUrl: getOwnerAvatarUrl(plan.ownerKey),
      color: plan.color,
      statusLabel: minutesUntil <= 15 ? '即将结束' : '进行中',
      statusClass: getStatusClass(minutesUntil <= 15 ? '即将结束' : '进行中'),
      hint: formatMinutesHint(minutesUntil, 'end'),
      minutesUntil,
    }
  }

  return null
}

const pickUpcomingPlans = (plans: Plan[]) => {
  const nowMinutes = getNowMinutes()

  return plans
    .map((plan) => buildUpcomingPreview(plan, nowMinutes))
    .filter((plan): plan is UpcomingPreviewPlan => Boolean(plan))
    .sort((a, b) => a.minutesUntil - b.minutesUntil)
    .slice(0, 3)
}

const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const formatTodayTitle = () => {
  const today = new Date()
  return `${today.getMonth() + 1}月${today.getDate()}日 ${weekDays[today.getDay()]}`
}

const resolveRelativeDate = (timeText: string | null) => {
  const date = new Date()

  if (!timeText) {
    return getToday()
  }

  if (timeText.includes('后天')) {
    date.setDate(date.getDate() + 2)
    return formatDate(date)
  }

  if (timeText.includes('明天')) {
    date.setDate(date.getDate() + 1)
    return formatDate(date)
  }

  return getToday()
}

const formatDateLabel = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const formatDraftTimeLabel = (plan: AiPlanDraft) => {
  if (plan.startTime && plan.endTime) {
    return `${plan.startTime} - ${plan.endTime}`
  }

  return plan.timeText || plan.startTime || '未定时间'
}

const buildAiDraftEntries = (plans: AiPlanDraft[]) =>
  plans.map((plan, index) => ({
    id: `draft-${Date.now()}-${index}`,
    ownerKey: 'me' as OwnerKey,
    plan,
  }))

const toAiDraftCardView = (entry: AiDraftEntry): AiDraftCardView => {
  const { plan } = entry
  const date = plan.date || resolveRelativeDate(plan.timeText)

  return {
    id: entry.id,
    tag: resolvePlanTag(plan.defaultTag || plan.section),
    remark: plan.remark || '无补充备注',
    dateLabel: formatDateLabel(date),
    timeLabel: formatDraftTimeLabel(plan),
  }
}

const mapAiDraftCards = (entries: AiDraftEntry[]) => entries.map(toAiDraftCardView)

const buildDraftSnapshotForRefine = (entries: AiDraftEntry[]): AiDraftRefineSnapshot[] =>
  entries.map(({ ownerKey, plan }) => ({
    ownerKey,
    tag: resolvePlanTag(plan.defaultTag || plan.section),
    remark: plan.remark,
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    timeText: plan.timeText,
    estimatedMinutes: plan.estimatedMinutes,
  }))

const mergeRefinedEntries = (previousEntries: AiDraftEntry[], plans: AiPlanDraft[]) =>
  plans.map((plan, index) => ({
    id: previousEntries[index]?.id || `draft-${Date.now()}-${index}`,
    ownerKey: previousEntries[index]?.ownerKey || ('me' as OwnerKey),
    plan,
  }))

const buildAiDraftScheduleInputs = (entries: AiDraftEntry[]) =>
  entries.flatMap(({ ownerKey, plan }) => {
    const startTime = plan.startTime?.trim()
    const endTime = plan.endTime?.trim()

    if (!startTime || !endTime) {
      return []
    }

    return [
      {
        ownerKey,
        date: plan.date || resolveRelativeDate(plan.timeText),
        startTime,
        endTime,
        label: resolvePlanTag(plan.defaultTag || plan.section),
      },
    ]
  })

const saveAiPlanDrafts = (entries: AiDraftEntry[]) => {
  let savedCount = 0

  entries.forEach(({ ownerKey, plan }) => {
    const tag = resolvePlanTag(plan.defaultTag || plan.section)
    const result = addPlan({
      ownerKey,
      tag,
      title: tag,
      remark: plan.remark || undefined,
      date: plan.date || resolveRelativeDate(plan.timeText),
      startTime: plan.startTime || undefined,
      endTime: plan.endTime || undefined,
      timeText: plan.timeText || undefined,
      estimatedMinutes: plan.estimatedMinutes,
    })

    if (result.ok) {
      savedCount += 1
      return
    }

    wx.showToast({
      title: result.message,
      icon: 'none',
    })
  })

  return savedCount
}

Component({
  data: {
    today: formatTodayTitle(),
    nickname: getDisplayNickname(),
    avatarUrl: getDisplayAvatarUrl(),
    needProfileLogin: !isProfileComplete(),
    heroAvatarExpanded: isProfileComplete(),
    heroAvatarAnimate: false,
    homeContentVisible: isProfileComplete(),
    homeRevealActive: false,
    isLoginSheetVisible: false,
    isLoginSheetClosing: false,
    loginAvatarUrl: '',
    loginNickname: '',
    loginInviteCode: '',
    isProfileSaving: false,
    heroTreeSrc: '/images/home/hero-tree.png',
    singleUserMode: getOwnerFilterStateLocal('all').singleUserMode,
    partnerNickname: getPartnerDisplayNickname(),
    partnerAvatarUrl: getPartnerDisplayAvatarUrl() || getOwnerAvatarUrl('partner'),
    partnerFocusVisible: false,
    selfFocusVisible: false,
    nextPlans: [] as UpcomingPreviewPlan[],
    partner: {
      name: '对方',
      status: '专注',
      duration: '',
      avatarUrl: getOwnerAvatarUrl('partner'),
    },
    selfFocus: {
      name: '我',
      status: '专注',
      duration: '',
      avatarUrl: getOwnerAvatarUrl('me'),
    },
    isRecording: false,
    isVoiceMaskVisible: false,
    isVoiceMaskClosing: false,
    isVoiceCancelling: false,
    voiceMode: 'create' as 'create' | 'refine',
    isAiProcessing: false,
    isAiProcessingClosing: false,
    aiProcessingText: '',
    aiProcessingTitle: '',
    skipNextVoiceResult: false,
    voiceStartY: 0,
    isAiDraftVisible: false,
    isAiDraftClosing: false,
    isAiDraftEditVisible: false,
    editingDraftId: '',
    aiDraftSourceText: '',
    aiDraftEntries: [] as AiDraftEntry[],
    aiDraftCards: [] as AiDraftCardView[],
    editPlanForm: buildEditPlanFormFromDraft(
      {
        title: DEFAULT_PLAN_TAGS[0],
        section: DEFAULT_PLAN_TAGS[0],
        defaultTag: DEFAULT_PLAN_TAGS[0],
        remark: null,
        date: null,
        startTime: null,
        endTime: null,
        timeText: null,
        estimatedMinutes: null,
        completionMode: 'manual',
        certainty: { date: 'unknown', time: 'unknown' },
      },
      getToday(),
    ),
    scheduleKindOptions: SCHEDULE_KIND_OPTIONS,
    periodOptionLabels: PERIOD_OPTIONS.map((item) => item.label),
    isPickerSheetVisible: false,
    isPickerSheetClosing: false,
    pickerSheetKind: 'date' as PickerSheetKind,
    pickerSheetTitle: '',
    pickerTempValue: [0, 0, 0],
    pickerDayOptions: buildDayOptions(new Date().getFullYear(), new Date().getMonth() + 1),
    pickerYears: PICKER_YEARS,
    pickerMonths: PICKER_MONTHS,
    pickerHours: PICKER_HOURS,
    pickerMinutes: PICKER_MINUTES,
    isTagCreateVisible: false,
    quickTags: getPlanTagOptions(),
    showPlanTagScrollFadeLeft: false,
    showPlanTagScrollFadeRight: false,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      void this.bootstrapHomeSession()
      this.syncHomeChrome()
      this.setupSpeechRecognition()
    },
    detached() {
      this.stopPartnerFocusPolling()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      void this.bootstrapHomeSession()
    },
    hide() {
      this.stopPartnerFocusPolling()
    },
  },
  methods: {
    async bootstrapHomeSession() {
      if (!isProfileComplete()) {
        await tryRestoreSessionFromCloud()
      }

      refreshWithLocalFirst(() => {
        this.refreshHomeData()
        this.syncHomeChrome()

        if (isProfileComplete() && !this.data.homeContentVisible) {
          this.revealHomeContent()
        }

        if (isProfileComplete()) {
          this.startPartnerFocusPolling()
        }
      })

      if (isProfileComplete()) {
        void bootstrapSharedSpace().then(async () => {
          await this.prefetchPartnerAvatar()
          void this.refreshFocusPresence()
        })
      }
    },
    getVoiceLiveText() {
      return this.selectComponent('#voice-live-text') as VoiceLiveTextComponent | null
    },
    updateVoiceLiveText(text: string) {
      if (!text) {
        return
      }

      ;(this as WechatMiniprogram.IAnyObject)._liveVoiceText = text
      this.getVoiceLiveText()?.updateText(text)
    },
    setupSpeechRecognition() {
      speechManager.onRecognize = (res: { result?: string }) => {
        this.updateVoiceLiveText(res.result || '')
      }

      speechManager.onStop = (res: { result?: string }) => {
        if (this.data.skipNextVoiceResult) {
          this.setData({
            skipNextVoiceResult: false,
          })
          return
        }

        const cachedText = ((this as WechatMiniprogram.IAnyObject)._liveVoiceText as string) || ''
        const resultText = (res.result || cachedText).trim()

        if (!resultText) {
          wx.showToast({
            title: '没有识别到内容',
            icon: 'none',
          })
          return
        }

        if (this.data.voiceMode === 'refine') {
          this.refineAiPlanDrafts(resultText)
          return
        }

        this.createAiPlanDraft(resultText)
      }

      speechManager.onError = () => {
        ;(this as WechatMiniprogram.IAnyObject)._liveVoiceText = ''
        this.getVoiceLiveText()?.reset()
        this.dismissVoiceMask({
          voiceMode: 'create',
        })
      }
    },
    refreshHomeData() {
      const today = getToday()
      const todayPlans = getPlansByDate(today)
      const activePlans = todayPlans.filter((plan) => plan.status !== 'completed')
      const session = getSession()
      const needProfileLogin = !isProfileComplete()
      const patch: WechatMiniprogram.Component.DataOption = {
        today: formatTodayTitle(),
        nickname: getDisplayNickname(),
        avatarUrl: getDisplayAvatarUrl(),
        needProfileLogin,
        singleUserMode: getOwnerFilterStateLocal(this.data.activeFilter || 'all').singleUserMode,
        partnerNickname: getPartnerDisplayNickname(),
        partnerAvatarUrl: getPartnerDisplayAvatarUrl() || getOwnerAvatarUrl('partner'),
        loginAvatarUrl: this.data.loginAvatarUrl || session?.avatarUrl || '',
        loginNickname: this.data.loginNickname || (session?.nickname !== '我' ? session?.nickname || '' : ''),
        nextPlans: pickUpcomingPlans(activePlans),
      }

      if (needProfileLogin && this.data.homeContentVisible) {
        patch.homeContentVisible = false
        patch.homeRevealActive = false
      }

      if (needProfileLogin && this.data.heroAvatarExpanded) {
        patch.heroAvatarExpanded = false
        patch.heroAvatarAnimate = false
      }

      if (!needProfileLogin && !this.data.heroAvatarExpanded) {
        patch.heroAvatarExpanded = true
      }

      this.setData(patch)
      this.syncHomeChrome()

      if (!needProfileLogin) {
        void this.refreshFocusPresence()
      }
    },
    syncHomeChrome() {
      const show = !this.data.needProfileLogin && this.data.homeContentVisible

      if (show) {
        wx.showTabBar({ animation: this.data.homeRevealActive })
      } else {
        wx.hideTabBar({ animation: false })
      }
    },
    revealHomeContent() {
      this.setData({
        homeContentVisible: true,
        homeRevealActive: true,
      }, () => {
        this.syncHomeChrome()
        setTimeout(() => {
          if (this.data.homeRevealActive) {
            this.setData({ homeRevealActive: false })
          }
        }, 920)
      })
    },
    startPartnerFocusPolling() {
      this.stopPartnerFocusPolling()
      ;(this as WechatMiniprogram.IAnyObject)._partnerFocusPollTimer = setInterval(() => {
        void this.refreshFocusPresence()
      }, FOCUS_PRESENCE_POLL_MS) as unknown as number
    },
    stopPartnerFocusPolling() {
      const timer = (this as WechatMiniprogram.IAnyObject)._partnerFocusPollTimer as number | undefined
      if (!timer) {
        return
      }

      clearInterval(timer)
      ;(this as WechatMiniprogram.IAnyObject)._partnerFocusPollTimer = 0
    },
    async prefetchPartnerAvatar() {
      const displayUrl = await resolvePartnerAvatarForDisplay()

      const updates: WechatMiniprogram.Component.DataOption = {}
      if (displayUrl !== this.data.partnerAvatarUrl) {
        updates.partnerAvatarUrl = displayUrl
      }

      if (this.data.partner.avatarUrl !== displayUrl) {
        updates.partner = {
          ...this.data.partner,
          avatarUrl: displayUrl,
        }
      }

      if (Object.keys(updates).length) {
        this.setData(updates)
      }
    },
    async refreshFocusPresence() {
      const state = getOwnerFilterStateLocal('all')
      const session = getSession()
      const partnerAvatarFallback = getPartnerDisplayAvatarUrl() || getOwnerAvatarUrl('partner')
      const selfAvatarFallback = toDisplayAvatarUrl(session?.avatarUrl || '', getFallbackAvatarUrl('me'))

      const updates: WechatMiniprogram.Component.DataOption = {}

      if (state.singleUserMode !== this.data.singleUserMode) {
        updates.singleUserMode = state.singleUserMode
      }

      let partner = null
      let self = null

      if (isSharedSpaceMode()) {
        try {
          partner = await fetchPartnerFocusPresence()
        } catch (error) {
          console.warn('[focus-presence] fetch partner failed', error)
        }

        try {
          self = await fetchOwnFocusPresence()
        } catch (error) {
          console.warn('[focus-presence] fetch self failed', error)
        }
      }

      const partnerVisible = Boolean(partner)
      if (partnerVisible !== this.data.partnerFocusVisible) {
        updates.partnerFocusVisible = partnerVisible
      }

      const selfVisible = Boolean(self)
      if (selfVisible !== this.data.selfFocusVisible) {
        updates.selfFocusVisible = selfVisible
      }

      const nextPartner = partner || {
        ...this.data.partner,
        avatarUrl: partnerAvatarFallback,
      }
      const prevPartner = this.data.partner
      if (
        nextPartner.name !== prevPartner.name ||
        nextPartner.status !== prevPartner.status ||
        nextPartner.duration !== prevPartner.duration ||
        nextPartner.avatarUrl !== prevPartner.avatarUrl
      ) {
        updates.partner = nextPartner
      }

      const nextSelf = self || {
        ...this.data.selfFocus,
        avatarUrl: selfAvatarFallback,
      }
      const prevSelf = this.data.selfFocus
      if (
        nextSelf.name !== prevSelf.name ||
        nextSelf.status !== prevSelf.status ||
        nextSelf.duration !== prevSelf.duration ||
        nextSelf.avatarUrl !== prevSelf.avatarUrl
      ) {
        updates.selfFocus = nextSelf
      }

      if (Object.keys(updates).length) {
        this.setData(updates)
      }

      void this.prefetchPartnerAvatar()
    },
    onHeroGreetingTap() {
      if (!this.data.needProfileLogin) {
        return
      }

      const session = getSession()
      openModal(this, 'isLoginSheetVisible', 'isLoginSheetClosing', {
        loginAvatarUrl: session?.avatarUrl || '',
        loginNickname: session?.nickname && session.nickname !== '我' ? session.nickname : '',
        loginInviteCode: this.data.loginInviteCode || '',
      })
    },
    closeLoginSheet() {
      if (this.data.isProfileSaving) {
        return
      }

      dismissModal(this, 'isLoginSheetVisible', 'isLoginSheetClosing')
    },
    onChooseLoginAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
      const avatarUrl = e.detail?.avatarUrl
      if (!avatarUrl) {
        return
      }

      this.setData({ loginAvatarUrl: avatarUrl })
    },
    onLoginNicknameInput(e: WechatMiniprogram.Input) {
      this.setData({ loginNickname: e.detail.value })
    },
    onLoginInviteCodeInput(e: WechatMiniprogram.Input) {
      this.setData({ loginInviteCode: e.detail.value.toUpperCase() })
    },
    async onConfirmProfileLogin() {
      const { loginAvatarUrl, loginNickname, loginInviteCode, isProfileSaving } = this.data
      if (isProfileSaving) {
        return
      }

      if (!loginAvatarUrl) {
        wx.showToast({ title: '请先选择头像', icon: 'none' })
        return
      }

      if (!loginNickname.trim()) {
        wx.showToast({ title: '请输入昵称', icon: 'none' })
        return
      }

      this.setData({ isProfileSaving: true })
      wx.showLoading({ title: '登录中' })

      try {
        const session = await saveUserProfile({
          nickname: loginNickname,
          avatarUrl: loginAvatarUrl,
          inviteCode: loginInviteCode,
        })

        if (isSharedSpaceMode()) {
          await bootstrapSharedSpace()
          getApp<IAppOption>().globalData.cloudReady = true
        }
        dismissModal(this, 'isLoginSheetVisible', 'isLoginSheetClosing', {
          extraData: {
            needProfileLogin: false,
            nickname: getDisplayNickname(),
            avatarUrl: getDisplayAvatarUrl(),
            heroAvatarExpanded: true,
            heroAvatarAnimate: true,
            isProfileSaving: false,
          },
          onDismissed: () => {
            this.refreshHomeData()
            setTimeout(() => {
              this.revealHomeContent()
              this.startPartnerFocusPolling()
            }, 520)
          },
        })
        wx.showToast({
          title: session.soloMode ? '已进入单人模式' : '欢迎回来',
          icon: 'success',
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '登录失败',
          icon: 'none',
        })
        this.setData({ isProfileSaving: false })
      } finally {
        wx.hideLoading()
      }
    },
    onVoiceStart(e: WechatMiniprogram.TouchEvent) {
      this.startVoiceRecording(e, 'create')
    },
    onDraftRefineVoiceStart(e: WechatMiniprogram.TouchEvent) {
      if (!this.data.isAiDraftVisible || this.data.isAiDraftEditVisible) {
        return
      }

      this.startVoiceRecording(e, 'refine')
    },
    startVoiceRecording(e: WechatMiniprogram.TouchEvent, mode: 'create' | 'refine') {
      const touch = e.touches[0]

      ;(this as WechatMiniprogram.IAnyObject)._liveVoiceText = ''
      this.getVoiceLiveText()?.reset()

      speechManager.start({
        duration: 60000,
        lang: 'zh_CN',
      })

      this.setData({
        voiceMode: mode,
        isVoiceMaskVisible: true,
        isVoiceMaskClosing: false,
        isRecording: true,
        isVoiceCancelling: false,
        skipNextVoiceResult: false,
        voiceStartY: touch ? touch.clientY : 0,
      })
    },
    dismissVoiceMask(extraData?: Record<string, unknown>) {
      dismissModal(this, 'isVoiceMaskVisible', 'isVoiceMaskClosing', {
        extraData: {
          isRecording: false,
          isVoiceCancelling: false,
          ...extraData,
        },
      })
    },
    onVoiceEnd() {
      if (!this.data.isRecording) {
        return
      }

      if (this.data.isVoiceCancelling) {
        this.dismissVoiceMask({
          skipNextVoiceResult: true,
          voiceMode: 'create',
        })
        wx.showToast({
          title: '已取消',
          icon: 'none',
        })
        speechManager.stop()
        return
      }

      this.dismissVoiceMask({
        skipNextVoiceResult: false,
      })
      speechManager.stop()
    },
    onVoiceCancel() {
      this.dismissVoiceMask({
        skipNextVoiceResult: true,
        voiceMode: 'create',
      })
      speechManager.stop()
    },
    onDraftRefineVoiceEnd() {
      this.onVoiceEnd()
    },
    onDraftRefineVoiceCancel() {
      this.onVoiceCancel()
    },
    onDraftRefineVoiceMove(e: WechatMiniprogram.TouchEvent) {
      this.onVoiceMove(e)
    },
    onVoiceMove(e: WechatMiniprogram.TouchEvent) {
      if (!this.data.isRecording) {
        return
      }

      const touch = e.touches[0]
      if (!touch) {
        return
      }

      const movedUpDistance = this.data.voiceStartY - touch.clientY
      const shouldCancel = movedUpDistance > 80

      if (shouldCancel !== this.data.isVoiceCancelling) {
        this.setData({
          isVoiceCancelling: shouldCancel,
        })
      }
    },
    dismissAiProcessing(extraData?: Record<string, unknown>) {
      dismissModal(this, 'isAiProcessing', 'isAiProcessingClosing', {
        extraData: {
          aiProcessingText: '',
          aiProcessingTitle: '',
          ...extraData,
        },
      })
    },
    createAiPlanDraft(sourceText: string) {
      this.setData({
        isAiProcessing: true,
        isAiProcessingClosing: false,
        aiProcessingText: sourceText,
        aiProcessingTitle: 'AI 整理中',
      })

      parsePlanTextWithDeepSeek(sourceText, getToday(), getPlanTagNames())
        .then((result) => {
          if (result.plans.length === 0) {
            wx.showToast({
              title: '没有识别到计划',
              icon: 'none',
            })
            return
          }

          const entries = buildAiDraftEntries(result.plans)

          openModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
            isAiDraftEditVisible: false,
            editingDraftId: '',
            aiDraftSourceText: sourceText,
            aiDraftEntries: entries,
            aiDraftCards: mapAiDraftCards(entries),
          })
        })
        .catch((error: Error) => {
          wx.showModal({
            title: 'DeepSeek 未连接成功',
            content: error.message,
            showCancel: false,
          })
        })
        .finally(() => {
          this.dismissAiProcessing()
        })
    },
    refineAiPlanDrafts(supplementText: string) {
      const { aiDraftSourceText, aiDraftEntries } = this.data

      if (!aiDraftEntries.length) {
        this.setData({ voiceMode: 'create' })
        return
      }

      this.setData({
        isAiProcessing: true,
        isAiProcessingClosing: false,
        aiProcessingText: supplementText,
        aiProcessingTitle: 'AI 调整中',
      })

      refinePlanDraftsWithDeepSeek(
        aiDraftSourceText,
        buildDraftSnapshotForRefine(aiDraftEntries),
        supplementText,
        getToday(),
        getPlanTagNames(),
      )
        .then((result) => {
          if (result.plans.length === 0) {
            this.setData({ voiceMode: 'create' })
            wx.showToast({
              title: '没有识别到调整',
              icon: 'none',
            })
            return
          }

          const entries = mergeRefinedEntries(aiDraftEntries, result.plans)

          openModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
            isAiDraftEditVisible: false,
            editingDraftId: '',
            aiDraftEntries: entries,
            aiDraftCards: mapAiDraftCards(entries),
            voiceMode: 'create',
          })
        })
        .catch((error: Error) => {
          this.setData({ voiceMode: 'create' })
          wx.showModal({
            title: 'DeepSeek 未连接成功',
            content: error.message,
            showCancel: false,
          })
        })
        .finally(() => {
          this.dismissAiProcessing()
        })
    },
    closeAiDraft() {
      const extraData: Record<string, unknown> = {
        isAiDraftEditVisible: false,
        editingDraftId: '',
        aiDraftSourceText: '',
        aiDraftEntries: [],
        aiDraftCards: [],
      }

      if (this.data.isPickerSheetVisible) {
        extraData.isPickerSheetVisible = false
        extraData.isPickerSheetClosing = false
      }

      dismissModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
        extraData,
      })
    },
    confirmAiDrafts() {
      if (this.data.aiDraftEntries.length === 0) {
        this.closeAiDraft()
        return
      }

      const scheduleConflict = findTimedScheduleBatchConflictMessage(
        buildAiDraftScheduleInputs(this.data.aiDraftEntries),
      )

      if (scheduleConflict) {
        wx.showToast({
          title: scheduleConflict,
          icon: 'none',
        })
        return
      }

      const savedCount = saveAiPlanDrafts(this.data.aiDraftEntries)

      if (savedCount === 0) {
        return
      }

      this.closeAiDraft()
      this.refreshHomeData()
      wx.showToast({
        title: '已加入日历',
        icon: 'success',
      })
    },
    deleteAiDraft(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string
      const entries = this.data.aiDraftEntries.filter((entry) => entry.id !== id)

      if (entries.length === 0) {
        this.closeAiDraft()
        return
      }

      this.setData({
        aiDraftEntries: entries,
        aiDraftCards: mapAiDraftCards(entries),
      })
    },
    openAiDraftEdit(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string
      const entry = this.data.aiDraftEntries.find((item) => item.id === id)

      if (!entry) {
        return
      }

      this.setData({
        isAiDraftEditVisible: true,
        editingDraftId: id,
        quickTags: getPlanTagOptions(),
        editPlanForm: buildEditPlanFormFromDraft(entry.plan, getToday(), entry.ownerKey),
      })
      this.updatePlanTagScrollFades()
    },
    closeAiDraftEdit() {
      const extraData: Record<string, unknown> = {
        isAiDraftEditVisible: false,
        editingDraftId: '',
      }

      if (this.data.isPickerSheetVisible) {
        extraData.isPickerSheetVisible = false
        extraData.isPickerSheetClosing = false
      }

      this.setData(extraData)
    },
    chooseScheduleKind(e: WechatMiniprogram.BaseEvent) {
      this.setData({
        'editPlanForm.scheduleKind': e.currentTarget.dataset.kind,
      })
    },
    openDatePicker() {
      const { date } = this.data.editPlanForm
      const parts = parseDateParts(date)
      const year = clampPickerYear(parts.year)
      const dayOptions = buildDayOptions(year, parts.month)

      this.setData({
        isPickerSheetVisible: true,
        isPickerSheetClosing: false,
        pickerSheetKind: 'date',
        pickerSheetTitle: '选择日期',
        pickerDayOptions: dayOptions,
        pickerTempValue: [
          year - PICKER_MIN_YEAR,
          parts.month - 1,
          Math.min(parts.day, dayOptions.length) - 1,
        ],
      })
    },
    openStartTimePicker() {
      const { hour, minute } = parseTimeParts(this.data.editPlanForm.startTime)

      this.setData({
        isPickerSheetVisible: true,
        isPickerSheetClosing: false,
        pickerSheetKind: 'time-start',
        pickerSheetTitle: '选择开始时间',
        pickerTempValue: [hour, minute],
      })
    },
    openEndTimePicker() {
      const { hour, minute } = parseTimeParts(this.data.editPlanForm.endTime)

      this.setData({
        isPickerSheetVisible: true,
        isPickerSheetClosing: false,
        pickerSheetKind: 'time-end',
        pickerSheetTitle: '选择结束时间',
        pickerTempValue: [hour, minute],
      })
    },
    openPeriodPicker() {
      this.setData({
        isPickerSheetVisible: true,
        isPickerSheetClosing: false,
        pickerSheetKind: 'period',
        pickerSheetTitle: '选择时段',
        pickerTempValue: [this.data.editPlanForm.periodIndex],
      })
    },
    dismissPickerSheet(extraData?: Record<string, unknown>) {
      dismissModal(this, 'isPickerSheetVisible', 'isPickerSheetClosing', {
        extraData,
      })
    },
    closePickerSheet() {
      this.dismissPickerSheet()
    },
    onPickerSheetChange(e: WechatMiniprogram.PickerViewChange) {
      const nextValue = e.detail.value as number[]
      const { pickerSheetKind } = this.data

      if (pickerSheetKind === 'date') {
        const year = PICKER_YEARS[nextValue[0]] || PICKER_YEARS[0]
        const month = nextValue[1] + 1
        const dayOptions = buildDayOptions(year, month)
        const dayIndex = Math.min(nextValue[2], dayOptions.length - 1)

        this.setData({
          pickerDayOptions: dayOptions,
          pickerTempValue: [nextValue[0], nextValue[1], dayIndex],
        })
        return
      }

      this.setData({
        pickerTempValue: nextValue,
      })
    },
    confirmPickerSheet() {
      const { pickerSheetKind, pickerTempValue } = this.data

      if (pickerSheetKind === 'date') {
        const year = PICKER_YEARS[pickerTempValue[0]] || PICKER_YEARS[0]
        const month = pickerTempValue[1] + 1
        const day = pickerTempValue[2] + 1

        this.dismissPickerSheet({
          'editPlanForm.date': formatDateParts(year, month, day),
        })
        return
      }

      if (pickerSheetKind === 'time-start' || pickerSheetKind === 'time-end') {
        const timeValue = formatTimeParts(pickerTempValue[0], pickerTempValue[1])
        const field = pickerSheetKind === 'time-start' ? 'editPlanForm.startTime' : 'editPlanForm.endTime'

        this.dismissPickerSheet({
          [field]: timeValue,
        })
        return
      }

      if (pickerSheetKind === 'period') {
        const periodIndex = pickerTempValue[0]
        const periodKey = PERIOD_OPTIONS[periodIndex]?.key || 'morning'

        this.dismissPickerSheet({
          'editPlanForm.periodIndex': periodIndex,
          'editPlanForm.periodKey': periodKey,
        })
      }
    },
    chooseEditPlanOwner(e: WechatMiniprogram.BaseEvent) {
      this.setData({
        'editPlanForm.ownerKey': e.currentTarget.dataset.owner,
      })
    },
    chooseEditPlanTag(e: WechatMiniprogram.BaseEvent) {
      const tag = e.currentTarget.dataset.tag as string
      const tagId = e.currentTarget.dataset.tagId as string
      this.setData({
        'editPlanForm.tag': tag,
        'editPlanForm.tagId': tagId,
      })
    },
    updatePlanTagScrollFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.tag-scroll').boundingClientRect()
        query.select('.tag-scroll-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          ;(this as WechatMiniprogram.IAnyObject).planTagScrollViewportWidth = viewportWidth
          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showPlanTagScrollFadeLeft: fades.showLeft,
            showPlanTagScrollFadeRight: fades.showRight,
          })
        })
      })
    },
    onPlanTagScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = (this as WechatMiniprogram.IAnyObject).planTagScrollViewportWidth || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        showPlanTagScrollFadeLeft: fades.showLeft,
        showPlanTagScrollFadeRight: fades.showRight,
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

      this.setData({
        isTagCreateVisible: false,
        quickTags: getPlanTagOptions(),
        'editPlanForm.tag': name.trim(),
        'editPlanForm.tagId': result.tagId || '',
      })
      wx.showToast({
        title: '已添加主题',
        icon: 'success',
      })
      this.updatePlanTagScrollFades()
    },
    onEditPlanInput(e: WechatMiniprogram.Input) {
      const field = e.currentTarget.dataset.field
      this.setData({
        [`editPlanForm.${field}`]: e.detail.value,
      })
    },
    saveAiDraftEdit() {
      const { editingDraftId, editPlanForm } = this.data

      if (!editingDraftId) {
        return
      }

      const entries = this.data.aiDraftEntries.map((entry) => {
        if (entry.id !== editingDraftId) {
          return entry
        }

        return {
          ...entry,
          ownerKey: editPlanForm.ownerKey,
          plan: applyEditPlanFormToDraft(entry.plan, editPlanForm),
        }
      })

      this.setData({
        aiDraftEntries: entries,
        aiDraftCards: mapAiDraftCards(entries),
        isAiDraftEditVisible: false,
        editingDraftId: '',
      })

      if (this.data.isPickerSheetVisible) {
        this.dismissPickerSheet()
      }

      wx.showToast({
        title: '已更新草稿',
        icon: 'success',
      })
    },
    goFocus() {
      const url = this.data.selfFocusVisible ? '/pages/focus/focus?resume=1' : '/pages/focus/focus'
      wx.navigateTo({ url })
    },
    goFocusResume() {
      wx.navigateTo({
        url: '/pages/focus/focus?resume=1',
      })
    },
    noop() {
      // Prevent modal content taps from closing the overlay.
    },
    goCalendar() {
      wx.switchTab({
        url: '/pages/calendar/calendar',
      })
    },
    goSettings() {
      wx.navigateTo({
        url: '/pages/settings/settings',
      })
    },
    goDay() {
      wx.navigateTo({
        url: '/pages/day/day',
      })
    },
  },
})
