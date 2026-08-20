import {
  formatDate,
  getCompletedRecords,
  getOwnerAvatarUrl,
  getPlans,
  getToday,
  type CompletedRecord,
  type OwnerKey,
  type Plan,
} from '../../utils/data'
import { bootstrapSharedSpace } from '../../utils/cloud-sync'
import { getOwnerFilterState, getOwnerFilterStateLocal } from '../../utils/owner-filters'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, MODAL_EXIT_MS, openModal } from '../../utils/modal-dismiss'
import { ScheduleTimeHelper } from '../../utils/schedule-time'

interface CalendarPlanView {
  id: string
  avatarUrl: string
  tag: string
  tone: 'green' | 'blue' | 'gray'
  isCompleted: boolean
}

interface CalendarDayView {
  date: string
  day: number
  muted: boolean
  selected: boolean
  hasItems: boolean
  plans: CalendarPlanView[]
  more: number
}

type CalendarViewMode = 'plan' | 'completed'

const COMPLETED_TYPE_FILTER = 'timed' as const

const CALENDAR_HINT = '点击日期快速选择'
const CALENDAR_VIEW_SWITCH_DURATION_MS = 280

const formatCalendarTag = (tag: string) => {
  const characters = Array.from(`${tag || ''}`.trim())
  if (characters.length <= 2) {
    return characters.join('')
  }

  return `${characters[0]}…`
}

const minYear = 1970
const maxYear = 2100
const years = Array.from({ length: maxYear - minYear + 1 }, (_value, index) => minYear + index)
const months = Array.from({ length: 12 }, (_value, index) => `${index + 1}月`)

const filterPlans = (plans: Plan[], filter: string) => {
  if (filter === 'me' || filter === 'partner') {
    return plans.filter((plan) => plan.ownerKey === filter as OwnerKey)
  }

  return plans
}

const filterCompletedRecords = (
  records: CompletedRecord[],
  ownerFilter: string,
) => {
  let filtered = records.filter((record) => record.completionMode === COMPLETED_TYPE_FILTER)

  if (ownerFilter === 'me' || ownerFilter === 'partner') {
    filtered = filtered.filter((record) => record.ownerKey === ownerFilter)
  }

  return filtered
}

const buildMonthTitle = (year: number, month: number) => `${year} 年 ${month + 1} 月`

const buildPlanTone = (plan: Plan): CalendarPlanView['tone'] => {
  if (plan.status === 'overdue') {
    return 'gray'
  }

  return plan.color
}

const compareCalendarDayPlans = (
  a: Plan,
  b: Plan,
  dateText: string,
  todayText: string,
  nowMinutes: number,
) => {
  const rank = (plan: Plan) => {
    if (plan.status === 'completed') {
      const startSort = plan.startTime ? ScheduleTimeHelper.parseToMinutes(plan.startTime) : Number.MAX_SAFE_INTEGER
      return { group: 3, sort: startSort }
    }

    if (plan.status === 'overdue') {
      return {
        group: 0,
        sort: plan.startTime ? ScheduleTimeHelper.parseToMinutes(plan.startTime) : 0,
      }
    }

    const hasTime = Boolean(plan.startTime && plan.endTime)

    if (hasTime && dateText === todayText) {
      const startMin = ScheduleTimeHelper.parseToMinutes(plan.startTime!)
      const endMin = ScheduleTimeHelper.parseToMinutes(plan.endTime!, true)

      if (nowMinutes < endMin) {
        const minutesUntil = nowMinutes < startMin ? startMin - nowMinutes : endMin - nowMinutes
        return { group: 1, sort: minutesUntil }
      }

      return { group: 0, sort: startMin }
    }

    if (hasTime) {
      return { group: 1, sort: ScheduleTimeHelper.parseToMinutes(plan.startTime!) }
    }

    if (plan.status === 'pending' || plan.status === 'in_progress') {
      return { group: 2, sort: plan.createdAt }
    }

    return { group: 2, sort: plan.createdAt }
  }

  const rankA = rank(a)
  const rankB = rank(b)

  if (rankA.group !== rankB.group) {
    return rankA.group - rankB.group
  }

  return rankA.sort - rankB.sort
}

const sortCalendarDayPlans = (plans: Plan[], dateText: string) => {
  const todayText = getToday()
  const nowMinutes = ScheduleTimeHelper.getNowMinutes()

  return [...plans].sort((a, b) => compareCalendarDayPlans(a, b, dateText, todayText, nowMinutes))
}

const mapPlanToCalendarView = (plan: Plan): CalendarPlanView => ({
  id: plan.id,
  avatarUrl: getOwnerAvatarUrl(plan.ownerKey),
  tag: formatCalendarTag(plan.tag),
  tone: buildPlanTone(plan),
  isCompleted: plan.status === 'completed',
})

const buildCalendarDays = (
  plans: Plan[],
  activeFilter: string,
  year: number,
  month: number,
  selectedDate: string,
): CalendarDayView[] => {
  const firstDate = new Date(year, month, 1)
  const startOffset = (firstDate.getDay() + 6) % 7
  const gridStart = new Date(year, month, 1 - startOffset)
  const filteredPlans = filterPlans(plans, activeFilter)

  return Array.from({ length: 42 }, (_value, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)

    const dateText = formatDate(date)
    const dayPlans = filteredPlans.filter((plan) => plan.date === dateText && plan.status !== 'cancelled')
    const visiblePlans = sortCalendarDayPlans(dayPlans, dateText).slice(0, 3).map(mapPlanToCalendarView)

    return {
      date: dateText,
      day: date.getDate(),
      muted: date.getMonth() !== month,
      selected: dateText === selectedDate,
      hasItems: dayPlans.length > 0,
      plans: visiblePlans,
      more: Math.max(dayPlans.length - visiblePlans.length, 0),
    }
  })
}

const buildCompletedCalendarDays = (
  records: CompletedRecord[],
  activeFilter: string,
  year: number,
  month: number,
  selectedDate: string,
): CalendarDayView[] => {
  const firstDate = new Date(year, month, 1)
  const startOffset = (firstDate.getDay() + 6) % 7
  const gridStart = new Date(year, month, 1 - startOffset)
  const filteredRecords = filterCompletedRecords(records, activeFilter)

  return Array.from({ length: 42 }, (_value, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)

    const dateText = formatDate(date)
    const dayRecords = filteredRecords.filter((record) => formatDate(new Date(record.completedAt)) === dateText)
    const visiblePlans = dayRecords.slice(0, 3).map((record) => ({
      id: record.id,
      avatarUrl: getOwnerAvatarUrl(record.ownerKey),
      tag: formatCalendarTag(record.tag),
      tone: record.wasOverdue ? 'gray' as const : record.ownerKey === 'partner' ? 'blue' as const : 'green' as const,
      isCompleted: true,
    }))

    return {
      date: dateText,
      day: date.getDate(),
      muted: date.getMonth() !== month,
      selected: dateText === selectedDate,
      hasItems: dayRecords.length > 0,
      plans: visiblePlans,
      more: Math.max(dayRecords.length - visiblePlans.length, 0),
    }
  })
}

Component({
  data: {
    safeTopPx: 0,
    viewMode: 'completed' as CalendarViewMode,
    swiperCurrent: 1,
    viewSwitchDuration: CALENDAR_VIEW_SWITCH_DURATION_MS,
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    selectedDate: getToday(),
    monthTitle: '',
    calendarHint: CALENDAR_HINT,
    isMonthPickerVisible: false,
    isMonthPickerClosing: false,
    pickerYear: new Date().getFullYear(),
    pickerMonth: new Date().getMonth(),
    pickerValue: [new Date().getFullYear() - minYear, new Date().getMonth()],
    years,
    months,
    filters: getOwnerFilterStateLocal('me').filters,
    activeFilter: getOwnerFilterStateLocal('me').activeFilter,
    singleUserMode: getOwnerFilterStateLocal('me').singleUserMode,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    planDays: [] as CalendarDayView[],
    completedDays: [] as CalendarDayView[],
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)

      this.setData({ safeTopPx: statusBarHeight + gapPx })
      this.renderCalendarGrid()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)

      const pendingMode = wx.getStorageSync('calendar_view_mode') as CalendarViewMode | ''
      if (pendingMode === 'completed') {
        wx.removeStorageSync('calendar_view_mode')
        this.applyViewMode('completed')
      }

      const renderCalendar = () => {
        const state = getOwnerFilterStateLocal(this.data.activeFilter)
        this.setData({
          filters: state.filters,
          activeFilter: state.activeFilter,
          singleUserMode: state.singleUserMode,
        })
        this.renderCalendarGrid()
      }

      // 先显示本地内容，云端同步和成员头像解析在后台完成后无条件刷新一次。
      renderCalendar()
      void bootstrapSharedSpace()
        .then(renderCalendar)
        .catch((error) => {
          console.warn('[calendar] background sync failed', error)
        })
    },
  },
  methods: {
    async refreshOwnerFilters() {
      const prevFilter = this.data.activeFilter
      const state = await getOwnerFilterState(prevFilter)
      this.setData({
        filters: state.filters,
        activeFilter: state.activeFilter,
        singleUserMode: state.singleUserMode,
      })

      return state.activeFilter !== prevFilter
    },
    renderCalendarGrid() {
      const { currentYear, currentMonth, activeFilter, selectedDate } = this.data

      const planDays = buildCalendarDays(getPlans(), activeFilter, currentYear, currentMonth, selectedDate)
      const completedDays = buildCompletedCalendarDays(
        getCompletedRecords(),
        activeFilter,
        currentYear,
        currentMonth,
        selectedDate,
      )

      this.setData({
        monthTitle: buildMonthTitle(currentYear, currentMonth),
        calendarHint: CALENDAR_HINT,
        planDays,
        completedDays,
      })
    },
    async refreshCalendar() {
      const filterChanged = await this.refreshOwnerFilters()
      this.renderCalendarGrid()

      if (filterChanged) {
        this.renderCalendarGrid()
      }
    },
    applyViewMode(mode: CalendarViewMode) {
      if (!mode || mode === this.data.viewMode) {
        return
      }

      this.setData({
        viewMode: mode,
        swiperCurrent: mode === 'plan' ? 0 : 1,
      })
    },
    switchViewMode(e: WechatMiniprogram.BaseEvent) {
      const mode = e.currentTarget.dataset.mode as CalendarViewMode
      this.applyViewMode(mode)
    },
    onCalendarSwiperChange(e: WechatMiniprogram.SwiperChange) {
      const index = e.detail.current
      const mode: CalendarViewMode = index === 0 ? 'plan' : 'completed'

      if (mode === this.data.viewMode) {
        return
      }

      this.setData({ viewMode: mode })
    },
    setFilter(e: WechatMiniprogram.CustomEvent<{ filter?: string }> | WechatMiniprogram.BaseEvent) {
      const filter =
        (e as WechatMiniprogram.CustomEvent<{ filter?: string }>).detail?.filter ||
        (e.currentTarget?.dataset?.filter as string | undefined)

      if (!filter || filter === this.data.activeFilter || (this as WechatMiniprogram.IAnyObject).filterSwitching) {
        return
      }

      void this.switchOwnerFilter(filter)
    },
    async switchOwnerFilter(filter: string) {
      ;(this as WechatMiniprogram.IAnyObject).filterSwitching = true
      wx.showLoading({
        title: '切换中',
        mask: true,
      })

      try {
        this.setData({ activeFilter: filter })
        await bootstrapSharedSpace()

        const state = getOwnerFilterStateLocal(filter)
        this.setData({
          filters: state.filters,
          activeFilter: state.activeFilter,
          singleUserMode: state.singleUserMode,
        })
        this.renderCalendarGrid()
      } catch (error) {
        console.warn('[calendar] switch owner filter failed', error)
        wx.showToast({
          title: '加载失败，请重试',
          icon: 'none',
        })
      } finally {
        wx.hideLoading()
        ;(this as WechatMiniprogram.IAnyObject).filterSwitching = false
      }
    },
    changeMonth(e: WechatMiniprogram.BaseEvent) {
      const offset = Number(e.currentTarget.dataset.offset)
      const nextMonth = new Date(this.data.currentYear, this.data.currentMonth + offset, 1)

      this.setData({
        currentYear: nextMonth.getFullYear(),
        currentMonth: nextMonth.getMonth(),
      })
      this.refreshCalendar()
    },
    openMonthPicker() {
      openModal(this, 'isMonthPickerVisible', 'isMonthPickerClosing', {
        pickerYear: this.data.currentYear,
        pickerMonth: this.data.currentMonth,
        pickerValue: [this.data.currentYear - minYear, this.data.currentMonth],
      })
    },
    dismissMonthPicker() {
      dismissModal(this, 'isMonthPickerVisible', 'isMonthPickerClosing', {
        durationMs: MODAL_EXIT_MS,
      })
    },
    closeMonthPicker() {
      this.dismissMonthPicker()
    },
    onPickerChange(e: WechatMiniprogram.PickerViewChange) {
      const [yearIndex, monthIndex] = e.detail.value
      this.setData({
        pickerValue: e.detail.value,
        pickerYear: years[yearIndex],
        pickerMonth: monthIndex,
      })
    },
    confirmMonthPicker() {
      this.setData({
        currentYear: this.data.pickerYear,
        currentMonth: this.data.pickerMonth,
      })
      this.refreshCalendar()
      this.dismissMonthPicker()
    },
    noop() {
      // Prevent picker panel taps from closing the overlay.
    },
    goDay(e: WechatMiniprogram.BaseEvent) {
      const date = e.currentTarget.dataset.date as string
      const viewMode = this.data.viewMode
      // 日历格子可能在删除记录后仍保留旧的 setData 快照，点击时以最新本地数据重新计算。
      const days = viewMode === 'plan'
        ? buildCalendarDays(getPlans(), this.data.activeFilter, this.data.currentYear, this.data.currentMonth, this.data.selectedDate)
        : buildCompletedCalendarDays(
            getCompletedRecords(),
            this.data.activeFilter,
            this.data.currentYear,
            this.data.currentMonth,
            this.data.selectedDate,
          )

      this.setData(viewMode === 'plan' ? { planDays: days } : { completedDays: days })
      const day = days.find((item) => item.date === date)

      if (!day?.hasItems) {
        wx.showToast({
          title: viewMode === 'plan' ? '当天暂无计划' : '当天暂无完成记录',
          icon: 'none',
        })
        return
      }

      if (viewMode === 'completed') {
        wx.navigateTo({
          url: `/pages/completed-day/completed-day?date=${date}&filter=${this.data.activeFilter}`,
        })
        return
      }

      wx.navigateTo({
        url: `/pages/day/day?date=${date}`,
      })
    },
  },
})
