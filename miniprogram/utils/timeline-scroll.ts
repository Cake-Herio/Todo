import { getToday } from './data'

export interface NowCursorLike {
  visible: boolean
  top: number
}

export const TIMELINE_BOARD_TOP_OFFSET_RPX = {
  common: 90 + 96 + 24,
  dayExtra: 40,
} as const

export const rpxToPx = (rpx: number, windowWidth = wx.getSystemInfoSync().windowWidth) =>
  Math.round((rpx * windowWidth) / 750)

export const shouldAutoScrollToNow = (selectedDate: string, nowCursor: NowCursorLike) =>
  selectedDate === getToday() && nowCursor.visible

export const buildTimelineScrollTop = (options: {
  nowTopRpx: number
  boardTopOffsetRpx: number
  boardHeightRpx: number
  safeTopPx: number
  viewportHeightPx?: number
  windowWidth?: number
}) => {
  const {
    nowTopRpx,
    boardTopOffsetRpx,
    boardHeightRpx,
    safeTopPx,
    viewportHeightPx = wx.getSystemInfoSync().windowHeight,
    windowWidth = wx.getSystemInfoSync().windowWidth,
  } = options

  const boardTopPx = safeTopPx + rpxToPx(boardTopOffsetRpx, windowWidth)
  const nowTopPx = rpxToPx(nowTopRpx, windowWidth)
  const boardHeightPx = rpxToPx(boardHeightRpx, windowWidth)
  const pageBottomPaddingPx = rpxToPx(56, windowWidth)

  const targetScrollTop = boardTopPx + nowTopPx - viewportHeightPx * 0.35
  const maxScrollTop = Math.max(boardTopPx + boardHeightPx + pageBottomPaddingPx - viewportHeightPx, 0)

  return Math.max(0, Math.min(Math.round(targetScrollTop), maxScrollTop))
}

export const getDayBoardTopOffsetRpx = () =>
  TIMELINE_BOARD_TOP_OFFSET_RPX.common + TIMELINE_BOARD_TOP_OFFSET_RPX.dayExtra

export const getCompletedDayBoardTopOffsetRpx = () => TIMELINE_BOARD_TOP_OFFSET_RPX.common

export const applyTimelineBoardUpdate = (
  page: WechatMiniprogram.Component.TrivialInstance,
  options: {
    boardPayload: WechatMiniprogram.IAnyObject
    selectedDate: string
    nowCursor: NowCursorLike
    boardHeightRpx: number
    safeTopPx: number
    boardTopOffsetRpx: number
    hasAutoScrolled: boolean
  },
) => {
  const {
    boardPayload,
    selectedDate,
    nowCursor,
    boardHeightRpx,
    safeTopPx,
    boardTopOffsetRpx,
    hasAutoScrolled,
  } = options

  if (!hasAutoScrolled && shouldAutoScrollToNow(selectedDate, nowCursor)) {
    const scrollTop = buildTimelineScrollTop({
      nowTopRpx: nowCursor.top,
      boardTopOffsetRpx,
      boardHeightRpx,
      safeTopPx,
    })

    page.setData({
      ...boardPayload,
      scrollTop,
      scrollWithTop: true,
      boardVisible: false,
      hasAutoScrolled: true,
    }, () => {
      wx.nextTick(() => {
        page.setData({
          boardVisible: true,
          scrollWithTop: false,
        })
      })
    })
    return
  }

  page.setData({
    ...boardPayload,
    boardVisible: true,
  })
}
