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

const RANGE_OPTIONS: StatsRangeOption[] = [
  { key: 'day', label: '每日' },
  { key: 'week', label: '每周' },
  { key: 'month', label: '每月' },
  { key: 'year', label: '每年' },
]

const TAG_COLORS = ['#98C6A8', '#7DA7D9', '#F1B86A', '#D98BB0', '#9B8DD9', '#8BC4D9', '#E09A7A', '#7BC8B8']

const STATS_INTRO_MS = 720

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

  const tagOrder = tagEntries.map((item) => item.tag)
  const maxMinutes = Math.max(...tagEntries.map((item) => item.minutes), 1)

  const tagStats: TagStatView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    minutes: item.minutes,
    percent: Math.round((item.minutes / maxMinutes) * 100),
    color: getTagColor(item.tag, tagOrder),
  }))

  const tagPieLegend: TagPieLegendView[] = tagEntries.map((item) => ({
    tag: item.tag,
    time: formatFocusMinutes(item.minutes),
    minutes: item.minutes,
    share: totalMinutes > 0 ? `${Math.round((item.minutes / totalMinutes) * 100)}%` : '0%',
    color: getTagColor(item.tag, tagOrder),
  }))

  const cards: StatsCard[] = [
    { label: '总专注', value: formatFocusMinutes(totalMinutes), icon: '/images/icons/stats-focus.svg' },
    { label: '计划完成/总数', value: `${completedPlanCount}/${totalPlanCount}`, icon: '/images/icons/stats-calendar.svg' },
    { label: '计划完成数', value: `${timedCount}`, icon: '/images/icons/stats-trophy.svg' },
  ]

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
  }
}

const buildStatsPageData = (
  range: StatsRange,
  periodAnchor: number,
  tagFilterMode: TagFilterMode,
  selectedTagKeys: string[],
) => buildStatsView(range, periodAnchor, tagFilterMode, selectedTagKeys)

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
    statsSectionsVisible: false,
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
    runStatsIntroAnimation(
      tagStats: TagStatView[],
      tagPieLegend: TagPieLegendView[],
      totalMinutes: number,
    ) {
      this.cancelStatsAnimation()
      const token = (this as WechatMiniprogram.IAnyObject).statsAnimToken as number
      const startedAt = Date.now()
      const shares = tagPieLegend.map((item) => ({
        color: item.color,
        share: totalMinutes > 0 ? Number.parseFloat(item.share) : 0,
      }))

      const resetDisplay = {
        displayTagStats: tagStats.map((item) => ({
          ...item,
          animPercent: 0,
          animTime: '0m',
        })),
        displayTotalFocus: '0m',
        displayTagPieStyle: 'background: #e8f0e8;',
        displayTagPieLegend: tagPieLegend.map((item) => ({
          ...item,
          animShare: '0%',
          animTime: '0m',
        })),
        statsSectionsVisible: false,
      }

      const step = () => {
        if (token !== (this as WechatMiniprogram.IAnyObject).statsAnimToken) {
          return
        }

        const progress = easeOutCubic(Math.min(1, (Date.now() - startedAt) / STATS_INTRO_MS))

        this.setData({
          statsSectionsVisible: progress > 0.04,
          displayTagStats: tagStats.map((item) => ({
            ...item,
            animPercent: Math.max(0, Math.round(item.percent * progress)),
            animTime: formatFocusMinutes(Math.round(item.minutes * progress)),
          })),
          displayTotalFocus: formatFocusMinutes(Math.round(totalMinutes * progress)),
          displayTagPieStyle: buildPieStyle(
            shares.map((item) => ({
              color: item.color,
              share: item.share * progress,
            })),
          ),
          displayTagPieLegend: tagPieLegend.map((item) => ({
            ...item,
            animShare:
              totalMinutes > 0
                ? `${Math.round(Number.parseFloat(item.share) * progress)}%`
                : '0%',
            animTime: formatFocusMinutes(Math.round(item.minutes * progress)),
          })),
        })

        if (progress < 1) {
          setTimeout(step, 16)
        }
      }

      this.setData(resetDisplay, () => {
        setTimeout(step, 16)
      })
    },
    applyStatsData(patch: ReturnType<typeof buildStatsPageData>) {
      this.cancelStatsAnimation()

      const { tagStats, tagPieLegend, totalMinutes, hasTagStats, ...rest } = patch

      this.setData({
        ...rest,
        tagStats,
        tagPieLegend,
        totalMinutes,
        hasTagStats,
      })

      if (!hasTagStats) {
        this.setData({
          displayTagStats: [],
          displayTagPieLegend: [],
          displayTagPieStyle: patch.tagPieStyle,
          displayTotalFocus: patch.totalFocus,
          statsSectionsVisible: true,
        })
        return
      }

      this.runStatsIntroAnimation(tagStats, tagPieLegend, totalMinutes)
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
  },
})
