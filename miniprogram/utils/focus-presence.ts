import { preloadAvatar } from './avatar-display'
import { SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import { getSession, isSharedSpaceMode } from './session'

const COLLECTION = 'focus_sessions'

/** 上传专注状态：开始计时时同步已选标签，供同房间主页展示。 */
export interface FocusPresencePayload {
  /** 整场专注的开始时间（用于保存记录） */
  sessionStartedAt: number
  /** 当前段开始之前的累计秒数 */
  accumulatedSeconds: number
  /** 当前计时段的开始时间；暂停时为 0 */
  segmentStartedAt: number
  isPaused: boolean
  tag?: string
}

export interface OwnFocusRestore {
  sessionStartedAt: number
  accumulatedSeconds: number
  segmentStartedAt: number
  isPaused: boolean
}

export interface SelfFocusView {
  name: string
  status: string
  duration: string
  avatarUrl: string
  restore: OwnFocusRestore
}

export interface PartnerFocusView {
  name: string
  status: string
  duration: string
  elapsedSeconds: number
  avatarUrl: string
}

interface FocusSessionDoc {
  _id?: string
  _openid?: string
  userId: string
  sharedSpaceId: string
  tag: string
  detail: string
  linkedPlanId?: string
  sessionStartedAt?: number
  accumulatedSeconds?: number
  segmentStartedAt?: number
  isPaused: boolean
  nickname?: string
  avatarUrl?: string
  /** @deprecated 旧字段，兼容历史数据 */
  startedAt?: number
  /** @deprecated 旧字段，兼容历史数据 */
  elapsedSeconds?: number
  updatedAt: number
}

interface FocusPresenceListResult {
  ok?: boolean
  message?: string
  openid?: string
  sharedSpaceId?: string
  sessions?: FocusSessionDoc[]
}

const getDb = () => wx.cloud.database()

export const canPublishFocusPresence = () => isSharedSpaceMode()

export const formatFocusPresenceDuration = (elapsedSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(Math.max(elapsedSeconds, 0) / 60))
  if (minutes < 60) {
    return `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

const resolveFocusStatusLabel = (doc: FocusSessionDoc) => {
  if (doc.isPaused) {
    return '暂停'
  }

  return doc.tag?.trim() || '专注'
}

const resolveElapsedSeconds = (doc: FocusSessionDoc) => {
  if (typeof doc.accumulatedSeconds === 'number') {
    if (doc.isPaused || !doc.segmentStartedAt) {
      return doc.accumulatedSeconds
    }

    return doc.accumulatedSeconds + Math.floor((Date.now() - doc.segmentStartedAt) / 1000)
  }

  // 兼容旧数据：elapsedSeconds + startedAt
  if (doc.isPaused) {
    return doc.elapsedSeconds ?? 0
  }

  const sessionStart = doc.sessionStartedAt ?? doc.startedAt ?? 0
  if (doc.elapsedSeconds != null && sessionStart) {
    return Math.max(doc.elapsedSeconds, Math.floor((Date.now() - sessionStart) / 1000))
  }

  return doc.elapsedSeconds ?? 0
}

const toOwnFocusRestore = (doc: FocusSessionDoc): OwnFocusRestore => {
  if (typeof doc.accumulatedSeconds === 'number') {
    return {
      sessionStartedAt: doc.sessionStartedAt ?? doc.segmentStartedAt ?? Date.now(),
      accumulatedSeconds: doc.accumulatedSeconds,
      segmentStartedAt: doc.isPaused ? 0 : doc.segmentStartedAt || 0,
      isPaused: doc.isPaused,
    }
  }

  const elapsedSeconds = resolveElapsedSeconds(doc)
  const sessionStartedAt = doc.sessionStartedAt ?? doc.startedAt ?? Date.now()

  return {
    sessionStartedAt,
    accumulatedSeconds: doc.isPaused ? elapsedSeconds : 0,
    segmentStartedAt: doc.isPaused ? 0 : sessionStartedAt,
    isPaused: doc.isPaused,
  }
}

const toSelfFocusView = async (
  doc: FocusSessionDoc,
  session: NonNullable<ReturnType<typeof getSession>>,
): Promise<SelfFocusView> => {
  const elapsedSeconds = resolveElapsedSeconds(doc)
  const rawAvatar = session.avatarUrl || ''
  const avatarUrl = await preloadAvatar(rawAvatar)

  return {
    name: session.nickname || '我',
    status: resolveFocusStatusLabel(doc),
    duration: formatFocusPresenceDuration(elapsedSeconds),
    avatarUrl,
    restore: toOwnFocusRestore(doc),
  }
}

const toPartnerFocusView = async (
  doc: FocusSessionDoc,
): Promise<PartnerFocusView> => {
  const elapsedSeconds = resolveElapsedSeconds(doc)
  const rawAvatar = doc.avatarUrl || ''
  const avatarUrl = await preloadAvatar(rawAvatar)

  return {
    name: doc.nickname || '对方',
    status: resolveFocusStatusLabel(doc),
    duration: formatFocusPresenceDuration(elapsedSeconds),
    elapsedSeconds,
    avatarUrl,
  }
}

const callFocusCloud = async (name: typeof SHARED_SPACE_CLOUD_FUNCTION | 'focusPresence', action: string) => {
  const result = await wx.cloud.callFunction({
    name,
    data: { action },
  })
  const payload = result.result as FocusPresenceListResult

  if (!payload?.ok) {
    throw new Error(payload?.message || `${name} 调用失败`)
  }

  return payload
}

const findOwnFocusDoc = async (session: NonNullable<ReturnType<typeof getSession>>) => {
  const db = getDb()
  const res = await db
    .collection(COLLECTION)
    .where({
      sharedSpaceId: session.sharedSpaceId,
      userId: session.openid,
    })
    .limit(1)
    .get()

  return (res.data[0] as FocusSessionDoc | undefined) || null
}

const isSessionOwnedBy = (doc: FocusSessionDoc, openid: string) =>
  Boolean(openid && (doc.userId === openid || doc._openid === openid))

const listFocusSessions = async (): Promise<{ openid: string; sessions: FocusSessionDoc[] }> => {
  const session = getSession()
  const callers: Array<() => Promise<FocusPresenceListResult>> = [
    () => callFocusCloud(SHARED_SPACE_CLOUD_FUNCTION, 'listFocusSessions'),
    () => callFocusCloud('focusPresence', 'list'),
  ]

  for (const call of callers) {
    try {
      const payload = await call()
      return {
        openid: payload.openid || session?.openid || '',
        sessions: payload.sessions || [],
      }
    } catch (error) {
      console.warn('[focus-presence] cloud list failed', error)
    }
  }

  if (!session?.sharedSpaceId) {
    return { openid: session?.openid || '', sessions: [] }
  }

  try {
    const ownDoc = await findOwnFocusDoc(session)
    if (ownDoc) {
      return { openid: session.openid || '', sessions: [ownDoc] }
    }

    const res = await getDb().collection(COLLECTION).where({ sharedSpaceId: session.sharedSpaceId }).get()
    return {
      openid: session.openid || '',
      sessions: (res.data || []) as FocusSessionDoc[],
    }
  } catch (error) {
    console.warn('[focus-presence] client list failed', error)
    return { openid: session.openid || '', sessions: [] }
  }
}

const pickPartnerSession = (sessions: FocusSessionDoc[], session: NonNullable<ReturnType<typeof getSession>>) => {
  const others = sessions.filter((doc) => {
    const ownerId = doc.userId || doc._openid
    return ownerId && !isSessionOwnedBy(doc, session.openid || '')
  })

  if (!others.length) {
    return null
  }

  if (session.partnerOpenid) {
    const preferred = others.find((doc) => doc.userId === session.partnerOpenid || doc._openid === session.partnerOpenid)
    if (preferred) {
      return preferred
    }
  }

  return others[0]
}

export const publishFocusPresence = async (payload: FocusPresencePayload) => {
  const session = getSession()
  if (!session?.openid || !session.sharedSpaceId) {
    return
  }

  try {
    await wx.cloud.callFunction({
      name: 'focusPresence',
      data: { action: 'upsert', payload },
    })
    return
  } catch (error) {
    console.warn('[focus-presence] cloud upsert failed, fallback to client db', error)
  }

  const db = getDb()
  const existing = await findOwnFocusDoc(session)
  const data = {
    userId: session.openid,
    sharedSpaceId: session.sharedSpaceId,
    tag: payload.tag?.trim() || '',
    detail: '',
    linkedPlanId: '',
    sessionStartedAt: payload.sessionStartedAt,
    accumulatedSeconds: payload.accumulatedSeconds,
    segmentStartedAt: payload.segmentStartedAt,
    isPaused: payload.isPaused,
    updatedAt: Date.now(),
  }

  if (existing?._id) {
    await db.collection(COLLECTION).doc(existing._id).update({ data })
    return
  }

  await db.collection(COLLECTION).add({ data })
}

export const clearFocusPresence = async () => {
  const session = getSession()
  if (!session?.openid || !session.sharedSpaceId) {
    return
  }

  try {
    await wx.cloud.callFunction({
      name: 'focusPresence',
      data: { action: 'clear' },
    })
    return
  } catch (error) {
    console.warn('[focus-presence] cloud clear failed, fallback to client db', error)
  }

  const existing = await findOwnFocusDoc(session)
  if (!existing?._id) {
    return
  }

  await getDb().collection(COLLECTION).doc(existing._id).remove()
}

export const fetchOwnFocusPresence = async (): Promise<SelfFocusView | null> => {
  const session = getSession()
  if (!isSharedSpaceMode() || !session?.openid || !session.sharedSpaceId) {
    return null
  }

  const { openid, sessions } = await listFocusSessions()
  const matchOpenid = openid || session.openid
  const doc =
    sessions.find((item) => isSessionOwnedBy(item, matchOpenid)) ||
    (await findOwnFocusDoc(session))

  if (!doc) {
    return null
  }

  return toSelfFocusView(doc, session)
}

export const fetchPartnerFocusPresence = async (): Promise<PartnerFocusView | null> => {
  const session = getSession()
  if (!isSharedSpaceMode() || !session?.openid || !session.sharedSpaceId) {
    return null
  }

  const { sessions } = await listFocusSessions()
  const doc = pickPartnerSession(sessions, session)
  if (!doc) {
    return null
  }

  return toPartnerFocusView(doc)
}
