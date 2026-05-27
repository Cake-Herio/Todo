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
  completedAt: number
  completionMode: CompletionMode
  actualMinutes: number | null
  wasOverdue: boolean
}

interface AppData {
  plans: Plan[]
  completedRecords: CompletedRecord[]
}

const STORAGE_KEY = 'myforest_local_data_v3'
const AVATARS = {
  me: '/assets/avatars/me.png',
  partner: '/assets/avatars/partner.png',
}
export { DEFAULT_PLAN_TAGS } from './plan-tags'

const now = Date.now()

const formatDateValue = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const SEED_DATE = formatDateValue(new Date())

const seedData: AppData = {
  plans: [
    {
      id: 'plan-english-morning',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '背英语单词',
      tag: '英语',
      remark: '背完 Unit 3 单词',
      date: SEED_DATE,
      startTime: '09:00',
      endTime: '10:00',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'overdue',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-code-evening',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '项目复盘',
      tag: '写代码',
      remark: '整理项目进度和下一步计划',
      date: SEED_DATE,
      startTime: '19:30',
      endTime: '20:30',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-partner-overlap-morning',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '晨会',
      tag: '写代码',
      remark: '和我撞时段的并行计划',
      date: SEED_DATE,
      startTime: '09:30',
      endTime: '10:30',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-read-morning',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '阅读',
      tag: '阅读',
      remark: '阅读一章书',
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '上午',
      estimatedMinutes: 30,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-read-today',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '整理项目 README',
      tag: '写代码',
      remark: null,
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '今天',
      estimatedMinutes: 30,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-sport-night',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '运动半小时',
      tag: '运动',
      remark: null,
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '晚上',
      estimatedMinutes: 30,
      completionMode: 'manual',
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-lunch-me-read',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '午间阅读',
      tag: '阅读',
      remark: '三段重叠测试 A',
      date: SEED_DATE,
      startTime: '12:00',
      endTime: '13:00',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-lunch-partner-sport',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '午间运动',
      tag: '运动',
      remark: '三段重叠测试 B',
      date: SEED_DATE,
      startTime: '12:15',
      endTime: '13:15',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-lunch-me-english',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '英语听力',
      tag: '英语',
      remark: '与午间阅读错开，单用户不重叠',
      date: SEED_DATE,
      startTime: '13:30',
      endTime: '14:00',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-afternoon-code-me',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '写代码',
      tag: '写代码',
      remark: '下午专注开发新功能模块',
      date: SEED_DATE,
      startTime: '14:00',
      endTime: '15:30',
      timeText: null,
      estimatedMinutes: 90,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-afternoon-review-partner',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '代码 Review',
      tag: '写代码',
      remark: '与我的开发时段部分重叠',
      date: SEED_DATE,
      startTime: '14:30',
      endTime: '15:00',
      timeText: null,
      estimatedMinutes: 30,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-short-walk-me',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '散步',
      tag: '运动',
      remark: null,
      date: SEED_DATE,
      startTime: '16:00',
      endTime: '16:30',
      timeText: null,
      estimatedMinutes: 30,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-evening-gym-partner',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '健身房',
      tag: '运动',
      remark: '与项目复盘时段部分重叠',
      date: SEED_DATE,
      startTime: '20:00',
      endTime: '21:00',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-afternoon-period-partner',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '整理笔记',
      tag: '阅读',
      remark: '下午时段的模糊计划',
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '下午',
      estimatedMinutes: 45,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-evening-period-me',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '写日记',
      tag: '其它',
      remark: '晚上时段的模糊计划',
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '晚上',
      estimatedMinutes: 20,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-allday-partner',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '取快递',
      tag: '其它',
      remark: '全天都可以做',
      date: SEED_DATE,
      startTime: null,
      endTime: null,
      timeText: '今天',
      estimatedMinutes: 15,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-english-23',
      ownerKey: 'me',
      ownerName: '我',
      ownerAvatar: '我',
      color: 'green',
      title: '英语阅读',
      tag: '英语',
      remark: null,
      date: '2026-05-23',
      startTime: null,
      endTime: null,
      timeText: '今天',
      estimatedMinutes: 40,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-code-30',
      ownerKey: 'partner',
      ownerName: 'W',
      ownerAvatar: 'W',
      color: 'blue',
      title: '代码整理',
      tag: '写代码',
      remark: null,
      date: '2026-05-30',
      startTime: '10:00',
      endTime: '11:00',
      timeText: null,
      estimatedMinutes: 60,
      completionMode: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
  ],
  completedRecords: [
    {
      id: 'record-english',
      planId: 'plan-old-english',
      ownerKey: 'me',
      title: '背英语单词',
      tag: '英语',
      detail: '背完 Unit 3 单词',
      completedAt: now,
      completionMode: 'timed',
      actualMinutes: 40,
      wasOverdue: true,
    },
    {
      id: 'record-read',
      planId: 'plan-old-read',
      ownerKey: 'partner',
      title: '阅读',
      tag: '阅读',
      detail: '读完一章',
      completedAt: now,
      completionMode: 'manual',
      actualMinutes: null,
      wasOverdue: false,
    },
  ],
}

export const getToday = () => formatDateValue(new Date())

export const getOwnerAvatarUrl = (ownerKey: OwnerKey) => AVATARS[ownerKey]

export const ensureLocalData = () => {
  const data = wx.getStorageSync(STORAGE_KEY) as AppData | ''

  if (!data) {
    wx.setStorageSync(STORAGE_KEY, seedData)
  }
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

  return { ok: true, plan }
}

export const deletePlan = (planId: string) => {
  const data = getLocalData()
  saveLocalData({
    ...data,
    plans: data.plans.filter((plan) => plan.id !== planId),
  })
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
    completedAt,
    completionMode: target.completionMode,
    actualMinutes: null,
    wasOverdue: target.status === 'overdue',
  }

  saveLocalData({
    plans: data.plans.map((plan) => plan.id === planId ? { ...plan, status: 'completed', updatedAt: completedAt } : plan),
    completedRecords: [record, ...data.completedRecords],
  })
}

export const formatDate = formatDateValue
