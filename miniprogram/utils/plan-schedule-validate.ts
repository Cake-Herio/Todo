import { findSameOwnerTimedConflict, type OwnerKey } from './data'
import { ScheduleTimeHelper } from './schedule-time'
import { type AiPlanError } from './deepseek'

interface ScheduleInput {
  ownerKey: OwnerKey
  date: string
  startTime: string
  endTime: string
  label: string
}

export interface ValidatedResult {
  validCreateIndices: number[]
  validUpdateIndices: number[]
  errors: AiPlanError[]
}

const mkError = (code: AiPlanError['code'], message: string, target?: string): AiPlanError => ({ code, message, target })

const timedPlansOverlap = (a: ScheduleInput, b: ScheduleInput): boolean =>
  a.ownerKey === b.ownerKey &&
  a.date === b.date &&
  ScheduleTimeHelper.parseToMinutes(a.startTime) < ScheduleTimeHelper.parseToMinutes(b.endTime, true) &&
  ScheduleTimeHelper.parseToMinutes(b.startTime) < ScheduleTimeHelper.parseToMinutes(a.endTime, true)

export const validateBatchSchedule = (input: {
  creates: Array<{
    ownerKey: OwnerKey
    label: string
    date: string | null
    startTime: string | null
    endTime: string | null
  }>
  updates: Array<{
    planId: string
    ownerKey: OwnerKey
    label: string
    date: string
    startTime: string | null
    endTime: string | null
  }>
}): ValidatedResult => {
  const errors: AiPlanError[] = []
  const validCreateIndices: number[] = []
  const validUpdateIndices: number[] = []
  const validTimed: ScheduleInput[] = []

  // --- validate creates ---
  for (let i = 0; i < input.creates.length; i++) {
    const c = input.creates[i]
    const startTime = c.startTime?.trim()
    const endTime = c.endTime?.trim()
    const date = c.date?.trim()

    // fuzzy time — always valid
    if (!startTime || !endTime || !date) {
      validCreateIndices.push(i)
      continue
    }

    if (!ScheduleTimeHelper.isValidTimeRange(startTime, endTime)) {
      errors.push(mkError('INVALID_TIME_RANGE', `「${c.label}」${startTime}-${endTime} 开始时间不能晚于结束时间`, `creates[${i}]`))
      continue
    }

    const conflict = findSameOwnerTimedConflict({ ownerKey: c.ownerKey, date, startTime, endTime })

    if (conflict) {
      const confStart = conflict.startTime || ''
      const confEnd = conflict.endTime || ''
      errors.push(mkError('TIME_OVERLAP', `「${c.label}」${startTime}-${endTime} 与「${conflict.tag}」${confStart}-${confEnd} 时段重叠`, `creates[${i}]`))
      continue
    }

    validCreateIndices.push(i)
    validTimed.push({ ownerKey: c.ownerKey, date, startTime, endTime, label: c.label })
  }

  // --- validate updates ---
  for (let i = 0; i < input.updates.length; i++) {
    const u = input.updates[i]
    const startTime = u.startTime?.trim()
    const endTime = u.endTime?.trim()

    if (!startTime || !endTime || !u.date) {
      validUpdateIndices.push(i)
      continue
    }

    if (!ScheduleTimeHelper.isValidTimeRange(startTime, endTime)) {
      errors.push(mkError('INVALID_TIME_RANGE', `「${u.label}」${startTime}-${endTime} 开始时间不能晚于结束时间`, `updates[${i}]`))
      continue
    }

    const conflict = findSameOwnerTimedConflict({
      ownerKey: u.ownerKey,
      date: u.date,
      startTime,
      endTime,
      excludePlanId: u.planId,
    })

    if (conflict) {
      const confStart = conflict.startTime || ''
      const confEnd = conflict.endTime || ''
      errors.push(mkError('TIME_OVERLAP', `「${u.label}」${startTime}-${endTime} 与「${conflict.tag}」${confStart}-${confEnd} 时段重叠`, `updates[${i}]`))
      continue
    }

    validUpdateIndices.push(i)
    validTimed.push({ ownerKey: u.ownerKey, date: u.date, startTime, endTime, label: u.label })
  }

  // --- batch-internal overlap check ---
  for (let i = 0; i < validTimed.length; i++) {
    for (let j = i + 1; j < validTimed.length; j++) {
      if (timedPlansOverlap(validTimed[i], validTimed[j])) {
        const a = validTimed[i]
        const b = validTimed[j]
        errors.push(mkError('TIME_OVERLAP', `「${a.label}」${a.startTime}-${a.endTime} 与「${b.label}」${b.startTime}-${b.endTime} 时段重叠`))
      }
    }
  }

  return { validCreateIndices, validUpdateIndices, errors }
}
