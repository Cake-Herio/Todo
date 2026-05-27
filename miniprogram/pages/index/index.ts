import { addPlan, formatDate, getOwnerAvatarUrl, getPlansByDate, getToday, type OwnerKey, type Plan } from '../../utils/data'
import { parsePlanTextWithDeepSeek, refinePlanDraftsWithDeepSeek, type AiPlanDraft, type AiDraftRefineSnapshot } from '../../utils/deepseek'
import { addPlanTagOption, DEFAULT_PLAN_TAGS, getPlanTagNames, getPlanTagOptions, resolvePlanTag } from '../../utils/plan-tags'
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
    nickname: '林间伙伴',
    heroTreeSrc: '/images/home/hero-tree.png',
    nextPlans: [] as UpcomingPreviewPlan[],
    partner: {
      name: '对方',
      status: '专注',
      focus: '运动',
      duration: '30 分钟',
      avatarUrl: getOwnerAvatarUrl('partner'),
    },
    isRecording: false,
    isVoiceCancelling: false,
    voiceMode: 'create' as 'create' | 'refine',
    isAiProcessing: false,
    aiProcessingText: '',
    aiProcessingTitle: '',
    skipNextVoiceResult: false,
    voiceStartY: 0,
    isAiDraftVisible: false,
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
  },
  lifetimes: {
    attached() {
      this.refreshHomeData()
      this.setupSpeechRecognition()
    },
  },
  pageLifetimes: {
    show() {
      this.refreshHomeData()
    },
  },
  methods: {
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
        this.setData({
          isRecording: false,
          isVoiceCancelling: false,
          voiceMode: 'create',
        })
      }
    },
    refreshHomeData() {
      const today = getToday()
      const todayPlans = getPlansByDate(today)
      const activePlans = todayPlans.filter((plan) => plan.status !== 'completed')

      this.setData({
        today: formatTodayTitle(),
        nextPlans: pickUpcomingPlans(activePlans),
      })
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
        isRecording: true,
        isVoiceCancelling: false,
        skipNextVoiceResult: false,
        voiceStartY: touch ? touch.clientY : 0,
      })
    },
    onVoiceEnd() {
      if (!this.data.isRecording) {
        return
      }

      if (this.data.isVoiceCancelling) {
        this.setData({
          isRecording: false,
          isVoiceCancelling: false,
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

      this.setData({
        isRecording: false,
        isVoiceCancelling: false,
        skipNextVoiceResult: false,
      })
      speechManager.stop()
    },
    onVoiceCancel() {
      this.setData({
        isRecording: false,
        isVoiceCancelling: false,
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
    createAiPlanDraft(sourceText: string) {
      this.setData({
        isAiProcessing: true,
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

          this.setData({
            isAiDraftVisible: true,
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
          this.setData({
            isAiProcessing: false,
            aiProcessingText: '',
            aiProcessingTitle: '',
          })
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

          this.setData({
            isAiDraftVisible: true,
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
          this.setData({
            isAiProcessing: false,
            aiProcessingText: '',
            aiProcessingTitle: '',
          })
        })
    },
    closeAiDraft() {
      this.setData({
        isAiDraftVisible: false,
        isAiDraftEditVisible: false,
        isPickerSheetVisible: false,
        editingDraftId: '',
        aiDraftSourceText: '',
        aiDraftEntries: [],
        aiDraftCards: [],
      })
    },
    confirmAiDrafts() {
      if (this.data.aiDraftEntries.length === 0) {
        this.closeAiDraft()
        return
      }

      saveAiPlanDrafts(this.data.aiDraftEntries)
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
    },
    closeAiDraftEdit() {
      this.setData({
        isAiDraftEditVisible: false,
        isPickerSheetVisible: false,
        editingDraftId: '',
      })
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
        pickerSheetKind: 'time-start',
        pickerSheetTitle: '选择开始时间',
        pickerTempValue: [hour, minute],
      })
    },
    openEndTimePicker() {
      const { hour, minute } = parseTimeParts(this.data.editPlanForm.endTime)

      this.setData({
        isPickerSheetVisible: true,
        pickerSheetKind: 'time-end',
        pickerSheetTitle: '选择结束时间',
        pickerTempValue: [hour, minute],
      })
    },
    openPeriodPicker() {
      this.setData({
        isPickerSheetVisible: true,
        pickerSheetKind: 'period',
        pickerSheetTitle: '选择时段',
        pickerTempValue: [this.data.editPlanForm.periodIndex],
      })
    },
    closePickerSheet() {
      this.setData({
        isPickerSheetVisible: false,
      })
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

        this.setData({
          'editPlanForm.date': formatDateParts(year, month, day),
          isPickerSheetVisible: false,
        })
        return
      }

      if (pickerSheetKind === 'time-start' || pickerSheetKind === 'time-end') {
        const timeValue = formatTimeParts(pickerTempValue[0], pickerTempValue[1])
        const field = pickerSheetKind === 'time-start' ? 'editPlanForm.startTime' : 'editPlanForm.endTime'

        this.setData({
          [field]: timeValue,
          isPickerSheetVisible: false,
        })
        return
      }

      if (pickerSheetKind === 'period') {
        const periodIndex = pickerTempValue[0]
        const periodKey = PERIOD_OPTIONS[periodIndex]?.key || 'morning'

        this.setData({
          'editPlanForm.periodIndex': periodIndex,
          'editPlanForm.periodKey': periodKey,
          isPickerSheetVisible: false,
        })
      }
    },
    chooseEditPlanOwner(e: WechatMiniprogram.BaseEvent) {
      this.setData({
        'editPlanForm.ownerKey': e.currentTarget.dataset.owner,
      })
    },
    chooseEditPlanTag(e: WechatMiniprogram.BaseEvent) {
      this.setData({
        'editPlanForm.tag': e.currentTarget.dataset.tag,
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

      this.setData({
        isTagCreateVisible: false,
        quickTags: getPlanTagOptions(),
        'editPlanForm.tag': name.trim(),
      })
      wx.showToast({
        title: '已添加主题',
        icon: 'success',
      })
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
        isPickerSheetVisible: false,
        editingDraftId: '',
      })

      wx.showToast({
        title: '已更新草稿',
        icon: 'success',
      })
    },
    goFocus() {
      wx.navigateTo({
        url: '/pages/focus/focus',
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
