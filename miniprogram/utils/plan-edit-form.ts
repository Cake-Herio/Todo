import type { AiPlanDraft } from './deepseek'
import { DEFAULT_PLAN_TAGS, type OwnerKey, type Plan } from './data'
import { resolvePlanTag } from './plan-tags'

export type ScheduleKind = 'timed' | 'period' | 'allday'
export type PeriodKey = 'morning' | 'afternoon' | 'evening'
export type PickerSheetKind = 'date' | 'time-start' | 'time-end' | 'period'

export interface EditPlanForm {
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

export const PERIOD_OPTIONS = [
  { key: 'morning' as const, label: '上午' },
  { key: 'afternoon' as const, label: '下午' },
  { key: 'evening' as const, label: '晚上' },
]

export const SCHEDULE_KIND_OPTIONS = [
  { key: 'timed' as const, title: '精准时间', desc: '起止时刻' },
  { key: 'period' as const, title: '时段', desc: '上下午晚上' },
  { key: 'allday' as const, title: '全天', desc: '随时完成' },
]

export const PICKER_MIN_YEAR = 2020
export const PICKER_MAX_YEAR = 2035
export const PICKER_YEARS = Array.from({ length: PICKER_MAX_YEAR - PICKER_MIN_YEAR + 1 }, (_, index) => PICKER_MIN_YEAR + index)
export const PICKER_MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`)
export const PICKER_HOURS = Array.from({ length: 24 }, (_, index) => `${index}`.padStart(2, '0'))
export const PICKER_MINUTES = Array.from({ length: 60 }, (_, index) => `${index}`.padStart(2, '0'))

export const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

export const buildDayOptions = (year: number, month: number) =>
  Array.from({ length: getDaysInMonth(year, month) }, (_, index) => `${index + 1}日`)

export const parseDateParts = (dateText: string) => {
  const [yearText, monthText, dayText] = dateText.split('-')

  return {
    year: Number(yearText) || new Date().getFullYear(),
    month: Number(monthText) || 1,
    day: Number(dayText) || 1,
  }
}

export const formatDateParts = (year: number, month: number, day: number) => {
  const safeDay = Math.min(day, getDaysInMonth(year, month))

  return `${year}-${`${month}`.padStart(2, '0')}-${`${safeDay}`.padStart(2, '0')}`
}

export const parseTimeParts = (timeText: string) => {
  const [hourText, minuteText] = timeText.split(':')

  return {
    hour: Number(hourText) || 0,
    minute: Number(minuteText) || 0,
  }
}

export const formatTimeParts = (hour: number, minute: number) =>
  `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`

export const clampPickerYear = (year: number) => Math.min(PICKER_MAX_YEAR, Math.max(PICKER_MIN_YEAR, year))

export const getPeriodKeyFromTimeText = (timeText: string | null): PeriodKey | null => {
  const text = timeText || ''

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

export const isTimedDraft = (plan: AiPlanDraft) => Boolean(plan.startTime && plan.endTime)

export const getDraftScheduleKind = (plan: AiPlanDraft): ScheduleKind => {
  if (isTimedDraft(plan)) {
    return 'timed'
  }

  if (getPeriodKeyFromTimeText(plan.timeText)) {
    return 'period'
  }

  return 'allday'
}

export const getPeriodIndex = (periodKey: PeriodKey) =>
  Math.max(0, PERIOD_OPTIONS.findIndex((item) => item.key === periodKey))

export { resolvePlanTag }

export const buildEditPlanFormFromPlan = (raw: Plan, fallbackDate: string): EditPlanForm => {
  const periodKey = getPeriodKeyFromTimeText(raw.timeText) || 'morning'

  return {
    ownerKey: raw.ownerKey,
    tag: raw.tag,
    remark: raw.remark || '',
    date: raw.date || fallbackDate,
    scheduleKind: raw.startTime && raw.endTime ? 'timed' : getPeriodKeyFromTimeText(raw.timeText) ? 'period' : 'allday',
    startTime: raw.startTime || '09:00',
    endTime: raw.endTime || '10:00',
    periodKey,
    periodIndex: getPeriodIndex(periodKey),
  }
}

export const buildEditPlanFormFromDraft = (
  draft: AiPlanDraft,
  fallbackDate: string,
  ownerKey: OwnerKey = 'me',
): EditPlanForm => {
  const periodKey = getPeriodKeyFromTimeText(draft.timeText) || 'morning'

  return {
    ownerKey,
    tag: resolvePlanTag(draft.defaultTag || draft.section),
    remark: draft.remark || '',
    date: draft.date || fallbackDate,
    scheduleKind: getDraftScheduleKind(draft),
    startTime: draft.startTime || '09:00',
    endTime: draft.endTime || '10:00',
    periodKey,
    periodIndex: getPeriodIndex(periodKey),
  }
}

export const createDefaultEditPlanForm = (date: string): EditPlanForm => ({
  ownerKey: 'me',
  tag: DEFAULT_PLAN_TAGS[0],
  remark: '',
  date,
  scheduleKind: 'timed',
  startTime: '09:00',
  endTime: '10:00',
  periodKey: 'morning',
  periodIndex: 0,
})

export const applyEditPlanFormToDraft = (draft: AiPlanDraft, form: EditPlanForm): AiPlanDraft => {
  let startTime: string | null = null
  let endTime: string | null = null
  let timeText: string | null = null

  if (form.scheduleKind === 'timed') {
    startTime = form.startTime
    endTime = form.endTime
  } else if (form.scheduleKind === 'period') {
    timeText = PERIOD_OPTIONS.find((item) => item.key === form.periodKey)?.label || '上午'
  } else {
    timeText = '今天'
  }

  const tag = resolvePlanTag(form.tag)

  return {
    ...draft,
    title: tag,
    section: tag,
    defaultTag: tag,
    remark: form.remark.trim() || null,
    date: form.date,
    startTime,
    endTime,
    timeText,
  }
}

export const buildPlanUpdatePayloadFromForm = (
  form: EditPlanForm,
  estimatedMinutes: number | null,
) => {
  let startTime = ''
  let endTime = ''
  let timeText = '今天'

  if (form.scheduleKind === 'timed') {
    startTime = form.startTime
    endTime = form.endTime
    timeText = ''
  } else if (form.scheduleKind === 'period') {
    timeText = PERIOD_OPTIONS.find((item) => item.key === form.periodKey)?.label || '上午'
  }

  return {
    ownerKey: form.ownerKey,
    title: form.tag,
    tag: form.tag,
    remark: form.remark.trim(),
    date: form.date,
    startTime,
    endTime,
    timeText,
    estimatedMinutes,
  }
}
