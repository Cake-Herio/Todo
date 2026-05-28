import { getDisplayAvatarUrl, getSession } from './session'

const FALLBACK_AVATARS = {
  me: '/assets/avatars/me.png',
  partner: '/assets/avatars/partner.png',
}

const avatarUrlCache = new Map<string, string>()

/** 供 <image src> 使用：未解析的 cloud:// 一律回落到占位图，避免空白 */
export const toDisplayAvatarUrl = (avatarUrl: string, fallback = FALLBACK_AVATARS.partner) => {
  if (!avatarUrl) {
    return fallback
  }

  if (!avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }

  return avatarUrlCache.get(avatarUrl) || fallback
}

export const getFallbackAvatarUrl = (owner: 'me' | 'partner') => FALLBACK_AVATARS[owner]

export const normalizeAvatarStorageUrl = (avatarUrl: string) => {
  if (!avatarUrl) {
    return ''
  }

  if (avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }

  return avatarUrl
}

/** 优先保留 cloud://，避免把会过期的临时 HTTPS 写进 session */
export const pickPartnerAvatarStorageUrl = (incoming: string, existing?: string) => {
  const next = normalizeAvatarStorageUrl(incoming)
  if (next.startsWith('cloud://')) {
    return next
  }

  if (existing?.startsWith('cloud://')) {
    return existing
  }

  return next
}

/** 同步读取：有缓存用缓存，否则返回原始 https；cloud:// 未缓存时返回空 */
export const getStableAvatarDisplayUrl = (avatarUrl: string) => {
  if (!avatarUrl) {
    return ''
  }

  if (!avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }

  return avatarUrlCache.get(avatarUrl) || ''
}

/** 将 cloud:// 文件 ID 转成可跨用户展示的 HTTPS 临时链接（结果会缓存，避免闪烁） */
export const resolveAvatarDisplayUrl = async (avatarUrl: string): Promise<string> => {
  if (!avatarUrl) {
    return ''
  }

  if (!avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }

  const cached = avatarUrlCache.get(avatarUrl)
  if (cached) {
    return cached
  }

  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [avatarUrl] })
    const tempFileURL = res.fileList?.[0]?.tempFileURL

    if (tempFileURL) {
      avatarUrlCache.set(avatarUrl, tempFileURL)
      return tempFileURL
    }
  } catch (error) {
    console.warn('[avatar] getTempFileURL failed', error)
  }

  return ''
}

export const ensureAvatarDisplayUrl = async (avatarUrl: string, fallback = FALLBACK_AVATARS.partner) => {
  if (!avatarUrl) {
    return fallback
  }

  if (!avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }

  const resolved = await resolveAvatarDisplayUrl(avatarUrl)
  return toDisplayAvatarUrl(resolved, fallback)
}

export const getPartnerDisplayAvatarUrl = () => {
  const session = getSession()
  const raw = session?.partnerAvatarUrl || ''
  return toDisplayAvatarUrl(raw, FALLBACK_AVATARS.partner)
}

export const resolvePartnerAvatarForDisplay = async (): Promise<string> => {
  const session = getSession()
  const raw = session?.partnerAvatarUrl || ''
  return ensureAvatarDisplayUrl(raw, FALLBACK_AVATARS.partner)
}

export const resolveMyAvatarForDisplay = async (): Promise<string> => {
  const raw = getDisplayAvatarUrl() || FALLBACK_AVATARS.me
  return ensureAvatarDisplayUrl(raw, FALLBACK_AVATARS.me)
}

export const pickPartnerAvatarRaw = (
  session: NonNullable<ReturnType<typeof getSession>>,
  docAvatarUrl?: string,
) => {
  if (session.partnerAvatarUrl?.startsWith('cloud://')) {
    return session.partnerAvatarUrl
  }

  if (docAvatarUrl?.startsWith('cloud://')) {
    return docAvatarUrl
  }

  if (session.partnerAvatarUrl) {
    return session.partnerAvatarUrl
  }

  return ''
}
