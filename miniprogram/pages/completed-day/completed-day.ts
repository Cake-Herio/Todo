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
import { getDisplayAvatarUrl, getPartnerDisplayAvatarUrl } from '../../utils/session'
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
const HOUR_HEIGHT = 44
const MIN_CARD_HEIGHT = 92
const COMPACT_CARD_HEIGHT = 84
const MIN_CARD_WITH_DETAIL_HEIGHT = 112
const COMPACT_CARD_WITH_DETAIL_HEIGHT = 106
const BOARD_BOTTOM_PADDING = 24
const TIMED_LANE_GAP = 2
const TIMED_SINGLE_WIDTH_PERCENT = 75
const TIMED_CONTENT_WIDTH_RPX = 652
const TIMED_MIN_CARD_WIDTH_RPX = 280
const TIMED_CARD_HORIZONTAL_PADDING_RPX = 24
const CARD_STACK_GAP = 8
const TIMELINE_BREAKPOINT_MINUTES = 120

interface TimelineSegment {
  startMin: number
  endMin: number
  height: number
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

const buildSegmentOffsets = (segments: TimelineSegment[]) => {
  let offsetY = 0

  return segments.map((segment) => {
    const item = {
      ...segment,
      offsetY,
    }
    offsetY += segment.height
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

    const duration = segment.endMin - segment.startMin
    const ratio = duration > 0 ? (minutes - segment.startMin) / duration : 0
    return segment.offsetY + ratio * segment.height
  }
}

const buildPiecewiseBoardHeight = (segments: TimelineSegment[]) =>
  segments.reduce((sum, segment) => sum + segment.height, 0)

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
    const startMin = startDate.getHours() * 60 + startDate.getMinutes()
    let endMin = endDate.getHours() * 60 + endDate.getMinutes()

    if (endDate.getDate() !== startDate.getDate() || (endMin === 0 && endDate > startDate)) {
      endMin = DAY_END_MINUTES
    } else if (endMin <= startMin && endDate > startDate) {
      // A short focus can start and end in the same minute. Keep one visible timeline minute.
      endMin = Math.min(startMin + 1, DAY_END_MINUTES)
    }

    return {
      startMin,
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

const estimateTextWidth = (text: string, asciiWidth: number, wideWidth: number) =>
  Array.from(text).reduce(
    (width, character) => width + (/^[a-zA-Z0-9 .,!?;:'\-]$/.test(character) ? asciiWidth : wideWidth),
    0,
  )

const getTimedColumnWidthRpx = (columnCount: number) => {
  const normalizedColumnCount = Math.max(1, columnCount)
  const laneWidthPercent = normalizedColumnCount === 1
    ? 100
    : (100 - TIMED_LANE_GAP * (normalizedColumnCount - 1)) / normalizedColumnCount

  return TIMED_CONTENT_WIDTH_RPX * laneWidthPercent / 100
}

const getTimedCardWidthRpx = (
  record: CompletedRecord,
  startMin: number,
  endMin: number,
  columnCount: number,
) => {
  const columnWidth = getTimedColumnWidthRpx(columnCount)
  const maxWidth = columnCount === 1 ? columnWidth * TIMED_SINGLE_WIDTH_PERCENT / 100 : columnWidth
  const timeWidth = estimateTextWidth(formatTimeRange(startMin, endMin), 12, 20)
  const tagRowWidth = 28 + 8 + estimateTextWidth(`${record.tag || ''}`, 10, 20) + 24 + 20
  const detailWidth = estimateTextWidth(`${record.detail || ''}`.trim(), 12, 22) + TIMED_CARD_HORIZONTAL_PADDING_RPX
  const desiredWidth = Math.max(TIMED_MIN_CARD_WIDTH_RPX, timeWidth + 20, tagRowWidth, detailWidth)

  return Math.min(maxWidth, desiredWidth)
}

const getRemarkLineCount = (detail: string, contentWidth: number) => {
  const textWidth = Array.from(detail).reduce(
    (width, character) => width + (/^[a-zA-Z0-9 .,!?;:'\-]$/.test(character) ? 12 : 22),
    0,
  )

  return Math.max(1, Math.ceil(textWidth / Math.max(1, contentWidth)))
}

const getRecordMinHeight = (
  record: CompletedRecord,
  startMin: number,
  endMin: number,
  columnCount = 1,
) => {
  const isCompact = endMin - startMin <= 20
  const detail = `${record.detail || ''}`.trim()
  const hasDetail = detail.length > 0

  if (hasDetail) {
    const baseHeight = isCompact ? COMPACT_CARD_WITH_DETAIL_HEIGHT : MIN_CARD_WITH_DETAIL_HEIGHT
    const cardWidth = getTimedCardWidthRpx(record, startMin, endMin, columnCount)
    const contentWidth = cardWidth - TIMED_CARD_HORIZONTAL_PADDING_RPX
    const extraLines = getRemarkLineCount(detail, contentWidth) - 1
    return baseHeight + extraLines * (isCompact ? 26 : 31)
  }

  return isCompact ? COMPACT_CARD_HEIGHT : MIN_CARD_HEIGHT
}

const buildTimelineBreakpoints = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
) => {
  const points = new Set<number>([rangeStart, rangeEnd])

  for (let minutes = rangeStart; minutes <= rangeEnd; minutes += TIMELINE_BREAKPOINT_MINUTES) {
    points.add(minutes)
  }

  records.forEach((record) => {
    const interval = getRecordInterval(record, selectedDate)
    const clipped = clipIntervalToRange(interval.startMin, interval.endMin, rangeStart, rangeEnd)

    if (clipped) {
      points.add(clipped.startMin)
      points.add(clipped.endMin)
    }
  })

  return [...points].sort((a, b) => a - b)
}

const buildTimelineSegments = (
  records: CompletedRecord[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
  columnCount: number,
): TimelineSegment[] => {
  const breakpoints = buildTimelineBreakpoints(records, selectedDate, rangeStart, rangeEnd)
  const segments: TimelineSegment[] = []

  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const startMin = breakpoints[index]
    const endMin = breakpoints[index + 1]
    const duration = endMin - startMin
    const baseHeight = (duration / 60) * HOUR_HEIGHT
    const cardHeightDemand = records.reduce((maxHeight, record) => {
      const interval = getRecordInterval(record, selectedDate)
      const clipped = clipIntervalToRange(interval.startMin, interval.endMin, rangeStart, rangeEnd)

      if (!clipped) {
        return maxHeight
      }

      const overlapStart = Math.max(startMin, clipped.startMin)
      const overlapEnd = Math.min(endMin, clipped.endMin)
      const overlapDuration = overlapEnd - overlapStart
      const recordDuration = clipped.endMin - clipped.startMin

      if (overlapDuration <= 0 || recordDuration <= 0) {
        return maxHeight
      }

      const minHeight = getRecordMinHeight(record, clipped.startMin, clipped.endMin, columnCount)
      return Math.max(maxHeight, minHeight * (overlapDuration / recordDuration))
    }, 0)

    segments.push({
      startMin,
      endMin,
      height: Math.max(baseHeight, cardHeightDemand),
    })
  }

  return segments
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
        card.leftPercent = 0
      } else {
        card.widthPercent = Math.min(card.widthPercent, ownerColumnWidth)
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
    const minHeight = getRecordMinHeight(record, clipped.startMin, clipped.endMin, columnCount)
    const cardWidth = getTimedCardWidthRpx(record, clipped.startMin, clipped.endMin, columnCount)
    const columnWidth = getTimedColumnWidthRpx(columnCount)

    view.top = top
    view.height = Math.max(minHeight, bottom - top)
    view.widthPercent = columnCount === 1
      ? cardWidth / columnWidth * 100
      : cardWidth / TIMED_CONTENT_WIDTH_RPX * 100
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
  const segments = buildTimelineSegments(
    records,
    selectedDate,
    rangeStart,
    rangeEnd,
    columnLayout.columnCount,
  )
  const layout = layoutBoardContent(
    records,
    selectedDate,
    rangeStart,
    rangeEnd,
    segments,
    columnLayout.columnCount,
  )

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
  ownerFilterRequestId: 0,
  data: {
    safeTopPx: 0,
    dateTitle: formatDateTitle(getToday()),
    selectedDate: getToday(),
    filters: getOwnerFilterStateLocal('me').filters,
    activeFilter: getOwnerFilterStateLocal('me').activeFilter,
    singleUserMode: getOwnerFilterStateLocal('me').singleUserMode,
    boardHeight: ((DAY_END_MINUTES - DAY_START_MINUTES) / 60) * HOUR_HEIGHT,
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
        void this.refreshOwnerFilters()
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
      const localFilterState = getOwnerFilterStateLocal(query.filter || 'me')
      const dateChanged = prevDate !== selectedDate

      this.setData({
        selectedDate,
        filters: localFilterState.filters,
        activeFilter: localFilterState.activeFilter,
        singleUserMode: localFilterState.singleUserMode,
        dateTitle: formatDateTitle(selectedDate),
        ...(dateChanged ? { hasAutoScrolled: false, boardVisible: false } : {}),
      })
      this.refreshRecords()
    },
    async refreshOwnerFilters() {
      const requestId = ++this.ownerFilterRequestId
      const requestedFilter = this.data.activeFilter
      const prevPartnerAvatarUrl = this.data.partnerAvatarUrl
      const prevAvatarUrl = this.data.avatarUrl
      const state = await getOwnerFilterState(requestedFilter)

      if (requestId !== this.ownerFilterRequestId || this.data.activeFilter !== requestedFilter) {
        return
      }

      const partnerAvatarUrl = getPartnerDisplayAvatarUrl() || getOwnerAvatarUrl('partner')
      const avatarUrl = getDisplayAvatarUrl() || getOwnerAvatarUrl('me')
      this.setData({
        filters: state.filters,
        activeFilter: state.activeFilter,
        singleUserMode: state.singleUserMode,
        partnerAvatarUrl,
        avatarUrl,
      })

      if (
        state.activeFilter !== requestedFilter ||
        partnerAvatarUrl !== prevPartnerAvatarUrl ||
        avatarUrl !== prevAvatarUrl
      ) {
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
