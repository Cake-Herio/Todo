import { registerCloudMutateHandler } from './cloud-bridge'
import { getCloudEnvId, isCloudEnabled, SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import {
  getLocalData,
  saveLocalData,
  type CompletedRecord,
  type OwnerKey,
  type Plan,
} from './data'
import { refreshSpaceMembersFromCloud } from './owner-filters'
import { saveCachedCloudTags, syncPlanTagsFromCloud } from './plan-tags'
import { getSession, isSessionReady, type UserSession, getPartnerDisplayNickname } from './session'

const BOOTSTRAP_KEY = 'myforest_cloud_bootstrapped'
const SYNC_DEBOUNCE_MS = 800

export const resetCloudBootstrap = () => {
  wx.removeStorageSync(BOOTSTRAP_KEY)
}

let syncPromise: Promise<boolean> | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pushPromise: Promise<void> | null = null

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

const pushLocalDataToCloud = async (session: UserSession) => {
  const local = getLocalData()
  const db = getDb()

  const [cloudPlans, cloudRecords] = await Promise.all([
    fetchCloudCollection<CloudPlanDoc>('plans', session.sharedSpaceId),
    fetchCloudCollection<CloudRecordDoc>('completed_records', session.sharedSpaceId),
  ])

  const localPlanIds = new Set(local.plans.map((plan) => plan.id))
  const localRecordIds = new Set(local.completedRecords.map((record) => record.id))

  await Promise.all([
    ...local.plans.map((plan) =>
      upsertCloudDoc('plans', session.sharedSpaceId, plan.id, planToCloudDoc(plan, session) as unknown as Record<string, unknown>),
    ),
    ...local.completedRecords.map((record) =>
      upsertCloudDoc('completed_records', session.sharedSpaceId, record.id, recordToCloudDoc(record, session) as unknown as Record<string, unknown>),
    ),
    ...cloudPlans
      .filter((plan) => plan._id && !localPlanIds.has(plan.id))
      .map((plan) => db.collection('plans').doc(plan._id!).remove()),
    ...cloudRecords
      .filter((record) => record._id && !localRecordIds.has(record.id))
      .map((record) => db.collection('completed_records').doc(record._id!).remove()),
  ])

  wx.setStorageSync(BOOTSTRAP_KEY, true)
}

export const initCloudSync = () => {
  if (!isCloudEnabled()) {
    return
  }

  registerCloudMutateHandler(() => {
    scheduleCloudPush()
  })
}

const mergeByUpdatedAt = <T extends { id: string; updatedAt: number }>(localItems: T[], cloudItems: T[]): T[] => {
  const merged = new Map<string, T>()

  cloudItems.forEach((item) => {
    merged.set(item.id, item)
  })

  localItems.forEach((localItem) => {
    const cloudItem = merged.get(localItem.id)

    if (!cloudItem || localItem.updatedAt >= cloudItem.updatedAt) {
      merged.set(localItem.id, localItem)
    }
  })

  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

const mergeRecordsByCompletedAt = (localItems: CompletedRecord[], cloudItems: CompletedRecord[]): CompletedRecord[] => {
  const merged = new Map<string, CompletedRecord>()

  cloudItems.forEach((item) => {
    merged.set(item.id, item)
  })

  localItems.forEach((localItem) => {
    const cloudItem = merged.get(localItem.id)

    if (!cloudItem || localItem.completedAt >= cloudItem.completedAt) {
      merged.set(localItem.id, localItem)
    }
  })

  return Array.from(merged.values()).sort((a, b) => b.completedAt - a.completedAt)
}

export const flushCloudPush = async (): Promise<void> => {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }

  await pushLocalDataToCloudNow()
}

export const scheduleCloudPush = () => {
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

  pushPromise = (async () => {
    try {
      await pushLocalDataToCloud(session)
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

  await refreshSpaceMembersFromCloud()
  const [dataChanged, tagsChanged] = await Promise.all([syncFromCloud(), syncPlanTagsFromCloud()])
  return dataChanged || tagsChanged
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
      const bootstrapped = wx.getStorageSync(BOOTSTRAP_KEY) as boolean

      if (cloudPlanDocs.length === 0 && cloudRecordDocs.length === 0 && !bootstrapped && (local.plans.length > 0 || local.completedRecords.length > 0)) {
        await pushLocalDataToCloud(session)
        return false
      }

      const cloudPlans = cloudPlanDocs.map((doc) => cloudPlanToPlan(doc, session))
      const cloudRecords = cloudRecordDocs.map((doc) => cloudRecordToRecord(doc, session))
      const plans = mergeByUpdatedAt(local.plans, cloudPlans)
      const completedRecords = mergeRecordsByCompletedAt(local.completedRecords, cloudRecords)

      const changed =
        JSON.stringify(local.plans) !== JSON.stringify(plans) ||
        JSON.stringify(local.completedRecords) !== JSON.stringify(completedRecords)

      if (changed) {
        saveLocalData({ plans, completedRecords })
      }

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
