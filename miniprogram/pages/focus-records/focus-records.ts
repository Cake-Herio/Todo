import {
  deleteCompletedRecord,
  formatFocusMinutes,
  formatRecordDateLabel,
  formatTimedRecordTimeRange,
  getMyTimedRecords,
  getMyTimedRecordsSummary,
  getToday,
  updateCompletedRecord,
  type CompletedRecord,
} from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import {
  buildDayOptions,
  clampPickerYear,
  formatDateParts,
  parseDateParts,
  PICKER_MONTHS,
  PICKER_YEARS,
} from '../../utils/plan-edit-form'
import { getPlanTagOptions, resolvePlanTag } from '../../utils/plan-tags'
import { getScrollFadeState } from '../../utils/scroll-fade'

interface FocusRecordView {
  id: string
  tag: string
  tagId?: string
  detail: string
  rawDetail: string
  durationText: string
  timeRange: string
  dateLabel: string
  showDateLabel: boolean
}

const PAGE_SIZE = 15
const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const formatDateTitle = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`)
  const today = getToday()

  if (dateText === today) {
    return '今天'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]}`
}

const shiftDate = (dateText: string, offset: number) => {
  const date = new Date(`${dateText}T00:00:00`)
  date.setDate(date.getDate() + offset)
  return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

const normalizeRecordDetail = (value: unknown) => {
  const detail = typeof value === 'string' ? value.trim() : ''
  let displayDetail = ''

  if (detail === '') {
    displayDetail = '无备注'
  } else {
    displayDetail = detail
  }

  return displayDetail
}

const toRecordView = (record: CompletedRecord, showDateLabel: boolean): FocusRecordView => {
  const rawDetail = `${record.detail || ''}`
  console.log('rawDetail', rawDetail, record.detail)
  const displayDetail = normalizeRecordDetail(record.detail)

  return {
    id: record.id,
    tag: record.tag,
    tagId: record.tagId,
    detail: displayDetail,
    rawDetail,
    durationText: formatFocusMinutes(record.actualMinutes || 0),
    timeRange: formatTimedRecordTimeRange(record),
    dateLabel: formatRecordDateLabel(record.completedAt),
    showDateLabel,
  }
}

const buildEmptyText = (showAll: boolean, selectedDate: string) => {
  if (showAll) {
    return '还没有计时记录，去首页开始计时吧'
  }

  if (selectedDate === getToday()) {
    return '今天还没有计时记录'
  }

  return '这一天还没有计时记录'
}

Component({
  data: {
    showAll: false,
    selectedDate: getToday(),
    dateTitle: formatDateTitle(getToday()),
    periodHint: '点击日期可选择',
    canGoNextDate: false,
    summaryText: '',
    records: [] as FocusRecordView[],
    emptyText: buildEmptyText(false, getToday()),
    hasMore: false,
    loadMoreText: '',
    isPickerSheetVisible: false,
    isPickerSheetClosing: false,
    isEditSheetVisible: false,
    isEditSheetClosing: false,
    editingRecordId: '',
    editingTag: '',
    editingTagId: '',
    editingDetail: '',
    availableTags: [] as string[],
    showEditTagFadeLeft: false,
    showEditTagFadeRight: false,
    isTagCreateVisible: false,
    pickerTempValue: [0, 0, 0],
    pickerDayOptions: buildDayOptions(new Date().getFullYear(), new Date().getMonth() + 1),
    pickerYears: PICKER_YEARS,
    pickerMonths: PICKER_MONTHS,
    pageFontStyle: getFontPageStyle(),
  },
  lifetimes: {
    attached() {
      this.reloadRecords(true)
    },
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => {
        this.reloadRecords(true)
      })
    },
  },
  methods: {
    reloadRecords(resetPage = false) {
      const { showAll, selectedDate } = this.data
      const filterDate = showAll ? null : selectedDate
      const allRecords = getMyTimedRecords(filterDate)
      const summary = getMyTimedRecordsSummary(filterDate)
      const visibleCount = resetPage
        ? PAGE_SIZE
        : Math.min(allRecords.length, this.data.records.length + PAGE_SIZE)
      const visibleRecords = allRecords.slice(0, visibleCount).map((record) => toRecordView(record, showAll))
      const hasMore = visibleCount < allRecords.length

      this.setData({
        dateTitle: showAll ? '全部记录' : formatDateTitle(selectedDate),
        periodHint: showAll ? '按日期筛选专注历史' : '点击日期可选择',
        canGoNextDate: !showAll && selectedDate < getToday(),
        summaryText: `${summary.count} 条 · 合计 ${summary.totalDurationText}`,
        records: visibleRecords,
        emptyText: buildEmptyText(showAll, selectedDate),
        hasMore,
        loadMoreText: hasMore ? '上拉加载更多' : allRecords.length > 0 ? '没有更多了' : '',
      })
    },
    showAllRecords() {
      if (this.data.showAll) {
        return
      }

      this.setData({ showAll: true })
      this.reloadRecords(true)
    },
    showDateRecords() {
      if (!this.data.showAll) {
        return
      }

      this.setData({
        showAll: false,
        selectedDate: getToday(),
      })
      this.reloadRecords(true)
    },
    changeDate(e: WechatMiniprogram.BaseEvent) {
      if (this.data.showAll) {
        return
      }

      const offset = Number(e.currentTarget.dataset.offset)
      const nextDate = shiftDate(this.data.selectedDate, offset)

      if (offset > 0 && nextDate > getToday()) {
        return
      }

      this.setData({ selectedDate: nextDate })
      this.reloadRecords(true)
    },
    openDatePicker() {
      if (this.data.showAll) {
        return
      }

      const parts = parseDateParts(this.data.selectedDate)
      const year = clampPickerYear(parts.year)
      const dayOptions = buildDayOptions(year, parts.month)

      openModal(this, 'isPickerSheetVisible', 'isPickerSheetClosing', {
        pickerDayOptions: dayOptions,
        pickerTempValue: [
          year - PICKER_YEARS[0],
          parts.month - 1,
          Math.min(parts.day, dayOptions.length) - 1,
        ],
      })
    },
    closePickerSheet() {
      dismissModal(this, 'isPickerSheetVisible', 'isPickerSheetClosing')
    },
    onPickerSheetChange(e: WechatMiniprogram.PickerViewChange) {
      const nextValue = e.detail.value as number[]
      const year = PICKER_YEARS[nextValue[0]] || PICKER_YEARS[0]
      const month = nextValue[1] + 1
      const dayOptions = buildDayOptions(year, month)
      const dayIndex = Math.min(nextValue[2], dayOptions.length - 1)

      this.setData({
        pickerDayOptions: dayOptions,
        pickerTempValue: [nextValue[0], nextValue[1], dayIndex],
      })
    },
    confirmPickerSheet() {
      const [yearIndex, monthIndex, dayIndex] = this.data.pickerTempValue
      const year = PICKER_YEARS[yearIndex] || PICKER_YEARS[0]
      const month = monthIndex + 1
      const day = dayIndex + 1
      const selectedDate = formatDateParts(year, month, day)
      const today = getToday()
      const nextDate = selectedDate > today ? today : selectedDate

      dismissModal(this, 'isPickerSheetVisible', 'isPickerSheetClosing', {
        extraData: {
          showAll: false,
          selectedDate: nextDate,
        },
        onDismissed: () => {
          this.reloadRecords(true)
        },
      })
    },
    loadMoreRecords() {
      if (!this.data.hasMore) {
        return
      }

      this.reloadRecords(false)
    },
    openEditSheet(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string
      const record = this.data.records.find((r) => r.id === id)
      if (!record) return

      openModal(this, 'isEditSheetVisible', 'isEditSheetClosing', {
        editingRecordId: record.id,
        editingTag: resolvePlanTag(record.tag),
        editingTagId: record.tagId || '',
        editingDetail: record.rawDetail,
        availableTags: getPlanTagOptions().map((item) => item.name),
        showEditTagFadeLeft: false,
        showEditTagFadeRight: false,
      })

      wx.nextTick(() => {
        this.updateEditTagFades()
      })
    },
    closeEditSheet() {
      dismissModal(this, 'isEditSheetVisible', 'isEditSheetClosing', {
        extraData: {
          editingRecordId: '',
          editingTag: '',
          editingTagId: '',
          editingDetail: '',
          availableTags: [],
          showEditTagFadeLeft: false,
          showEditTagFadeRight: false,
        },
      })
    },
    selectEditTag(e: WechatMiniprogram.BaseEvent) {
      const tag = e.currentTarget.dataset.tag as string
      if (!tag) return
      this.setData({ editingTag: tag })
    },
    onEditTagScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const query = wx.createSelectorQuery().in(this)
      query.select('.edit-record-tag-scroll').boundingClientRect()
      query.exec((res) => {
        const viewportWidth = res[0]?.width || 0
        const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)
        this.setData({
          showEditTagFadeLeft: fades.showLeft,
          showEditTagFadeRight: fades.showRight,
        })
      })
    },
    updateEditTagFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.edit-record-tag-scroll').boundingClientRect()
        query.select('.edit-record-tag-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showEditTagFadeLeft: fades.showLeft,
            showEditTagFadeRight: fades.showRight,
          })
        })
      })
    },
    onEditDetailInput(e: WechatMiniprogram.Input) {
      this.setData({ editingDetail: e.detail.value })
    },
    confirmEditSheet() {
      const { editingRecordId, editingTag, editingTagId, editingDetail } = this.data
      const option = getPlanTagOptions().find((item) => item.name === editingTag)
      const newTagId = option?.id || editingTagId

      const ok = updateCompletedRecord(editingRecordId, {
        tag: editingTag,
        tagId: newTagId,
        detail: editingDetail.trim(),
      })

      dismissModal(this, 'isEditSheetVisible', 'isEditSheetClosing', {
        extraData: {
          editingRecordId: '',
          editingTag: '',
          editingTagId: '',
          editingDetail: '',
          availableTags: [],
          showEditTagFadeLeft: false,
          showEditTagFadeRight: false,
        },
        onDismissed: () => {
          if (ok) {
            this.reloadRecords(true)
          }
        },
      })
    },
    deleteEditingRecord() {
      wx.showModal({
        title: '删除记录',
        content: '删除后这条专注记录将被移除，无法恢复。',
        confirmText: '删除',
        confirmColor: '#D96565',
        success: (res) => {
          if (!res.confirm) return

          const ok = deleteCompletedRecord(this.data.editingRecordId)

          dismissModal(this, 'isEditSheetVisible', 'isEditSheetClosing', {
            extraData: {
              editingRecordId: '',
              editingTag: '',
              editingTagId: '',
              editingDetail: '',
              availableTags: [],
              showEditTagFadeLeft: false,
              showEditTagFadeRight: false,
            },
            onDismissed: () => {
              if (ok) {
                this.reloadRecords(true)
                wx.showToast({ title: '已删除', icon: 'none' })
              }
            },
          })
        },
      })
    },
    openTagCreateSheet() {
      this.setData({ isTagCreateVisible: true })
    },
    closeTagCreateSheet() {
      this.setData({ isTagCreateVisible: false })
    },
    onEditTagCreateConfirm(e: WechatMiniprogram.CustomEvent) {
      const { name } = e.detail || {}
      if (!name) return
      const tags = getPlanTagOptions().map((item) => item.name)
      this.setData({
        editingTag: name,
        availableTags: tags,
        isTagCreateVisible: false,
      })
      this.updateEditTagFades()
    },
    noop() {},
  },
})
