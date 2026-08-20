import { SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import { bootstrapSharedSpace, resetCloudBootstrap } from './cloud-sync'
import { preloadAvatar } from './avatar-display'
import { getSession, saveSession, type UserSession } from './session'

export interface RoomSummary {
  sharedSpaceId: string
  roomName: string
  inviteCode: string
  role: 'owner' | 'member'
  memberCount: number
  isActive: boolean
  joinedAt?: number
}

export interface MyRoomsResult {
  owned: RoomSummary[]
  joined: RoomSummary[]
  activeSharedSpaceId: string
  totalCount: number
}

interface RoomActionResult {
  ok?: boolean
  message?: string
  openid?: string
  sharedSpaceId?: string
  inviteCode?: string
  code?: string
  roomName?: string
  memberCount?: number
  nickname?: string
  avatarUrl?: string
  owned?: RoomSummary[]
  joined?: RoomSummary[]
  activeSharedSpaceId?: string
  totalCount?: number
  cleared?: boolean
  removed?: boolean
  partner?: {
    openid?: string
    nickname?: string
    avatarUrl?: string
  } | null
}

const callSharedSpace = async (data: Record<string, unknown>) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data,
  })

  return (result.result || {}) as RoomActionResult
}

const getProfilePayload = () => {
  const session = getSession()

  if (!session?.avatarUrl?.startsWith('cloud://')) {
    throw new Error('请先完善头像资料')
  }

  return {
    nickname: session?.nickname?.trim() || '我',
    avatarUrl: session?.avatarUrl || '',
  }
}

const applyRoomSession = async (payload: RoomActionResult) => {
  const previous = getSession()

  if (!payload.ok || !payload.sharedSpaceId) {
    throw new Error(payload.message || '房间操作失败')
  }

  const openid = payload.openid || previous?.openid
  if (!openid) {
    throw new Error(payload.message || '无法获取用户身份')
  }

  const session: UserSession = {
    openid,
    sharedSpaceId: payload.sharedSpaceId,
    inviteVerified: true,
    nickname: payload.nickname?.trim() || previous?.nickname?.trim() || '我',
    avatarUrl: payload.avatarUrl || '',
    profileCompleted: Boolean(payload.avatarUrl),
    partnerOpenid: payload.partner?.openid,
    partnerNickname: payload.partner?.nickname,
    partnerAvatarUrl: payload.partner?.avatarUrl,
    partnerAvatarSourceUrl: payload.partner?.avatarUrl,
  }

  await preloadAvatar(session.avatarUrl)
  await preloadAvatar(session.partnerAvatarSourceUrl || '')
  saveSession(session)
  return session
}

const activateRoomSession = async (payload: RoomActionResult) => {
  await applyRoomSession(payload)
  resetCloudBootstrap()
  await bootstrapSharedSpace()
  getApp<IAppOption>().globalData.cloudReady = true
}

const applyRoomExitResult = async (response: RoomActionResult) => {
  if (!response.ok) {
    throw new Error(response.message || '操作失败')
  }

  const previous = getSession()
  const openid = response.openid || previous?.openid

  if (response.cleared || !response.sharedSpaceId) {
    saveSession({
      openid: openid || '',
      sharedSpaceId: '',
      inviteVerified: false,
      nickname: response.nickname || previous?.nickname?.trim() || '我',
      avatarUrl: response.avatarUrl || previous?.avatarUrl || '',
      profileCompleted: previous?.profileCompleted ?? true,
    })
    resetCloudBootstrap()
    getApp<IAppOption>().globalData.cloudReady = false
    return
  }

  await applyRoomSession(response)
  resetCloudBootstrap()
  await bootstrapSharedSpace()
  getApp<IAppOption>().globalData.cloudReady = true
}

export const listMyRooms = async (): Promise<MyRoomsResult> => {
  const response = await callSharedSpace({ action: 'listMyRooms' })

  if (!response.ok) {
    throw new Error(response.message || '读取房间列表失败')
  }

  return {
    owned: response.owned || [],
    joined: response.joined || [],
    activeSharedSpaceId: response.activeSharedSpaceId || '',
    totalCount: response.totalCount || 0,
  }
}

export const createRoom = async (roomName: string) => {
  const normalizedRoomName = roomName.trim()
  if (!normalizedRoomName) {
    throw new Error('请输入房间名称')
  }

  const profile = getProfilePayload()
  const response = await callSharedSpace({
    action: 'createRoom',
    payload: {
      ...profile,
      roomName: normalizedRoomName,
    },
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
  })

  if (!response.ok || !response.code || !response.sharedSpaceId) {
    throw new Error(response.message || '创建房间失败')
  }

  await activateRoomSession(response)

  return {
    code: response.code,
    roomName: response.roomName || normalizedRoomName,
    sharedSpaceId: response.sharedSpaceId,
    memberCount: response.memberCount || 1,
  }
}

export const joinRoom = async (code: string) => {
  const normalized = code.trim().toUpperCase()

  if (!normalized) {
    throw new Error('请输入邀请码')
  }

  const profile = getProfilePayload()
  const response = await callSharedSpace({
    action: 'joinRoom',
    payload: {
      ...profile,
      code: normalized,
    },
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
  })

  await activateRoomSession(response)

  return {
    sharedSpaceId: response.sharedSpaceId!,
    roomName: response.roomName || '',
    inviteCode: response.inviteCode || normalized,
    memberCount: response.memberCount || 1,
  }
}

export const switchRoom = async (sharedSpaceId: string) => {
  const targetSpaceId = sharedSpaceId.trim()

  if (!targetSpaceId) {
    throw new Error('缺少房间 ID')
  }

  const profile = getProfilePayload()
  const response = await callSharedSpace({
    action: 'switchRoom',
    payload: {
      ...profile,
      sharedSpaceId: targetSpaceId,
    },
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
  })

  await activateRoomSession(response)
}

export const leaveRoom = async (sharedSpaceId: string) => {
  const targetSpaceId = sharedSpaceId.trim()

  if (!targetSpaceId) {
    throw new Error('缺少房间 ID')
  }

  const response = await callSharedSpace({
    action: 'leaveRoom',
    payload: { sharedSpaceId: targetSpaceId },
  })

  await applyRoomExitResult(response)
}

export const deleteRoom = async (sharedSpaceId: string) => {
  const targetSpaceId = sharedSpaceId.trim()

  if (!targetSpaceId) {
    throw new Error('缺少房间 ID')
  }

  const response = await callSharedSpace({
    action: 'deleteRoom',
    payload: { sharedSpaceId: targetSpaceId },
  })

  await applyRoomExitResult(response)
}
