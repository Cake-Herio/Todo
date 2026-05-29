import { notifyCloudMutate } from './cloud-bridge'
import { resolveTagBindingFromList } from './tag-binding'
import { getSession } from './session'
import { ScheduleTimeHelper } from './schedule-time'

export type OwnerKey = 'me' | 'partner'
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled'
export type CompletionMode = 'manual' | 'timed'

export interface Plan {
  id: string
  ownerKey: OwnerKey
  ownerName: string
  ownerAvatar: string
  color: 'green' | 'blue'
  title: string
  tag: string
  tagId?: string
  remark: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  timeText: string | null
  estimatedMinutes: number | null
  completionMode: CompletionMode
  status: PlanStatus
  createdAt: number
  updatedAt: number
}

export interface CompletedRecord {
  id: string
  planId: string
  ownerKey: OwnerKey
  title: string
  tag: string
  tagId?: string
  detail: string
  startedAt: number | null
  completedAt: number
  completionMode: CompletionMode
  actualMinutes: number | null
  wasOverdue: boolean
}

interface AppData {
  plans: Plan[]
  completedRecords: CompletedRecord[]
}

const STORAGE_KEY = 'myforest_local_data_v5'
const AVATARS = {
  me: '/assets/avatars/me.png',
  partner: '/assets/avatars/partner.png',
}
export { DEFAULT_PLAN_TAGS } from './plan-tags'

const resolveTagBinding = (tag: string, tagId?: string) => {
  const { getPlanTagOptions } = require('./plan-tags') as typeof import('./plan-tags')
  return resolveTagBindingFromList(tag, tagId, getPlanTagOptions())
}

const formatDateValue = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createEmptyAppData = (): AppData => ({
  plans: [],
  completedRecords: [],
})
export const getToday = () => formatDateValue(new Date())

export const getOwnerAvatarUrl = (ownerKey: OwnerKey) => {
  const session = getSession()

  if (ownerKey === 'me') {
    if (session?.profileCompleted && session.avatarUrl) {
      return session.avatarUrl
    }
  }

  if (ownerKey === 'partner' && session?.partnerAvatarUrl) {
    const url = session.partnerAvatarUrl
    if (!url.startsWith('cloud://')) {
      return url
    }
  }

  return AVATARS[ownerKey]
}

export const ensureLocalData = () => {
  const data = wx.getStorageSync(STORAGE_KEY) as AppData | ''

  if (!data) {
    wx.setStorageSync(STORAGE_KEY, createEmptyAppData())
  }
}

const notifyCloudDataChanged = () => {
  notifyCloudMutate()
}

export const getLocalData = (): AppData => {
  ensureLocalData()
  const data = wx.getStorageSync(STORAGE_KEY) as AppData
  const backfilled = backfillTagIdsInData(data)

  if (backfilled.changed) {
    wx.setStorageSync(STORAGE_KEY, backfilled.data)
  }

  return backfilled.data
}

export const saveLocalData = (data: AppData) => {
  wx.setStorageSync(STORAGE_KEY, data)
}

const backfillTagIdsInData = (data: AppData) => {
  let changed = false

  const plans = data.plans.map((plan) => {
    if (plan.tagId) {
      return plan
    }

    const binding = resolveTagBinding(plan.tag)
    changed = true
    return { ...plan, tagId: binding.tagId, tag: binding.tag }
  })

  const completedRecords = data.completedRecords.map((record) => {
    if (record.tagId) {
      return record
    }

    const binding = resolveTagBinding(record.tag)
    changed = true
    return { ...record, tagId: binding.tagId, tag: binding.tag }
  })

  if (!changed) {
    return { changed: false, data }
  }

  return {
    changed: true,
    data: {
      ...data,
      plans,
      completedRecords,
    },
  }
}

export const applyTagUpdate = (tagId: string, update: { name?: string }) => {
  if (!update.name) {
    return
  }

  const data = getLocalData()
  let changed = false
  const nextName = update.name

  const plans = data.plans.map((plan) => {
    if (plan.tagId !== tagId) {
      return plan
    }

    changed = true
    const title = plan.title === plan.tag ? nextName : plan.title

    return {
      ...plan,
      tag: nextName,
      title,
      updatedAt: Date.now(),
    }
  })

  const completedRecords = data.completedRecords.map((record) => {
    if (record.tagId !== tagId) {
      return record
    }

    changed = true
    const title = record.title === record.tag ? nextName : record.title

    return {
      ...record,
      tag: nextName,
      title,
    }
  })

  if (!changed) {
    return
  }

  saveLocalData({
    ...data,
    plans,
    completedRecords,
  })
  notifyCloudDataChanged()
}

export const getPlans = () => getLocalData().plans

export const getCompletedRecords = () => getLocalData().completedRecords

export const getPlansByDate = (date: string) => getPlans().filter((plan) => plan.date === date && plan.status !== 'cancelled')

export const getBindablePlansForToday = (ownerKey: OwnerKey = 'me') =>
  getPlans().filter(
    (plan) =>
      plan.date === getToday() &&
      plan.ownerKey === ownerKey &&
      plan.status !== 'completed' &&
      plan.status !== 'cancelled',
  )

export const getPlanById = (planId: string) => getPlans().find((plan) => plan.id === planId) || null

const isTimedPlanRecord = (plan: Plan) => Boolean(plan.startTime && plan.endTime)

const timedPlansOverlap = (startA: string, endA: string, startB: string, endB: string) => {
  const aStart = ScheduleTimeHelper.parseToMinutes(startA)
  const aEnd = ScheduleTimeHelper.parseToMinutes(endA, true)
  const bStart = ScheduleTimeHelper.parseToMinutes(startB)
  const bEnd = ScheduleTimeHelper.parseToMinutes(endB, true)

  return aStart < bEnd && bStart < aEnd
}

export const findSameOwnerTimedConflict = (input: {
  ownerKey: OwnerKey
  date: string
  startTime: string
  endTime: string
  excludePlanId?: string
}) =>
  getPlans().find((plan) => {
    if (plan.id === input.excludePlanId) {
      return false
    }

    if (plan.ownerKey !== input.ownerKey || plan.date !== input.date) {
      return false
    }

    if (plan.status === 'cancelled' || plan.status === 'completed') {
      return false
    }

    if (!isTimedPlanRecord(plan)) {
      return false
    }

    return timedPlansOverlap(input.startTime, input.endTime, plan.startTime!, plan.endTime!)
  }) || null

export interface TimedScheduleInput {
  ownerKey: OwnerKey
  date: string
  startTime: string
  endTime: string
  label?: string
}

export const findTimedScheduleConflictMessage = (
  input: TimedScheduleInput,
  excludePlanId?: string,
): string | null => {
  const startTime = input.startTime.trim()
  const endTime = input.endTime.trim()

  if (!startTime || !endTime) {
    return null
  }

  if (!ScheduleTimeHelper.isValidTimeRange(startTime, endTime)) {
    return '结束时间需晚于开始时间'
  }

  const conflict = findSameOwnerTimedConflict({
    ownerKey: input.ownerKey,
    date: input.date,
    startTime,
    endTime,
    excludePlanId,
  })

  if (!conflict) {
    return null
  }

  const conflictTime = `${conflict.startTime}-${conflict.endTime}`
  return `与已有计划「${conflict.tag}」(${conflictTime}) 时段冲突`
}

export const findTimedScheduleBatchConflictMessage = (items: TimedScheduleInput[]): string | null => {
  const pendingTimed: TimedScheduleInput[] = []

  for (const item of items) {
    const startTime = item.startTime.trim()
    const endTime = item.endTime.trim()

    if (!startTime || !endTime) {
      continue
    }

    const label = item.label || '计划'
    const existingConflict = findTimedScheduleConflictMessage({
      ...item,
      startTime,
      endTime,
    })

    if (existingConflict) {
      return `「${label}」${existingConflict}`
    }

    const batchConflict = pendingTimed.find(
      (pending) =>
        pending.ownerKey === item.ownerKey &&
        pending.date === item.date &&
        timedPlansOverlap(startTime, endTime, pending.startTime, pending.endTime),
    )

    if (batchConflict) {
      const batchLabel = batchConflict.label || '计划'
      return `「${label}」与「${batchLabel}」时段冲突`
    }

    pendingTimed.push({
      ...item,
      startTime,
      endTime,
    })
  }

  return null
}

export type AddPlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; message: string }

export const addPlan = (input: {
  ownerKey: OwnerKey
  title: string
  tag: string
  tagId?: string
  remark?: string
  date: string
  startTime?: string
  endTime?: string
  timeText?: string
  estimatedMinutes?: number | null
}): AddPlanResult => {
  const startTime = input.startTime?.trim() || ''
  const endTime = input.endTime?.trim() || ''
  const hasTimedRange = Boolean(startTime && endTime)

  if (hasTimedRange) {
    if (!ScheduleTimeHelper.isValidTimeRange(startTime, endTime)) {
      return { ok: false, message: '结束时间需晚于开始时间' }
    }

    const conflict = findSameOwnerTimedConflict({
      ownerKey: input.ownerKey,
      date: input.date,
      startTime,
      endTime,
    })

    if (conflict) {
      const conflictTime = `${conflict.startTime}-${conflict.endTime}`
      return { ok: false, message: `与已有计划「${conflict.tag}」(${conflictTime}) 时段冲突` }
    }
  }

  const data = getLocalData()
  const createdAt = Date.now()
  const isMe = input.ownerKey === 'me'
  const tagBinding = resolveTagBinding(input.tag, input.tagId)
  const plan: Plan = {
    id: `plan-${createdAt}`,
    ownerKey: input.ownerKey,
    ownerName: isMe ? '我' : 'W',
    ownerAvatar: isMe ? '我' : 'W',
    color: isMe ? 'green' : 'blue',
    title: input.title || tagBinding.tag,
    tag: tagBinding.tag,
    tagId: tagBinding.tagId,
    remark: input.remark || null,
    date: input.date,
    startTime: hasTimedRange ? startTime : null,
    endTime: hasTimedRange ? endTime : null,
    timeText: hasTimedRange ? null : input.timeText || '今天',
    estimatedMinutes: input.estimatedMinutes || null,
    completionMode: 'manual',
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  }

  saveLocalData({
    ...data,
    plans: [plan, ...data.plans],
  })

  notifyCloudDataChanged()

  return { ok: true, plan }
}

export type UpdatePlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; message: string }

export const updatePlan = (
  planId: string,
  input: {
    ownerKey: OwnerKey
    title: string
    tag: string
    tagId?: string
    remark?: string
    date: string
    startTime?: string
    endTime?: string
    timeText?: string
    estimatedMinutes?: number | null
  },
): UpdatePlanResult => {
  const data = getLocalData()
  const target = data.plans.find((plan) => plan.id === planId)

  if (!target) {
    return { ok: false, message: '计划不存在' }
  }

  const startTime = input.startTime?.trim() || ''
  const endTime = input.endTime?.trim() || ''
  const hasTimedRange = Boolean(startTime && endTime)

  if (hasTimedRange) {
    if (!ScheduleTimeHelper.isValidTimeRange(startTime, endTime)) {
      return { ok: false, message: '结束时间需晚于开始时间' }
    }

    const conflict = findSameOwnerTimedConflict({
      ownerKey: input.ownerKey,
      date: input.date,
      startTime,
      endTime,
      excludePlanId: planId,
    })

    if (conflict) {
      const conflictTime = `${conflict.startTime}-${conflict.endTime}`
      return { ok: false, message: `与已有计划「${conflict.tag}」(${conflictTime}) 时段冲突` }
    }
  }

  const isMe = input.ownerKey === 'me'
  const updatedAt = Date.now()
  const tagBinding = resolveTagBinding(input.tag, input.tagId)
  const plan: Plan = {
    ...target,
    ownerKey: input.ownerKey,
    ownerName: isMe ? '我' : 'W',
    ownerAvatar: isMe ? '我' : 'W',
    color: isMe ? 'green' : 'blue',
    title: input.title || tagBinding.tag,
    tag: tagBinding.tag,
    tagId: tagBinding.tagId,
    remark: input.remark?.trim() ? input.remark.trim() : null,
    date: input.date,
    startTime: hasTimedRange ? startTime : null,
    endTime: hasTimedRange ? endTime : null,
    timeText: hasTimedRange ? null : input.timeText?.trim() || '今天',
    estimatedMinutes: input.estimatedMinutes || null,
    updatedAt,
  }

  saveLocalData({
    ...data,
    plans: data.plans.map((item) => (item.id === planId ? plan : item)),
  })

  notifyCloudDataChanged()

  return { ok: true, plan }
}

export const deletePlan = (planId: string) => {
  deletePlansByIds([planId])
}

export const deletePlansByIds = (planIds: string[]) => {
  const uniqueIds = Array.from(new Set(planIds.filter(Boolean)))

  if (uniqueIds.length === 0) {
    return 0
  }

  const idSet = new Set(uniqueIds)
  const data = getLocalData()
  const nextPlans = data.plans.filter((plan) => !idSet.has(plan.id))
  const removedCount = data.plans.length - nextPlans.length

  if (removedCount === 0) {
    return 0
  }

  saveLocalData({
    ...data,
    plans: nextPlans,
  })

  notifyCloudDataChanged()

  return removedCount
}

export const completePlan = (planId: string) => {
  const data = getLocalData()
  const target = data.plans.find((plan) => plan.id === planId)

  if (!target || target.status === 'completed') {
    return
  }

  const completedAt = Date.now()

  saveLocalData({
    ...data,
    plans: data.plans.map((plan) =>
      plan.id === planId ? { ...plan, status: 'completed', updatedAt: completedAt } : plan,
    ),
  })

  notifyCloudDataChanged()
}

export const saveTimedCompletion = (input: {
  tag: string
  tagId?: string
  detail?: string
  actualMinutes: number
  startedAt: number
  completedAt?: number
  planId?: string
  ownerKey?: OwnerKey
}) => {
  const data = getLocalData()
  const completedAt = input.completedAt ?? Date.now()
  const linkedPlan = input.planId ? data.plans.find((plan) => plan.id === input.planId) : null
  const ownerKey = linkedPlan?.ownerKey || input.ownerKey || 'me'
  const planId = linkedPlan?.id || `focus-${completedAt}`
  const tagBinding = resolveTagBinding(input.tag || linkedPlan?.tag || '专注', input.tagId || linkedPlan?.tagId)
  const tag = tagBinding.tag
  const title = linkedPlan?.title || tag
  const detail = input.detail?.trim() || linkedPlan?.remark || title

  const record: CompletedRecord = {
    id: `record-${completedAt}`,
    planId,
    ownerKey,
    title,
    tag,
    tagId: tagBinding.tagId,
    detail,
    startedAt: input.startedAt,
    completedAt,
    completionMode: 'timed',
    actualMinutes: input.actualMinutes,
    wasOverdue: linkedPlan?.status === 'overdue',
  }

  saveLocalData({
    ...data,
    plans: linkedPlan
      ? data.plans.map((plan) =>
          plan.id === linkedPlan.id
            ? { ...plan, status: 'completed', updatedAt: completedAt }
            : plan,
        )
      : data.plans,
    completedRecords: [record, ...data.completedRecords],
  })

  notifyCloudDataChanged()

  return record
}

export const formatFocusMinutes = (minutes: number) => {
  if (minutes <= 0) {
    return '0 分钟'
  }

  if (minutes < 60) {
    return `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (rest === 0) {
    return `${hours} 小时`
  }

  return `${hours} 小时 ${rest} 分钟`
}

const padTimePart = (value: number) => `${value}`.padStart(2, '0')

export const formatRecordClock = (timestamp: number, withSeconds = false) => {
  const date = new Date(timestamp)
  const hour = padTimePart(date.getHours())
  const minute = padTimePart(date.getMinutes())

  if (!withSeconds) {
    return `${hour}:${minute}`
  }

  return `${hour}:${minute}:${padTimePart(date.getSeconds())}`
}

export const formatRecordDateLabel = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export const formatTimedRecordTimeRange = (record: CompletedRecord) => {
  const endMs = record.completedAt
  const durationMs = Math.max((record.actualMinutes || 1) * 60 * 1000, 1000)
  let startMs = record.startedAt

  if (!startMs || startMs <= 0 || startMs >= endMs) {
    startMs = endMs - durationMs
  }

  const useSeconds = formatRecordClock(startMs) === formatRecordClock(endMs)
  const startLabel = formatRecordClock(startMs, useSeconds)
  const endLabel = formatRecordClock(endMs, useSeconds)

  return `${startLabel} - ${endLabel}`
}

export const getMyTimedRecords = (date?: string | null) => {
  let records = getCompletedRecords().filter(
    (record) => record.completionMode === 'timed' && record.ownerKey === 'me',
  )

  if (date) {
    records = records.filter((record) => formatDate(new Date(record.completedAt)) === date)
  }

  return records.sort((a, b) => b.completedAt - a.completedAt)
}

export const getMyTimedRecordsSummary = (date?: string | null) => {
  const records = getMyTimedRecords(date)
  const totalMinutes = records.reduce((total, record) => total + (record.actualMinutes || 0), 0)

  return {
    count: records.length,
    totalMinutes,
    totalDurationText: formatFocusMinutes(totalMinutes),
  }
}

export const formatDate = formatDateValue
