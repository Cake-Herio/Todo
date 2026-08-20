import { registerCloudMutateHandler, type CloudMutation } from './cloud-bridge'
import { getCloudEnvId, isCloudEnabled, SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import {
  clearCompletedRecordDeletion,
  getDeletedCompletedRecordIds,
  getLocalData,
  saveLocalData,
  type CompletedRecord,
  type OwnerKey,
  type Plan,
  type TimedCompletionDraft,
} from './data'
import { refreshSpaceMembersFromCloud } from './owner-filters'
import { saveCachedCloudTags, syncPlanTagsFromCloud } from './plan-tags'
import { getSession, isSessionReady, type UserSession, getPartnerDisplayNickname } from './session'

const BOOTSTRAP_KEY = 'myforest_cloud_bootstrapped'
const PENDING_MUTATIONS_KEY = 'myforest_cloud_pending_mutations_v1'
const SYNC_DEBOUNCE_MS = 800

export const resetCloudBootstrap = () => {
  wx.removeStorageSync(BOOTSTRAP_KEY)
  wx.removeStorageSync(PENDING_MUTATIONS_KEY)

  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
}

let syncPromise: Promise<boolean> | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pushPromise: Promise<void> | null = null
let bootstrapPromise: Promise<boolean> | null = null

interface CloudPlanDoc extends Omit<Plan, 'ownerKey' | 'ownerName' | 'ownerAvatar' | 'color'> {
  _id?: string
  userId: string
  sharedSpaceId: string
}

interface CloudRecordDoc extends Omit<CompletedRecord, 'ownerKey'> {
  _id?: string
  userId: string
  sharedSpaceId: string
}

interface SyncSharedDataResult {
  ok?: boolean
  message?: string
  plans?: CloudPlanDoc[]
  records?: CloudRecordDoc[]
  tags?: Array<{
    id: string
    name: string
    color: string
    visibility: 'shared' | 'private'
    ownerOpenid?: string
    sharedSpaceId?: string
  }>
}

interface SharedCloudPayload {
  plans: CloudPlanDoc[]
  records: CloudRecordDoc[]
  tags: SyncSharedDataResult['tags']
}

const getDb = () => wx.cloud.database()

interface PendingCloudMutations {
  planIds: string[]
  completedRecordIds: string[]
  deletedPlanIds: string[]
  deletedCompletedRecordIds: string[]
}

const emptyPendingMutations = (): PendingCloudMutations => ({
  planIds: [],
  completedRecordIds: [],
  deletedPlanIds: [],
  deletedCompletedRecordIds: [],
})

const getPendingMutations = (): PendingCloudMutations => {
  const stored = wx.getStorageSync(PENDING_MUTATIONS_KEY) as Partial<PendingCloudMutations> | ''
  const pending = emptyPendingMutations()

  if (stored) {
    ;(['planIds', 'completedRecordIds', 'deletedPlanIds', 'deletedCompletedRecordIds'] as const).forEach((key) => {
      const values = stored[key]
      if (Array.isArray(values)) {
        pending[key] = Array.from(new Set(values.filter((id): id is string => typeof id === 'string' && Boolean(id))))
      }
    })
  }

  getDeletedCompletedRecordIds().forEach((id) => {
    if (!pending.deletedCompletedRecordIds.includes(id)) {
      pending.deletedCompletedRecordIds.push(id)
    }
  })

  return pending
}

const hasPendingMutations = (pending: PendingCloudMutations) =>
  Object.values(pending).some((ids) => ids.length > 0)

const savePendingMutations = (pending: PendingCloudMutations) => {
  wx.setStorageSync(PENDING_MUTATIONS_KEY, pending)
}

const mergePendingMutations = (mutation: CloudMutation = {}) => {
  const pending = getPendingMutations()
  const add = (key: keyof PendingCloudMutations, values?: string[]) => {
    if (!values?.length) {
      return
    }

    pending[key] = Array.from(new Set([...pending[key], ...values.filter(Boolean)]))
  }

  add('planIds', mutation.planIds)
  add('completedRecordIds', mutation.completedRecordIds)
  add('deletedPlanIds', mutation.deletedPlanIds)
  add('deletedCompletedRecordIds', mutation.deletedCompletedRecordIds)

  pending.planIds = pending.planIds.filter((id) => !pending.deletedPlanIds.includes(id))
  pending.completedRecordIds = pending.completedRecordIds.filter(
    (id) => !pending.deletedCompletedRecordIds.includes(id),
  )
  savePendingMutations(pending)
}

const subtractPendingMutations = (source: PendingCloudMutations, completed: PendingCloudMutations) => {
  const next = emptyPendingMutations()
  ;(['planIds', 'completedRecordIds', 'deletedPlanIds', 'deletedCompletedRecordIds'] as const).forEach((key) => {
    next[key] = source[key].filter((id) => !completed[key].includes(id))
  })
  savePendingMutations(next)
}

// 保留旧函数名，兼容开发者工具可能尚未清理的热重载代码；实际结果仍以云端为准。
const mergeByUpdatedAt = <T extends { id: string }>(_localItems: T[], cloudItems: T[]) => cloudItems

const mergeRecordsByCompletedAt = (_localItems: CompletedRecord[], cloudItems: CompletedRecord[]) => cloudItems

const resolveOwnerKey = (userId: string, session: UserSession): OwnerKey =>
  userId === session.openid ? 'me' : 'partner'

const resolveOwnerDisplay = (ownerKey: OwnerKey, session: UserSession) => {
  if (ownerKey === 'me') {
    return {
      ownerName: session.nickname || '我',
      ownerAvatar: session.nickname?.slice(0, 1) || '我',
      color: 'green' as const,
    }
  }

  return {
    ownerName: getPartnerDisplayNickname(),
    ownerAvatar: session.partnerNickname?.slice(0, 1) || 'W',
    color: 'blue' as const,
  }
}

const cloudPlanToPlan = (doc: CloudPlanDoc, session: UserSession): Plan => {
  const ownerKey = resolveOwnerKey(doc.userId, session)
  const display = resolveOwnerDisplay(ownerKey, session)

  return {
    id: doc.id,
    ownerKey,
    ownerName: display.ownerName,
    ownerAvatar: display.ownerAvatar,
    color: display.color,
    title: doc.title,
    tag: doc.tag,
    tagId: doc.tagId,
    remark: doc.remark,
    date: doc.date,
    startTime: doc.startTime,
    endTime: doc.endTime,
    timeText: doc.timeText,
    estimatedMinutes: doc.estimatedMinutes,
    completionMode: doc.completionMode,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

const cloudRecordToRecord = (doc: CloudRecordDoc, session: UserSession): CompletedRecord => ({
  id: doc.id,
  planId: doc.planId,
  ownerKey: resolveOwnerKey(doc.userId, session),
  title: doc.title,
  tag: doc.tag,
  tagId: doc.tagId,
  detail: doc.detail,
  startedAt: doc.startedAt,
  completedAt: doc.completedAt,
  completionMode: doc.completionMode,
  actualMinutes: doc.actualMinutes,
  wasOverdue: doc.wasOverdue,
})

const planToCloudDoc = (plan: Plan, session: UserSession): CloudPlanDoc => {
  const userId = plan.ownerKey === 'me' ? session.openid : session.partnerOpenid || session.openid

  return {
    id: plan.id,
    userId,
    sharedSpaceId: session.sharedSpaceId,
    title: plan.title,
    tag: plan.tag,
    tagId: plan.tagId,
    remark: plan.remark,
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    timeText: plan.timeText,
    estimatedMinutes: plan.estimatedMinutes,
    completionMode: plan.completionMode,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}

const recordToCloudDoc = (record: CompletedRecord, session: UserSession): CloudRecordDoc => {
  const userId = record.ownerKey === 'me' ? session.openid : session.partnerOpenid || session.openid

  return {
    id: record.id,
    planId: record.planId,
    userId,
    sharedSpaceId: session.sharedSpaceId,
    title: record.title,
    tag: record.tag,
    tagId: record.tagId,
    detail: record.detail,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    completionMode: record.completionMode,
    actualMinutes: record.actualMinutes,
    wasOverdue: record.wasOverdue,
  }
}

const fetchCloudCollection = async <T>(collectionName: string, sharedSpaceId: string) => {
  const db = getDb()
  const limit = 100
  let skip = 0
  const all: T[] = []

  while (true) {
    const res = await db
      .collection(collectionName)
      .where({ sharedSpaceId })
      .skip(skip)
      .limit(limit)
      .get()

    all.push(...(res.data as T[]))

    if (res.data.length < limit) {
      break
    }

    skip += limit
  }

  return all
}

const fetchSharedDataViaCloudFunction = async (): Promise<SharedCloudPayload | null> => {
  const callers = [
    () =>
      wx.cloud.callFunction({
        name: SHARED_SPACE_CLOUD_FUNCTION,
        data: { action: 'syncSharedData' },
      }),
    () =>
      wx.cloud.callFunction({
        name: 'focusPresence',
        data: { action: 'syncSharedData' },
      }),
  ]

  for (const call of callers) {
    try {
      const result = await call()
      const payload = result.result as SyncSharedDataResult

      if (payload?.ok) {
        return {
          plans: payload.plans || [],
          records: payload.records || [],
          tags: payload.tags || [],
        }
      }
    } catch (error) {
      console.warn('[cloud] syncSharedData cloud function failed', error)
    }
  }

  return null
}

const upsertCloudDoc = async (collectionName: string, sharedSpaceId: string, id: string, data: Record<string, unknown>) => {
  const db = getDb()
  const existing = await db.collection(collectionName).where({ sharedSpaceId, id }).limit(1).get()

  if (existing.data.length > 0) {
    const docId = existing.data[0]._id as string
    await db.collection(collectionName).doc(docId).update({ data })
    return
  }

  await db.collection(collectionName).add({ data })
}

const deleteCloudCompletedRecord = async (recordId: string) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'deleteCompletedRecord',
      payload: { id: recordId },
    },
  })
  const payload = result.result as { ok?: boolean }
  if (!payload?.ok) {
    throw new Error('云端删除完成记录失败')
  }
}

export const deleteCompletedRecordOnCloud = async (recordId: string) => {
  await deleteCloudCompletedRecord(recordId)
}

export const updateCompletedRecordOnCloud = async (
  recordId: string,
  patch: { tag?: string; tagId?: string; detail?: string },
) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'updateCompletedRecord',
      payload: { id: recordId, ...patch },
    },
  })
  const payload = result.result as { ok?: boolean; message?: string }
  if (!payload?.ok) {
    throw new Error(payload?.message || '云端更新完成记录失败')
  }
}

export const saveTimedCompletionOnCloud = async (draft: TimedCompletionDraft) => {
  const session = getSession()
  if (!session?.sharedSpaceId) {
    throw new Error('当前未连接共享云端，无法保存计时记录')
  }

  const cloudRecords = draft.records.map((record) => recordToCloudDoc(record, session))
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'saveTimedCompletion',
      payload: {
        records: cloudRecords,
        linkedPlanId: draft.linkedPlanId || '',
      },
    },
  })
  const payload = result.result as { ok?: boolean; message?: string }
  if (!payload?.ok) {
    throw new Error(payload?.message || '云端保存计时记录失败')
  }
}

const deleteCloudPlan = async (planId: string) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'deletePlan',
      payload: { id: planId },
    },
  })
  const payload = result.result as { ok?: boolean }
  if (!payload?.ok) {
    throw new Error('云端删除计划失败')
  }
}

const pushLocalDataToCloud = async (session: UserSession, pending: PendingCloudMutations) => {
  const local = getLocalData()
  const localPlans = new Map(local.plans.map((plan) => [plan.id, plan]))
  const localRecords = new Map(local.completedRecords.map((record) => [record.id, record]))
  const sharedSpaceId = session.sharedSpaceId!

  await Promise.all([
    ...pending.planIds
      .map((id) => localPlans.get(id))
      .filter((plan): plan is Plan => Boolean(plan))
      .map((plan) =>
        upsertCloudDoc('plans', sharedSpaceId, plan.id, planToCloudDoc(plan, session) as unknown as Record<string, unknown>),
      ),
    ...pending.completedRecordIds
      .map((id) => localRecords.get(id))
      .filter((record): record is CompletedRecord => Boolean(record))
      .map((record) =>
        upsertCloudDoc(
          'completed_records',
          sharedSpaceId,
          record.id,
          recordToCloudDoc(record, session) as unknown as Record<string, unknown>,
        ),
      ),
    ...pending.deletedPlanIds.map((id) => deleteCloudPlan(id)),
    ...pending.deletedCompletedRecordIds.map((id) => deleteCloudCompletedRecord(id)),
  ])

  pending.deletedCompletedRecordIds.forEach((id) => clearCompletedRecordDeletion(id))
  subtractPendingMutations(getPendingMutations(), pending)
  wx.setStorageSync(BOOTSTRAP_KEY, true)
}

export const initCloudSync = () => {
  if (!isCloudEnabled()) {
    return
  }

  registerCloudMutateHandler((mutation) => {
    scheduleCloudPush(mutation)
  })
}

export const flushCloudPush = async (): Promise<void> => {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }

  await pushLocalDataToCloudNow()
}

export const scheduleCloudPush = (mutation?: CloudMutation) => {
  mergePendingMutations(mutation)

  if (!isSessionReady()) {
    return
  }

  if (pushTimer) {
    clearTimeout(pushTimer)
  }

  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushLocalDataToCloudNow()
  }, SYNC_DEBOUNCE_MS)
}

const pushLocalDataToCloudNow = async () => {
  if (pushPromise) {
    return pushPromise
  }

  const session = getSession()
  if (!session) {
    return
  }

  const pending = getPendingMutations()
  if (!hasPendingMutations(pending)) {
    return
  }

  pushPromise = (async () => {
    try {
      await pushLocalDataToCloud(session, pending)
    } catch (error) {
      console.warn('[cloud] push failed', error)
    } finally {
      pushPromise = null
    }
  })()

  return pushPromise
}

/** 刷新成员信息并同步共享空间数据到本地 */
export const bootstrapSharedSpace = async (): Promise<boolean> => {
  if (!isSessionReady()) {
    return false
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    await refreshSpaceMembersFromCloud()
    const [dataChanged, tagsChanged] = await Promise.all([syncFromCloud(), syncPlanTagsFromCloud()])
    return dataChanged || tagsChanged
  })()

  try {
    return await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

/** 从云拉取并写入本地缓存，UI 不直接读云 */
export const syncFromCloud = async (): Promise<boolean> => {
  if (!isSessionReady()) {
    return false
  }

  if (syncPromise) {
    return syncPromise
  }

  syncPromise = (async () => {
    const session = getSession()
    if (!session) {
      return false
    }

    try {
      await flushCloudPush()

      const sharedData = await fetchSharedDataViaCloudFunction()
      const [cloudPlanDocs, cloudRecordDocs] = sharedData
        ? [sharedData.plans, sharedData.records]
        : await Promise.all([
            fetchCloudCollection<CloudPlanDoc>('plans', session.sharedSpaceId!),
            fetchCloudCollection<CloudRecordDoc>('completed_records', session.sharedSpaceId!),
          ])

      if (sharedData?.tags?.length) {
        saveCachedCloudTags(
          sharedData.tags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            visibility: tag.visibility,
            ownerOpenid: tag.ownerOpenid,
            sharedSpaceId: tag.sharedSpaceId,
          })),
        )
      }

      const local = getLocalData()

      const cloudPlans = cloudPlanDocs.map((doc) => cloudPlanToPlan(doc, session))
      const deletedRecordIds = new Set(getDeletedCompletedRecordIds())
      const cloudRecords = cloudRecordDocs
        .filter((doc) => !deletedRecordIds.has(doc.id))
        .map((doc) => cloudRecordToRecord(doc, session))
      // 云端是唯一事实来源。只有发生本地明确变更时才会在 fetch 前 flush，
      // 普通刷新不能用本地旧缓存补回云端已删除或已修改的数据。
      const plans = mergeByUpdatedAt(local.plans, cloudPlans)
      const completedRecords = mergeRecordsByCompletedAt(local.completedRecords, cloudRecords)

      const changed =
        JSON.stringify(local.plans) !== JSON.stringify(plans) ||
        JSON.stringify(local.completedRecords) !== JSON.stringify(completedRecords)

      if (changed) {
        saveLocalData({ plans, completedRecords })
      }

      wx.setStorageSync(BOOTSTRAP_KEY, true)
      return changed
    } catch (error) {
      console.warn('[cloud] sync failed', error)
      return false
    } finally {
      syncPromise = null
    }
  })()

  return syncPromise
}

/**
 * 本地优先：先 refresh（读 wx.storage），再在后台拉云更新本地，有变化时再 refresh。
 */
export const refreshWithLocalFirst = (refresh: () => void) => {
  refresh()

  void bootstrapSharedSpace()
    .then((changed) => {
      if (changed) {
        refresh()
      }
    })
    .catch((error) => {
      console.warn('[cloud] background sync skipped', error)
    })
}

export const initCloud = () => {
  if (!isCloudEnabled()) {
    console.warn('[cloud] wx.cloud unavailable')
    return
  }

  const envId = getCloudEnvId()
  if (envId) {
    wx.cloud.init({ env: envId, traceUser: true })
  } else {
    wx.cloud.init({ traceUser: true })
  }

  initCloudSync()
}
