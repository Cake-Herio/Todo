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
  plans: CalendarPlanView[]
  more: number
}

type CalendarViewMode = 'plan' | 'completed'

const COMPLETED_TYPE_FILTER = 'timed' as const

const CALENDAR_HINT = '点日期查看详情'

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

const mapPlanToCalendarView = (plan: Plan): CalendarPlanView => ({
  id: plan.id,
  avatarUrl: getOwnerAvatarUrl(plan.ownerKey),
  tag: plan.tag,
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
    const visiblePlans = dayPlans.slice(0, 3).map(mapPlanToCalendarView)

    return {
      date: dateText,
      day: date.getDate(),
      muted: date.getMonth() !== month,
      selected: dateText === selectedDate,
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
      tag: record.tag,
      tone: record.wasOverdue ? 'gray' as const : record.ownerKey === 'partner' ? 'blue' as const : 'green' as const,
      isCompleted: true,
    }))

    return {
      date: dateText,
      day: date.getDate(),
      muted: date.getMonth() !== month,
      selected: dateText === selectedDate,
      plans: visiblePlans,
      more: Math.max(dayRecords.length - visiblePlans.length, 0),
    }
  })
}

Component({
  data: {
    viewMode: 'plan' as CalendarViewMode,
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
    filters: [
      { key: 'all', label: '全部', avatars: [{ key: 'me', url: getOwnerAvatarUrl('me') }, { key: 'partner', url: getOwnerAvatarUrl('partner') }] },
      { key: 'me', label: '我', avatars: [{ key: 'me', url: getOwnerAvatarUrl('me') }] },
      { key: 'partner', label: '对方', avatars: [{ key: 'partner', url: getOwnerAvatarUrl('partner') }] },
    ],
    activeFilter: 'all',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    days: [] as CalendarDayView[],
  },
  lifetimes: {
    attached() {
      this.refreshCalendar()
    },
  },
  pageLifetimes: {
    show() {
      const pendingMode = wx.getStorageSync('calendar_view_mode') as CalendarViewMode | ''

      if (pendingMode === 'completed') {
        wx.removeStorageSync('calendar_view_mode')
        this.setData({ viewMode: 'completed' })
      }

      this.refreshCalendar()
    },
  },
  methods: {
    refreshCalendar() {
      const {
        currentYear,
        currentMonth,
        activeFilter,
        selectedDate,
        viewMode,
      } = this.data
      const days = viewMode === 'plan'
        ? buildCalendarDays(getPlans(), activeFilter, currentYear, currentMonth, selectedDate)
        : buildCompletedCalendarDays(getCompletedRecords(), activeFilter, currentYear, currentMonth, selectedDate)

      this.setData({
        monthTitle: buildMonthTitle(currentYear, currentMonth),
        calendarHint: CALENDAR_HINT,
        days,
      })
    },
    switchViewMode(e: WechatMiniprogram.BaseEvent) {
      const mode = e.currentTarget.dataset.mode as CalendarViewMode

      if (!mode || mode === this.data.viewMode) {
        return
      }

      this.setData({ viewMode: mode })
      this.refreshCalendar()
    },
    setFilter(e: WechatMiniprogram.BaseEvent) {
      const filter = e.currentTarget.dataset.filter
      this.setData({
        activeFilter: filter,
      })
      this.refreshCalendar()
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
      this.setData({
        isMonthPickerVisible: true,
        isMonthPickerClosing: false,
        pickerYear: this.data.currentYear,
        pickerMonth: this.data.currentMonth,
        pickerValue: [this.data.currentYear - minYear, this.data.currentMonth],
      })
    },
    dismissMonthPicker() {
      if (this.data.isMonthPickerClosing || !this.data.isMonthPickerVisible) {
        return
      }

      this.setData({ isMonthPickerClosing: true })

      setTimeout(() => {
        this.setData({
          isMonthPickerVisible: false,
          isMonthPickerClosing: false,
        })
      }, 220)
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
      const date = e.currentTarget.dataset.date

      if (this.data.viewMode === 'completed') {
        this.setData({ selectedDate: date })
        this.refreshCalendar()
        return
      }

      wx.navigateTo({
        url: `/pages/day/day?date=${date}`,
      })
    },
  },
})
