import {
  formatDate,
  getCompletedRecords,
  getOwnerAvatarUrl,
  getPlanById,
  getToday,
  type CompletedRecord,
  type OwnerKey,
} from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getOwnerFilterState, getOwnerFilterStateLocal } from '../../utils/owner-filters'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'

interface TimelineMarker {
  label: string
  top: number
}

interface NowCursor {
  visible: boolean
  top: number
  label: string
}

interface CompletedRecordView {
  id: string
  tag: string
  detail: string
  time: string
  status: string
  ownerAvatarUrl: string
  color: 'green' | 'blue' | 'gray'
  top: number
  height: number
  lane: number
  laneCount: number
  leftPercent: number
  widthPercent: number
}

interface TimedInterval {
  record: CompletedRecordView
  start: number
  end: number
  ownerKey: OwnerKey
}

type MinutesToY = (minutes: number) => number

const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const MORNING_START_MINUTES = 0
const MORNING_END_MINUTES = 12 * 60
const AFTERNOON_START_MINUTES = 12 * 60
const AFTERNOON_END_MINUTES = 24 * 60
const HOUR_HEIGHT = 88
const MIN_CARD_HEIGHT = 96
const TIMED_LANE_GAP = 2
const TIMED_SINGLE_WIDTH_PERCENT = 88

const padTime = (value: number) => `${value}`.padStart(2, '0')

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

const formatMinutesLabel = (minutes: number) => {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${padTime(hour)}:${padTime(minute)}`
}

const formatTimeRange = (startMin: number, endMin: number) =>
  `${formatMinutesLabel(startMin)}-${formatMinutesLabel(endMin)}`

const getNowMinutes = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

const isViewingToday = (selectedDate: string) => selectedDate === getToday()

const buildHalfMinutesToY = (halfStart: number): MinutesToY =>
  (minutes) => ((minutes - halfStart) / 60) * HOUR_HEIGHT

const buildHalfBoardHeight = (halfStart: number, halfEnd: number) =>
  ((halfEnd - halfStart) / 60) * HOUR_HEIGHT

const buildHalfMarkers = (halfStart: number, halfEnd: number, minutesToY: MinutesToY): TimelineMarker[] => {
  const markers: TimelineMarker[] = []
  const startHour = Math.ceil(halfStart / 60)
  const endHour = Math.floor(halfEnd / 60)

  for (let hour = startHour; hour <= endHour; hour += 2) {
    markers.push({
      label: `${padTime(hour)}:00`,
      top: minutesToY(hour * 60),
    })
  }

  return markers
}

const buildHalfNowCursor = (
  selectedDate: string,
  halfStart: number,
  halfEnd: number,
  minutesToY: MinutesToY,
): NowCursor => {
  if (!isViewingToday(selectedDate)) {
    return { visible: false, top: 0, label: '' }
  }

  const nowMinutes = getNowMinutes()

  if (nowMinutes < halfStart || nowMinutes >= halfEnd) {
    return { visible: false, top: 0, label: '' }
  }

  const now = new Date()
  return {
    visible: true,
    top: minutesToY(nowMinutes),
    label: `${padTime(now.getHours())}:${padTime(now.getMinutes())}`,
  }
}

const filterRecords = (records: CompletedRecord[], filter: string) => {
  let filtered = records.filter((record) => record.completionMode === 'timed')

  if (filter === 'me' || filter === 'partner') {
    filtered = filtered.filter((record) => record.ownerKey === filter)
  }

  return filtered
}

const getRecordInterval = (record: CompletedRecord, selectedDate: string) => {
  if (record.startedAt) {
    const startDate = new Date(record.startedAt)
    const endDate = new Date(record.completedAt)
    let endMin = endDate.getHours() * 60 + endDate.getMinutes()

    if (endDate.getDate() !== startDate.getDate() || (endMin === 0 && endDate > startDate)) {
      endMin = AFTERNOON_END_MINUTES
    }

    return {
      startMin: startDate.getHours() * 60 + startDate.getMinutes(),
      endMin: Math.max(endMin, startDate.getHours() * 60 + startDate.getMinutes() + 15),
    }
  }

  const plan = getPlanById(record.planId)

  if (plan?.startTime && plan.endTime) {
    return {
      startMin: parseTimeToMinutes(plan.startTime),
      endMin: parseTimeToMinutes(plan.endTime, true),
    }
  }

  const completedDate = new Date(record.completedAt)
  const completedMin = completedDate.getHours() * 60 + completedDate.getMinutes()
  const duration = Math.max(record.actualMinutes || 30, 15)

  return {
    startMin: Math.max(MORNING_START_MINUTES, completedMin - duration),
    endMin: Math.min(AFTERNOON_END_MINUTES, completedMin),
  }
}

const clipIntervalToHalf = (
  startMin: number,
  endMin: number,
  halfStart: number,
  halfEnd: number,
) => {
  const clippedStart = Math.max(startMin, halfStart)
  const clippedEnd = Math.min(endMin, halfEnd)

  if (clippedEnd <= clippedStart) {
    return null
  }

  return {
    startMin: clippedStart,
    endMin: clippedEnd,
  }
}

const toRecordView = (
  record: CompletedRecord,
  startMin: number,
  endMin: number,
): CompletedRecordView => ({
  id: record.id,
  tag: record.tag,
  detail: record.detail,
  time: formatTimeRange(startMin, endMin),
  status: '已完成',
  ownerAvatarUrl: getOwnerAvatarUrl(record.ownerKey),
  color: record.wasOverdue ? 'gray' : record.ownerKey === 'partner' ? 'blue' : 'green',
  top: 0,
  height: MIN_CARD_HEIGHT,
  lane: 0,
  laneCount: 1,
  leftPercent: 0,
  widthPercent: 100,
})

const intervalsOverlapForLayout = (a: TimedInterval, b: TimedInterval) =>
  a.ownerKey !== b.ownerKey && a.start < b.end && b.start < a.end

const buildOverlapClusters = (intervals: TimedInterval[]) => {
  const visited = new Set<string>()
  const clusters: TimedInterval[][] = []

  intervals.forEach((interval) => {
    if (visited.has(interval.record.id)) {
      return
    }

    const cluster: TimedInterval[] = []
    const queue = [interval]
    visited.add(interval.record.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      cluster.push(current)

      intervals.forEach((other) => {
        if (!visited.has(other.record.id) && intervalsOverlapForLayout(current, other)) {
          visited.add(other.record.id)
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
    cluster.forEach(({ record }) => {
      record.lane = 0
      record.laneCount = 1
      record.widthPercent = TIMED_SINGLE_WIDTH_PERCENT
      record.leftPercent = (100 - TIMED_SINGLE_WIDTH_PERCENT) / 2
    })
    return
  }

  const sorted = [...cluster].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const laneEnds: number[] = []
  const laneById = new Map<string, number>()

  sorted.forEach(({ record, start, end }) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)

    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }

    laneById.set(record.id, lane)
  })

  const laneCount = Math.max(laneEnds.length, 1)
  const widthPercent = (100 - TIMED_LANE_GAP * (laneCount - 1)) / laneCount

  sorted.forEach(({ record }) => {
    const lane = laneById.get(record.id) || 0

    record.lane = lane
    record.laneCount = laneCount
    record.widthPercent = widthPercent
    record.leftPercent = lane * (widthPercent + TIMED_LANE_GAP)
  })
}

const layoutHalfRecords = (
  records: CompletedRecord[],
  selectedDate: string,
  halfStart: number,
  halfEnd: number,
  minutesToY: MinutesToY,
) => {
  const views: CompletedRecordView[] = []
  const intervals: TimedInterval[] = []

  records.forEach((record) => {
    const interval = getRecordInterval(record, selectedDate)
    const clipped = clipIntervalToHalf(interval.startMin, interval.endMin, halfStart, halfEnd)

    if (!clipped) {
      return
    }

    const view = toRecordView(record, clipped.startMin, clipped.endMin)
    const top = minutesToY(clipped.startMin)
    const bottom = minutesToY(clipped.endMin)

    view.top = top
    view.height = Math.max(MIN_CARD_HEIGHT, bottom - top)
    views.push(view)
    intervals.push({
      record: view,
      start: clipped.startMin,
      end: clipped.endMin,
      ownerKey: record.ownerKey,
    })
  })

  buildOverlapClusters(intervals).forEach(layoutOverlapCluster)
  return views
}

const buildHalfBoard = (
  records: CompletedRecord[],
  selectedDate: string,
  halfStart: number,
  halfEnd: number,
) => {
  const minutesToY = buildHalfMinutesToY(halfStart)
  const boardHeight = buildHalfBoardHeight(halfStart, halfEnd)

  return {
    boardHeight,
    timelineMarkers: buildHalfMarkers(halfStart, halfEnd, minutesToY),
    records: layoutHalfRecords(records, selectedDate, halfStart, halfEnd, minutesToY),
    nowCursor: buildHalfNowCursor(selectedDate, halfStart, halfEnd, minutesToY),
  }
}

Component({
  nowTimer: 0 as number,
  data: {
    safeTopPx: 0,
    dateTitle: formatDateTitle(getToday()),
    selectedDate: getToday(),
    filters: getOwnerFilterStateLocal('all').filters,
    activeFilter: getOwnerFilterStateLocal('all').activeFilter,
    singleUserMode: getOwnerFilterStateLocal('all').singleUserMode,
    morningBoardHeight: buildHalfBoardHeight(MORNING_START_MINUTES, MORNING_END_MINUTES),
    afternoonBoardHeight: buildHalfBoardHeight(AFTERNOON_START_MINUTES, AFTERNOON_END_MINUTES),
    morningTimelineMarkers: [] as TimelineMarker[],
    afternoonTimelineMarkers: [] as TimelineMarker[],
    morningRecords: [] as CompletedRecordView[],
    afternoonRecords: [] as CompletedRecordView[],
    morningNowCursor: { visible: false, top: 0, label: '' } as NowCursor,
    afternoonNowCursor: { visible: false, top: 0, label: '' } as NowCursor,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      this.initPageInsets()
      this.refreshRecords()
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
        this.refreshRecords()
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
    onLoad(query: { date?: string; filter?: string }) {
      const selectedDate = query.date || getToday()
      const activeFilter = query.filter || 'all'

      this.setData({
        selectedDate,
        activeFilter,
        dateTitle: formatDateTitle(selectedDate),
      })
      this.refreshRecords()
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
        this.refreshRecords()
      }
    },
    refreshRecords() {
      const { selectedDate, activeFilter } = this.data
      const dayRecords = filterRecords(
        getCompletedRecords().filter((record) => formatDate(new Date(record.completedAt)) === selectedDate),
        activeFilter,
      )

      const morningBoard = buildHalfBoard(dayRecords, selectedDate, MORNING_START_MINUTES, MORNING_END_MINUTES)
      const afternoonBoard = buildHalfBoard(dayRecords, selectedDate, AFTERNOON_START_MINUTES, AFTERNOON_END_MINUTES)

      this.setData({
        morningBoardHeight: morningBoard.boardHeight,
        afternoonBoardHeight: afternoonBoard.boardHeight,
        morningTimelineMarkers: morningBoard.timelineMarkers,
        afternoonTimelineMarkers: afternoonBoard.timelineMarkers,
        morningRecords: morningBoard.records,
        afternoonRecords: afternoonBoard.records,
        morningNowCursor: morningBoard.nowCursor,
        afternoonNowCursor: afternoonBoard.nowCursor,
      })

      void this.refreshOwnerFilters()
    },
    setFilter(e: WechatMiniprogram.BaseEvent) {
      const filter = e.currentTarget.dataset.filter as string | undefined

      if (!filter || filter === this.data.activeFilter) {
        return
      }

      this.setData({ activeFilter: filter })
      this.refreshRecords()
    },
    goBack() {
      wx.navigateBack({
        fail: () => {
          wx.setStorageSync('calendar_view_mode', 'completed')
          wx.switchTab({ url: '/pages/calendar/calendar' })
        },
      })
    },
    startNowCursorTimer() {
      this.clearNowCursorTimer()

      if (!isViewingToday(this.data.selectedDate)) {
        return
      }

      this.nowTimer = setInterval(() => {
        this.refreshRecords()
      }, 60000) as unknown as number
    },
    clearNowCursorTimer() {
      if (this.nowTimer) {
        clearInterval(this.nowTimer)
        this.nowTimer = 0
      }
    },
  },
})
