import { DEFAULT_INVITE_CODE } from './cloud-config'

export interface UserSession {
  openid?: string
  sharedSpaceId?: string
  inviteVerified: boolean
  soloMode?: boolean
  nickname: string
  avatarUrl: string
  profileCompleted?: boolean
  partnerOpenid?: string
  partnerNickname?: string
  partnerAvatarUrl?: string
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

  if (stored.soloMode) {
    return stored.profileCompleted ? stored : null
  }

  if (!stored.openid || !stored.sharedSpaceId) {
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
      !session.soloMode &&
      session.inviteVerified &&
      session.sharedSpaceId &&
      session.openid,
  )
}

export const isSharedSpaceMode = () => isSessionReady()

export const isSoloMode = () => {
  const session = getSession()
  return Boolean(session?.soloMode && session.profileCompleted)
}

/** 共享空间内暂无其他成员时，隐藏「对方 / 伙伴」相关 UI */
export const shouldHidePartnerUi = () => {
  const session = getSession()
  if (!session || session.soloMode || !isSharedSpaceMode()) {
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
    return session.avatarUrl
  }
  return ''
}

const isTempAvatarPath = (avatarUrl: string) =>
  avatarUrl.startsWith('wxfile://') || avatarUrl.startsWith('http://tmp') || !avatarUrl.startsWith('cloud://')

export const uploadAvatarToCloud = async (tempPath: string) => {
  const ext = tempPath.match(/\.(\w+)(?:\?|$)/)?.[1] || 'png'
  const cloudPath = `avatars/${Date.now()}.${ext}`
  const uploadResult = await wx.cloud.uploadFile({
    cloudPath,
    filePath: tempPath,
  })

  return uploadResult.fileID
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

  let finalAvatarUrl = avatarUrl
  if (isTempAvatarPath(avatarUrl)) {
    finalAvatarUrl = await uploadAvatarToCloud(avatarUrl)
  }

  if (!trimmedInviteCode) {
    const previousSession = getSession()
    const nextSession: UserSession = {
      openid: previousSession?.openid || '',
      sharedSpaceId: '',
      inviteVerified: false,
      soloMode: true,
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
    soloMode: false,
    profileCompleted: true,
  }
  saveSession(nextSession)
  return nextSession
}

export const verifyInviteCode = async (
  code = DEFAULT_INVITE_CODE,
  profile?: Partial<UserProfileInput>,
) => {
  const previousSession = getSession()
  const result = await wx.cloud.callFunction({
    name: 'verifyInvite',
    data: {
      code,
      nickname: profile?.nickname,
      avatarUrl: profile?.avatarUrl,
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
    soloMode: false,
    nickname: profile?.nickname?.trim() || previousSession?.nickname?.trim() || payload.nickname?.trim() || '我',
    avatarUrl: profile?.avatarUrl || previousSession?.avatarUrl || payload.avatarUrl || '',
    profileCompleted: previousSession?.profileCompleted ?? Boolean(profile?.nickname && profile?.avatarUrl),
    partnerOpenid: payload.partner?.openid,
    partnerNickname: payload.partner?.nickname,
    partnerAvatarUrl: payload.partner?.avatarUrl,
  }

  saveSession(session)
  return session
}
