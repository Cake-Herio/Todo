import { getCompletedRecords, getPlans, type CompletedRecord, type Plan } from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { getPlanTagColor } from '../../utils/plan-tags'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { getScrollFadeState } from '../../utils/scroll-fade'
import { getOwnerFilterState, getOwnerFilterStateLocal } from '../../utils/owner-filters'
import * as echarts from '../../components/ec-canvas/echarts'

type StatsRange = 'day' | 'week' | 'month' | 'year'
type TagFilterMode = 'all' | 'none' | 'custom'

interface StatsRangeOption {
  key: StatsRange
  label: string
}

interface StatsCard {
  label: string
  value: string
  icon: string
}

interface TagPieLegendView {
  tag: string
  time: string
  minutes: number
  share: string
  color: string
}

interface TagFilterOption {
  tag: string
  color: string
  minutes: number
  time: string
}

interface TagFilterItem {
  tag: string
  color: string
  checked: boolean
}

interface TagEchoItem {
  tag: string
  color: string
}

interface BarSegment {
  tag: string
  minutes: number
  color: string
}

interface BarBucket {
  label: string
  totalMinutes: number
  segments: BarSegment[]
}

const RANGE_OPTIONS: StatsRangeOption[] = [
  { key: 'day', label: '每日' },
  { key: 'week', label: '每周' },
  { key: 'month', label: '每月' },
  { key: 'year', label: '每年' },
]

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

const getTagBindColor = (tag: string) => {
  return getPlanTagColor(tag) || '#98C6A8'
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
    // Normalize first so dates like May 31 do not overflow when moving to June.
    date.setDate(1)
    date.setMonth(date.getMonth() + offset)
  } else {
    date.setMonth(0, 1)
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

  return '点击此处可回到当前周期'
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

const isTagChecked = (tag: string, mode: TagFilterMode, selectedTagKeys: string[]) => {
  if (mode === 'all') {
    return true
  }

  if (mode === 'none') {
    return false
  }

  return selectedTagKeys.includes(tag)
}

const getCheckedTags = (availableTags: string[], mode: TagFilterMode, selectedTagKeys: string[]) => {
  if (mode === 'all') {
    return availableTags
  }

  if (mode === 'none') {
    return []
  }

  return availableTags.filter((tag) => selectedTagKeys.includes(tag))
}

const filterByTagSelection = <T extends { tag: string }>(
  items: T[],
  mode: TagFilterMode,
  selectedTagKeys: string[],
) => {
  if (mode === 'all') {
    return items
  }

  if (mode === 'none') {
    return []
  }

  return items.filter((item) => selectedTagKeys.includes(item.tag))
}

const buildTagMinutesMap = (records: CompletedRecord[]) =>
  records.reduce<Record<string, number>>((result, record) => {
    const minutes = record.actualMinutes || 0
    if (minutes <= 0) {
      return result
    }

    result[record.tag] = (result[record.tag] || 0) + minutes
    return result
  }, {})

const buildAvailableTagFilters = (records: CompletedRecord[]): TagFilterOption[] => {
  const tagMinutesMap = buildTagMinutesMap(records)

  return Object.entries(tagMinutesMap)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, minutes]) => ({
      tag,
      minutes,
      time: formatFocusMinutes(minutes),
      color: getTagBindColor(tag),
    }))
}

const buildTagFilterItems = (
  availableTagFilters: TagFilterOption[],
  mode: TagFilterMode,
  selectedTagKeys: string[],
): TagFilterItem[] =>
  availableTagFilters.map((item) => ({
    tag: item.tag,
    color: item.color,
    checked: isTagChecked(item.tag, mode, selectedTagKeys),
  }))

const buildSelectedTagEcho = (
  availableTagFilters: TagFilterOption[],
  mode: TagFilterMode,
  selectedTagKeys: string[],
): TagEchoItem[] => {
  if (mode === 'none') {
    return []
  }

  if (mode === 'all') {
    return availableTagFilters.map(({ tag, color }) => ({ tag, color }))
  }

  return selectedTagKeys.map((tag) => {
    const matched = availableTagFilters.find((item) => item.tag === tag)
    return {
      tag,
      color: matched?.color || getTagBindColor(tag),
    }
  })
}

const buildTagFilterEchoText = (
  availableTagFilters: TagFilterOption[],
  mode: TagFilterMode,
) => {
  if (availableTagFilters.length === 0) {
    return '当前周期暂无可选标签'
  }

  if (mode === 'none') {
    return '未选择标签'
  }

  return ''
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const getBarUnitLabel = (range: StatsRange): string => {
  if (range === 'day') return '单位：时'
  if (range === 'month') return '单位：日'
  if (range === 'year') return '单位：月'
  return ''
}

const buildBarBuckets = (records: CompletedRecord[], range: StatsRange, periodAnchor: number): BarBucket[] => {
  if (records.length === 0) return []

  const numBuckets = range === 'day' ? 12 : range === 'week' ? 7 : range === 'month' ? 10 : 12
  const bucketTagMaps: Array<Record<string, number>> = Array.from({ length: numBuckets }, () => ({}))

  let daysInMonth = 30
  if (range === 'month') {
    const anchor = new Date(periodAnchor)
    daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
  }

  for (const r of records) {
    const minutes = r.actualMinutes || 0
    if (minutes <= 0) continue

    let idx: number
    if (range === 'day') {
      idx = Math.min(Math.floor(new Date(r.completedAt).getHours() / 2), 11)
    } else if (range === 'week') {
      const d = new Date(r.completedAt).getDay()
      idx = d === 0 ? 6 : d - 1
    } else if (range === 'month') {
      idx = Math.min(Math.floor((new Date(r.completedAt).getDate() - 1) * numBuckets / daysInMonth), numBuckets - 1)
    } else {
      idx = new Date(r.completedAt).getMonth()
    }

    bucketTagMaps[idx][r.tag] = (bucketTagMaps[idx][r.tag] || 0) + minutes
  }

  const buckets: BarBucket[] = []
  for (let i = 0; i < numBuckets; i++) {
    const segments = Object.entries(bucketTagMaps[i])
      .map(([tag, minutes]) => ({ tag, minutes, color: getTagBindColor(tag) }))
      .sort((a, b) => a.minutes - b.minutes)

    let label: string
    if (range === 'day') {
      label = `${i * 2}`
    } else if (range === 'week') {
      label = WEEK_LABELS[i]
    } else if (range === 'month') {
      const s = Math.floor(i * daysInMonth / numBuckets) + 1
      const e = Math.floor((i + 1) * daysInMonth / numBuckets)
      label = `${s}-${e}`
    } else {
      label = `${i + 1}`
    }

    buckets.push({
      label,
      totalMinutes: segments.reduce((s, seg) => s + seg.minutes, 0),
      segments,
    })
  }

  return buckets
}

const getNiceAxisMax = (max: number) => {
  if (max <= 0) return 60
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const normalized = max / magnitude

  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

const formatChartMinutes = (minutes: number) => {
  if (minutes <= 0) return '0m'
  if (minutes < 1) return `${Math.round(minutes * 60)}s`
  if (minutes < 60) return `${Math.round(minutes)}m`

  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

type EChartOption = Record<string, any>
type EChartInstance = {
  setOption: (option: EChartOption, notMerge?: boolean) => void
  resize: () => void
  dispose: () => void
}

const buildPieChartOption = (
  legend: TagPieLegendView[],
  totalMinutes: number,
): EChartOption => {
  const hasData = legend.length > 0 && totalMinutes > 0
  const data = hasData
    ? legend.map((item) => ({
        name: item.tag,
        value: item.minutes,
        itemStyle: { color: item.color },
      }))
    : [{ name: 'empty', value: 1, itemStyle: { color: '#E4F2E9' } }]

  return {
    animation: true,
    animationDuration: 900,
    animationEasing: 'cubicOut',
    tooltip: hasData
      ? {
          trigger: 'item',
          formatter: (params: any) => `${params.name}\n${formatChartMinutes(Number(params.value))}（${params.percent}%）`,
          backgroundColor: 'rgba(47, 58, 52, 0.9)',
          borderWidth: 0,
          textStyle: { color: '#FFFFFF', fontSize: 12 },
        }
      : { show: false },
    series: [
      {
        type: 'pie',
        radius: ['40%', '62%'],
        center: ['50%', '50%'],
        startAngle: 90,
        clockwise: true,
        avoidLabelOverlap: true,
        minAngle: hasData ? 2 : 0,
        data,
        itemStyle: {
          borderColor: '#FFFDF7',
          borderWidth: hasData ? 2 : 0,
        },
        label: hasData
          ? {
              show: true,
              position: 'outside',
              alignTo: 'edge',
              edgeDistance: 8,
              bleedMargin: 4,
              color: '#6E7B71',
              fontSize: 11,
              lineHeight: 16,
              formatter: (params: any) => `${params.name}  ${formatChartMinutes(Number(params.value))}`,
            }
          : { show: false },
        labelLine: hasData
          ? {
              show: true,
              length: 12,
              length2: 12,
              smooth: 0.15,
              lineStyle: { color: '#C8D4CC', width: 1 },
            }
          : { show: false },
        labelLayout: { moveOverlap: 'shiftY', hideOverlap: true },
        emphasis: { scale: false },
      },
    ],
  }
}

const buildBarChartOption = (
  buckets: BarBucket[],
  maxMinutes: number,
  hasData: boolean,
  unitLabel: string,
  emptyText: string,
): EChartOption => {
  const tagNames = Array.from(new Set(buckets.flatMap((bucket) => bucket.segments.map((segment) => segment.tag))))
  const colorMap = new Map<string, string>()
  buckets.forEach((bucket) => bucket.segments.forEach((segment) => colorMap.set(segment.tag, segment.color)))
  const axisMax = getNiceAxisMax(maxMinutes)

  return {
    animation: true,
    animationDuration: 960,
    animationEasing: 'cubicOut',
    tooltip: hasData
      ? {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params: any[]) => {
            const rows = params.filter((item) => Number(item.value) > 0)
            if (rows.length === 0) return params[0]?.axisValue || ''
            return [params[0]?.axisValue || '', ...rows.map((item) => `${item.seriesName}：${formatChartMinutes(Number(item.value))}`)].join('\n')
          },
          backgroundColor: 'rgba(47, 58, 52, 0.9)',
          borderWidth: 0,
          textStyle: { color: '#FFFFFF', fontSize: 12 },
        }
      : { show: false },
    graphic: !hasData
      ? [{
          type: 'text',
          left: 'center',
          top: 'middle',
          silent: true,
          style: {
            text: emptyText,
            fill: '#7A857D',
            fontSize: 13,
            textAlign: 'center',
            textVerticalAlign: 'middle',
          },
        }]
      : [],
    grid: { left: 42, right: 12, top: 14, bottom: 38, containLabel: false },
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => bucket.label),
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#C8D4CC' } },
      axisTick: { show: false },
      axisLabel: { color: '#7A857D', fontSize: 10, margin: 8 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: axisMax,
      splitNumber: 4,
      name: unitLabel.replace('单位：', ''),
      nameTextStyle: { color: '#9AA89E', fontSize: 9, align: 'right' },
      nameGap: 20,
      axisLine: { show: true, lineStyle: { color: '#C8D4CC' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#9AA89E',
        fontSize: 10,
        formatter: (value: number) => formatChartMinutes(value),
      },
      splitLine: { lineStyle: { color: '#E4F2E9', width: 1 } },
    },
    series: tagNames.map((tag) => ({
      name: tag,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 30,
      itemStyle: { color: colorMap.get(tag) || '#98C6A8' },
      data: buckets.map((bucket) => bucket.segments.find((segment) => segment.tag === tag)?.minutes || 0),
    })),
  }
}

const buildStatsView = (
  range: StatsRange,
  periodAnchor: number,
  tagFilterMode: TagFilterMode = 'all',
  selectedTagKeys: string[] = [],
  ownerFilter = 'me',
) => {
  const ownerRecords = getCompletedRecords().filter(
    (record) => ownerFilter === 'all' || record.ownerKey === ownerFilter,
  )
  const ownerPlans = getPlans().filter(
    (plan) => ownerFilter === 'all' || plan.ownerKey === ownerFilter,
  )
  const rangeRecords = filterRecordsByRange(ownerRecords, range, periodAnchor)
  const availableTagFilters = buildAvailableTagFilters(rangeRecords)
  const records = filterByTagSelection(rangeRecords, tagFilterMode, selectedTagKeys)
  const timedCount = records.filter((record) => record.completionMode === 'timed').length
  const plansInRange = filterByTagSelection(filterPlansByRange(ownerPlans, range, periodAnchor), tagFilterMode, selectedTagKeys)
  const completedPlanCount = plansInRange.filter((plan) => plan.status === 'completed').length
  const totalPlanCount = plansInRange.length
  const totalMinutes = records.reduce((total, record) => total + (record.actualMinutes || 0), 0)

  const tagMinutesMap = buildTagMinutesMap(records)

  const tagEntries = Object.entries(tagMinutesMap)
    .map(([tag, minutes]) => ({ tag, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  const tagPieLegend: TagPieLegendView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    minutes: item.minutes,
    share: totalMinutes > 0 ? `${Math.round((item.minutes / totalMinutes) * 100)}%` : '0%',
    color: getTagBindColor(item.tag),
  }))

  const cards: StatsCard[] = [
    { label: '总专注', value: formatFocusMinutes(totalMinutes), icon: '/images/icons/stats-focus.svg' },
    { label: '计时次数', value: `${timedCount}`, icon: '/images/icons/stats-trophy.svg' },
    { label: '计划完成/总数', value: `${completedPlanCount}/${totalPlanCount}`, icon: '/images/icons/stats-calendar.svg' },

  ]

  const barBuckets = buildBarBuckets(records, range, periodAnchor)
  const barMaxMinutes = Math.max(...barBuckets.map((b) => b.totalMinutes), 1)
  const hasBarData = barBuckets.some((b) => b.totalMinutes > 0)
  const barUnitLabel = getBarUnitLabel(range)

  const rangeOption = RANGE_OPTIONS.find((item) => item.key === range)
  const isCurrentPeriod = isSamePeriod(range, periodAnchor, Date.now())
  const isTagFilterRestricted = tagFilterMode !== 'all'

  return {
    rangeLabel: rangeOption?.label || '每周',
    rangeIndex: Math.max(0, RANGE_OPTIONS.findIndex((item) => item.key === range)),
    periodTitle: formatPeriodTitle(range, periodAnchor),
    periodHint: formatPeriodHint(range, periodAnchor),
    isCurrentPeriod,
    canGoNextPeriod: !isCurrentPeriod,
    cards,
    totalFocus: formatFocusMinutes(totalMinutes),
    totalMinutes,
    tagPieLegend,
    barBuckets,
    barMaxMinutes,
    barUnitLabel,
    hasBarData,
    availableTagFilters,
    tagFilterMode,
    selectedTagKeys,
    tagFilterItems: buildTagFilterItems(availableTagFilters, tagFilterMode, selectedTagKeys),
    selectedTagEcho: buildSelectedTagEcho(availableTagFilters, tagFilterMode, selectedTagKeys),
    tagFilterEchoText: buildTagFilterEchoText(availableTagFilters, tagFilterMode),
    tagFilterToggleLabel: tagFilterMode === 'all' ? '取消全选' : '全选',
    isTagFilterRestricted,
    tagEmptyText: tagFilterMode === 'none'
      ? '请至少选择一个标签'
      : isTagFilterRestricted
        ? '所选标签在当前周期暂无记录'
        : '当前时间范围内还没有计时专注记录',
    tagPieEmptyText: tagFilterMode === 'none'
      ? '请至少选择一个标签'
      : isTagFilterRestricted
        ? '所选标签在当前周期暂无占比数据'
        : '完成计时后这里会显示标签占比',
    tagBarEmptyText: tagFilterMode === 'none'
      ? '请至少选择一个标签'
      : isTagFilterRestricted
        ? '所选标签在当前周期暂无柱状图数据'
        : '完成计时后这里会显示时段分布',
  }
}

const buildStatsPageData = (
  range: StatsRange,
  periodAnchor: number,
  tagFilterMode: TagFilterMode,
  selectedTagKeys: string[],
  ownerFilter: string,
) => {
  const view = buildStatsView(range, periodAnchor, tagFilterMode, selectedTagKeys, ownerFilter)
  return view
}

Component({
  pieChart: null as EChartInstance | null,
  barChart: null as EChartInstance | null,
  pieChartInitPending: false,
  barChartInitPending: false,
  latestPieOption: null as EChartOption | null,
  latestBarOption: null as EChartOption | null,
  data: {
    safeTopPx: 0,
    filters: getOwnerFilterStateLocal('me').filters,
    activeFilter: getOwnerFilterStateLocal('me').activeFilter,
    singleUserMode: getOwnerFilterStateLocal('me').singleUserMode,
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
    totalMinutes: 0,
    tagPieLegend: [] as TagPieLegendView[],
    tagFilterMode: 'all' as TagFilterMode,
    selectedTagKeys: [] as string[],
    availableTagFilters: [] as TagFilterOption[],
    tagFilterItems: [] as TagFilterItem[],
    selectedTagEcho: [] as TagEchoItem[],
    tagFilterEchoText: '',
    tagFilterToggleLabel: '取消全选',
    showTagEchoFadeLeft: false,
    showTagEchoFadeRight: false,
    isTagFilterSheetVisible: false,
    isTagFilterSheetClosing: false,
    isTagFilterRestricted: false,
    tagEmptyText: '当前时间范围内还没有计时专注记录',
    tagPieEmptyText: '完成计时后这里会显示标签占比',
    tagBarEmptyText: '完成计时后这里会显示时段分布',
    barBuckets: [] as BarBucket[],
    barMaxMinutes: 0,
    barUnitLabel: '',
    hasBarData: false,
    // Charts are display-only here so the parent scroll-view keeps all vertical gestures.
    pieEc: { lazyLoad: true, disableTouch: true },
    barEc: { lazyLoad: true, disableTouch: true },
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)
      this.setData({ safeTopPx: statusBarHeight + gapPx })
      this.refreshStats()
      void this.refreshOwnerFilters()
    },
    detached() {
      this.disposeCharts()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => {
        void this.refreshOwnerFilters()
      })
    },
  },
  methods: {
    disposeCharts() {
      this.pieChart?.dispose()
      this.barChart?.dispose()
      this.pieChart = null
      this.barChart = null
      this.pieChartInitPending = false
      this.barChartInitPending = false
    },
    updatePieChart(legend: TagPieLegendView[], totalMinutes: number) {
      const option = buildPieChartOption(legend, totalMinutes)
      this.latestPieOption = option

      if (this.pieChart) {
        this.pieChart.setOption(option, true)
        return
      }

      if (this.pieChartInitPending) {
        return
      }

      this.pieChartInitPending = true
      wx.nextTick(() => {
        const component = (this as WechatMiniprogram.IAnyObject).selectComponent('#pie-chart') as WechatMiniprogram.IAnyObject | null
        if (!component) {
          this.pieChartInitPending = false
          return
        }

        component.init((canvas: any, width: number, height: number, dpr: number) => {
          const chart = echarts.init(canvas, null, {
            width,
            height,
            devicePixelRatio: dpr,
          }) as EChartInstance
          canvas.setChart(chart)
          this.pieChart = chart
          this.pieChartInitPending = false
          chart.setOption(this.latestPieOption || option, true)
          return chart
        })
      })
    },
    updateBarChart(buckets: BarBucket[], maxMinutes: number, hasData: boolean, unitLabel: string, emptyText: string) {
      const option = buildBarChartOption(buckets, maxMinutes, hasData, unitLabel, emptyText)
      this.latestBarOption = option

      if (this.barChart) {
        this.barChart.setOption(option, true)
        return
      }

      if (this.barChartInitPending) {
        return
      }

      this.barChartInitPending = true
      wx.nextTick(() => {
        const component = (this as WechatMiniprogram.IAnyObject).selectComponent('#bar-chart') as WechatMiniprogram.IAnyObject | null
        if (!component) {
          this.barChartInitPending = false
          return
        }

        component.init((canvas: any, width: number, height: number, dpr: number) => {
          const chart = echarts.init(canvas, null, {
            width,
            height,
            devicePixelRatio: dpr,
          }) as EChartInstance
          canvas.setChart(chart)
          this.barChart = chart
          this.barChartInitPending = false
          chart.setOption(this.latestBarOption || option, true)
          return chart
        })
      })
    },
    applyStatsData(patch: ReturnType<typeof buildStatsPageData>) {
      const { tagPieLegend, totalMinutes, barBuckets, barMaxMinutes, hasBarData } = patch

      this.setData(patch)
      this.updatePieChart(tagPieLegend, totalMinutes)
      this.updateBarChart(barBuckets, barMaxMinutes, hasBarData, patch.barUnitLabel, patch.tagBarEmptyText)
    },
    async refreshOwnerFilters() {
      const state = await getOwnerFilterState(this.data.activeFilter)
      this.setData(
        {
          filters: state.filters,
          activeFilter: state.activeFilter,
          singleUserMode: state.singleUserMode,
        },
        () => this.refreshStats(),
      )
    },
    refreshStats() {
      const { statsRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter } = this.data
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
    },
    setFilter(e: WechatMiniprogram.CustomEvent<{ filter?: string }> | WechatMiniprogram.BaseEvent) {
      const filter =
        (e as WechatMiniprogram.CustomEvent<{ filter?: string }>).detail?.filter ||
        (e.currentTarget?.dataset?.filter as string | undefined)

      if (!filter || filter === this.data.activeFilter) {
        return
      }

      this.setData({ activeFilter: filter })
      this.refreshStats()
    },
    applyTagFilterState(tagFilterMode: TagFilterMode, selectedTagKeys: string[]) {
      const { statsRange, periodAnchor, activeFilter } = this.data
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
    },
    switchStatsRange(e: WechatMiniprogram.BaseEvent) {
      const range = e.currentTarget.dataset.range as StatsRange | undefined
      if (!range || range === this.data.statsRange) {
        return
      }

      const periodAnchor = Date.now()
      const { tagFilterMode, selectedTagKeys, activeFilter } = this.data

      this.setData({
        statsRange: range,
        periodAnchor,
      })
      this.applyStatsData(buildStatsPageData(range, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
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
      const { statsRange, tagFilterMode, selectedTagKeys, activeFilter } = this.data

      this.setData({ periodAnchor })
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
    },
    goToCurrentPeriod() {
      if (this.data.isCurrentPeriod) {
        return
      }

      const periodAnchor = Date.now()
      const { statsRange, tagFilterMode, selectedTagKeys, activeFilter } = this.data

      this.setData({ periodAnchor })
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
    },
    toggleSelectAllTags() {
      if (this.data.tagFilterMode === 'all') {
        this.applyTagFilterState('none', [])
        return
      }

      this.applyTagFilterState('all', [])
    },
    toggleTagFilter(e: WechatMiniprogram.BaseEvent) {
      const tag = e.currentTarget.dataset.tag as string | undefined
      if (!tag) {
        return
      }

      const availableTags = this.data.availableTagFilters.map((item) => item.tag)
      const checkedTags = getCheckedTags(availableTags, this.data.tagFilterMode, this.data.selectedTagKeys)
      const isChecked = checkedTags.includes(tag)

      let nextCheckedTags: string[]
      if (isChecked) {
        nextCheckedTags = checkedTags.filter((item) => item !== tag)
      } else {
        nextCheckedTags = [...checkedTags, tag]
      }

      if (nextCheckedTags.length === 0) {
        this.applyTagFilterState('none', [])
        return
      }

      if (nextCheckedTags.length === availableTags.length) {
        this.applyTagFilterState('all', [])
        return
      }

      this.applyTagFilterState('custom', nextCheckedTags)
    },
    openTagFilterSheet() {
      openModal(this, 'isTagFilterSheetVisible', 'isTagFilterSheetClosing')
    },
    closeTagFilterSheet() {
      dismissModal(this, 'isTagFilterSheetVisible', 'isTagFilterSheetClosing')
    },
    updateTagEchoScrollFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.stats-tag-echo-scroll').boundingClientRect()
        query.select('.stats-tag-echo-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          ;(this as WechatMiniprogram.IAnyObject).tagEchoScrollViewportWidth = viewportWidth
          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showTagEchoFadeLeft: fades.showLeft,
            showTagEchoFadeRight: fades.showRight,
          })
        })
      })
    },
    onTagEchoScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = (this as WechatMiniprogram.IAnyObject).tagEchoScrollViewportWidth || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        showTagEchoFadeLeft: fades.showLeft,
        showTagEchoFadeRight: fades.showRight,
      })
    },
    noop() {},
    onSwipeStart(e: WechatMiniprogram.TouchEvent) {
      const touch = e.touches[0]
      ;(this as WechatMiniprogram.IAnyObject)._swipeStartX = touch.clientX
      ;(this as WechatMiniprogram.IAnyObject)._swipeStartY = touch.clientY
    },
    onSwipeEnd(e: WechatMiniprogram.TouchEvent) {
      const startX = (this as WechatMiniprogram.IAnyObject)._swipeStartX as number
      const startY = (this as WechatMiniprogram.IAnyObject)._swipeStartY as number
      if (startX === undefined) return

      const touch = e.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      const SWIPE_THRESHOLD = 50

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        const direction = dx < 0 ? 1 : -1
        this.swipeToRange(direction)
      }

      ;(this as WechatMiniprogram.IAnyObject)._swipeStartX = undefined
      ;(this as WechatMiniprogram.IAnyObject)._swipeStartY = undefined
    },
    swipeToRange(direction: number) {
      const ranges: StatsRange[] = ['day', 'week', 'month', 'year']
      const currentIndex = ranges.indexOf(this.data.statsRange)
      const nextIndex = currentIndex + direction
      if (nextIndex < 0 || nextIndex >= ranges.length) return

      const nextRange = ranges[nextIndex]
      const periodAnchor = Date.now()
      const { tagFilterMode, selectedTagKeys, activeFilter } = this.data

      this.setData({
        statsRange: nextRange,
        rangeIndex: nextIndex,
        periodAnchor,
      })
      this.applyStatsData(buildStatsPageData(nextRange, periodAnchor, tagFilterMode, selectedTagKeys, activeFilter))
      this.updateTagEchoScrollFades()
    },
  },
})
