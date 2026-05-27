import { completePlan, deletePlan, getOwnerAvatarUrl, getPlanById, getPlansByDate, getToday, updatePlan, type OwnerKey, type Plan } from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getOwnerFilterState, getOwnerFilterStateLocal } from '../../utils/owner-filters'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { addPlanTagOption, DEFAULT_PLAN_TAGS, getPlanTagOptions } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'

interface DayPlanView {
  id: string
  time: string
  owner: string
  ownerAvatarUrl: string
  title: string
  tag: string
  remark: string | null
  status: string
  color: 'green' | 'blue'
  isExpired: boolean
}

interface NowCursor {
  visible: boolean
  top: number
  label: string
}

interface TimedPlanView extends DayPlanView {
  top: number
  height: number
  lane: number
  laneCount: number
  leftPercent: number
  widthPercent: number
}

interface TimedInterval {
  plan: TimedPlanView
  start: number
  end: number
  ownerKey: OwnerKey
}

const TIMED_LANE_GAP = 2
const TIMED_SINGLE_WIDTH_PERCENT = 75
const TIMED_CARD_PADDING = 20
const TIMED_TIME_ROW = 22
const TIMED_TITLE_ROW = 34
const TIMED_REMARK_GAP = 8
const TIMED_REMARK_LINE_HEIGHT = 22
const TIMED_COLUMN_BASE_WIDTH = 315

interface TimelineMarker {
  label: string
  top: number
}

interface TimeSegment {
  startMin: number
  endMin: number
  baseHeight: number
  height: number
}

type MinutesToY = (minutes: number) => number

interface PeriodZone {
  top: number
  height: number
}

const TIMELINE_START = 6
const TIMELINE_END = 24
const HOUR_HEIGHT = 88
const PERIOD_CARD_HEIGHT = 124
const PERIOD_CARD_GAP = 8
const PERIOD_LABEL_HEIGHT = 28
const PERIOD_ZONE_PADDING = 12

const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const statusTextMap = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  overdue: '逾期',
  cancelled: '已取消',
}

const filterPlans = (plans: Plan[], filter: string) => {
  if (filter === 'me' || filter === 'partner') {
    return plans.filter((plan) => plan.ownerKey === filter as OwnerKey)
  }

  return plans
}

const formatDateTitle = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]}`
}

const parseTimeToMinutes = (time: string, treatMidnightAsEnd = false) => {
  const [hourText, minuteText] = time.split(':')
  let hour = Number(hourText)
  const minute = Number(minuteText || '0')

  if (treatMidnightAsEnd && hour === 0 && minute === 0) {
    hour = 24
  }

  return hour * 60 + minute
}

const linearMinutesToY: MinutesToY = (minutes) => ((minutes - TIMELINE_START * 60) / 60) * HOUR_HEIGHT

const timeTop = (hour: number) => linearMinutesToY(hour * 60)

const getNowMinutes = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

const isViewingToday = (selectedDate: string) => selectedDate === getToday()

const isPlanExpired = (
  plan: Plan,
  selectedDate: string,
  periodKey: 'morning' | 'afternoon' | 'evening' | null = null,
) => {
  if (!isViewingToday(selectedDate)) {
    return false
  }

  const nowMinutes = getNowMinutes()

  if (plan.startTime && plan.endTime) {
    return nowMinutes >= parseTimeToMinutes(plan.endTime, true)
  }

  if (periodKey === 'morning') {
    return nowMinutes >= 12 * 60
  }

  if (periodKey === 'afternoon') {
    return nowMinutes >= 18 * 60
  }

  if (periodKey === 'evening') {
    return nowMinutes >= 24 * 60
  }

  return false
}

const getPeriodKey = (plan: Plan): 'morning' | 'afternoon' | 'evening' | null => {
  const text = plan.timeText || ''

  if (text.includes('上午') || text.includes('早上') || text.includes('早晨')) {
    return 'morning'
  }

  if (text.includes('下午')) {
    return 'afternoon'
  }

  if (text.includes('晚上') || text.includes('傍晚') || text.includes('夜间')) {
    return 'evening'
  }

  return null
}

type ScheduleKind = 'timed' | 'period' | 'allday'
type PeriodKey = 'morning' | 'afternoon' | 'evening'

interface EditPlanForm {
  ownerKey: OwnerKey
  tag: string
  remark: string
  date: string
  scheduleKind: ScheduleKind
  startTime: string
  endTime: string
  periodKey: PeriodKey
  periodIndex: number
}

const PERIOD_OPTIONS = [
  { key: 'morning' as const, label: '上午' },
  { key: 'afternoon' as const, label: '下午' },
  { key: 'evening' as const, label: '晚上' },
]

const SCHEDULE_KIND_OPTIONS = [
  { key: 'timed' as const, title: '精准时间', desc: '起止时刻' },
  { key: 'period' as const, title: '时段', desc: '上下午晚上' },
  { key: 'allday' as const, title: '全天', desc: '随时完成' },
]

type PickerSheetKind = 'date' | 'time-start' | 'time-end' | 'period'

const PICKER_MIN_YEAR = 2020
const PICKER_MAX_YEAR = 2035
const PICKER_YEARS = Array.from({ length: PICKER_MAX_YEAR - PICKER_MIN_YEAR + 1 }, (_, index) => PICKER_MIN_YEAR + index)
const PICKER_MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`)
const PICKER_HOURS = Array.from({ length: 24 }, (_, index) => `${index}`.padStart(2, '0'))
const PICKER_MINUTES = Array.from({ length: 60 }, (_, index) => `${index}`.padStart(2, '0'))

const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

const buildDayOptions = (year: number, month: number) =>
  Array.from({ length: getDaysInMonth(year, month) }, (_, index) => `${index + 1}日`)

const parseDateParts = (dateText: string) => {
  const [yearText, monthText, dayText] = dateText.split('-')

  return {
    year: Number(yearText) || new Date().getFullYear(),
    month: Number(monthText) || 1,
    day: Number(dayText) || 1,
  }
}

const formatDateParts = (year: number, month: number, day: number) => {
  const safeDay = Math.min(day, getDaysInMonth(year, month))

  return `${year}-${`${month}`.padStart(2, '0')}-${`${safeDay}`.padStart(2, '0')}`
}

const parseTimeParts = (timeText: string) => {
  const [hourText, minuteText] = timeText.split(':')

  return {
    hour: Number(hourText) || 0,
    minute: Number(minuteText) || 0,
  }
}

const formatTimeParts = (hour: number, minute: number) =>
  `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`

const clampPickerYear = (year: number) => Math.min(PICKER_MAX_YEAR, Math.max(PICKER_MIN_YEAR, year))

const isTimedPlan = (plan: Plan) => Boolean(plan.startTime && plan.endTime)

const getScheduleKind = (plan: Plan): ScheduleKind => {
  if (isTimedPlan(plan)) {
    return 'timed'
  }

  if (getPeriodKey(plan)) {
    return 'period'
  }

  return 'allday'
}

const getPeriodIndex = (periodKey: 'morning' | 'afternoon' | 'evening') =>
  Math.max(0, PERIOD_OPTIONS.findIndex((item) => item.key === periodKey))

const buildEditPlanForm = (raw: Plan, fallbackDate: string): EditPlanForm => {
  const periodKey = getPeriodKey(raw) || 'morning'

  return {
    ownerKey: raw.ownerKey,
    tag: raw.tag,
    remark: raw.remark || '',
    date: raw.date || fallbackDate,
    scheduleKind: getScheduleKind(raw),
    startTime: raw.startTime || '09:00',
    endTime: raw.endTime || '10:00',
    periodKey,
    periodIndex: getPeriodIndex(periodKey),
  }
}

const createDefaultEditPlanForm = (date: string): EditPlanForm => ({
  ownerKey: 'me' as OwnerKey,
  tag: DEFAULT_PLAN_TAGS[0],
  remark: '',
  date,
  scheduleKind: 'timed' as ScheduleKind,
  startTime: '09:00',
  endTime: '10:00',
  periodKey: 'morning' as const,
  periodIndex: 0,
})

const toDayPlanView = (
  plan: Plan,
  selectedDate: string,
  periodKey: 'morning' | 'afternoon' | 'evening' | null = null,
): DayPlanView => ({
  id: plan.id,
  time: plan.startTime && plan.endTime ? `${plan.startTime}-${plan.endTime}` : plan.timeText === '今天' ? '' : plan.timeText || '',
  owner: plan.ownerName,
  ownerAvatarUrl: getOwnerAvatarUrl(plan.ownerKey),
  title: plan.title,
  tag: plan.tag,
  remark: plan.remark || null,
  status: statusTextMap[plan.status],
  color: plan.color,
  isExpired: isPlanExpired(plan, selectedDate, periodKey),
})

const toTimedPlanView = (plan: Plan, selectedDate: string): TimedPlanView => ({
  ...toDayPlanView(plan, selectedDate),
  top: 0,
  height: 0,
  lane: 0,
  laneCount: 1,
  leftPercent: 0,
  widthPercent: 100,
})

const estimateRemarkLines = (remark: string, widthPercent: number) => {
  const cardWidth = Math.max(60, TIMED_COLUMN_BASE_WIDTH * (widthPercent / 100) - 6)
  const charsPerLine = Math.max(3, Math.floor(cardWidth / 17))

  return remark.split('\n').reduce((total, line) => {
    const trimmed = line.trim()

    if (!trimmed) {
      return total + 1
    }

    return total + Math.ceil(trimmed.length / charsPerLine)
  }, 0)
}

const estimateTimedCardContentHeight = (plan: TimedPlanView) => {
  let height = TIMED_CARD_PADDING + TIMED_TIME_ROW + TIMED_TITLE_ROW

  if (plan.remark) {
    height += TIMED_REMARK_GAP + estimateRemarkLines(plan.remark, plan.widthPercent) * TIMED_REMARK_LINE_HEIGHT
  }

  return Math.ceil(height) + 6
}

const collectTimeBreakpoints = (rawPlans: Plan[]) => {
  const points = new Set<number>()
  points.add(TIMELINE_START * 60)
  points.add(TIMELINE_END * 60)

  for (let hour = TIMELINE_START; hour <= TIMELINE_END; hour += 2) {
    points.add(hour * 60)
  }

  rawPlans.forEach((plan) => {
    if (plan.startTime && plan.endTime) {
      points.add(parseTimeToMinutes(plan.startTime))
      points.add(parseTimeToMinutes(plan.endTime, true))
    }
  })

  return [...points].sort((a, b) => a - b)
}

const sumSegmentHeights = (segments: TimeSegment[], startMin: number, endMin: number) =>
  segments.reduce((sum, segment) => {
    if (segment.endMin <= startMin || segment.startMin >= endMin) {
      return sum
    }

    return sum + segment.height
  }, 0)

const buildAdaptiveTimeScale = (timedPlans: TimedPlanView[], rawPlans: Plan[]) => {
  const breakpoints = collectTimeBreakpoints(rawPlans)
  const segments: TimeSegment[] = []

  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const startMin = breakpoints[index]
    const endMin = breakpoints[index + 1]
    const duration = endMin - startMin
    const baseHeight = (duration / 60) * HOUR_HEIGHT

    segments.push({
      startMin,
      endMin,
      baseHeight,
      height: baseHeight,
    })
  }

  timedPlans.forEach((plan) => {
    const raw = rawPlans.find((item) => item.id === plan.id)

    if (!raw?.startTime || !raw.endTime) {
      return
    }

    const startMin = parseTimeToMinutes(raw.startTime)
    const endMin = parseTimeToMinutes(raw.endTime, true)
    const baseTotal = sumSegmentHeights(segments, startMin, endMin)
    const contentHeight = estimateTimedCardContentHeight(plan)

    if (contentHeight <= baseTotal || baseTotal <= 0) {
      return
    }

    const factor = contentHeight / baseTotal

    segments.forEach((segment) => {
      if (segment.endMin <= startMin || segment.startMin >= endMin) {
        return
      }

      segment.height = Math.max(segment.height, segment.baseHeight * factor)
    })
  })

  const breakpointY = new Map<number, number>()
  let y = 0
  breakpointY.set(breakpoints[0], 0)

  segments.forEach((segment, index) => {
    y += segment.height
    breakpointY.set(breakpoints[index + 1], y)
  })

  const minutesToY: MinutesToY = (minutes) => {
    const clamped = Math.max(TIMELINE_START * 60, Math.min(TIMELINE_END * 60, minutes))

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]

      if (clamped < segment.startMin || clamped > segment.endMin) {
        continue
      }

      const segmentStartY = breakpointY.get(segment.startMin) || 0
      const duration = segment.endMin - segment.startMin

      if (duration <= 0) {
        return segmentStartY
      }

      const ratio = (clamped - segment.startMin) / duration
      return segmentStartY + ratio * segment.height
    }

    return y
  }

  return {
    minutesToY,
    totalHeight: y,
  }
}

const applyTimeScaleToTimedPlans = (plans: TimedPlanView[], rawPlans: Plan[], minutesToY: MinutesToY) => {
  plans.forEach((plan) => {
    const raw = rawPlans.find((item) => item.id === plan.id)

    if (!raw?.startTime || !raw.endTime) {
      return
    }

    const startMin = parseTimeToMinutes(raw.startTime)
    const endMin = Math.min(parseTimeToMinutes(raw.endTime, true), TIMELINE_END * 60)
    const top = minutesToY(startMin)
    const bottom = minutesToY(endMin)

    plan.top = top
    plan.height = Math.max(1, bottom - top)
  })
}

const intervalsOverlapForLayout = (a: TimedInterval, b: TimedInterval) =>
  a.ownerKey !== b.ownerKey && a.start < b.end && b.start < a.end

const buildOverlapClusters = (intervals: TimedInterval[]) => {
  const visited = new Set<string>()
  const clusters: TimedInterval[][] = []

  intervals.forEach((interval) => {
    if (visited.has(interval.plan.id)) {
      return
    }

    const cluster: TimedInterval[] = []
    const queue = [interval]
    visited.add(interval.plan.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      cluster.push(current)

      intervals.forEach((other) => {
        if (!visited.has(other.plan.id) && intervalsOverlapForLayout(current, other)) {
          visited.add(other.plan.id)
          queue.push(other)
        }
      })
    }

    clusters.push(cluster)
  })

  return clusters
}

const layoutOverlapCluster = (cluster: TimedInterval[]) => {
  if (cluster.length <= 1) {
    cluster.forEach(({ plan }) => {
      plan.lane = 0
      plan.laneCount = 1
      plan.widthPercent = TIMED_SINGLE_WIDTH_PERCENT
      plan.leftPercent = (100 - TIMED_SINGLE_WIDTH_PERCENT) / 2
    })
    return
  }

  const sorted = [...cluster].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const laneEnds: number[] = []
  const laneById = new Map<string, number>()

  sorted.forEach(({ plan, start, end }) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)

    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }

    laneById.set(plan.id, lane)
  })

  const laneCount = Math.max(laneEnds.length, 1)
  const widthPercent = (100 - TIMED_LANE_GAP * (laneCount - 1)) / laneCount

  sorted.forEach(({ plan }) => {
    const lane = laneById.get(plan.id) || 0

    plan.lane = lane
    plan.laneCount = laneCount
    plan.widthPercent = widthPercent
    plan.leftPercent = lane * (widthPercent + TIMED_LANE_GAP)
  })
}

const layoutTimedPlans = (plans: TimedPlanView[], rawPlans: Plan[]) => {
  const intervals: TimedInterval[] = plans.map((plan) => {
    const raw = rawPlans.find((item) => item.id === plan.id)!

    return {
      plan,
      start: parseTimeToMinutes(raw.startTime!),
      end: parseTimeToMinutes(raw.endTime!, true),
      ownerKey: raw.ownerKey,
    }
  })

  intervals.forEach(({ plan }) => {
    plan.lane = 0
    plan.laneCount = 1
    plan.widthPercent = 100
    plan.leftPercent = 0
  })

  buildOverlapClusters(intervals).forEach(layoutOverlapCluster)
  return plans
}

const calcPeriodContentHeight = (count: number) => {
  if (count === 0) {
    return 0
  }

  return PERIOD_ZONE_PADDING * 2
    + PERIOD_LABEL_HEIGHT
    + count * PERIOD_CARD_HEIGHT
    + (count - 1) * PERIOD_CARD_GAP
}

const buildPeriodZones = (
  morningCount: number,
  afternoonCount: number,
  eveningCount: number,
  minutesToY: MinutesToY,
) => {
  const morningBaseHeight = minutesToY(12 * 60) - minutesToY(6 * 60)
  const afternoonBaseHeight = minutesToY(18 * 60) - minutesToY(12 * 60)
  const eveningBaseHeight = minutesToY(24 * 60) - minutesToY(18 * 60)

  const morningZone: PeriodZone = {
    top: minutesToY(6 * 60),
    height: Math.max(morningBaseHeight, calcPeriodContentHeight(morningCount)),
  }

  const afternoonZone: PeriodZone = {
    top: Math.max(minutesToY(12 * 60), morningZone.top + morningZone.height),
    height: Math.max(afternoonBaseHeight, calcPeriodContentHeight(afternoonCount)),
  }

  const eveningZone: PeriodZone = {
    top: Math.max(minutesToY(18 * 60), afternoonZone.top + afternoonZone.height),
    height: Math.max(eveningBaseHeight, calcPeriodContentHeight(eveningCount)),
  }

  return { morningZone, afternoonZone, eveningZone }
}

const buildTimelineMarkers = (minutesToY: MinutesToY): TimelineMarker[] => {
  const markers: TimelineMarker[] = []

  for (let hour = TIMELINE_START; hour <= TIMELINE_END; hour += 2) {
    markers.push({
      label: `${`${hour}`.padStart(2, '0')}:00`,
      top: minutesToY(hour * 60),
    })
  }

  return markers
}

const buildNowCursorWithScale = (selectedDate: string, minutesToY: MinutesToY): NowCursor => {
  if (!isViewingToday(selectedDate)) {
    return { visible: false, top: 0, label: '' }
  }

  const now = new Date()
  const nowMinutes = getNowMinutes()

  if (nowMinutes < TIMELINE_START * 60 || nowMinutes >= TIMELINE_END * 60) {
    return { visible: false, top: 0, label: '' }
  }

  const hour = now.getHours()
  const minute = now.getMinutes()

  return {
    visible: true,
    top: minutesToY(nowMinutes),
    label: `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`,
  }
}

const buildBoardHeight = (timedPlans: TimedPlanView[], eveningZone: PeriodZone, minutesToY: MinutesToY) => {
  const timelineHeight = minutesToY(TIMELINE_END * 60)
  const periodHeight = eveningZone.top + eveningZone.height
  const timedBottom = timedPlans.reduce((max, plan) => Math.max(max, plan.top + plan.height), 0)

  return Math.max(timelineHeight, periodHeight, timedBottom)
}

Component({
  data: {
    safeTopPx: 0,
    dateTitle: formatDateTitle(getToday()),
    selectedDate: getToday(),
    filters: getOwnerFilterStateLocal('all').filters,
    activeFilter: getOwnerFilterStateLocal('all').activeFilter,
    singleUserMode: getOwnerFilterStateLocal('all').singleUserMode,
    boardHeight: timeTop(TIMELINE_END),
    morningZone: { top: timeTop(6), height: timeTop(12) - timeTop(6) } as PeriodZone,
    afternoonZone: { top: timeTop(12), height: timeTop(18) - timeTop(12) } as PeriodZone,
    eveningZone: { top: timeTop(18), height: timeTop(24) - timeTop(18) } as PeriodZone,
    timelineMarkers: buildTimelineMarkers(linearMinutesToY),
    timedPlans: [] as TimedPlanView[],
    morningPlans: [] as DayPlanView[],
    afternoonPlans: [] as DayPlanView[],
    eveningPlans: [] as DayPlanView[],
    allDayPlans: [] as DayPlanView[],
    isPlanActionVisible: false,
    isPlanActionClosing: false,
    isPlanEditVisible: false,
    activePlan: null as DayPlanView | null,
    editPlanForm: createDefaultEditPlanForm(getToday()),
    scheduleKindOptions: SCHEDULE_KIND_OPTIONS,
    periodOptions: PERIOD_OPTIONS,
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
    quickTags: getPlanTagOptions(),
    isTagCreateVisible: false,
    showPlanTagScrollFadeLeft: false,
    showPlanTagScrollFadeRight: false,
    nowCursor: { visible: false, top: 0, label: '' } as NowCursor,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      this.refreshPlans()
      this.startNowCursorTimer()
    },
    detached() {
      this.clearNowCursorTimer()
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => {
        this.refreshPlans()
        this.startNowCursorTimer()
      })
    },
    hide() {
      this.clearNowCursorTimer()
    },
  },
  methods: {
    initPageInsets() {
      const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
      const gapPx = Math.round((16 * windowWidth) / 750)
      this.setData({ safeTopPx: statusBarHeight + gapPx })
    },
    goBack() {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({ url: '/pages/calendar/calendar' })
        },
      })
    },
    onLoad(query: { date?: string }) {
      this.initPageInsets()
      const selectedDate = query.date || getToday()
      this.setData({
        selectedDate,
        dateTitle: formatDateTitle(selectedDate),
      })
      this.refreshPlans()
    },
    async refreshOwnerFilters() {
      const prevFilter = this.data.activeFilter
      const state = await getOwnerFilterState(prevFilter)
      this.setData({
        filters: state.filters,
        activeFilter: state.activeFilter,
        singleUserMode: state.singleUserMode,
      })

      if (state.activeFilter !== prevFilter) {
        this.refreshPlans()
      }
    },
    refreshPlans() {
      const { selectedDate } = this.data
      const plans = filterPlans(getPlansByDate(selectedDate), this.data.activeFilter)
      const activePlans = plans.filter((plan) => plan.status !== 'completed')

      const timedRaw = activePlans.filter(isTimedPlan)
      const timedPlans = layoutTimedPlans(
        timedRaw.map((plan) => toTimedPlanView(plan, selectedDate)),
        timedRaw,
      )
      const { minutesToY } = buildAdaptiveTimeScale(timedPlans, timedRaw)
      applyTimeScaleToTimedPlans(timedPlans, timedRaw, minutesToY)

      const periodPlans = activePlans.filter((plan) => !isTimedPlan(plan) && getPeriodKey(plan))
      const allDayPlans = activePlans.filter((plan) => !isTimedPlan(plan) && !getPeriodKey(plan))

      const morningPlans = periodPlans.filter((plan) => getPeriodKey(plan) === 'morning').map((plan) => toDayPlanView(plan, selectedDate, 'morning'))
      const afternoonPlans = periodPlans.filter((plan) => getPeriodKey(plan) === 'afternoon').map((plan) => toDayPlanView(plan, selectedDate, 'afternoon'))
      const eveningPlans = periodPlans.filter((plan) => getPeriodKey(plan) === 'evening').map((plan) => toDayPlanView(plan, selectedDate, 'evening'))

      const { morningZone, afternoonZone, eveningZone } = buildPeriodZones(
        morningPlans.length,
        afternoonPlans.length,
        eveningPlans.length,
        minutesToY,
      )

      this.setData({
        dateTitle: formatDateTitle(selectedDate),
        timedPlans,
        morningPlans,
        afternoonPlans,
        eveningPlans,
        allDayPlans: allDayPlans.map((plan) => toDayPlanView(plan, selectedDate)),
        morningZone,
        afternoonZone,
        eveningZone,
        timelineMarkers: buildTimelineMarkers(minutesToY),
        boardHeight: buildBoardHeight(timedPlans, eveningZone, minutesToY),
        nowCursor: buildNowCursorWithScale(selectedDate, minutesToY),
      })

      void this.refreshOwnerFilters()
    },
    startNowCursorTimer() {
      this.clearNowCursorTimer()
      this.refreshPlans()

      ;(this as WechatMiniprogram.Component.TrivialInstance & { _nowCursorTimer?: ReturnType<typeof setInterval> })._nowCursorTimer = setInterval(() => {
        this.refreshPlans()
      }, 60 * 1000)
    },
    clearNowCursorTimer() {
      const timer = (this as WechatMiniprogram.Component.TrivialInstance & { _nowCursorTimer?: ReturnType<typeof setInterval> })._nowCursorTimer

      if (timer) {
        clearInterval(timer)
        ;(this as WechatMiniprogram.Component.TrivialInstance & { _nowCursorTimer?: ReturnType<typeof setInterval> })._nowCursorTimer = undefined
      }
    },
    setFilter(e: WechatMiniprogram.BaseEvent) {
      const filter = e.currentTarget.dataset.filter
      this.setData({ activeFilter: filter })
      this.refreshPlans()
    },
    goFocus() {
      wx.navigateTo({
        url: '/pages/focus/focus',
      })
    },
    findActivePlan(id: string) {
      const allPlans = [
        ...this.data.timedPlans,
        ...this.data.morningPlans,
        ...this.data.afternoonPlans,
        ...this.data.eveningPlans,
        ...this.data.allDayPlans,
      ]

      return allPlans.find((plan) => plan.id === id) || null
    },
    onPlanTap(e: WechatMiniprogram.BaseEvent) {
      const { id } = e.currentTarget.dataset
      const plan = this.findActivePlan(id)

      if (!plan) {
        return
      }

      openModal(this, 'isPlanActionVisible', 'isPlanActionClosing', {
        activePlan: plan,
      })
    },
    closePlanAction() {
      const extraData: Record<string, unknown> = {
        isPlanEditVisible: false,
        activePlan: null,
      }

      if (this.data.isPickerSheetVisible) {
        extraData.isPickerSheetVisible = false
        extraData.isPickerSheetClosing = false
      }

      dismissModal(this, 'isPlanActionVisible', 'isPlanActionClosing', {
        extraData,
      })
    },
    openPlanEdit() {
      const { activePlan } = this.data

      if (!activePlan) {
        return
      }

      const raw = getPlanById(activePlan.id)

      if (!raw) {
        wx.showToast({
          title: '计划不存在',
          icon: 'none',
        })
        return
      }

      this.setData({
        isPlanEditVisible: true,
        editPlanForm: buildEditPlanForm(raw, this.data.selectedDate),
        quickTags: getPlanTagOptions(),
      })
      this.updatePlanTagScrollFades()
    },
    closePlanEdit() {
      this.setData({
        isPlanEditVisible: false,
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
      this.setData({
        'editPlanForm.tag': e.currentTarget.dataset.tag,
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
      this.updatePlanTagScrollFades()
    },
    onEditPlanInput(e: WechatMiniprogram.Input) {
      const field = e.currentTarget.dataset.field
      this.setData({
        [`editPlanForm.${field}`]: e.detail.value,
      })
    },
    savePlanEdit() {
      const { activePlan, editPlanForm: plan } = this.data

      if (!activePlan) {
        return
      }

      const raw = getPlanById(activePlan.id)

      if (!raw) {
        wx.showToast({
          title: '计划不存在',
          icon: 'none',
        })
        return
      }

      let startTime = ''
      let endTime = ''
      let timeText = '今天'

      if (plan.scheduleKind === 'timed') {
        startTime = plan.startTime
        endTime = plan.endTime
        timeText = ''
      } else if (plan.scheduleKind === 'period') {
        timeText = PERIOD_OPTIONS.find((item) => item.key === plan.periodKey)?.label || '上午'
      }

      const result = updatePlan(activePlan.id, {
        ownerKey: plan.ownerKey,
        title: plan.tag,
        tag: plan.tag,
        remark: plan.remark.trim(),
        date: plan.date,
        startTime,
        endTime,
        timeText,
        estimatedMinutes: raw.estimatedMinutes,
      })

      if (!result.ok) {
        wx.showToast({
          title: result.message,
          icon: 'none',
        })
        return
      }

      this.closePlanAction()
      this.refreshPlans()
      wx.showToast({
        title: '已保存',
        icon: 'success',
      })
    },
    noop() {
      // Prevent modal content taps from closing the overlay.
    },
    startPlanFocus() {
      const { activePlan } = this.data
      this.closePlanAction()

      wx.navigateTo({
        url: activePlan ? `/pages/focus/focus?planId=${activePlan.id}` : '/pages/focus/focus',
      })
    },
    completeActivePlan() {
      const { activePlan } = this.data

      if (!activePlan) {
        return
      }

      const id = activePlan.id
      this.closePlanAction()
      this.confirmCompletePlan(id)
    },
    deleteActivePlan() {
      const { activePlan } = this.data

      if (!activePlan) {
        return
      }

      const id = activePlan.id
      this.closePlanAction()
      this.confirmDeletePlan(id)
    },
    confirmCompletePlan(id: string) {
      wx.showModal({
        title: '标记完成',
        content: '确认后计划会打勾，并写入已完成表。',
        confirmText: '确认',
        success: (res) => {
          if (!res.confirm) {
            return
          }

          completePlan(id)
          this.refreshPlans()
          wx.showToast({
            title: '已完成',
            icon: 'success',
          })
        },
      })
    },
    confirmDeletePlan(id: string) {
      wx.showModal({
        title: '删除计划',
        content: '删除后这条计划会从计划表移除，不会进入已完成表。',
        confirmText: '删除',
        confirmColor: '#D96565',
        success: (res) => {
          if (!res.confirm) {
            return
          }

          deletePlan(id)
          this.refreshPlans()
          wx.showToast({
            title: '已删除',
            icon: 'none',
          })
        },
      })
    },
  },
})
