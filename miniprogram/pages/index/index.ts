import { getFallbackAvatarUrl, resolvePartnerAvatarForDisplay, toDisplayAvatarUrl } from '../../utils/avatar-display'
import { addPlan, deletePlansByIds, findTimedScheduleBatchConflictMessage, formatDate, getOwnerAvatarUrl, getPlans, getPlansByDate, getToday, updatePlan, type OwnerKey, type Plan } from '../../utils/data'
import { refreshWithLocalFirst, bootstrapSharedSpace } from '../../utils/cloud-sync'
import { getDisplayAvatarUrl, getDisplayNickname, getPartnerDisplayAvatarUrl, getPartnerDisplayNickname, getSession, isProfileComplete, isSharedSpaceMode, saveUserProfile, tryRestoreSessionFromCloud } from '../../utils/session'
import { getOwnerFilterStateLocal } from '../../utils/owner-filters'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { fetchOwnFocusPresence, fetchPartnerFocusPresence } from '../../utils/focus-presence'
import {
  parseVoicePlanCommandWithDeepSeek,
  refineVoiceCommandWithDeepSeek,
  type AiPlanDraft,
  type AiDraftRefineSnapshot,
  type AiConfirmRefineSnapshot,
} from '../../utils/deepseek'
import {
  buildAiPlanContext,
  hasBatchOperations,
  inferDateScopeFromText,
  mapAddConfirmCards,
  mapDeleteConfirmCards,
  mapUpdateConfirmCards,
  mergeBatchConfirmState,
  resolveBatchConfirmState,
  type AiConfirmCardView,
  type AiUpdatePayload,
  type ResolvedBatchDraft,
} from '../../utils/plan-ai-actions'
import { addPlanTagOption, DEFAULT_PLAN_TAGS, getPlanTagNames, getPlanTagOptions, resolvePlanTag } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'
import { ScheduleTimeHelper } from '../../utils/schedule-time'
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
  sourceLabel?: string
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

/** 主页专注状态轮询间隔（自己 + 对方） */
const FOCUS_PRESENCE_POLL_MS = 60 * 1000

const buildUpcomingPreview = (plan: Plan, nowMinutes: number): UpcomingPreviewPlan | null => {
  if (!plan.startTime || !plan.endTime) {
    return null
  }

  const startMin = ScheduleTimeHelper.parseToMinutes(plan.startTime)
  const endMin = ScheduleTimeHelper.parseToMinutes(plan.endTime, true)

  if (nowMinutes < startMin) {
    const minutesUntil = startMin - nowMinutes

    if (minutesUntil > ScheduleTimeHelper.UPCOMING_WINDOW_MINUTES) {
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
      statusClass: ScheduleTimeHelper.resolveStatusClass(minutesUntil <= 15 ? '即将开始' : '待开始'),
      hint: ScheduleTimeHelper.formatMinutesHint(minutesUntil, 'start'),
      minutesUntil,
    }
  }

  if (nowMinutes < endMin) {
    const minutesUntil = endMin - nowMinutes

    if (minutesUntil > ScheduleTimeHelper.UPCOMING_WINDOW_MINUTES) {
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
      statusClass: ScheduleTimeHelper.resolveStatusClass(minutesUntil <= 15 ? '即将结束' : '进行中'),
      hint: ScheduleTimeHelper.formatMinutesHint(minutesUntil, 'end'),
      minutesUntil,
    }
  }

  return null
}

const pickUpcomingPlans = (plans: Plan[]) => {
  const nowMinutes = ScheduleTimeHelper.getNowMinutes()

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

const batchDraftsToEntries = (drafts: ResolvedBatchDraft[]) =>
  drafts.map((draft, index) => ({
    id: `draft-${Date.now()}-${index}`,
    ownerKey: draft.ownerKey,
    plan: draft.plan,
    sourceLabel: draft.sourceLabel,
  }))

const entriesToBatchDrafts = (entries: AiDraftEntry[]): ResolvedBatchDraft[] =>
  entries.map((entry) => ({
    ownerKey: entry.ownerKey,
    plan: entry.plan,
    sourceLabel: entry.sourceLabel,
  }))

const buildConfirmRefineSnapshot = (
  entries: AiDraftEntry[],
  deletePlanIds: string[],
  updatePayloads: AiUpdatePayload[],
): AiConfirmRefineSnapshot => ({
  creates: buildDraftSnapshotForRefine(entries),
  deletePlanIds,
  updates: updatePayloads.map((payload) => ({
    planId: payload.planId,
    patch: {
      defaultTag: payload.tag,
      remark: payload.remark,
      date: payload.date,
      startTime: payload.startTime,
      endTime: payload.endTime,
      timeText: payload.timeText,
    },
  })),
})

const applyResolvedBatch = (
  entries: AiDraftEntry[],
  deletePlanIds: string[],
  updatePayloads: AiUpdatePayload[],
) => ({
  aiDraftEntries: entries,
  aiDeletePlanIds: deletePlanIds,
  aiUpdatePayloads: updatePayloads,
  ...syncAllConfirmCards(entries, deletePlanIds, updatePayloads),
})

const syncDeleteConfirmCards = (planIds: string[]): AiConfirmCardView[] =>
  mapDeleteConfirmCards(planIds, getPlans())

const syncUpdateConfirmCards = (payloads: AiUpdatePayload[]): AiConfirmCardView[] =>
  mapUpdateConfirmCards(payloads, getPlans())

const syncAllConfirmCards = (
  entries: AiDraftEntry[],
  deletePlanIds: string[],
  updatePayloads: AiUpdatePayload[],
) => {
  const addCards = entries.flatMap((entry) =>
    mapAddConfirmCards(
      [{
        id: entry.id,
        plan: entry.plan,
        sourceLabel: entry.sourceLabel,
      }],
      entry.sourceLabel ? 'reuse' : 'create',
    ),
  )

  return {
    aiConfirmCards: [
      ...addCards,
      ...syncDeleteConfirmCards(deletePlanIds),
      ...syncUpdateConfirmCards(updatePayloads),
    ],
    aiConfirmHasDelete: deletePlanIds.length > 0,
  }
}

const resetAiConfirmState = () => ({
  aiConfirmWarnings: [] as string[],
  aiConfirmCards: [] as AiConfirmCardView[],
  aiDeletePlanIds: [] as string[],
  aiDeleteSummary: '',
  aiUpdatePayloads: [] as AiUpdatePayload[],
  aiConfirmHasDelete: false,
  aiDraftSourceText: '',
  aiDraftEntries: [] as AiDraftEntry[],
})

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
    aiConfirmCards: [] as AiConfirmCardView[],
    aiConfirmWarnings: [] as string[],
    aiDeletePlanIds: [] as string[],
    aiDeleteSummary: '',
    aiUpdatePayloads: [] as AiUpdatePayload[],
    aiConfirmHasDelete: false,
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

        this.handleVoicePlanCommand(resultText)
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
    openConfirmFromBatch(
      sourceText: string,
      warnings: string[],
      resolved: ReturnType<typeof resolveBatchConfirmState>,
      options?: { merge?: boolean },
    ) {
      const incomingEntries = batchDraftsToEntries(resolved.drafts)

      if (options?.merge && this.data.isAiDraftVisible) {
        const merged = mergeBatchConfirmState(
          {
            drafts: entriesToBatchDrafts(this.data.aiDraftEntries),
            deletePlanIds: this.data.aiDeletePlanIds,
            updatePayloads: this.data.aiUpdatePayloads,
          },
          resolved,
        )
        const entries = [...this.data.aiDraftEntries, ...incomingEntries]

        openModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
          isAiDraftEditVisible: false,
          editingDraftId: '',
          aiDraftSourceText: sourceText,
          ...applyResolvedBatch(entries, merged.deletePlanIds, merged.updatePayloads),
          aiConfirmWarnings: [...this.data.aiConfirmWarnings, ...warnings],
        })
        return
      }

      openModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
        ...resetAiConfirmState(),
        isAiDraftEditVisible: false,
        editingDraftId: '',
        aiDraftSourceText: sourceText,
        ...applyResolvedBatch(incomingEntries, resolved.deletePlanIds, resolved.updatePayloads),
        aiConfirmWarnings: warnings,
      })
    },
    handleVoicePlanCommand(sourceText: string, options?: { merge?: boolean }) {
      this.setData({
        isAiProcessing: true,
        isAiProcessingClosing: false,
        aiProcessingText: sourceText,
        aiProcessingTitle: 'AI 整理中',
      })

      const today = getToday()
      const dateScope = inferDateScopeFromText(sourceText, today)
      const { items: contextItems, truncated } = buildAiPlanContext(dateScope, {
        ownerFilter: 'me',
        includeCompleted: true,
      })
      const contextIds = new Set(contextItems.map((item) => item.id))
      const warnings: string[] = []

      if (truncated) {
        warnings.push('相关计划较多，请尽量说明具体日期')
      }

      parseVoicePlanCommandWithDeepSeek(sourceText, today, getPlanTagNames(), contextItems)
        .then((batch) => {
          const mergedWarnings = [...warnings, ...(batch.warnings || [])]
          const resolved = resolveBatchConfirmState(batch, contextIds)

          if (!hasBatchOperations(resolved)) {
            wx.showToast({
              title: mergedWarnings[0] || '没有识别到变更',
              icon: 'none',
            })
            return
          }

          this.openConfirmFromBatch(batch.sourceText, mergedWarnings, resolved, {
            merge: options?.merge ?? this.data.isAiDraftVisible,
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
    refreshConfirmCards() {
      this.setData(
        syncAllConfirmCards(
          this.data.aiDraftEntries,
          this.data.aiDeletePlanIds,
          this.data.aiUpdatePayloads,
        ),
      )
    },
    refineAiPlanDrafts(supplementText: string) {
      const { aiDraftSourceText, aiDraftEntries, aiDeletePlanIds, aiUpdatePayloads } = this.data

      if (!aiDraftSourceText) {
        this.setData({ voiceMode: 'create' })
        return
      }

      const today = getToday()
      const combinedSource = `${aiDraftSourceText}。${supplementText}`
      const dateScope = inferDateScopeFromText(combinedSource, today)
      const { items: contextItems, truncated } = buildAiPlanContext(dateScope, {
        ownerFilter: 'me',
        includeCompleted: true,
      })
      const contextIds = new Set(contextItems.map((item) => item.id))
      const pendingSnapshot = buildConfirmRefineSnapshot(aiDraftEntries, aiDeletePlanIds, aiUpdatePayloads)

      this.setData({
        isAiProcessing: true,
        isAiProcessingClosing: false,
        aiProcessingText: supplementText,
        aiProcessingTitle: 'AI 调整中',
      })

      refineVoiceCommandWithDeepSeek(
        aiDraftSourceText,
        pendingSnapshot,
        supplementText,
        today,
        getPlanTagNames(),
        contextItems,
      )
        .then((batch) => {
          const warnings = [...(truncated ? ['相关计划较多，请尽量说明具体日期'] : []), ...(batch.warnings || [])]
          const resolved = resolveBatchConfirmState(batch, contextIds)

          if (!hasBatchOperations(resolved)) {
            this.setData({ voiceMode: 'create' })
            wx.showToast({
              title: warnings[0] || '没有识别到调整',
              icon: 'none',
            })
            return
          }

          const entries = batchDraftsToEntries(resolved.drafts)

          openModal(this, 'isAiDraftVisible', 'isAiDraftClosing', {
            isAiDraftEditVisible: false,
            editingDraftId: '',
            aiDraftSourceText: batch.sourceText,
            ...applyResolvedBatch(entries, resolved.deletePlanIds, resolved.updatePayloads),
            aiConfirmWarnings: warnings,
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
        ...resetAiConfirmState(),
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
      const { aiDraftEntries, aiDeletePlanIds, aiUpdatePayloads } = this.data
      const hasAdd = aiDraftEntries.length > 0
      const hasDelete = aiDeletePlanIds.length > 0
      const hasUpdate = aiUpdatePayloads.length > 0

      if (!hasAdd && !hasDelete && !hasUpdate) {
        this.closeAiDraft()
        return
      }

      if (hasAdd) {
        const scheduleConflict = findTimedScheduleBatchConflictMessage(
          buildAiDraftScheduleInputs(aiDraftEntries),
        )

        if (scheduleConflict) {
          wx.showToast({
            title: scheduleConflict,
            icon: 'none',
          })
          return
        }
      }

      if (hasDelete) {
        const removedCount = deletePlansByIds(aiDeletePlanIds)

        if (removedCount === 0) {
          wx.showToast({
            title: '删除失败',
            icon: 'none',
          })
          return
        }
      }

      if (hasUpdate) {
        for (const payload of aiUpdatePayloads) {
          const result = updatePlan(payload.planId, {
            ownerKey: payload.ownerKey,
            title: payload.title,
            tag: payload.tag,
            tagId: payload.tagId,
            remark: payload.remark || undefined,
            date: payload.date,
            startTime: payload.startTime || undefined,
            endTime: payload.endTime || undefined,
            timeText: payload.timeText || undefined,
            estimatedMinutes: payload.estimatedMinutes,
          })

          if (!result.ok) {
            wx.showToast({
              title: result.message,
              icon: 'none',
            })
            return
          }
        }
      }

      if (hasAdd) {
        const savedCount = saveAiPlanDrafts(aiDraftEntries)

        if (savedCount === 0) {
          return
        }
      }

      this.closeAiDraft()
      this.refreshHomeData()
      wx.showToast({
        title: '已完成调整',
        icon: 'success',
      })
    },
    revokeAiConfirmItem(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string
      const kind = e.currentTarget.dataset.kind as AiConfirmCardView['kind']

      if (kind === 'update') {
        const payloads = this.data.aiUpdatePayloads.filter((item) => item.planId !== id)

        if (payloads.length === 0 && this.data.aiDraftEntries.length === 0 && this.data.aiDeletePlanIds.length === 0) {
          this.closeAiDraft()
          return
        }

        this.setData({ aiUpdatePayloads: payloads }, () => {
          this.refreshConfirmCards()
        })
        return
      }

      if (kind === 'delete') {
        const planIds = this.data.aiDeletePlanIds.filter((planId) => planId !== id)

        if (planIds.length === 0 && this.data.aiDraftEntries.length === 0 && this.data.aiUpdatePayloads.length === 0) {
          this.closeAiDraft()
          return
        }

        this.setData({ aiDeletePlanIds: planIds }, () => {
          this.refreshConfirmCards()
        })
        return
      }

      const entries = this.data.aiDraftEntries.filter((entry) => entry.id !== id)

      if (entries.length === 0 && this.data.aiDeletePlanIds.length === 0 && this.data.aiUpdatePayloads.length === 0) {
        this.closeAiDraft()
        return
      }

      this.setData({ aiDraftEntries: entries }, () => {
        this.refreshConfirmCards()
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
        ...syncAllConfirmCards(entries, this.data.aiDeletePlanIds, this.data.aiUpdatePayloads),
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
