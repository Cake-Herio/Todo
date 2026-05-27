import { notifyCloudMutate } from './cloud-bridge'
import { getSession } from './session'

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
  if (ownerKey === 'me') {
    const session = getSession()
    if (session?.profileCompleted && session.avatarUrl) {
      return session.avatarUrl
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
  return wx.getStorageSync(STORAGE_KEY) as AppData
}

export const saveLocalData = (data: AppData) => {
  wx.setStorageSync(STORAGE_KEY, data)
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

const parseTimeToMinutes = (time: string, treatMidnightAsEnd = false) => {
  const [hourText, minuteText] = time.split(':')
  let hour = Number(hourText)
  const minute = Number(minuteText || '0')

  if (treatMidnightAsEnd && hour === 0 && minute === 0) {
    hour = 24
  }

  return hour * 60 + minute
}

const isTimedPlanRecord = (plan: Plan) => Boolean(plan.startTime && plan.endTime)

const timedPlansOverlap = (startA: string, endA: string, startB: string, endB: string) => {
  const aStart = parseTimeToMinutes(startA)
  const aEnd = parseTimeToMinutes(endA, true)
  const bStart = parseTimeToMinutes(startB)
  const bEnd = parseTimeToMinutes(endB, true)

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

export type AddPlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; message: string }

export const addPlan = (input: {
  ownerKey: OwnerKey
  title: string
  tag: string
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
    if (parseTimeToMinutes(startTime) >= parseTimeToMinutes(endTime, true)) {
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
  const plan: Plan = {
    id: `plan-${createdAt}`,
    ownerKey: input.ownerKey,
    ownerName: isMe ? '我' : 'W',
    ownerAvatar: isMe ? '我' : 'W',
    color: isMe ? 'green' : 'blue',
    title: input.title || input.tag,
    tag: input.tag,
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
    if (parseTimeToMinutes(startTime) >= parseTimeToMinutes(endTime, true)) {
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
  const plan: Plan = {
    ...target,
    ownerKey: input.ownerKey,
    ownerName: isMe ? '我' : 'W',
    ownerAvatar: isMe ? '我' : 'W',
    color: isMe ? 'green' : 'blue',
    title: input.title || input.tag,
    tag: input.tag,
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
  const data = getLocalData()
  saveLocalData({
    ...data,
    plans: data.plans.filter((plan) => plan.id !== planId),
  })

  notifyCloudDataChanged()
}

export const completePlan = (planId: string) => {
  const data = getLocalData()
  const target = data.plans.find((plan) => plan.id === planId)

  if (!target) {
    return
  }

  const completedAt = Date.now()
  const record: CompletedRecord = {
    id: `record-${completedAt}`,
    planId,
    ownerKey: target.ownerKey,
    title: target.title,
    tag: target.tag,
    detail: target.remark || target.title,
    startedAt: null,
    completedAt,
    completionMode: target.completionMode,
    actualMinutes: null,
    wasOverdue: target.status === 'overdue',
  }

  saveLocalData({
    plans: data.plans.map((plan) => plan.id === planId ? { ...plan, status: 'completed', updatedAt: completedAt } : plan),
    completedRecords: [record, ...data.completedRecords],
  })

  notifyCloudDataChanged()
}

export const saveTimedCompletion = (input: {
  tag: string
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
  const tag = input.tag || linkedPlan?.tag || '专注'
  const title = linkedPlan?.title || tag
  const detail = input.detail?.trim() || linkedPlan?.remark || title

  const record: CompletedRecord = {
    id: `record-${completedAt}`,
    planId,
    ownerKey,
    title,
    tag,
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

export const formatDate = formatDateValue
