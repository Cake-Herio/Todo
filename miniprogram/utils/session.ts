import { getAvatarDisplayUrl, preloadAvatar, uploadAvatarFile } from './avatar-display'
import { DEFAULT_INVITE_CODE, SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'

export interface UserSession {
  openid?: string
  sharedSpaceId?: string
  inviteVerified: boolean
  nickname: string
  avatarUrl: string
  profileCompleted?: boolean
  partnerOpenid?: string
  partnerNickname?: string
  partnerAvatarUrl?: string
  partnerAvatarSourceUrl?: string
}

export interface UserProfileInput {
  nickname: string
  avatarUrl: string
  inviteCode?: string
}

const SESSION_KEY = 'myforest_session'

export const getSession = (): UserSession | null => {
  const stored = wx.getStorageSync(SESSION_KEY) as UserSession | ''
  if (!stored) {
    return null
  }

  if (!stored.openid || !stored.profileCompleted) {
    return null
  }

  return stored
}

export const saveSession = (session: UserSession) => {
  wx.setStorageSync(SESSION_KEY, session)
}

export const clearSession = () => {
  wx.removeStorageSync(SESSION_KEY)
}

export const logoutUser = () => {
  clearSession()
}

export const isSessionReady = () => {
  const session = getSession()
  return Boolean(
    session &&
      session.inviteVerified &&
      session.sharedSpaceId &&
      session.openid,
  )
}

export const isSharedSpaceMode = () => isSessionReady()

/** 共享空间内暂无其他成员时，隐藏「对方 / 伙伴」相关 UI */
export const shouldHidePartnerUi = () => {
  const session = getSession()
  if (!session || !isSharedSpaceMode()) {
    return true
  }

  return !session.partnerOpenid
}

export const isProfileComplete = () => {
  const session = getSession()
  return Boolean(session?.profileCompleted && session.nickname?.trim() && session.avatarUrl)
}

export const getDisplayNickname = () => {
  const session = getSession()
  if (session?.profileCompleted && session.nickname?.trim()) {
    return session.nickname.trim()
  }
  return '林间伙伴'
}

export const getDisplayAvatarUrl = () => {
  const session = getSession()
  if (session?.profileCompleted && session.avatarUrl) {
    return getAvatarDisplayUrl(session.avatarUrl)
  }
  return ''
}

/** 共享空间中另一位成员的昵称（用于筛选、计划归属等 UI） */
export const getPartnerDisplayNickname = () => {
  const session = getSession()
  const nickname = session?.partnerNickname?.trim()
  return nickname || '对方'
}

export const getPartnerDisplayAvatarUrl = () => {
  const session = getSession()
  const sourceAvatarUrl = session?.partnerAvatarSourceUrl || session?.partnerAvatarUrl
  if (sourceAvatarUrl) {
    return getAvatarDisplayUrl(sourceAvatarUrl)
  }

  return ''
}

interface SaveProfileResult {
  ok?: boolean
  message?: string
  openid?: string
  nickname?: string
  avatarUrl?: string
}

const saveProfileToCloud = async (profile: { nickname: string; avatarUrl: string }) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'saveProfile',
      payload: profile,
    },
  })
  const payload = result.result as SaveProfileResult

  if (!payload?.ok || !payload.openid) {
    throw new Error(payload?.message || '账号资料保存失败')
  }

  return payload
}

export const saveUserProfile = async ({ nickname, avatarUrl, inviteCode = '' }: UserProfileInput) => {
  const trimmedNickname = nickname.trim()
  const trimmedInviteCode = inviteCode.trim().toUpperCase()
  if (!trimmedNickname) {
    throw new Error('请输入昵称')
  }
  if (!avatarUrl) {
    throw new Error('请选择头像')
  }

  const finalAvatarUrl = await uploadAvatarFile(avatarUrl)
  const cloudProfile = await saveProfileToCloud({
    nickname: trimmedNickname,
    avatarUrl: finalAvatarUrl,
  })

  // 登录完成前把自己的头像落到本地，首页不再先显示一次兜底头像。
  await preloadAvatar(finalAvatarUrl)

  if (!trimmedInviteCode) {
    const nextSession: UserSession = {
      openid: cloudProfile.openid,
      sharedSpaceId: '',
      inviteVerified: false,
      nickname: trimmedNickname,
      avatarUrl: finalAvatarUrl,
      profileCompleted: true,
    }
    saveSession(nextSession)
    return nextSession
  }

  const session = await verifyInviteCode(trimmedInviteCode, {
    nickname: trimmedNickname,
    avatarUrl: finalAvatarUrl,
  })

  const nextSession: UserSession = {
    ...session,
    profileCompleted: true,
  }
  saveSession(nextSession)
  return nextSession
}

export const verifyInviteCode = async (
  code = DEFAULT_INVITE_CODE,
  profile?: Partial<UserProfileInput>,
) => {
  if (!profile?.avatarUrl?.startsWith('cloud://')) {
    throw new Error('头像资料无效，请重新选择头像')
  }

  const previousSession = getSession()
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'joinRoom',
      payload: {
        code,
        nickname: profile?.nickname,
        avatarUrl: profile?.avatarUrl,
      },
    },
  })

  const payload = result.result as {
    ok?: boolean
    message?: string
    openid?: string
    sharedSpaceId?: string
    nickname?: string
    avatarUrl?: string
    partner?: {
      openid?: string
      nickname?: string
      avatarUrl?: string
    } | null
  }

  if (!payload?.ok || !payload.openid || !payload.sharedSpaceId) {
    throw new Error(payload?.message || '邀请码验证失败')
  }

  const session: UserSession = {
    openid: payload.openid,
    sharedSpaceId: payload.sharedSpaceId,
    inviteVerified: true,
    nickname: profile?.nickname?.trim() || previousSession?.nickname?.trim() || payload.nickname?.trim() || '我',
    avatarUrl: profile?.avatarUrl || '',
    profileCompleted: Boolean(profile?.nickname && profile?.avatarUrl),
    partnerOpenid: payload.partner?.openid,
    partnerNickname: payload.partner?.nickname,
    partnerAvatarUrl: payload.partner?.avatarUrl,
    partnerAvatarSourceUrl: payload.partner?.avatarUrl,
  }

  saveSession(session)
  return session
}

interface RestoreSessionResult {
  ok?: boolean
  exists?: boolean
  message?: string
  openid?: string
  sharedSpaceId?: string
  nickname?: string
  avatarUrl?: string
  inviteVerified?: boolean
  partner?: {
    openid?: string
    nickname?: string
    avatarUrl?: string
  } | null
}

/** 云端已有同 openid 用户时，免登录恢复本地 session */
export const tryRestoreSessionFromCloud = async (): Promise<UserSession | null> => {
  if (isProfileComplete()) {
    return getSession()
  }

  try {
    const result = await wx.cloud.callFunction({
      name: SHARED_SPACE_CLOUD_FUNCTION,
      data: { action: 'restoreSession' },
    })
    const payload = result.result as RestoreSessionResult

    if (!payload?.ok || !payload.exists || !payload.openid) {
      return null
    }

    const session: UserSession = {
      openid: payload.openid,
      sharedSpaceId: payload.sharedSpaceId || '',
      inviteVerified: Boolean(payload.sharedSpaceId && payload.inviteVerified !== false),
      nickname: payload.nickname?.trim() || '我',
      avatarUrl: payload.avatarUrl || '',
      profileCompleted: true,
      partnerOpenid: payload.partner?.openid,
      partnerNickname: payload.partner?.nickname,
      partnerAvatarUrl: payload.partner?.avatarUrl,
      partnerAvatarSourceUrl: payload.partner?.avatarUrl,
    }

    await preloadAvatar(session.avatarUrl)
    await preloadAvatar(session.partnerAvatarSourceUrl || '')
    saveSession(session)
    return session
  } catch (error) {
    console.warn('[session] restoreSession failed', error)
    return null
  }
}
