import { getCompletedRecords, getPlans, type CompletedRecord, type Plan } from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'

type StatsRange = 'day' | 'week' | 'month' | 'year'

interface StatsRangeOption {
  key: StatsRange
  label: string
}

interface StatsCard {
  label: string
  value: string
}

interface TagStatView {
  tag: string
  time: string
  percent: number
  color: string
}

interface TagPieLegendView {
  tag: string
  time: string
  share: string
  color: string
}

const RANGE_OPTIONS: StatsRangeOption[] = [
  { key: 'day', label: '每日' },
  { key: 'week', label: '每周' },
  { key: 'month', label: '每月' },
  { key: 'year', label: '每年' },
]

const TAG_COLORS = ['#98C6A8', '#7DA7D9', '#F1B86A', '#D98BB0', '#9B8DD9', '#8BC4D9', '#E09A7A', '#7BC8B8']

const formatFocusMinutes = (minutes: number) => {
  if (minutes <= 0) {
    return '0m'
  }

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

const getRangeBounds = (range: StatsRange, reference = new Date()) => {
  const start = new Date(reference)
  const end = new Date(reference)

  if (range === 'day') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else if (range === 'week') {
    const weekday = start.getDay()
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday
    start.setDate(start.getDate() + mondayOffset)
    start.setHours(0, 0, 0, 0)
    end.setTime(start.getTime())
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
  } else if (range === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(start.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
  } else {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(11, 31)
    end.setHours(23, 59, 59, 999)
  }

  return {
    start: start.getTime(),
    end: end.getTime(),
  }
}

const isSamePeriod = (range: StatsRange, anchorA: number, anchorB: number) => {
  const boundsA = getRangeBounds(range, new Date(anchorA))
  const boundsB = getRangeBounds(range, new Date(anchorB))
  return boundsA.start === boundsB.start && boundsA.end === boundsB.end
}

const shiftPeriodAnchor = (anchor: number, range: StatsRange, offset: number) => {
  const date = new Date(anchor)

  if (range === 'day') {
    date.setDate(date.getDate() + offset)
  } else if (range === 'week') {
    date.setDate(date.getDate() + offset * 7)
  } else if (range === 'month') {
    date.setMonth(date.getMonth() + offset)
  } else {
    date.setFullYear(date.getFullYear() + offset)
  }

  return date.getTime()
}

const formatPeriodTitle = (range: StatsRange, anchor: number) => {
  const { start, end } = getRangeBounds(range, new Date(anchor))
  const startDate = new Date(start)
  const endDate = new Date(end)
  const currentYear = new Date().getFullYear()
  const startYear = startDate.getFullYear()
  const startMonth = startDate.getMonth() + 1
  const startDay = startDate.getDate()
  const endYear = endDate.getFullYear()
  const endMonth = endDate.getMonth() + 1
  const endDay = endDate.getDate()

  if (range === 'day') {
    if (startYear === currentYear) {
      return `${startMonth}月${startDay}日`
    }
    return `${startYear}年${startMonth}月${startDay}日`
  }

  if (range === 'week') {
    if (startYear === endYear) {
      if (startYear === currentYear && startDate.getMonth() === endDate.getMonth()) {
        return `${startMonth}月${startDay}日–${endDay}日`
      }
      return `${startYear}年${startMonth}月${startDay}日–${endMonth}月${endDay}日`
    }
    return `${startYear}年${startMonth}月${startDay}日–${endYear}年${endMonth}月${endDay}日`
  }

  if (range === 'month') {
    return `${startYear}年${startMonth}月`
  }

  return `${startYear}年`
}

const formatPeriodHint = (range: StatsRange, anchor: number) => {
  if (isSamePeriod(range, anchor, Date.now())) {
    return '当前周期'
  }

  return '点击标题可回到当前周期'
}

const filterRecordsByRange = (records: CompletedRecord[], range: StatsRange, anchor: number) => {
  const { start, end } = getRangeBounds(range, new Date(anchor))
  return records.filter((record) => record.completedAt >= start && record.completedAt <= end)
}

const filterPlansByRange = (plans: Plan[], range: StatsRange, anchor: number) => {
  const { start, end } = getRangeBounds(range, new Date(anchor))

  return plans.filter((plan) => {
    if (!plan.date || plan.status === 'cancelled') {
      return false
    }

    const planTime = new Date(`${plan.date}T12:00:00`).getTime()
    return planTime >= start && planTime <= end
  })
}

const getTagColor = (tag: string, tagOrder: string[]) => {
  const index = tagOrder.indexOf(tag)
  return TAG_COLORS[(index >= 0 ? index : 0) % TAG_COLORS.length]
}

const buildPieStyle = (items: Array<{ color: string; share: number }>) => {
  if (!items.length) {
    return 'background: #e8f0e8;'
  }

  let current = 0
  const stops = items.map((item) => {
    const start = current
    current += item.share
    return `${item.color} ${start}% ${current}%`
  })

  return `background: conic-gradient(${stops.join(', ')});`
}

const buildStatsView = (range: StatsRange, periodAnchor: number) => {
  const records = filterRecordsByRange(getCompletedRecords(), range, periodAnchor)
  const timedCount = records.filter((record) => record.completionMode === 'timed').length
  const plansInRange = filterPlansByRange(getPlans(), range, periodAnchor)
  const completedPlanCount = plansInRange.filter((plan) => plan.status === 'completed').length
  const totalPlanCount = plansInRange.length
  const totalMinutes = records.reduce((total, record) => total + (record.actualMinutes || 0), 0)

  const tagMinutesMap = records.reduce<Record<string, number>>((result, record) => {
    const minutes = record.actualMinutes || 0
    if (minutes <= 0) {
      return result
    }

    result[record.tag] = (result[record.tag] || 0) + minutes
    return result
  }, {})

  const tagEntries = Object.entries(tagMinutesMap)
    .map(([tag, minutes]) => ({ tag, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  const tagOrder = tagEntries.map((item) => item.tag)
  const maxMinutes = Math.max(...tagEntries.map((item) => item.minutes), 1)

  const tagStats: TagStatView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    percent: Math.round((item.minutes / maxMinutes) * 100),
    color: getTagColor(item.tag, tagOrder),
  }))

  const tagPieLegend: TagPieLegendView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    share: totalMinutes > 0 ? `${Math.round((item.minutes / totalMinutes) * 100)}%` : '0%',
    color: getTagColor(item.tag, tagOrder),
  }))

  const cards: StatsCard[] = [
    { label: '总专注', value: formatFocusMinutes(totalMinutes) },
    { label: '计划 完成数/总数', value: `${completedPlanCount}/${totalPlanCount}` },
    { label: '计时完成数', value: `${timedCount}` },
  ]

  const rangeOption = RANGE_OPTIONS.find((item) => item.key === range)
  const isCurrentPeriod = isSamePeriod(range, periodAnchor, Date.now())

  return {
    rangeLabel: rangeOption?.label || '每周',
    rangeIndex: Math.max(0, RANGE_OPTIONS.findIndex((item) => item.key === range)),
    periodTitle: formatPeriodTitle(range, periodAnchor),
    periodHint: formatPeriodHint(range, periodAnchor),
    isCurrentPeriod,
    canGoNextPeriod: !isCurrentPeriod,
    cards,
    totalFocus: formatFocusMinutes(totalMinutes),
    tagStats,
    tagPieStyle: buildPieStyle(
      tagPieLegend.map((item) => ({
        color: item.color,
        share: totalMinutes > 0 ? Number.parseFloat(item.share) : 0,
      })),
    ),
    tagPieLegend,
    hasTagStats: tagStats.length > 0,
  }
}

Component({
  data: {
    safeTopPx: 0,
    rangeOptions: RANGE_OPTIONS,
    statsRange: 'week' as StatsRange,
    periodAnchor: Date.now(),
    rangeLabel: '每周',
    rangeIndex: 1,
    periodTitle: '',
    periodHint: '当前周期',
    isCurrentPeriod: true,
    canGoNextPeriod: false,
    cards: [] as StatsCard[],
    totalFocus: '0m',
    tagStats: [] as TagStatView[],
    tagPieStyle: 'background: #e8f0e8;',
    tagPieLegend: [] as TagPieLegendView[],
    hasTagStats: false,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)
      this.setData({ safeTopPx: statusBarHeight + gapPx })
      this.refreshStats()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => this.refreshStats())
    },
  },
  methods: {
    refreshStats() {
      this.setData(buildStatsView(this.data.statsRange, this.data.periodAnchor))
    },
    switchStatsRange(e: WechatMiniprogram.BaseEvent) {
      const range = e.currentTarget.dataset.range as StatsRange | undefined
      if (!range || range === this.data.statsRange) {
        return
      }

      const periodAnchor = Date.now()

      this.setData({
        statsRange: range,
        periodAnchor,
        ...buildStatsView(range, periodAnchor),
      })
    },
    changePeriod(e: WechatMiniprogram.BaseEvent) {
      const offset = Number(e.currentTarget.dataset.offset)
      if (!offset) {
        return
      }

      if (offset > 0 && !this.data.canGoNextPeriod) {
        return
      }

      const periodAnchor = shiftPeriodAnchor(this.data.periodAnchor, this.data.statsRange, offset)

      this.setData({
        periodAnchor,
        ...buildStatsView(this.data.statsRange, periodAnchor),
      })
    },
    goToCurrentPeriod() {
      if (this.data.isCurrentPeriod) {
        return
      }

      const periodAnchor = Date.now()

      this.setData({
        periodAnchor,
        ...buildStatsView(this.data.statsRange, periodAnchor),
      })
    },
  },
})
