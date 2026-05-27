const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()

const DEFAULT_CODE = 'FOREST2026'
const COLLECTIONS = ['users', 'invite_codes', 'plans', 'completed_records', 'focus_sessions']

const ensureCollections = async () => {
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
    } catch (error) {
      const msg = `${error?.message || ''} ${error?.errMsg || ''}`
      if (!/exist|已存在|ResourceExist|already/i.test(msg)) {
        console.warn(`[verifyInvite] createCollection ${name}:`, error)
      }
    }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { ok: false, message: '无法获取用户身份' }
  }

  const code = (event.code || '').trim().toUpperCase()
  if (!code || code !== DEFAULT_CODE) {
    return { ok: false, message: '邀请码无效' }
  }

  try {
    await ensureCollections()

    let sharedSpaceId = ''

    const inviteRes = await db.collection('invite_codes').where({ code }).limit(1).get()
    if (inviteRes.data.length === 0) {
      sharedSpaceId = `space-${Date.now()}`
      await db.collection('invite_codes').add({
        data: {
          code,
          sharedSpaceId,
          enabled: true,
          createdAt: Date.now(),
        },
      })
    } else {
      sharedSpaceId = inviteRes.data[0].sharedSpaceId
      if (inviteRes.data[0].enabled === false) {
        return { ok: false, message: '邀请码已失效' }
      }
    }

    const membersRes = await db.collection('users').where({ sharedSpaceId }).get()
    const members = membersRes.data || []
    const existingMember = members.find((item) => item._openid === openid)

    // 暂时不限制共享空间人数（原限制为 2 人）
    const now = Date.now()
    const nickname = (event.nickname || existingMember?.nickname || '我').trim() || '我'
    const avatarUrl = event.avatarUrl || existingMember?.avatarUrl || ''
    const userPayload = {
      sharedSpaceId,
      inviteVerified: true,
      nickname,
      avatarUrl,
      updatedAt: now,
    }

    if (existingMember) {
      await db.collection('users').doc(existingMember._id).update({ data: userPayload })
    } else {
      await db.collection('users').add({
        data: {
          ...userPayload,
          createdAt: now,
        },
      })
    }

    const refreshedMembersRes = await db.collection('users').where({ sharedSpaceId }).get()
    const refreshedMembers = refreshedMembersRes.data || []
    const partner = refreshedMembers.find((item) => item._openid !== openid) || null

    return {
      ok: true,
      openid,
      sharedSpaceId,
      nickname: userPayload.nickname,
      avatarUrl: userPayload.avatarUrl,
      partner: partner
        ? {
            openid: partner._openid,
            nickname: partner.nickname || '对方',
            avatarUrl: partner.avatarUrl || '',
          }
        : null,
    }
  } catch (error) {
    console.error('[verifyInvite]', error)
    return {
      ok: false,
      message: error.message || '邀请码验证失败',
    }
  }
}
