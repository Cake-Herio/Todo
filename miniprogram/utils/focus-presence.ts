import { getOwnerAvatarUrl } from './data'
import { getSession, isSharedSpaceMode } from './session'

const COLLECTION = 'focus_sessions'
const STALE_MS = 5 * 60 * 1000

export interface FocusPresencePayload {
  tag: string
  detail: string
  startedAt: number
  isPaused: boolean
  elapsedSeconds: number
}

export interface PartnerFocusView {
  name: string
  status: string
  focus: string
  duration: string
  avatarUrl: string
}

interface FocusSessionDoc {
  _id?: string
  userId: string
  sharedSpaceId: string
  tag: string
  detail: string
  startedAt: number
  isPaused: boolean
  elapsedSeconds: number
  updatedAt: number
}

const getDb = () => wx.cloud.database()

export const canPublishFocusPresence = () => isSharedSpaceMode()

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

export const publishFocusPresence = async (payload: FocusPresencePayload) => {
  const session = getSession()
  if (!session?.openid || !session.sharedSpaceId || session.soloMode) {
    return
  }

  const db = getDb()
  const existing = await findOwnFocusDoc(session)
  const data = {
    userId: session.openid,
    sharedSpaceId: session.sharedSpaceId,
    tag: payload.tag,
    detail: payload.detail,
    startedAt: payload.startedAt,
    isPaused: payload.isPaused,
    elapsedSeconds: payload.elapsedSeconds,
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
  if (!session?.openid || !session.sharedSpaceId || session.soloMode) {
    return
  }

  const existing = await findOwnFocusDoc(session)
  if (!existing?._id) {
    return
  }

  await getDb().collection(COLLECTION).doc(existing._id).remove()
}

const formatDurationLabel = (elapsedSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(Math.max(elapsedSeconds, 0) / 60))
  return `${minutes} 分钟`
}

export const fetchPartnerFocusPresence = async (): Promise<PartnerFocusView | null> => {
  const session = getSession()
  if (!isSharedSpaceMode() || !session?.partnerOpenid || !session.sharedSpaceId) {
    return null
  }

  const res = await getDb()
    .collection(COLLECTION)
    .where({
      sharedSpaceId: session.sharedSpaceId,
      userId: session.partnerOpenid,
    })
    .limit(1)
    .get()

  const doc = res.data[0] as FocusSessionDoc | undefined
  if (!doc || Date.now() - doc.updatedAt > STALE_MS) {
    return null
  }

  const elapsedSeconds = doc.isPaused
    ? doc.elapsedSeconds
    : Math.max(doc.elapsedSeconds, Math.floor((Date.now() - doc.startedAt) / 1000))

  return {
    name: session.partnerNickname || '对方',
    status: doc.isPaused ? '暂停' : '专注',
    focus: doc.tag || doc.detail || '专注中',
    duration: formatDurationLabel(elapsedSeconds),
    avatarUrl: session.partnerAvatarUrl || getOwnerAvatarUrl('partner'),
  }
}
