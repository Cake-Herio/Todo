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
import {
  applyTimelineBoardUpdate,
  getCompletedDayBoardTopOffsetRpx,
} from '../../utils/timeline-scroll'

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
  ownerKey: OwnerKey
  startMin: number
  endMin: number
  ownerAvatarUrl: string
  color: 'green' | 'blue' | 'gray'
  top: number
  height: number
  lane: number
  laneCount: number
  leftPercent: number
  widthPercent: number
  isCompact: boolean
}

type MinutesToY = (minutes: number) => number

const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const DAY_START_MINUTES = 0
const DAY_END_MINUTES = 24 * 60
const HOUR_HEIGHT = 88
const MIN_CARD_HEIGHT = 92
const COMPACT_CARD_HEIGHT = 84
const MIN_CARD_WITH_DETAIL_HEIGHT = 112
const COMPACT_CARD_WITH_DETAIL_HEIGHT = 106
const BOARD_BOTTOM_PADDING = 24
const MAX_HOUR_HEIGHT_SCALE = 4
const TIMED_LANE_GAP = 2
const TIMED_SINGLE_WIDTH_PERCENT = 75
const CARD_STACK_GAP = 8
const STRETCH_CLUSTER_GAP_MIN = 90
const STRETCH_WINDOW_PAD_MIN = 20
const STRETCH_BLOCK_MIN = 120

interface TimelineSegment {
  startMin: number
  endMin: number
  hourHeight: number
  stretch: boolean
}
const OWNER_COLUMN_MAP: Record<OwnerKey, number> = {
  me: 0,
  partner: 1,
}

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

const buildMinutesToY = (rangeStart: number, hourHeight = HOUR_HEIGHT): MinutesToY =>
  (minutes) => ((minutes - rangeStart) / 60) * hourHeight

const buildSegmentOffsets = (segments: TimelineSegment[]) => {
  let offsetY = 0

  return segments.map((segment) => {
    const item = {
      ...segment,
      offsetY,
    }
    offsetY += ((segment.endMin - segment.startMin) / 60) * segment.hourHeight
    return item
  })
}

const buildPiecewiseMinutesToY = (segments: TimelineSegment[]): MinutesToY => {
  const withOffsets = buildSegmentOffsets(segments)

  return (minutes) => {
    if (withOffsets.length === 0) {
      return 0
    }

    if (minutes <= withOffsets[0].startMin) {
      return 0
    }

    const segment =
      withOffsets.find((item) => minutes >= item.startMin && minutes < item.endMin) ||
      withOffsets[withOffsets.length - 1]

    return segment.offsetY + ((minutes - segment.startMin) / 60) * segment.hourHeight
  }
}

const buildPiecewiseBoardHeight = (segments: TimelineSegment[]) =>
  segments.reduce(
    (sum, segment) => sum + ((segment.endMin - segment.startMin) / 60) * segment.hourHeight,
    0,
  )

const buildBoardHeight = (rangeStart: number, rangeEnd: number, hourHeight = HOUR_HEIGHT) =>
  ((rangeEnd - rangeStart) / 60) * hourHeight

const alignStretchWindow = (startMin: number, endMin: number, rangeStart: number, rangeEnd: number) => ({
  startMin: Math.max(rangeStart, Math.floor((startMin - STRETCH_WINDOW_PAD_MIN) / STRETCH_BLOCK_MIN) * STRETCH_BLOCK_MIN),
  endMin: Math.min(rangeEnd, Math.ceil((endMin + STRETCH_WINDOW_PAD_MIN) / STRETCH_BLOCK_MIN) * STRETCH_BLOCK_MIN),
})

const mergeMinuteIntervals = (intervals: Array<{ startMin: number; endMin: number }>) => {
  if (intervals.length === 0) {
    return []
  }

  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const merged = [{ ...sorted[0] }]

  sorted.slice(1).forEach((interval) => {
    const last = merged[merged.length - 1]

    if (interval.startMin <= last.endMin + STRETCH_CLUSTER_GAP_MIN) {
      last.endMin = Math.max(last.endMin, interval.endMin)
      return
    }

    merged.push({ ...interval })
  })

  return merged
}

const mergeStretchWindows = (windows: Array<{ startMin: number; endMin: number; hourHeight: number }>) => {
  if (windows.length === 0) {
    return []
  }

  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const merged = [{ ...sorted[0] }]

  sorted.slice(1).forEach((window) => {
    const last = merged[merged.length - 1]

    if (window.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, window.endMin)
      last.hourHeight = Math.max(last.hourHeight, window.hourHeight)
      return
    }

    merged.push({ ...window })
  })

  return merged
}

const detectStretchWindows = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
) => {
  const intervals = records
    .map((record) => {
      const interval = getRecordInterval(record, selectedDate)
      return clipIntervalToRange(interval.startMin, interval.endMin, rangeStart, rangeEnd)
    })
    .filter(Boolean) as Array<{ startMin: number; endMin: number }>

  return mergeMinuteIntervals(intervals).map((cluster) => {
    const aligned = alignStretchWindow(cluster.startMin, cluster.endMin, rangeStart, rangeEnd)

    return {
      startMin: aligned.startMin,
      endMin: aligned.endMin,
      hourHeight: HOUR_HEIGHT,
    }
  })
}

const buildTimelineSegments = (
  stretchWindows: Array<{ startMin: number; endMin: number; hourHeight: number }>,
  rangeStart: number,
  rangeEnd: number,
): TimelineSegment[] => {
  const windows = mergeStretchWindows(stretchWindows)

  if (windows.length === 0) {
    return [
      {
        startMin: rangeStart,
        endMin: rangeEnd,
        hourHeight: HOUR_HEIGHT,
        stretch: false,
      },
    ]
  }

  const segments: TimelineSegment[] = []
  let cursor = rangeStart

  windows.forEach((window) => {
    if (cursor < window.startMin) {
      segments.push({
        startMin: cursor,
        endMin: window.startMin,
        hourHeight: HOUR_HEIGHT,
        stretch: false,
      })
    }

    segments.push({
      startMin: window.startMin,
      endMin: window.endMin,
      hourHeight: window.hourHeight,
      stretch: true,
    })

    cursor = window.endMin
  })

  if (cursor < rangeEnd) {
    segments.push({
      startMin: cursor,
      endMin: rangeEnd,
      hourHeight: HOUR_HEIGHT,
      stretch: false,
    })
  }

  return segments
}

const refineStretchSegments = (segments: TimelineSegment[], views: CompletedRecordView[]) => {
  let changed = false

  const nextSegments = segments.map((segment) => {
    if (!segment.stretch) {
      return segment
    }

    const viewsInSegment = views.filter(
      (view) => view.startMin >= segment.startMin && view.startMin < segment.endMin,
    )

    if (viewsInSegment.length === 0) {
      return segment
    }

    const nextHourHeight = Math.min(
      HOUR_HEIGHT * MAX_HOUR_HEIGHT_SCALE,
      Math.max(HOUR_HEIGHT, estimateMinHourHeight(viewsInSegment)),
    )

    if (Math.abs(nextHourHeight - segment.hourHeight) < 0.5) {
      return segment
    }

    changed = true

    return {
      ...segment,
      hourHeight: nextHourHeight,
    }
  })

  return {
    segments: nextSegments,
    changed,
  }
}

const buildTimelineMarkers = (
  rangeStart: number,
  rangeEnd: number,
  minutesToY: MinutesToY,
): TimelineMarker[] => {
  const markers: TimelineMarker[] = []
  const startHour = Math.ceil(rangeStart / 60)
  const endHour = Math.floor(rangeEnd / 60)

  for (let hour = startHour; hour <= endHour; hour += 2) {
    markers.push({
      label: `${padTime(hour)}:00`,
      top: minutesToY(hour * 60),
    })
  }

  return markers
}

const buildNowCursor = (
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
  minutesToY: MinutesToY,
): NowCursor => {
  if (!isViewingToday(selectedDate)) {
    return { visible: false, top: 0, label: '' }
  }

  const nowMinutes = getNowMinutes()

  if (nowMinutes < rangeStart || nowMinutes >= rangeEnd) {
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
      endMin = DAY_END_MINUTES
    }

    return {
      startMin: startDate.getHours() * 60 + startDate.getMinutes(),
      endMin,
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
  const duration = Math.max(record.actualMinutes || 30, 1)

  return {
    startMin: Math.max(DAY_START_MINUTES, completedMin - duration),
    endMin: Math.min(DAY_END_MINUTES, completedMin),
  }
}

const clipIntervalToRange = (
  startMin: number,
  endMin: number,
  rangeStart: number,
  rangeEnd: number,
) => {
  const clippedStart = Math.max(startMin, rangeStart)
  const clippedEnd = Math.min(endMin, rangeEnd)

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
  ownerKey: record.ownerKey,
  startMin,
  endMin,
  ownerAvatarUrl: getOwnerAvatarUrl(record.ownerKey),
  color: record.wasOverdue ? 'gray' : record.ownerKey === 'partner' ? 'blue' : 'green',
  top: 0,
  height: MIN_CARD_HEIGHT,
  lane: 0,
  laneCount: 1,
  leftPercent: 0,
  widthPercent: 100,
  isCompact: endMin - startMin <= 20,
})

const getBoardColumnLayout = (
  records: CompletedRecord[],
  singleUserMode: boolean,
  activeFilter: string,
) => {
  const ownerKeys = new Set(records.map((record) => record.ownerKey))
  const useDualColumns = !singleUserMode && activeFilter === 'all' && ownerKeys.size > 1

  return {
    columnCount: useDualColumns ? 2 : 1,
  }
}

const getColumnWidthPercent = (columnCount: number) =>
  columnCount === 1 ? 100 : (100 - TIMED_LANE_GAP * (columnCount - 1)) / columnCount

const estimateMinHourHeight = (views: CompletedRecordView[]) => {
  let required = HOUR_HEIGHT

  ;(['me', 'partner'] as OwnerKey[]).forEach((ownerKey) => {
    const sorted = views
      .filter((view) => view.ownerKey === ownerKey)
      .sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id))

    sorted.forEach((card, index) => {
      if (index === 0) {
        return
      }

      const prev = sorted[index - 1]
      const gapMinutes = card.startMin - prev.startMin

      if (gapMinutes <= 0) {
        return
      }

      const minHourHeight = (prev.height * 60) / gapMinutes
      required = Math.max(required, minHourHeight)
    })
  })

  return Math.min(required, HOUR_HEIGHT * MAX_HOUR_HEIGHT_SCALE)
}

const layoutOwnerColumnStack = (views: CompletedRecordView[], columnCount: number) => {
  const ownerColumnWidth = getColumnWidthPercent(columnCount)

  ;(['me', 'partner'] as OwnerKey[]).forEach((ownerKey) => {
    const ownerViews = views
      .filter((view) => view.ownerKey === ownerKey)
      .sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id))

    if (ownerViews.length === 0) {
      return
    }

    const ownerColumnLeft = columnCount === 1 ? 0 : (OWNER_COLUMN_MAP[ownerKey] ?? 0) * (ownerColumnWidth + TIMED_LANE_GAP)
    const ownerBaseLane = columnCount === 1 ? 0 : OWNER_COLUMN_MAP[ownerKey] ?? 0
    let columnBottom = -1

    ownerViews.forEach((card) => {
      const timelineTop = card.top

      card.top = columnBottom < 0 ? timelineTop : Math.max(timelineTop, columnBottom + CARD_STACK_GAP)
      card.lane = ownerBaseLane
      card.laneCount = columnCount
      if (columnCount === 1) {
        card.widthPercent = TIMED_SINGLE_WIDTH_PERCENT
        card.leftPercent = (100 - TIMED_SINGLE_WIDTH_PERCENT) / 2
      } else {
        card.widthPercent = ownerColumnWidth
        card.leftPercent = ownerColumnLeft
      }
      columnBottom = card.top + card.height
    })
  })
}

const calcRecordsContentBottom = (views: CompletedRecordView[]) =>
  views.reduce((max, view) => Math.max(max, view.top + view.height), 0)

const layoutTimelineRecords = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
  minutesToY: MinutesToY,
  columnCount: number,
) => {
  const views: CompletedRecordView[] = []

  records.forEach((record) => {
    const interval = getRecordInterval(record, selectedDate)
    const clipped = clipIntervalToRange(interval.startMin, interval.endMin, rangeStart, rangeEnd)

    if (!clipped) {
      return
    }

    const view = toRecordView(record, clipped.startMin, clipped.endMin)
    const top = minutesToY(clipped.startMin)
    const bottom = minutesToY(clipped.endMin)
    const hasDetail = view.detail.trim().length > 0
    let minHeight = MIN_CARD_HEIGHT

    if (hasDetail) {
      minHeight = view.isCompact ? COMPACT_CARD_WITH_DETAIL_HEIGHT : MIN_CARD_WITH_DETAIL_HEIGHT
    } else if (view.isCompact) {
      minHeight = COMPACT_CARD_HEIGHT
    }

    view.top = top
    view.height = Math.max(minHeight, bottom - top)
    views.push(view)
  })

  layoutOwnerColumnStack(views, columnCount)
  return views
}

const layoutBoardContent = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
  segments: TimelineSegment[],
  columnCount: number,
) => {
  const minutesToY = buildPiecewiseMinutesToY(segments)
  const recordViews = layoutTimelineRecords(
    records,
    selectedDate,
    rangeStart,
    rangeEnd,
    minutesToY,
    columnCount,
  )

  const contentBottom = calcRecordsContentBottom(recordViews)
  const baseBoardHeight = buildPiecewiseBoardHeight(segments)

  return {
    recordViews,
    minutesToY,
    contentBottom,
    baseBoardHeight,
    segments,
  }
}

const buildDayBoard = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
  singleUserMode: boolean,
  activeFilter: string,
) => {
  const columnLayout = getBoardColumnLayout(records, singleUserMode, activeFilter)
  const stretchWindows = detectStretchWindows(records, selectedDate, rangeStart, rangeEnd)
  let segments = buildTimelineSegments(stretchWindows, rangeStart, rangeEnd)
  let layout = layoutBoardContent(
    records,
    selectedDate,
    rangeStart,
    rangeEnd,
    segments,
    columnLayout.columnCount,
  )

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const refined = refineStretchSegments(segments, layout.recordViews)

    if (!refined.changed) {
      break
    }

    segments = refined.segments
    layout = layoutBoardContent(
      records,
      selectedDate,
      rangeStart,
      rangeEnd,
      segments,
      columnLayout.columnCount,
    )
  }

  const boardHeight = Math.max(
    layout.baseBoardHeight,
    layout.contentBottom + BOARD_BOTTOM_PADDING,
  )

  return {
    boardHeight,
    timelineMarkers: buildTimelineMarkers(rangeStart, rangeEnd, layout.minutesToY),
    records: layout.recordViews,
    nowCursor: buildNowCursor(selectedDate, rangeStart, rangeEnd, layout.minutesToY),
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
    boardHeight: buildBoardHeight(DAY_START_MINUTES, DAY_END_MINUTES),
    timelineMarkers: [] as TimelineMarker[],
    records: [] as CompletedRecordView[],
    nowCursor: { visible: false, top: 0, label: '' } as NowCursor,
    scrollTop: 0,
    scrollWithTop: false,
    boardVisible: true,
    hasAutoScrolled: false,
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
      const prevDate = this.data.selectedDate
      const selectedDate = query.date || getToday()
      const activeFilter = query.filter || 'all'
      const dateChanged = prevDate !== selectedDate

      this.setData({
        selectedDate,
        activeFilter,
        dateTitle: formatDateTitle(selectedDate),
        ...(dateChanged ? { hasAutoScrolled: false, boardVisible: false } : {}),
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
      const { selectedDate, activeFilter, singleUserMode } = this.data
      const dayRecords = filterRecords(
        getCompletedRecords().filter((record) => formatDate(new Date(record.completedAt)) === selectedDate),
        activeFilter,
      )

      const board = buildDayBoard(
        dayRecords,
        selectedDate,
        DAY_START_MINUTES,
        DAY_END_MINUTES,
        singleUserMode,
        activeFilter,
      )

      applyTimelineBoardUpdate(this, {
        boardPayload: {
          boardHeight: board.boardHeight,
          timelineMarkers: board.timelineMarkers,
          records: board.records,
          nowCursor: board.nowCursor,
        },
        selectedDate,
        nowCursor: board.nowCursor,
        boardHeightRpx: board.boardHeight,
        safeTopPx: this.data.safeTopPx,
        boardTopOffsetRpx: getCompletedDayBoardTopOffsetRpx(),
        hasAutoScrolled: this.data.hasAutoScrolled,
      })

      void this.refreshOwnerFilters()
    },
    setFilter(e: WechatMiniprogram.CustomEvent<{ filter?: string }> | WechatMiniprogram.BaseEvent) {
      const filter =
        (e as WechatMiniprogram.CustomEvent<{ filter?: string }>).detail?.filter ||
        (e.currentTarget?.dataset?.filter as string | undefined)

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
