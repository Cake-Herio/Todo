import { getOwnerAvatarUrl } from './data'
import { getDisplayAvatarUrl, getSession, isSharedSpaceMode, saveSession } from './session'

export interface OwnerFilterOption {
  key: string
  label: string
  avatars: { key: string; url: string }[]
}

export interface OwnerFilterState {
  filters: OwnerFilterOption[]
  activeFilter: string
  hasSpacePartner: boolean
  singleUserMode: boolean
}

interface CloudUserDoc {
  _openid?: string
  nickname?: string
  avatarUrl?: string
}

const getMeAvatarUrl = () => getDisplayAvatarUrl() || getOwnerAvatarUrl('me')

export const buildOwnerFilters = (hasPartner: boolean): OwnerFilterOption[] => {
  const session = getSession()
  const meAvatar = getMeAvatarUrl()
  const partnerAvatar = session?.partnerAvatarUrl || getOwnerAvatarUrl('partner')
  const meFilter: OwnerFilterOption = {
    key: 'me',
    label: '我',
    avatars: [{ key: 'me', url: meAvatar }],
  }

  if (!hasPartner) {
    return [meFilter]
  }

  return [
    {
      key: 'all',
      label: '全部',
      avatars: [
        { key: 'me', url: meAvatar },
        { key: 'partner', url: partnerAvatar },
      ],
    },
    meFilter,
    {
      key: 'partner',
      label: '对方',
      avatars: [{ key: 'partner', url: partnerAvatar }],
    },
  ]
}

export const normalizeOwnerFilter = (activeFilter: string, hasPartner: boolean) => {
  if (!hasPartner) {
    return 'me'
  }

  if (activeFilter === 'all' || activeFilter === 'me' || activeFilter === 'partner') {
    return activeFilter
  }

  return 'all'
}

export const refreshSpaceMembersFromCloud = async () => {
  const session = getSession()

  if (!session || session.soloMode || !session.sharedSpaceId) {
    return { memberCount: 1, hasPartner: false }
  }

  try {
    const db = wx.cloud.database()
    const res = await db.collection('users').where({ sharedSpaceId: session.sharedSpaceId }).get()
    const members = (res.data || []) as CloudUserDoc[]
    const partner = members.find((item) => item._openid && item._openid !== session.openid) || null
    const hasPartner = members.length > 1 && Boolean(partner)

    if (hasPartner && partner?._openid) {
      saveSession({
        ...session,
        partnerOpenid: partner._openid,
        partnerNickname: partner.nickname || '对方',
        partnerAvatarUrl: partner.avatarUrl || '',
      })
    } else if (session.partnerOpenid || session.partnerNickname || session.partnerAvatarUrl) {
      saveSession({
        ...session,
        partnerOpenid: undefined,
        partnerNickname: undefined,
        partnerAvatarUrl: undefined,
      })
    }

    return { memberCount: members.length, hasPartner }
  } catch (error) {
    console.warn('[owner-filters] refresh members failed', error)
    const hasPartner = Boolean(session.partnerOpenid)
    return { memberCount: hasPartner ? 2 : 1, hasPartner }
  }
}

export const getOwnerFilterStateLocal = (activeFilter: string): OwnerFilterState => {
  const session = getSession()
  const hasPartner = Boolean(isSharedSpaceMode() && session?.partnerOpenid)

  return {
    filters: buildOwnerFilters(hasPartner),
    activeFilter: normalizeOwnerFilter(activeFilter, hasPartner),
    hasSpacePartner: hasPartner,
    singleUserMode: !hasPartner,
  }
}

export const getOwnerFilterState = async (activeFilter: string): Promise<OwnerFilterState> => {
  const { hasPartner } = await refreshSpaceMembersFromCloud()

  return {
    filters: buildOwnerFilters(hasPartner),
    activeFilter: normalizeOwnerFilter(activeFilter, hasPartner),
    hasSpacePartner: hasPartner,
    singleUserMode: !hasPartner,
  }
}
