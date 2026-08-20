const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()

const DEFAULT_CODE = 'FOREST2026'
const MAX_ROOM_MEMBERS = 3
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLLECTIONS = ['users', 'invite_codes', 'room_members', 'plans', 'completed_records', 'focus_sessions', 'plan_tags']

const DEFAULT_SHARED_TAGS = [
  { name: '英语', color: '#98C6A8' },
  { name: '写代码', color: '#98C6A8' },
  { name: '运动', color: '#7DA7D9' },
  { name: '阅读', color: '#98C6A8' },
  { name: '冥想', color: '#9B8DD9' },
  { name: '写作', color: '#F1B86A' },
  { name: '学习', color: '#8BC4D9' },
  { name: '整理', color: '#7BC8B8' },
  { name: '复盘', color: '#D98BB0' },
  { name: '绘画', color: '#E09A7A' },
  { name: '其它', color: '#7A857D' },
]

const normalizeHexColor = (value) => {
  const trimmed = `${value || ''}`.trim()
  if (!trimmed) {
    return ''
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return ''
  }

  return withHash.toUpperCase()
}

const ensureCollections = async () => {
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
    } catch (error) {
      const msg = `${error?.message || ''} ${error?.errMsg || ''}`
      if (!/exist|已存在|ResourceExist|already/i.test(msg)) {
        console.warn(`[sharedSpace] createCollection ${name}:`, error)
      }
    }
  }
}

const getUserInSpace = async (openid) => {
  const bySystemOpenid = await db.collection('users').where({ _openid: openid }).limit(1).get()
  if (bySystemOpenid.data[0]) {
    return bySystemOpenid.data[0]
  }

  const byOpenidField = await db.collection('users').where({ openid }).limit(1).get()
  return byOpenidField.data[0] || null
}

const saveUserProfile = async (openid, profile = {}) => {
  const user = await getUserInSpace(openid)
  const nickname = `${profile.nickname || user?.nickname || ''}`.trim()
  const avatarUrl = `${profile.avatarUrl || user?.avatarUrl || ''}`.trim()

  if (!nickname) {
    throw new Error('请输入昵称')
  }

  if (!avatarUrl.startsWith('cloud://')) {
    throw new Error('头像资料无效，请重新选择头像')
  }

  const now = Date.now()
  const profilePayload = {
    openid,
    nickname,
    avatarUrl,
    updatedAt: now,
  }

  if (user?._id) {
    await db.collection('users').doc(user._id).update({ data: profilePayload })
  } else {
    await db.collection('users').add({
      data: {
        ...profilePayload,
        sharedSpaceId: '',
        inviteVerified: false,
        createdAt: now,
      },
    })
  }

  return {
    ...profilePayload,
    sharedSpaceId: user?.sharedSpaceId || '',
    inviteVerified: Boolean(user?.sharedSpaceId && user.inviteVerified !== false),
  }
}

const generateInviteCode = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let code = ''
    for (let i = 0; i < 8; i += 1) {
      code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)]
    }

    const existing = await db.collection('invite_codes').where({ code }).limit(1).get()
    if (!existing.data.length) {
      return code
    }
  }

  throw new Error('生成邀请码失败，请重试')
}

const getInviteByCode = async (code) => {
  const normalized = `${code || ''}`.trim().toUpperCase()
  if (!normalized) {
    return null
  }

  const inviteRes = await db.collection('invite_codes').where({ code: normalized }).limit(1).get()
  return inviteRes.data[0] || null
}

const getRoomMemberCount = async (sharedSpaceId) => {
  const countRes = await db.collection('room_members').where({ sharedSpaceId }).count()
  return countRes.total || 0
}

const findRoomMember = async (openid, sharedSpaceId) => {
  const memberRes = await db.collection('room_members').where({ openid, sharedSpaceId }).limit(1).get()
  return memberRes.data[0] || null
}

const upsertRoomMember = async (openid, sharedSpaceId, role, inviteCode) => {
  const now = Date.now()
  const existing = await findRoomMember(openid, sharedSpaceId)

  if (existing?._id) {
    await db.collection('room_members').doc(existing._id).update({
      data: {
        role: existing.role === 'owner' ? 'owner' : role,
        inviteCode,
        updatedAt: now,
      },
    })
    return existing
  }

  await db.collection('room_members').add({
    data: {
      openid,
      sharedSpaceId,
      role,
      inviteCode,
      joinedAt: now,
      updatedAt: now,
    },
  })

  return null
}

const getUserProfileByOpenid = async (memberOpenid) => {
  const byOpenid = await db.collection('users').where({ openid: memberOpenid }).limit(1).get()
  if (byOpenid.data[0]) {
    return byOpenid.data[0]
  }

  const bySystemOpenid = await db.collection('users').where({ _openid: memberOpenid }).limit(1).get()
  return bySystemOpenid.data[0] || null
}

const listRoomMembersWithProfiles = async (sharedSpaceId) => {
  let memberCount = await getRoomMemberCount(sharedSpaceId)

  if (memberCount === 0) {
    const usersRes = await db.collection('users').where({ sharedSpaceId }).get()
    const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId }).limit(1).get()
    const invite = inviteRes.data[0]
    const inviteCode = invite?.code || DEFAULT_CODE

    for (const userDoc of usersRes.data || []) {
      const memberOpenid = userDoc.openid || userDoc._openid
      if (!memberOpenid) {
        continue
      }

      const role = invite?.ownerOpenid === memberOpenid ? 'owner' : 'member'
      await upsertRoomMember(memberOpenid, sharedSpaceId, role, inviteCode)
    }

    memberCount = await getRoomMemberCount(sharedSpaceId)
  }

  const membersRes = await db.collection('room_members').where({ sharedSpaceId }).get()
  const members = []

  for (const memberDoc of membersRes.data || []) {
    const profile = await getUserProfileByOpenid(memberDoc.openid)
    const avatarUrl = profile?.avatarUrl || ''
    members.push({
      openid: memberDoc.openid,
      nickname: profile?.nickname || '我',
      avatarUrl,
      role: memberDoc.role || 'member',
    })
  }

  return members
}

const setActiveRoom = async (openid, sharedSpaceId, profile = {}) => {
  const user = await getUserInSpace(openid)
  const now = Date.now()
  const nickname = `${profile.nickname || user?.nickname || '我'}`.trim() || '我'
  const avatarUrl = profile.avatarUrl || user?.avatarUrl || ''
  if (!avatarUrl.startsWith('cloud://')) {
    throw new Error('头像资料无效，请重新选择头像')
  }
  const userPayload = {
    openid,
    sharedSpaceId,
    inviteVerified: true,
    nickname,
    avatarUrl,
    updatedAt: now,
  }

  if (user?._id) {
    await db.collection('users').doc(user._id).update({ data: userPayload })
  } else {
    await db.collection('users').add({
      data: {
        ...userPayload,
        createdAt: now,
      },
    })
  }

  const membership = await findRoomMember(openid, sharedSpaceId)
  if (membership?._id) {
    await db.collection('room_members').doc(membership._id).update({
      data: {
        nickname,
        updatedAt: now,
      },
    })
  }

  return userPayload
}

const findPartnerInRoom = async (sharedSpaceId, openid) => {
  const members = await listRoomMembersWithProfiles(sharedSpaceId)
  return members.find((item) => item.openid !== openid) || null
}

const ensureLegacyRoomMembership = async (openid, sharedSpaceId) => {
  const existing = await findRoomMember(openid, sharedSpaceId)
  if (existing) {
    return existing
  }

  const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId }).limit(1).get()
  const invite = inviteRes.data[0]
  if (!invite) {
    return null
  }

  const role = invite.ownerOpenid === openid ? 'owner' : 'member'
  await upsertRoomMember(openid, sharedSpaceId, role, invite.code)
  return findRoomMember(openid, sharedSpaceId)
}

const joinRoomByCode = async (openid, rawCode, profile = {}) => {
  await ensureCollections()

  const code = `${rawCode || ''}`.trim().toUpperCase()
  if (!code) {
    return { ok: false, message: '请输入邀请码' }
  }

  let invite = await getInviteByCode(code)

  if (!invite && code === DEFAULT_CODE) {
    const sharedSpaceId = `space-${Date.now()}`
    await db.collection('invite_codes').add({
      data: {
        code,
        sharedSpaceId,
        ownerOpenid: openid,
        enabled: true,
        maxMembers: MAX_ROOM_MEMBERS,
        createdAt: Date.now(),
      },
    })
    invite = await getInviteByCode(code)
  }

  if (!invite) {
    return { ok: false, message: '邀请码无效' }
  }

  if (invite.enabled === false) {
    return { ok: false, message: '邀请码已失效' }
  }

  const sharedSpaceId = invite.sharedSpaceId
  const existingMembership = await findRoomMember(openid, sharedSpaceId)
  const memberCount = await getRoomMemberCount(sharedSpaceId)

  if (!existingMembership && memberCount >= MAX_ROOM_MEMBERS) {
    return { ok: false, message: '房间已满（最多 3 人）' }
  }

  const role =
    invite.ownerOpenid === openid || (!invite.ownerOpenid && memberCount === 0)
      ? 'owner'
      : existingMembership?.role || 'member'

  await upsertRoomMember(openid, sharedSpaceId, role, invite.code)

  const userPayload = await setActiveRoom(openid, sharedSpaceId, profile)
  await ensureDefaultSharedTags(sharedSpaceId, openid)

  const partner = await findPartnerInRoom(sharedSpaceId, openid)

  return {
    ok: true,
    openid,
    sharedSpaceId,
    roomName: resolveRoomDisplayName(invite, invite.code),
    inviteCode: invite.code,
    nickname: userPayload.nickname,
    avatarUrl: userPayload.avatarUrl,
    memberCount: await getRoomMemberCount(sharedSpaceId),
    partner: partner
      ? {
          openid: partner.openid,
          nickname: partner.nickname || '对方',
          avatarUrl: partner.avatarUrl || '',
        }
      : null,
  }
}

const normalizeRoomName = (value) => {
  const trimmed = `${value || ''}`.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.slice(0, 20)
}

const resolveRoomDisplayName = (invite, inviteCode = '') => {
  const roomName = normalizeRoomName(invite?.roomName)
  if (roomName) {
    return roomName
  }

  const code = `${inviteCode || invite?.code || ''}`.trim()
  if (code) {
    return `房间 ${code.slice(-4)}`
  }

  return '未命名房间'
}

const buildRoomListItem = (membership, invite, activeSharedSpaceId, memberCount) => {
  const inviteCode = membership.inviteCode || invite?.code || ''

  return {
    sharedSpaceId: membership.sharedSpaceId,
    roomName: resolveRoomDisplayName(invite, inviteCode),
    inviteCode,
    role: membership.role || 'member',
    memberCount,
    isActive: membership.sharedSpaceId === activeSharedSpaceId,
    joinedAt: membership.joinedAt || membership.updatedAt || 0,
  }
}

const createRoom = async (openid, profile = {}) => {
  await ensureCollections()

  const roomName = normalizeRoomName(profile.roomName)
  if (!roomName) {
    return { ok: false, message: '请输入房间名称' }
  }

  const code = await generateInviteCode()
  const sharedSpaceId = `space-${Date.now()}`
  const now = Date.now()

  await db.collection('invite_codes').add({
    data: {
      code,
      roomName,
      sharedSpaceId,
      ownerOpenid: openid,
      enabled: true,
      maxMembers: MAX_ROOM_MEMBERS,
      createdAt: now,
    },
  })

  await upsertRoomMember(openid, sharedSpaceId, 'owner', code)
  const userPayload = await setActiveRoom(openid, sharedSpaceId, profile)
  await ensureDefaultSharedTags(sharedSpaceId, openid)

  return {
    ok: true,
    openid,
    code,
    roomName,
    sharedSpaceId,
    inviteCode: code,
    memberCount: 1,
    nickname: userPayload.nickname,
    avatarUrl: userPayload.avatarUrl,
  }
}

const listMyRooms = async (openid) => {
  await ensureCollections()

  const user = await getUserInSpace(openid)
  if (user?.sharedSpaceId) {
    await ensureLegacyRoomMembership(openid, user.sharedSpaceId)
  }

  const membershipsRes = await db.collection('room_members').where({ openid }).get()
  const memberships = membershipsRes.data || []
  const activeSharedSpaceId = user?.sharedSpaceId || ''
  const owned = []
  const joined = []

  for (const membership of memberships) {
    const memberCount = await getRoomMemberCount(membership.sharedSpaceId)
    const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId: membership.sharedSpaceId }).limit(1).get()
    const invite = inviteRes.data[0]
    const roomItem = buildRoomListItem(membership, invite, activeSharedSpaceId, memberCount)

    if (roomItem.role === 'owner') {
      owned.push(roomItem)
    } else {
      joined.push(roomItem)
    }
  }

  owned.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0))
  joined.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0))

  return {
    ok: true,
    activeSharedSpaceId,
    owned,
    joined,
    totalCount: owned.length + joined.length,
  }
}

const resolveActiveRoomAfterRemoval = async (openid, removedSpaceId) => {
  const user = await getUserInSpace(openid)
  if (!user || user.sharedSpaceId !== removedSpaceId) {
    return null
  }

  const remainingRes = await db.collection('room_members').where({ openid }).limit(1).get()
  const nextMembership = remainingRes.data[0]

  if (nextMembership) {
    const userPayload = await setActiveRoom(openid, nextMembership.sharedSpaceId)
    const inviteRes = await db
      .collection('invite_codes')
      .where({ sharedSpaceId: nextMembership.sharedSpaceId })
      .limit(1)
      .get()
    const partner = await findPartnerInRoom(nextMembership.sharedSpaceId, openid)

    return {
      cleared: false,
      openid,
      sharedSpaceId: nextMembership.sharedSpaceId,
      roomName: resolveRoomDisplayName(inviteRes.data[0], nextMembership.inviteCode),
      inviteCode: inviteRes.data[0]?.code || nextMembership.inviteCode || '',
      nickname: userPayload.nickname,
      avatarUrl: userPayload.avatarUrl,
      partner: partner
        ? {
            openid: partner.openid,
            nickname: partner.nickname || '对方',
            avatarUrl: partner.avatarUrl || '',
          }
        : null,
    }
  }

  await db.collection('users').doc(user._id).update({
    data: {
      sharedSpaceId: '',
      inviteVerified: false,
      updatedAt: Date.now(),
    },
  })

  return {
    cleared: true,
    openid,
    sharedSpaceId: '',
    nickname: user.nickname || '我',
    avatarUrl: user.avatarUrl || '',
  }
}

const notifyRoomMembersViaBark = async ({ sharedSpaceId, excludeOpenid, title, body }) => {
  try {
    const membersRes = await db.collection('room_members').where({ sharedSpaceId }).get()
    const openids = (membersRes.data || []).map((item) => item.openid).filter(Boolean)

    if (!openids.length) {
      return
    }

    await cloud.callFunction({
      name: 'bark',
      data: {
        action: 'notifyUsers',
        payload: {
          openids,
          excludeOpenid,
          title,
          body,
        },
      },
    })
  } catch (error) {
    console.warn('[sharedSpace] bark notify failed', error)
  }
}

const leaveRoom = async (openid, sharedSpaceId) => {
  await ensureCollections()

  const targetSpaceId = `${sharedSpaceId || ''}`.trim()
  if (!targetSpaceId) {
    return { ok: false, message: '缺少房间 ID' }
  }

  const membership = await findRoomMember(openid, targetSpaceId)
  if (!membership) {
    return { ok: false, message: '你不在该房间中' }
  }

  if (membership.role === 'owner') {
    return { ok: false, message: '创建者请使用删除房间' }
  }

  const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId: targetSpaceId }).limit(1).get()
  const invite = inviteRes.data[0]
  const roomName = resolveRoomDisplayName(invite, membership.inviteCode || invite?.code || '')
  const actorProfile = await getUserProfileByOpenid(openid)
  const actorName = `${actorProfile?.nickname || '一位成员'}`.trim() || '一位成员'

  await notifyRoomMembersViaBark({
    sharedSpaceId: targetSpaceId,
    excludeOpenid: openid,
    title: 'MyForest',
    body: `${actorName} 已退出房间「${roomName}」`,
  })

  await db.collection('room_members').doc(membership._id).remove()

  const sessionState = await resolveActiveRoomAfterRemoval(openid, targetSpaceId)

  return {
    ok: true,
    removed: true,
    ...(sessionState || { cleared: true, openid, sharedSpaceId: '' }),
  }
}

const deleteRoom = async (openid, sharedSpaceId) => {
  await ensureCollections()

  const targetSpaceId = `${sharedSpaceId || ''}`.trim()
  if (!targetSpaceId) {
    return { ok: false, message: '缺少房间 ID' }
  }

  const membership = await findRoomMember(openid, targetSpaceId)
  if (!membership || membership.role !== 'owner') {
    return { ok: false, message: '仅创建者可删除房间' }
  }

  const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId: targetSpaceId }).limit(1).get()
  const invite = inviteRes.data[0]
  const roomName = resolveRoomDisplayName(invite, membership.inviteCode || invite?.code || '')

  const membersRes = await db.collection('room_members').where({ sharedSpaceId: targetSpaceId }).get()
  const memberOpenids = (membersRes.data || []).map((item) => item.openid).filter(Boolean)

  await notifyRoomMembersViaBark({
    sharedSpaceId: targetSpaceId,
    excludeOpenid: openid,
    title: 'MyForest',
    body: `房间「${roomName}」已被创建者关闭`,
  })

  if (invite?._id) {
    await db.collection('invite_codes').doc(invite._id).update({
      data: {
        enabled: false,
        closedAt: Date.now(),
        updatedAt: Date.now(),
      },
    })
  }

  for (const memberDoc of membersRes.data || []) {
    if (memberDoc?._id) {
      await db.collection('room_members').doc(memberDoc._id).remove()
    }
  }

  let sessionState = null
  for (const memberOpenid of memberOpenids) {
    const nextState = await resolveActiveRoomAfterRemoval(memberOpenid, targetSpaceId)
    if (memberOpenid === openid) {
      sessionState = nextState
    }
  }

  return {
    ok: true,
    removed: true,
    ...(sessionState || { cleared: true, openid, sharedSpaceId: '' }),
  }
}

const switchRoom = async (openid, sharedSpaceId, profile = {}) => {
  await ensureCollections()

  const targetSpaceId = `${sharedSpaceId || ''}`.trim()
  if (!targetSpaceId) {
    return { ok: false, message: '缺少房间 ID' }
  }

  const membership = await findRoomMember(openid, targetSpaceId)
  if (!membership) {
    return { ok: false, message: '你不在该房间中' }
  }

  const userPayload = await setActiveRoom(openid, targetSpaceId, profile)
  const partner = await findPartnerInRoom(targetSpaceId, openid)
  const inviteRes = await db.collection('invite_codes').where({ sharedSpaceId: targetSpaceId }).limit(1).get()
  const invite = inviteRes.data[0]

  return {
    ok: true,
    openid,
    sharedSpaceId: targetSpaceId,
    roomName: resolveRoomDisplayName(invite, invite?.code || membership.inviteCode || ''),
    inviteCode: invite?.code || membership.inviteCode || '',
    nickname: userPayload.nickname,
    avatarUrl: userPayload.avatarUrl,
    memberCount: await getRoomMemberCount(targetSpaceId),
    partner: partner
      ? {
          openid: partner.openid,
          nickname: partner.nickname || '对方',
          avatarUrl: partner.avatarUrl || '',
        }
      : null,
  }
}

const mapSpaceMembers = (items) =>
  (items || []).map((item) => ({
    openid: item.openid || item._openid,
    nickname: item.nickname || '我',
    avatarUrl: item.avatarUrl || '',
  }))

const listVisibleTags = async (sharedSpaceId, openid) => {
  const [sharedRes, privateRes] = await Promise.all([
    db.collection('plan_tags').where({ sharedSpaceId, visibility: 'shared' }).get(),
    db.collection('plan_tags').where({ sharedSpaceId, visibility: 'private', ownerOpenid: openid }).get(),
  ])

  return [...(sharedRes.data || []), ...(privateRes.data || [])]
}

const seedDefaultSharedTags = async (sharedSpaceId, openid) => {
  const now = Date.now()

  await Promise.all(
    DEFAULT_SHARED_TAGS.map((item, index) =>
      db.collection('plan_tags').add({
        data: {
          id: `tag-seed-${index}-${now}`,
          name: item.name,
          color: item.color,
          visibility: 'shared',
          sharedSpaceId,
          ownerOpenid: openid,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  )
}

const ensureDefaultSharedTags = async (sharedSpaceId, openid) => {
  const sharedRes = await db.collection('plan_tags').where({ sharedSpaceId, visibility: 'shared' }).limit(1).get()
  if (sharedRes.data.length > 0) {
    return
  }

  await seedDefaultSharedTags(sharedSpaceId, openid)
}

const fetchSharedSpacePayload = async (sharedSpaceId, openid) => {
  await ensureDefaultSharedTags(sharedSpaceId, openid)

  const [membersRes, plansRes, recordsRes, tags] = await Promise.all([
    listRoomMembersWithProfiles(sharedSpaceId),
    db.collection('plans').where({ sharedSpaceId }).get(),
    db.collection('completed_records').where({ sharedSpaceId }).get(),
    listVisibleTags(sharedSpaceId, openid),
  ])

  return {
    sharedSpaceId,
    members: mapSpaceMembers(membersRes),
    plans: plansRes.data || [],
    records: recordsRes.data || [],
    tags,
  }
}

const upsertPlanTag = async (openid, user, payload = {}) => {
  if (!user?.sharedSpaceId) {
    return { ok: false, message: '未加入共享空间' }
  }

  const name = `${payload.name || ''}`.trim()
  const color = normalizeHexColor(payload.color)
  const visibility = payload.visibility === 'private' ? 'private' : 'shared'
  const tagId = payload.id || `tag-${Date.now()}`

  if (!name) {
    return { ok: false, message: '请输入标签名称' }
  }

  if (!color) {
    return { ok: false, message: '请选择有效颜色' }
  }

  const scopeWhere =
    visibility === 'shared'
      ? { sharedSpaceId: user.sharedSpaceId, visibility: 'shared', name }
      : { sharedSpaceId: user.sharedSpaceId, visibility: 'private', ownerOpenid: openid, name }

  const duplicateRes = await db.collection('plan_tags').where(scopeWhere).limit(1).get()
  if (duplicateRes.data[0] && duplicateRes.data[0].id !== tagId) {
    return { ok: false, message: '这个标签已存在' }
  }

  const now = Date.now()
  const data = {
    id: tagId,
    name,
    color,
    visibility,
    sharedSpaceId: user.sharedSpaceId,
    ownerOpenid: openid,
    updatedAt: now,
  }

  const existingById = await db.collection('plan_tags').where({ sharedSpaceId: user.sharedSpaceId, id: tagId }).limit(1).get()
  if (existingById.data[0]) {
    const doc = existingById.data[0]
    if (doc.visibility === 'private' && doc.ownerOpenid !== openid) {
      return { ok: false, message: '无权修改此标签' }
    }

    await db.collection('plan_tags').doc(doc._id).update({
      data: {
        ...data,
        createdAt: doc.createdAt || now,
      },
    })
  } else {
    await db.collection('plan_tags').add({
      data: {
        ...data,
        createdAt: now,
      },
    })
  }

  return { ok: true, tag: data }
}

const deletePlanTag = async (openid, user, payload = {}) => {
  if (!user?.sharedSpaceId) {
    return { ok: false, message: '未加入共享空间' }
  }

  const tagId = `${payload.id || ''}`.trim()
  if (!tagId) {
    return { ok: false, message: '缺少标签 id' }
  }

  const existingRes = await db
    .collection('plan_tags')
    .where({ sharedSpaceId: user.sharedSpaceId, id: tagId })
    .limit(1)
    .get()
  const doc = existingRes.data[0]

  if (!doc) {
    return { ok: false, message: '标签不存在' }
  }

  if (doc.visibility === 'private' && doc.ownerOpenid !== openid) {
    return { ok: false, message: '无权删除此标签' }
  }

  await db.collection('plan_tags').doc(doc._id).remove()
  return { ok: true }
}

const deleteCompletedRecord = async (openid, user, payload = {}) => {
  if (!user?.sharedSpaceId) {
    return { ok: false, message: '未加入共享空间' }
  }

  const recordId = `${payload.id || ''}`.trim()
  if (!recordId) {
    return { ok: false, message: '缺少记录 id' }
  }

  const result = await db
    .collection('completed_records')
    .where({
      sharedSpaceId: user.sharedSpaceId,
      id: recordId,
    })
    .limit(1)
    .get()

  const record = result.data[0]
  const recordOwner = record?.userId || record?._openid
  if (record && recordOwner !== openid) {
    return { ok: false, message: '无权删除此记录' }
  }

  if (record?._id) {
    await db.collection('completed_records').doc(record._id).remove()
  }

  return { ok: true, removed: Boolean(record) }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { ok: false, message: '无法获取用户身份' }
  }

  const managedActions = [
    'saveProfile',
    'listMembers',
    'syncSharedData',
    'restoreSession',
    'resolveAvatar',
    'listFocusSessions',
    'deleteCompletedRecord',
    'listTags',
    'upsertTag',
    'deleteTag',
    'createRoom',
    'joinRoom',
    'listMyRooms',
    'switchRoom',
    'leaveRoom',
    'deleteRoom',
  ]

  const roomActions = ['createRoom', 'joinRoom', 'listMyRooms', 'switchRoom', 'leaveRoom', 'deleteRoom']

  if (roomActions.includes(event.action)) {
    try {
      await ensureCollections()
      const profile = event.payload || {}
      const sessionProfile = {
        nickname: event.nickname || profile.nickname,
        avatarUrl: event.avatarUrl || profile.avatarUrl,
        roomName: profile.roomName,
      }

      if (event.action === 'createRoom') {
        return await createRoom(openid, sessionProfile)
      }

      if (event.action === 'joinRoom') {
        return await joinRoomByCode(openid, profile.code || event.code, sessionProfile)
      }

      if (event.action === 'listMyRooms') {
        return await listMyRooms(openid)
      }

      if (event.action === 'switchRoom') {
        return await switchRoom(openid, profile.sharedSpaceId || event.sharedSpaceId, sessionProfile)
      }

      if (event.action === 'leaveRoom') {
        return await leaveRoom(openid, profile.sharedSpaceId || event.sharedSpaceId)
      }

      if (event.action === 'deleteRoom') {
        return await deleteRoom(openid, profile.sharedSpaceId || event.sharedSpaceId)
      }
    } catch (error) {
      console.error(`[sharedSpace] ${event.action}`, error)
      return {
        ok: false,
        message: error.message || '房间操作失败',
      }
    }
  }

  if (managedActions.includes(event.action)) {
    try {
      if (event.action === 'saveProfile') {
        await ensureCollections()
        const profile = await saveUserProfile(openid, event.payload || {})
        return { ok: true, ...profile }
      }

      const user = await getUserInSpace(openid)

      if (event.action === 'restoreSession') {
        if (!user?.nickname?.trim() || !user?.avatarUrl) {
          return { ok: true, exists: false }
        }

        let partner = null
        if (user.sharedSpaceId) {
          await ensureLegacyRoomMembership(openid, user.sharedSpaceId)
          partner = await findPartnerInRoom(user.sharedSpaceId, openid)
        }

        return {
          ok: true,
          exists: true,
          openid,
          sharedSpaceId: user.sharedSpaceId || '',
          nickname: user.nickname.trim(),
          avatarUrl: user.avatarUrl || '',
          inviteVerified: Boolean(user.sharedSpaceId && user.inviteVerified !== false),
          partner: partner
            ? {
                openid: partner.openid || partner._openid,
                nickname: partner.nickname || '对方',
                avatarUrl: partner.avatarUrl || '',
              }
            : null,
        }
      }

      if (event.action === 'resolveAvatar') {
        if (!user?.sharedSpaceId) {
          return { ok: false, message: '未加入共享空间' }
        }

        const fileID = `${event.payload?.fileID || ''}`.trim()
        if (!fileID.startsWith('cloud://')) {
          return { ok: false, message: '头像文件 ID 无效' }
        }

        const partner = await findPartnerInRoom(user.sharedSpaceId, openid)
        const canRead = user.avatarUrl === fileID || partner?.avatarUrl === fileID
        if (!canRead) {
          return { ok: false, message: '无权读取该头像' }
        }

        const result = await cloud.getTempFileURL({ fileList: [fileID] })
        const item = result.fileList?.[0]
        if (!item?.tempFileURL || (item.status && item.status !== 0)) {
          return { ok: false, message: item?.errMsg || '云文件不存在或无权访问' }
        }

        return { ok: true, fileID, tempFileURL: item.tempFileURL }
      }

      if (event.action === 'listFocusSessions') {
        if (!user?.sharedSpaceId) {
          return {
            ok: true,
            openid,
            sharedSpaceId: '',
            sessions: [],
          }
        }

        const [sessionsRes, members] = await Promise.all([
          db.collection('focus_sessions').where({ sharedSpaceId: user.sharedSpaceId }).get(),
          listRoomMembersWithProfiles(user.sharedSpaceId),
        ])
        const memberMap = {}
        members.forEach((item) => {
          if (item.openid) {
            memberMap[item.openid] = item
          }
        })

        const sessions = (sessionsRes.data || []).map((doc) => {
          const member = memberMap[doc.userId] || {}
          return {
            ...doc,
            nickname: member.nickname || (doc.userId === openid ? user.nickname : '对方'),
            avatarUrl: member.avatarUrl || '',
          }
        })

        return {
          ok: true,
          openid,
          sharedSpaceId: user.sharedSpaceId,
          sessions,
        }
      }

      if (event.action === 'deleteCompletedRecord') {
        return deleteCompletedRecord(openid, user, event.payload || {})
      }

      if (event.action === 'listTags') {
        if (!user?.sharedSpaceId) {
          return { ok: true, sharedSpaceId: '', tags: [] }
        }

        await ensureDefaultSharedTags(user.sharedSpaceId, openid)
        const tags = await listVisibleTags(user.sharedSpaceId, openid)
        return {
          ok: true,
          sharedSpaceId: user.sharedSpaceId,
          tags,
        }
      }

      if (event.action === 'upsertTag') {
        return upsertPlanTag(openid, user, event.payload || {})
      }

      if (event.action === 'deleteTag') {
        return deletePlanTag(openid, user, event.payload || {})
      }

      if (!user?.sharedSpaceId) {
        return {
          ok: true,
          sharedSpaceId: '',
          members: [],
          plans: [],
          records: [],
          tags: [],
          hasPartner: false,
        }
      }

      const payload = await fetchSharedSpacePayload(user.sharedSpaceId, openid)

      if (event.action === 'listMembers') {
        return {
          ok: true,
          sharedSpaceId: payload.sharedSpaceId,
          members: payload.members,
          hasPartner: payload.members.length > 1,
        }
      }

      return {
        ok: true,
        ...payload,
        hasPartner: payload.members.length > 1,
      }
    } catch (error) {
      console.error(`[sharedSpace] ${event.action}`, error)
      return {
        ok: false,
        message: error.message || '读取共享空间失败',
      }
    }
  }

  return { ok: false, message: '缺少有效操作' }
}
