import { getCompletedRecords, getPlans, type CompletedRecord, type Plan } from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { getPlanTagOptions, resolvePlanTag } from '../../utils/plan-tags'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { getScrollFadeState } from '../../utils/scroll-fade'

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

interface TagStatView {
  tag: string
  time: string
  minutes: number
  percent: number
  color: string
}

interface TagStatDisplayView extends TagStatView {
  animPercent: number
  animTime: string
  _rk: string
}

interface TagPieLegendView {
  tag: string
  time: string
  minutes: number
  share: string
  color: string
}

interface TagPieLegendDisplayView extends TagPieLegendView {
  animShare: string
  animTime: string
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

const STATS_INTRO_MS = 900

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3

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
  const resolvedTag = resolvePlanTag(tag)
  const option = getPlanTagOptions().find((item) => item.name === resolvedTag)
  return option?.color || '#98C6A8'
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

const buildBarBuckets = (records: CompletedRecord[], range: StatsRange): BarBucket[] => {
  if (records.length === 0) return []

  const numBuckets = range === 'day' ? 12 : range === 'week' ? 7 : range === 'month' ? 10 : 12
  const bucketTagMaps: Array<Record<string, number>> = Array.from({ length: numBuckets }, () => ({}))

  let daysInMonth = 30
  if (range === 'month') {
    const anchor = new Date(records[0].completedAt)
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

const buildStatsView = (
  range: StatsRange,
  periodAnchor: number,
  tagFilterMode: TagFilterMode = 'all',
  selectedTagKeys: string[] = [],
) => {
  const rangeRecords = filterRecordsByRange(getCompletedRecords(), range, periodAnchor)
  const availableTagFilters = buildAvailableTagFilters(rangeRecords)
  const records = filterByTagSelection(rangeRecords, tagFilterMode, selectedTagKeys)
  const timedCount = records.filter((record) => record.completionMode === 'timed').length
  const plansInRange = filterByTagSelection(filterPlansByRange(getPlans(), range, periodAnchor), tagFilterMode, selectedTagKeys)
  const completedPlanCount = plansInRange.filter((plan) => plan.status === 'completed').length
  const totalPlanCount = plansInRange.length
  const totalMinutes = records.reduce((total, record) => total + (record.actualMinutes || 0), 0)

  const tagMinutesMap = buildTagMinutesMap(records)

  const tagEntries = Object.entries(tagMinutesMap)
    .map(([tag, minutes]) => ({ tag, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  const maxMinutes = Math.max(...tagEntries.map((item) => item.minutes), 1)

  const tagStats: TagStatView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    minutes: item.minutes,
    percent: Math.round((item.minutes / maxMinutes) * 100),
    color: getTagBindColor(item.tag),
  }))

  const tagPieLegend: TagPieLegendView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    minutes: item.minutes,
    share: totalMinutes > 0 ? `${Math.round((item.minutes / totalMinutes) * 100)}%` : '0%',
    color: getTagBindColor(item.tag),
  }))

  const cards: StatsCard[] = [
    { label: '总专注', value: formatFocusMinutes(totalMinutes), icon: '/images/icons/stats-focus.svg' },
    { label: '计划完成/总数', value: `${completedPlanCount}/${totalPlanCount}`, icon: '/images/icons/stats-calendar.svg' },
    { label: '计时次数', value: `${timedCount}`, icon: '/images/icons/stats-trophy.svg' },
  ]

  const barBuckets = buildBarBuckets(records, range)
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
    tagStats,
    tagPieStyle: buildPieStyle(
      tagPieLegend.map((item) => ({
        color: item.color,
        share: totalMinutes > 0 ? Number.parseFloat(item.share) : 0,
      })),
    ),
    tagPieLegend,
    hasTagStats: tagStats.length > 0,
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
) => {
  const view = buildStatsView(range, periodAnchor, tagFilterMode, selectedTagKeys)
  return view
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
    totalMinutes: 0,
    tagStats: [] as TagStatView[],
    displayTagStats: [] as TagStatDisplayView[],
    tagPieStyle: 'background: #e8f0e8;',
    displayTagPieStyle: 'background: #e8f0e8;',
    tagPieLegend: [] as TagPieLegendView[],
    displayTagPieLegend: [] as TagPieLegendDisplayView[],
    displayTotalFocus: '0m',
    hasTagStats: false,
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
    tagChartView: 'pie' as 'pie' | 'bar',
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)
      this.setData({ safeTopPx: statusBarHeight + gapPx })
      this.refreshStats()
    },
    detached() {
      this.cancelStatsAnimation()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => this.refreshStats())
    },
  },
  methods: {
    cancelStatsAnimation() {
      ;(this as WechatMiniprogram.IAnyObject).statsAnimToken =
        ((this as WechatMiniprogram.IAnyObject).statsAnimToken || 0) + 1
    },
    initBarCanvas(buckets: BarBucket[], maxMinutes: number, hasData: boolean) {
      const query = this.createSelectorQuery()
      query.select('#bar-canvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0] || !res[0].node) return
        const canvas = res[0].node as any
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio
        const w = res[0].width as number
        const h = res[0].height as number
        if (w <= 0 || h <= 0) return
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)

        const token = (this as WechatMiniprogram.IAnyObject).statsAnimToken as number
        const unitLabel = this.data.barUnitLabel as string

        const padTop = 14; const padBottom = 34; const padLeft = 44; const padRight = 14
        const chartW = w - padLeft - padRight
        const chartH = h - padTop - padBottom
        const barCount = buckets.length
        if (barCount === 0) {
          ctx.fillStyle = '#7a857d'
          ctx.font = '13px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(this.data.tagBarEmptyText || '暂无数据', w / 2, h / 2)
          return
        }
        const barGap = 6
        const barW = (chartW - barGap * (barCount - 1)) / barCount
        const labelFontSize = barCount >= 12 ? 9 : 10

        const niceMaxForAxis = (max: number): number => {
          if (max <= 0) return 60
          const mag = 10 ** Math.floor(Math.log10(max))
          const n = max / mag
          if (n <= 1) return mag
          if (n <= 2) return 2 * mag
          if (n <= 5) return 5 * mag
          return 10 * mag
        }

        const formatTickMinutes = (m: number): string => {
          if (m <= 0) return '0'
          if (m < 60) return `${Math.round(m)}m`
          const hours = Math.floor(m / 60)
          const rest = Math.round(m % 60)
          if (rest === 0) return `${hours}h`
          return `${hours}h${rest}m`
        }

        const yMax = niceMaxForAxis(maxMinutes)
        const tickCount = 4
        const tickInterval = yMax / tickCount
        const yAxisX = padLeft - 1

        const drawBarFrame = (progress: number) => {
          ctx.clearRect(0, 0, w, h)

          // --- Y-axis gridlines + labels ---
          for (let t = 0; t <= tickCount; t++) {
            const val = t * tickInterval
            const y = padTop + chartH - (val / yMax) * chartH

            ctx.beginPath()
            ctx.moveTo(padLeft, y)
            ctx.lineTo(w - padRight, y)
            ctx.strokeStyle = '#E4F2E9'
            ctx.lineWidth = 1
            ctx.stroke()

            ctx.fillStyle = '#9aa89e'
            ctx.font = '10px sans-serif'
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText(formatTickMinutes(val), padLeft - 6, y)
          }

          // Y-axis vertical line
          ctx.beginPath()
          ctx.moveTo(yAxisX, padTop)
          ctx.lineTo(yAxisX, padTop + chartH)
          ctx.strokeStyle = '#C8D4CC'
          ctx.lineWidth = 1
          ctx.stroke()

          // --- empty state ---
          if (!hasData || maxMinutes <= 0) {
            ctx.fillStyle = '#7a857d'
            ctx.font = '13px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(this.data.tagBarEmptyText || '暂无数据', padLeft + chartW / 2, padTop + chartH / 2)
            return
          }

          // --- stacked bars ---
          for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i]
            const x = padLeft + i * (barW + barGap)

            let segY = padTop + chartH
            for (const seg of bucket.segments) {
              const segH = Math.max(0, (seg.minutes / yMax) * chartH * progress)
              if (segH > 0.5) {
                ctx.fillStyle = seg.color
                ctx.fillRect(x, segY - segH, barW, segH)
              }
              segY -= segH
            }

            // X-axis label
            if (bucket.label) {
              ctx.fillStyle = '#7a857d'
              ctx.font = `${labelFontSize}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.fillText(bucket.label, x + barW / 2, padTop + chartH + 6)
            }
          }

          // X-axis unit label
          if (unitLabel) {
            ctx.fillStyle = '#9aa89e'
            ctx.font = '9px sans-serif'
            ctx.textAlign = 'right'
            ctx.textBaseline = 'top'
            ctx.fillText(unitLabel, w - padRight, padTop + chartH + 20)
          }
        }

        drawBarFrame(0)
        const animStartedAt = Date.now()
        const BAR_ANIM_MS = 960

        const step = () => {
          if (token !== (this as WechatMiniprogram.IAnyObject).statsAnimToken) return
          const t = Math.min(1, (Date.now() - animStartedAt) / BAR_ANIM_MS)
          drawBarFrame(easeOutCubic(t))
          if (t < 1) canvas.requestAnimationFrame(step)
        }
        canvas.requestAnimationFrame(step)
      })
    },
    onTagChartSwiperChange(e: WechatMiniprogram.SwiperChange) {
      const current = e.detail.current
      const view = current === 1 ? 'bar' : 'pie'
      this.setData({ tagChartView: view })

      if (view === 'bar') {
        const { barBuckets, barMaxMinutes, hasBarData } = this.data
        wx.nextTick(() => {
          this.initBarCanvas(barBuckets, barMaxMinutes, hasBarData)
        })
      }
    },
    drawEmptyPieRing() {
      const query = this.createSelectorQuery()
      query.select('#pie-canvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0] || !res[0].node) return
        const canvas = res[0].node as any
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio
        const w = res[0].width as number
        const h = res[0].height as number
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)

        const ringDiameter = Math.min(w * 0.42, h * 0.88)
        const ringCX = ringDiameter / 2 + 10
        const ringCY = h / 2
        const outerR = ringDiameter / 2 - 2
        const innerR = outerR * 0.58
        const arcR = (outerR + innerR) / 2
        const lineW = outerR - innerR

        ctx.clearRect(0, 0, w, h)

        ctx.beginPath()
        ctx.arc(ringCX, ringCY, arcR, 0, 2 * Math.PI)
        ctx.strokeStyle = '#E4F2E9'
        ctx.lineWidth = lineW
        ctx.lineCap = 'butt'
        ctx.stroke()

        const centerR = innerR - 2
        ctx.beginPath()
        ctx.arc(ringCX, ringCY, centerR, 0, 2 * Math.PI)
        ctx.fillStyle = '#fffdf7'
        ctx.fill()

        ctx.fillStyle = '#2f3a34'
        ctx.font = `bold ${Math.round(lineW * 0.55)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('0m', ringCX, ringCY - Math.round(lineW * 0.10))
        ctx.fillStyle = '#7a857d'
        ctx.font = `${Math.round(lineW * 0.34)}px sans-serif`
        ctx.fillText('总专注', ringCX, ringCY + Math.round(lineW * 0.36))
      })
    },
    runStatsIntroAnimation(
      tagStats: TagStatView[],
      tagPieLegend: TagPieLegendView[],
      totalMinutes: number,
    ) {
      this.cancelStatsAnimation()
      const token = (this as WechatMiniprogram.IAnyObject).statsAnimToken as number
      const shares = tagPieLegend.map((item) => ({
        color: item.color,
        share: totalMinutes > 0 ? Number.parseFloat(item.share) : 0,
      }))

      const rk = (i: number) => `${i}-${token}`

      const resetDisplay = {
        displayTagStats: tagStats.map((item, i) => ({
          ...item,
          animPercent: 0,
          animTime: '0m',
          _rk: rk(i),
        })),
      }

      const finalBars = {
        displayTagStats: tagStats.map((item, i) => ({
          ...item,
          animPercent: item.percent,
          animTime: item.time,
          _rk: rk(i),
        })),
      }

      this.setData(resetDisplay, () => {
        const query = this.createSelectorQuery()
        query.select('#pie-canvas').fields({ node: true, size: true }).exec((res) => {
          if (!res[0] || !res[0].node) return
          const canvas = res[0].node as any
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio
          const w = res[0].width as number
          const h = res[0].height as number
          canvas.width = w * dpr
          canvas.height = h * dpr
          ctx.scale(dpr, dpr)

          // --- precompute layout (invariant per canvas size) ---
          const ringPortion = 0.42
          const ringDiameter = Math.min(w * ringPortion, h * 0.88)
          const ringCX = ringDiameter / 2 + 10
          const ringCY = h / 2
          const outerR = ringDiameter / 2 - 2
          const innerR = outerR * 0.58
          const arcR = (outerR + innerR) / 2
          const lineW = outerR - innerR
          const centerR = innerR - 2
          const fullCircle = 2 * Math.PI
          const startAngle0 = -Math.PI / 2
          const labelStartX = ringCX + ringDiameter / 2 + 28
          const labelAreaWidth = w - labelStartX - 12
          const fontSize = Math.max(11, Math.min(13, lineW * 0.55))
          const pillPadY = 5
          const pillH = fontSize + pillPadY * 2
          const minGap = 4
          const valueFontSize = Math.round(lineW * 0.55)
          const subFontSize = Math.round(lineW * 0.34)
          const valueYOff = Math.round(lineW * 0.10)
          const subYOff = Math.round(lineW * 0.36)

          // --- pre-measure pill text widths + time widths ---
          ctx.font = `bold ${fontSize}px sans-serif`
          const pillWidths: number[] = tagPieLegend.map((item) => ctx.measureText(item.tag).width)
          ctx.font = `${fontSize}px sans-serif`
          const preTimeWidths: number[] = tagPieLegend.map((item) => ctx.measureText(item.time).width)

          const computeCalloutLayout = () => {
            const segs: Array<{
              midAngle: number; color: string; tag: string; time: string; timeW: number; anchorY: number; labelY: number; pillW: number
            }> = []

            let sa = startAngle0
            for (let i = 0; i < shares.length; i++) {
              const sweep = (shares[i].share / 100) * fullCircle
              if (sweep <= 0.001) { sa += sweep; continue }
              const mid = sa + sweep / 2
              segs.push({
                midAngle: mid,
                color: shares[i].color,
                tag: tagPieLegend[i].tag,
                time: tagPieLegend[i].time,
                timeW: preTimeWidths[i],
                anchorY: ringCY + Math.sin(mid) * arcR,
                labelY: 0,
                pillW: pillWidths[i] + 16,
              })
              sa += sweep
            }
            if (segs.length === 0) return segs

            segs.sort((a, b) => a.anchorY - b.anchorY)
            for (let i = 0; i < segs.length; i++) segs[i].labelY = segs[i].anchorY
            for (let i = 1; i < segs.length; i++) {
              const prev = segs[i - 1]
              const curr = segs[i]
              const minY = prev.labelY + pillH / 2 + minGap + pillH / 2
              if (curr.labelY < minY) curr.labelY = minY
            }
            return segs
          }

          const calloutSegs = shares.length > 0 ? computeCalloutLayout() : []

          // --- draw function ---
          const drawPieCard = (ringProgress: number, calloutProgress: number) => {
            ctx.clearRect(0, 0, w, h)

            // track
            ctx.beginPath()
            ctx.arc(ringCX, ringCY, arcR, 0, fullCircle)
            ctx.strokeStyle = '#E4F2E9'
            ctx.lineWidth = lineW
            ctx.lineCap = 'butt'
            ctx.stroke()

            // center circle
            ctx.beginPath()
            ctx.arc(ringCX, ringCY, centerR, 0, fullCircle)
            ctx.fillStyle = '#fffdf7'
            ctx.fill()

            // center text
            const currentTotal = formatFocusMinutes(Math.round(totalMinutes * ringProgress))
            ctx.fillStyle = '#2f3a34'
            ctx.font = `bold ${valueFontSize}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(currentTotal, ringCX, ringCY - valueYOff)
            ctx.fillStyle = '#7a857d'
            ctx.font = `${subFontSize}px sans-serif`
            ctx.fillText('总专注', ringCX, ringCY + subYOff)

            if (shares.length === 0) return

            // segments
            let sa = startAngle0
            for (let i = 0; i < shares.length; i++) {
              let sweep = (shares[i].share / 100) * fullCircle * ringProgress
              if (ringProgress >= 0.99 && i === shares.length - 1) {
                const endAngle = startAngle0 + fullCircle
                if (endAngle > sa + 0.001) sweep = endAngle - sa
              }
              if (sweep <= 0.001) { sa += sweep; continue }
              ctx.beginPath()
              ctx.arc(ringCX, ringCY, arcR, sa, sa + sweep)
              ctx.strokeStyle = shares[i].color
              ctx.lineWidth = lineW
              ctx.lineCap = 'butt'
              ctx.stroke()
              sa += sweep
            }

            if (calloutProgress <= 0 || calloutSegs.length === 0) return

            // guide lines
            ctx.globalAlpha = Math.min(0.55, calloutProgress * 0.55)
            ctx.setLineDash([4, 3])
            for (const seg of calloutSegs) {
              const ax = ringCX + Math.cos(seg.midAngle) * arcR
              ctx.beginPath()
              ctx.moveTo(ax, seg.anchorY)
              ctx.lineTo(labelStartX, seg.labelY)
              ctx.strokeStyle = '#C8D4CC'
              ctx.lineWidth = 1
              ctx.lineCap = 'round'
              ctx.stroke()

              ctx.beginPath()
              ctx.arc(ax, seg.anchorY, 2.5, 0, fullCircle)
              ctx.fillStyle = seg.color
              ctx.fill()
            }
            ctx.setLineDash([])
            ctx.globalAlpha = 1

            // pills
            const pillAlpha = calloutProgress
            for (const seg of calloutSegs) {
              ctx.globalAlpha = pillAlpha
              const pillX = labelStartX
              const pillY = seg.labelY - pillH / 2
              const r = Math.min(7, pillH / 2)
              ctx.beginPath()
              ctx.moveTo(pillX + r, pillY)
              ctx.lineTo(pillX + seg.pillW - r, pillY)
              ctx.arcTo(pillX + seg.pillW, pillY, pillX + seg.pillW, pillY + r, r)
              ctx.lineTo(pillX + seg.pillW, pillY + pillH - r)
              ctx.arcTo(pillX + seg.pillW, pillY + pillH, pillX + seg.pillW - r, pillY + pillH, r)
              ctx.lineTo(pillX + r, pillY + pillH)
              ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - r, r)
              ctx.lineTo(pillX, pillY + r)
              ctx.arcTo(pillX, pillY, pillX + r, pillY, r)
              ctx.closePath()
              ctx.fillStyle = seg.color
              ctx.fill()
              ctx.fillStyle = '#FFFFFF'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'middle'
              ctx.fillText(seg.tag, pillX + 8, seg.labelY)

              const timeX = pillX + seg.pillW + 8
              const maxTimeW = labelAreaWidth - seg.pillW - 8
              ctx.font = `${fontSize}px sans-serif`
              ctx.fillStyle = '#6e7b71'
              if (seg.timeW <= maxTimeW) {
                ctx.fillText(seg.time, timeX, seg.labelY)
              }
            }
            ctx.globalAlpha = 1
          }

          // --- trigger CSS bar animation (delayed 1 frame so reset renders first) ---
          wx.nextTick(() => {
            if (token !== (this as WechatMiniprogram.IAnyObject).statsAnimToken) return
            this.setData(finalBars)
          })

          // --- start rAF loop (canvas only, startedAt set after frame 0 to avoid async gap) ---
          drawPieCard(0, 0)
          const animStartedAt = Date.now()
          const step = () => {
            if (token !== (this as WechatMiniprogram.IAnyObject).statsAnimToken) return
            const t = Math.min(1, (Date.now() - animStartedAt) / STATS_INTRO_MS)
            const ringProgress = easeOutCubic(Math.min(1, t / 0.7))
            const calloutProgress = t > 0.7 ? easeOutCubic((t - 0.7) / 0.3) : 0
            drawPieCard(ringProgress, calloutProgress)
            if (t < 1) canvas.requestAnimationFrame(step)
          }
          canvas.requestAnimationFrame(step)
        })
      })
    },
    applyStatsData(patch: ReturnType<typeof buildStatsPageData>) {
      this.cancelStatsAnimation()

      const { tagStats, tagPieLegend, totalMinutes, hasTagStats, barBuckets, barMaxMinutes, hasBarData, ...rest } = patch

      this.setData({
        ...rest,
        tagStats,
        tagPieLegend,
        totalMinutes,
        hasTagStats,
        barBuckets,
        barMaxMinutes,
        hasBarData,
        displayTagStats: [],
      })

      if (!hasTagStats) {
        this.setData({
          displayTagStats: [],
          displayTotalFocus: patch.totalFocus,
        }, () => {
          this.drawEmptyPieRing()
        })
        return
      }

      this.runStatsIntroAnimation(tagStats, tagPieLegend, totalMinutes)

      if (this.data.tagChartView === 'bar') {
        wx.nextTick(() => {
          this.initBarCanvas(barBuckets, barMaxMinutes, hasBarData)
        })
      }
    },
    refreshStats() {
      const { statsRange, periodAnchor, tagFilterMode, selectedTagKeys } = this.data
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys))
      this.updateTagEchoScrollFades()
    },
    applyTagFilterState(tagFilterMode: TagFilterMode, selectedTagKeys: string[]) {
      const { statsRange, periodAnchor } = this.data
      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys))
      this.updateTagEchoScrollFades()
    },
    switchStatsRange(e: WechatMiniprogram.BaseEvent) {
      const range = e.currentTarget.dataset.range as StatsRange | undefined
      if (!range || range === this.data.statsRange) {
        return
      }

      const periodAnchor = Date.now()
      const { tagFilterMode, selectedTagKeys } = this.data

      this.setData({
        statsRange: range,
        periodAnchor,
      })
      this.applyStatsData(buildStatsPageData(range, periodAnchor, tagFilterMode, selectedTagKeys))
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
      const { statsRange, tagFilterMode, selectedTagKeys } = this.data

      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys))
      this.updateTagEchoScrollFades()
    },
    goToCurrentPeriod() {
      if (this.data.isCurrentPeriod) {
        return
      }

      const periodAnchor = Date.now()
      const { statsRange, tagFilterMode, selectedTagKeys } = this.data

      this.applyStatsData(buildStatsPageData(statsRange, periodAnchor, tagFilterMode, selectedTagKeys))
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
      const { tagFilterMode, selectedTagKeys } = this.data

      this.setData({
        statsRange: nextRange,
        rangeIndex: nextIndex,
        periodAnchor,
      })
      this.applyStatsData(buildStatsPageData(nextRange, periodAnchor, tagFilterMode, selectedTagKeys))
      this.updateTagEchoScrollFades()
    },
  },
})
