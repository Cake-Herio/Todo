import { getFallbackAvatarUrl, pickPartnerAvatarStorageUrl, resolveAvatarDisplayUrl, toDisplayAvatarUrl } from './avatar-display'
import { SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import { getOwnerAvatarUrl } from './data'
import { getDisplayAvatarUrl, getPartnerDisplayAvatarUrl, getPartnerDisplayNickname, getSession, isSharedSpaceMode, saveSession } from './session'

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
  openid?: string
  nickname?: string
  avatarUrl?: string
}

interface SpaceMember {
  openid: string
  nickname: string
  avatarUrl: string
}

interface ListMembersResult {
  ok?: boolean
  message?: string
  members?: SpaceMember[]
  hasPartner?: boolean
}

const getMeAvatarUrl = () => toDisplayAvatarUrl(getDisplayAvatarUrl() || '', getFallbackAvatarUrl('me'))

export const buildOwnerFilters = (hasPartner: boolean): OwnerFilterOption[] => {
  const meAvatar = getMeAvatarUrl()
  const partnerAvatar = getPartnerDisplayAvatarUrl() || getOwnerAvatarUrl('partner')
  const partnerLabel = getPartnerDisplayNickname()
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
      label: partnerLabel,
      avatars: [{ key: 'partner', url: partnerAvatar }],
    },
  ]
}

/** 「全部」固定左侧，其余成员胶囊放入横向滚动区 */
export const splitOwnerFilters = (filters: OwnerFilterOption[]) => {
  const pinnedFilter = filters.find((item) => item.key === 'all') || null
  const scrollFilters = pinnedFilter ? filters.filter((item) => item.key !== 'all') : filters

  return { pinnedFilter, scrollFilters }
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

const mapCloudUserDoc = (doc: CloudUserDoc): SpaceMember | null => {
  const openid = doc.openid || doc._openid
  if (!openid) {
    return null
  }

  return {
    openid,
    nickname: doc.nickname || '我',
    avatarUrl: doc.avatarUrl || '',
  }
}

const fetchSpaceMembersViaCloudFunction = async (): Promise<SpaceMember[] | null> => {
  const callers = [
    () =>
      wx.cloud.callFunction({
        name: SHARED_SPACE_CLOUD_FUNCTION,
        data: { action: 'listMembers' },
      }),
    () =>
      wx.cloud.callFunction({
        name: 'focusPresence',
        data: { action: 'listMembers' },
      }),
  ]

  for (const call of callers) {
    try {
      const result = await call()
      const payload = result.result as ListMembersResult

      if (payload?.ok && payload.members) {
        return payload.members.filter((member) => Boolean(member.openid))
      }
    } catch (error) {
      console.warn('[owner-filters] listMembers cloud function failed', error)
    }
  }

  return null
}

const fetchSpaceMembersViaClientDb = async (sharedSpaceId: string): Promise<SpaceMember[]> => {
  const db = wx.cloud.database()
  const res = await db.collection('users').where({ sharedSpaceId }).get()
  const members = (res.data || []) as CloudUserDoc[]

  return members
    .map(mapCloudUserDoc)
    .filter((member): member is SpaceMember => Boolean(member))
}

export const refreshSpaceMembersFromCloud = async () => {
  const session = getSession()

  if (!session || session.soloMode || !session.sharedSpaceId) {
    return { memberCount: 1, hasPartner: false }
  }

  try {
    const cloudMembers = await fetchSpaceMembersViaCloudFunction()
    const members = cloudMembers || (await fetchSpaceMembersViaClientDb(session.sharedSpaceId))
    const membersTrusted = Boolean(cloudMembers)
    const partner = members.find((item) => item.openid !== session.openid) || null
    const hasPartner = members.length > 1 && Boolean(partner)

    if (hasPartner && partner?.openid) {
      const partnerAvatarUrl = pickPartnerAvatarStorageUrl(partner.avatarUrl || '', session.partnerAvatarUrl)

      saveSession({
        ...session,
        partnerOpenid: partner.openid,
        partnerNickname: partner.nickname || '对方',
        partnerAvatarUrl,
      })

      if (partnerAvatarUrl.startsWith('cloud://')) {
        void resolveAvatarDisplayUrl(partnerAvatarUrl)
      }
    } else if (
      membersTrusted &&
      !hasPartner &&
      (session.partnerOpenid || session.partnerNickname || session.partnerAvatarUrl)
    ) {
      saveSession({
        ...session,
        partnerOpenid: undefined,
        partnerNickname: undefined,
        partnerAvatarUrl: undefined,
      })
    }

    return { memberCount: members.length, hasPartner: membersTrusted ? hasPartner : Boolean(session.partnerOpenid) || hasPartner }
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
