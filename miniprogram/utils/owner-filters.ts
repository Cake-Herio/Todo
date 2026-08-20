import { getDefaultAvatarUrl, preloadAvatar } from './avatar-display'
import { SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
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

const getMeAvatarUrl = () => getDisplayAvatarUrl() || getDefaultAvatarUrl()

export const buildOwnerFilters = (hasPartner: boolean): OwnerFilterOption[] => {
  const meAvatar = getMeAvatarUrl()
  const partnerAvatar = getPartnerDisplayAvatarUrl() || getDefaultAvatarUrl()
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

const fetchSpaceMembersViaCloudFunction = async (): Promise<SpaceMember[] | null> => {
  try {
    const result = await wx.cloud.callFunction({
      name: SHARED_SPACE_CLOUD_FUNCTION,
      data: { action: 'listMembers' },
    })
    const payload = result.result as ListMembersResult

    if (payload?.ok && payload.members) {
      return payload.members.filter((member) => Boolean(member.openid))
    }
  } catch (error) {
    console.warn('[owner-filters] listMembers cloud function failed', error)
  }

  return null
}

export const refreshSpaceMembersFromCloud = async () => {
  const session = getSession()

  if (!session || !session.sharedSpaceId) {
    return { memberCount: 1, hasPartner: false }
  }

  try {
    const members = (await fetchSpaceMembersViaCloudFunction()) || []
    const partner = members.find((item) => item.openid !== session.openid) || null
    const hasPartner = members.length > 1 && Boolean(partner)

    if (hasPartner && partner?.openid) {
      const partnerAvatarSourceUrl = partner.avatarUrl || session.partnerAvatarSourceUrl || ''
      const partnerAvatarUrl = partnerAvatarSourceUrl
      const partnerChanged =
        session.partnerOpenid !== partner.openid ||
        session.partnerNickname !== (partner.nickname || '对方') ||
        session.partnerAvatarSourceUrl !== partnerAvatarSourceUrl ||
        session.partnerAvatarUrl !== partnerAvatarUrl

      if (partnerChanged) {
        saveSession({
          ...session,
          partnerOpenid: partner.openid,
          partnerNickname: partner.nickname || '对方',
          partnerAvatarUrl,
          partnerAvatarSourceUrl,
        })
      }

      // 每次打开房间都校验本地文件是否仍在；有效缓存不会触发云端下载。
      const displayAvatarUrl = await preloadAvatar(partnerAvatarSourceUrl)
      console.info('[avatar] partner member resolved', {
        openid: partner.openid,
        nickname: partner.nickname || '对方',
        sourceAvatarUrl: partnerAvatarSourceUrl,
        displayAvatarUrl,
      })
    }

    await preloadAvatar(session.avatarUrl)

    if (!hasPartner && (session.partnerOpenid || session.partnerNickname || session.partnerAvatarUrl)) {
      saveSession({
        ...session,
        partnerOpenid: undefined,
        partnerNickname: undefined,
        partnerAvatarUrl: undefined,
        partnerAvatarSourceUrl: undefined,
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
