import {
  formatDate,
  getPlans,
  getToday,
  type OwnerKey,
  type Plan,
  type PlanStatus,
} from './data'
import type { AiPlanDraft, AiPlanContextItem, AiDeleteSpec, AiPlanBatchResponse, AiPlanUpdateItem, AiReuseItem } from './deepseek'
import { resolvePlanTag } from './plan-tags'

export type AiConfirmMode = 'create' | 'reuse' | 'update' | 'delete'

export type AiConfirmCardKind = 'add' | 'delete' | 'update'

export interface AiConfirmCardView {
  id: string
  kind: AiConfirmCardKind
  badgeText: string
  sourceLabel?: string
  tag: string
  dateLabel: string
  timeLabel: string
  remark: string
  statusLabel?: string
  diffRows?: Array<{ label: string; before: string; after: string; changed: boolean }>
}

export interface AiUpdatePayload {
  planId: string
  ownerKey: OwnerKey
  title: string
  tag: string
  tagId?: string
  remark: string | null
  date: string
  startTime: string | null
  endTime: string | null
  timeText: string | null
  estimatedMinutes: number | null
  changedFields: Array<'date' | 'time' | 'tag' | 'remark'>
}

const STATUS_LABELS: Partial<Record<PlanStatus, string>> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  overdue: '已逾期',
}

const shiftDate = (baseDate: string, days: number) => {
  const date = new Date(`${baseDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

export const inferDateScopeFromText = (text: string, today: string = getToday()): string[] => {
  const dates = new Set<string>()

  if (/昨天|昨日/.test(text)) {
    dates.add(shiftDate(today, -1))
  }

  if (/前天/.test(text)) {
    dates.add(shiftDate(today, -2))
  }

  if (/今天|今日/.test(text)) {
    dates.add(today)
  }

  if (/明天/.test(text)) {
    dates.add(shiftDate(today, 1))
  }

  if (/后天/.test(text)) {
    dates.add(shiftDate(today, 2))
  }

  for (let offset = -7; offset <= 7; offset += 1) {
    dates.add(shiftDate(today, offset))
  }

  return Array.from(dates).sort()
}

export const buildAiPlanContext = (
  dateScope: string[],
  options?: {
    ownerFilter?: OwnerKey | 'all'
    maxItems?: number
    includeCompleted?: boolean
  },
): { items: AiPlanContextItem[]; truncated: boolean } => {
  const maxItems = options?.maxItems ?? 30
  const ownerFilter = options?.ownerFilter ?? 'me'
  const includeCompleted = options?.includeCompleted ?? false
  const scopeSet = new Set(dateScope)

  const matched = getPlans().filter((plan) => {
    if (plan.status === 'cancelled') {
      return false
    }

    if (!includeCompleted && plan.status === 'completed') {
      return false
    }

    if (!plan.date || !scopeSet.has(plan.date)) {
      return false
    }

    if (ownerFilter !== 'all' && plan.ownerKey !== ownerFilter) {
      return false
    }

    return true
  })

  const sorted = matched.sort((a, b) => {
    const dateCompare = (a.date || '').localeCompare(b.date || '')

    if (dateCompare !== 0) {
      return dateCompare
    }

    return (a.startTime || '').localeCompare(b.startTime || '')
  })

  return {
    items: sorted.slice(0, maxItems).map(toContextItem),
    truncated: sorted.length > maxItems,
  }
}

const toContextItem = (plan: Plan): AiPlanContextItem => ({
  id: plan.id,
  date: plan.date,
  tag: plan.tag,
  tagId: plan.tagId,
  ownerKey: plan.ownerKey,
  startTime: plan.startTime,
  endTime: plan.endTime,
  timeText: plan.timeText,
  status: plan.status === 'cancelled' ? 'pending' : plan.status,
  remark: plan.remark,
})

export const formatPlanDateLabel = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export const formatPlanTimeLabel = (plan: Pick<Plan, 'startTime' | 'endTime' | 'timeText'>) => {
  if (plan.startTime && plan.endTime) {
    return `${plan.startTime} - ${plan.endTime}`
  }

  return plan.timeText || plan.startTime || '未定时间'
}

const formatDraftTimeLabel = (plan: AiPlanDraft) => {
  if (plan.startTime && plan.endTime) {
    return `${plan.startTime} - ${plan.endTime}`
  }

  return plan.timeText || plan.startTime || '未定时间'
}

const resolveRelativeDate = (timeText: string | null, today = getToday()) => {
  if (!timeText) {
    return today
  }

  if (timeText.includes('后天')) {
    return shiftDate(today, 2)
  }

  if (timeText.includes('明天')) {
    return shiftDate(today, 1)
  }

  if (timeText.includes('昨天') || timeText.includes('昨日')) {
    return shiftDate(today, -1)
  }

  return today
}

export const resolveDeletePlanIds = (
  deleteSpec: AiDeleteSpec,
  plans: Plan[],
  contextIds: Set<string>,
): string[] => {
  const ownerKey = deleteSpec.ownerKey || 'me'
  const activePlans = plans.filter((plan) => plan.status !== 'cancelled')

  if (deleteSpec.scope === 'by_ids') {
    return deleteSpec.planIds.filter((id) => contextIds.has(id))
  }

  if (deleteSpec.scope === 'date_all') {
    if (!deleteSpec.date) {
      return []
    }

    return activePlans
      .filter((plan) => {
        if (plan.date !== deleteSpec.date) {
          return false
        }

        if (ownerKey === 'all') {
          return true
        }

        return plan.ownerKey === ownerKey
      })
      .map((plan) => plan.id)
      .filter((id) => contextIds.has(id))
  }

  if (deleteSpec.scope === 'date_tag') {
    if (!deleteSpec.date || !deleteSpec.tag) {
      return []
    }

    const tag = resolvePlanTag(deleteSpec.tag)

    return activePlans
      .filter((plan) => {
        if (plan.date !== deleteSpec.date) {
          return false
        }

        if (resolvePlanTag(plan.tag) !== tag) {
          return false
        }

        if (ownerKey === 'all') {
          return true
        }

        return plan.ownerKey === ownerKey
      })
      .map((plan) => plan.id)
      .filter((id) => contextIds.has(id))
  }

  return []
}

export const buildDeleteSummary = (deleteSpec: AiDeleteSpec, planIds: string[]) => {
  if (deleteSpec.scope !== 'date_all' || !deleteSpec.date) {
    return ''
  }

  const dateLabel = formatPlanDateLabel(deleteSpec.date)
  return `将删除 ${dateLabel} 的全部 ${planIds.length} 条计划`
}

export const resolveReuseDrafts = (
  reuses: AiReuseItem[],
  plans: AiPlanDraft[] | undefined,
  allPlans: Plan[],
): Array<{ draft: AiPlanDraft; sourceLabel: string; ownerKey: OwnerKey }> => {
  if (plans?.length) {
    return plans.map((draft, index) => {
      const reuse = reuses[index]
      const sourcePlan = reuse ? allPlans.find((plan) => plan.id === reuse.sourcePlanId) : null
      const sourceLabel = sourcePlan
        ? `复用自 ${formatPlanDateLabel(sourcePlan.date || getToday())} ${sourcePlan.tag}`
        : reuse
          ? '复用计划'
          : ''

      return {
        draft,
        sourceLabel,
        ownerKey: sourcePlan?.ownerKey || 'me',
      }
    })
  }

  return reuses.flatMap((reuse) => {
    const sourcePlan = allPlans.find((plan) => plan.id === reuse.sourcePlanId)

    if (!sourcePlan) {
      return []
    }

    const draft = copyPlanToDraft(sourcePlan, reuse.targetDate, reuse.patch)

    return [{
      draft,
      sourceLabel: `复用自 ${formatPlanDateLabel(sourcePlan.date || getToday())} ${sourcePlan.tag}`,
      ownerKey: sourcePlan.ownerKey,
    }]
  })
}

export const copyPlanToDraft = (
  plan: Plan,
  targetDate: string,
  patch: Partial<Pick<AiPlanDraft, 'defaultTag' | 'remark' | 'startTime' | 'endTime' | 'timeText'>>,
): AiPlanDraft => {
  const tag = patch.defaultTag ? resolvePlanTag(patch.defaultTag) : plan.tag

  return {
    title: tag,
    section: plan.tag,
    defaultTag: tag,
    remark: patch.remark !== undefined ? patch.remark : plan.remark,
    date: targetDate,
    startTime: patch.startTime !== undefined ? patch.startTime : plan.startTime,
    endTime: patch.endTime !== undefined ? patch.endTime : plan.endTime,
    timeText: patch.timeText !== undefined ? patch.timeText : plan.timeText,
    estimatedMinutes: plan.estimatedMinutes,
    completionMode: 'manual',
    certainty: {
      date: 'certain',
      time: patch.startTime && patch.endTime ? 'certain' : patch.timeText ? 'vague' : 'unknown',
    },
  }
}

export const resolveUpdatePayloads = (
  updates: AiPlanUpdateItem[],
  plans: Plan[],
  contextIds: Set<string>,
): AiUpdatePayload[] =>
  updates.flatMap((update) => {
    if (!contextIds.has(update.planId)) {
      return []
    }

    const target = plans.find((plan) => plan.id === update.planId)

    if (!target || target.status === 'completed' || target.status === 'cancelled') {
      return []
    }

    const patch = update.patch
    const nextTag = patch.defaultTag ? resolvePlanTag(patch.defaultTag) : target.tag
    const nextDate = patch.date || target.date || getToday()
    const nextRemark = patch.remark !== undefined ? patch.remark : target.remark
    const nextStartTime = patch.startTime !== undefined ? patch.startTime : target.startTime
    const nextEndTime = patch.endTime !== undefined ? patch.endTime : target.endTime
    const nextTimeText = patch.timeText !== undefined ? patch.timeText : target.timeText
    const changedFields: AiUpdatePayload['changedFields'] = []

    if (patch.defaultTag && resolvePlanTag(patch.defaultTag) !== target.tag) {
      changedFields.push('tag')
    }

    if (patch.date && patch.date !== target.date) {
      changedFields.push('date')
    }

    if (
      patch.startTime !== undefined ||
      patch.endTime !== undefined ||
      patch.timeText !== undefined
    ) {
      if (
        nextStartTime !== target.startTime ||
        nextEndTime !== target.endTime ||
        nextTimeText !== target.timeText
      ) {
        changedFields.push('time')
      }
    }

    if (patch.remark !== undefined && patch.remark !== target.remark) {
      changedFields.push('remark')
    }

    if (changedFields.length === 0) {
      return []
    }

    return [{
      planId: target.id,
      ownerKey: target.ownerKey,
      title: nextTag,
      tag: nextTag,
      tagId: target.tagId,
      remark: nextRemark,
      date: nextDate,
      startTime: nextStartTime,
      endTime: nextEndTime,
      timeText: nextTimeText,
      estimatedMinutes: target.estimatedMinutes,
      changedFields,
    }]
  })

export const mapAddConfirmCards = (
  entries: Array<{ id: string; plan: AiPlanDraft; sourceLabel?: string }>,
  mode: 'create' | 'reuse',
): AiConfirmCardView[] =>
  entries.map((entry) => {
    const date = entry.plan.date || resolveRelativeDate(entry.plan.timeText)

    return {
      id: entry.id,
      kind: 'add',
      badgeText: mode === 'reuse' ? '复用' : '新增',
      sourceLabel: entry.sourceLabel,
      tag: resolvePlanTag(entry.plan.defaultTag || entry.plan.section),
      dateLabel: formatPlanDateLabel(date),
      timeLabel: formatDraftTimeLabel(entry.plan),
      remark: entry.plan.remark || '无补充备注',
    }
  })

export const mapDeleteConfirmCards = (planIds: string[], plans: Plan[]): AiConfirmCardView[] =>
  planIds.flatMap((planId) => {
    const plan = plans.find((item) => item.id === planId)

    if (!plan) {
      return []
    }

    return [{
      id: plan.id,
      kind: 'delete',
      badgeText: '删除',
      tag: plan.tag,
      dateLabel: formatPlanDateLabel(plan.date || getToday()),
      timeLabel: formatPlanTimeLabel(plan),
      remark: plan.remark || '无补充备注',
      statusLabel: STATUS_LABELS[plan.status],
    }]
  })

export const mapUpdateConfirmCards = (payloads: AiUpdatePayload[], plans: Plan[]): AiConfirmCardView[] =>
  payloads.flatMap((payload) => {
    const before = plans.find((plan) => plan.id === payload.planId)

    if (!before) {
      return []
    }

    const diffRows = [
      {
        label: '标签',
        before: before.tag,
        after: payload.tag,
        changed: payload.changedFields.includes('tag'),
      },
      {
        label: '日期',
        before: formatPlanDateLabel(before.date || getToday()),
        after: formatPlanDateLabel(payload.date),
        changed: payload.changedFields.includes('date'),
      },
      {
        label: '时间',
        before: formatPlanTimeLabel(before),
        after: formatPlanTimeLabel(payload),
        changed: payload.changedFields.includes('time'),
      },
      {
        label: '备注',
        before: before.remark || '无',
        after: payload.remark || '无',
        changed: payload.changedFields.includes('remark'),
      },
    ]

    return [{
      id: payload.planId,
      kind: 'update',
      badgeText: '修改',
      tag: payload.tag,
      dateLabel: formatPlanDateLabel(payload.date),
      timeLabel: formatPlanTimeLabel(payload),
      remark: payload.remark || '无补充备注',
      diffRows,
    }]
  })

export interface ResolvedBatchDraft {
  ownerKey: OwnerKey
  plan: AiPlanDraft
  sourceLabel?: string
}

export interface ResolvedBatchState {
  drafts: ResolvedBatchDraft[]
  deletePlanIds: string[]
  updatePayloads: AiUpdatePayload[]
}

export const resolveBatchConfirmState = (
  batch: AiPlanBatchResponse,
  contextIds: Set<string>,
): ResolvedBatchState => {
  const deletePlanIds = batch.delete
    ? resolveDeletePlanIds(batch.delete, getPlans(), contextIds)
    : []
  const updatePayloads = resolveUpdatePayloads(batch.updates, getPlans(), contextIds)

  const createDrafts: ResolvedBatchDraft[] = batch.creates.map((plan) => ({
    ownerKey: 'me',
    plan,
  }))

  const reuseDrafts = resolveReuseDrafts(batch.reuses, batch.reusePlans, getPlans()).map((item) => ({
    ownerKey: item.ownerKey,
    plan: item.draft,
    sourceLabel: item.sourceLabel,
  }))

  return {
    drafts: [...createDrafts, ...reuseDrafts],
    deletePlanIds,
    updatePayloads,
  }
}

export const hasBatchOperations = (state: ResolvedBatchState) =>
  state.drafts.length > 0 || state.deletePlanIds.length > 0 || state.updatePayloads.length > 0

export const mergeBatchConfirmState = (
  existing: ResolvedBatchState,
  incoming: ResolvedBatchState,
): ResolvedBatchState => {
  const updateMap = new Map(existing.updatePayloads.map((item) => [item.planId, item]))
  incoming.updatePayloads.forEach((item) => {
    updateMap.set(item.planId, item)
  })

  return {
    drafts: [...existing.drafts, ...incoming.drafts],
    deletePlanIds: Array.from(new Set([...existing.deletePlanIds, ...incoming.deletePlanIds])),
    updatePayloads: Array.from(updateMap.values()),
  }
}

export const replaceBatchConfirmState = (
  _existing: ResolvedBatchState,
  incoming: ResolvedBatchState,
): ResolvedBatchState => incoming
