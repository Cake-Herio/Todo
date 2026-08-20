const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const COLLECTION = 'focus_sessions'

const ensureCollection = async () => {
  try {
    await db.createCollection(COLLECTION)
  } catch (error) {
    const msg = `${error?.message || ''} ${error?.errMsg || ''}`
    if (!/exist|已存在|ResourceExist|already/i.test(msg)) {
      console.warn(`[focusPresence] createCollection ${COLLECTION}:`, error)
    }
  }
}

const getMemberContext = async (openid) => {
  let userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
  let user = userRes.data[0]

  if (!user) {
    userRes = await db.collection('users').where({ openid }).limit(1).get()
    user = userRes.data[0]
  }

  if (!user?.sharedSpaceId) {
    return null
  }

  const membersRes = await db.collection('users').where({ sharedSpaceId: user.sharedSpaceId }).get()
  const members = membersRes.data || []
  const memberMap = {}
  members.forEach((item) => {
    const memberOpenid = item.openid || item._openid
    if (memberOpenid) {
      memberMap[memberOpenid] = item
    }
  })

  return {
    openid,
    sharedSpaceId: user.sharedSpaceId,
    nickname: user.nickname || '我',
    avatarUrl: user.avatarUrl || '',
    members,
    memberMap,
  }
}

const findOwnDoc = async (sharedSpaceId, openid) => {
  const res = await db
    .collection(COLLECTION)
    .where({
      sharedSpaceId,
      userId: openid,
    })
    .limit(1)
    .get()

  return res.data[0] || null
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { ok: false, message: '无法获取用户身份' }
  }

  const action = event.action || 'list'

  try {
    await ensureCollection()

    const ctx = await getMemberContext(openid)
    if (!ctx) {
      return { ok: false, message: '未加入共享空间' }
    }

    if (action === 'upsert') {
      const payload = event.payload || {}
      const data = {
        userId: openid,
        sharedSpaceId: ctx.sharedSpaceId,
        tag: '',
        detail: '',
        linkedPlanId: '',
        sessionStartedAt: payload.sessionStartedAt || Date.now(),
        accumulatedSeconds: payload.accumulatedSeconds || 0,
        segmentStartedAt: payload.segmentStartedAt || 0,
        isPaused: Boolean(payload.isPaused),
        tag: `${payload.tag || ''}`.trim(),
        updatedAt: Date.now(),
      }

      const existing = await findOwnDoc(ctx.sharedSpaceId, openid)
      if (existing?._id) {
        await db.collection(COLLECTION).doc(existing._id).update({ data })
      } else {
        await db.collection(COLLECTION).add({ data })
      }

      return { ok: true }
    }

    if (action === 'clear') {
      const existing = await findOwnDoc(ctx.sharedSpaceId, openid)
      if (existing?._id) {
        await db.collection(COLLECTION).doc(existing._id).remove()
      }

      return { ok: true }
    }

    if (action === 'listMembers') {
      const members = ctx.members
        .filter((item) => item._openid || item.openid)
        .map((item) => ({
          openid: item.openid || item._openid,
          nickname: item.nickname || '我',
          avatarUrl: item.avatarUrl || '',
        }))

      return {
        ok: true,
        sharedSpaceId: ctx.sharedSpaceId,
        members,
        hasPartner: ctx.members.length > 1,
      }
    }

    if (action === 'syncSharedData') {
      const [plansRes, recordsRes] = await Promise.all([
        db.collection('plans').where({ sharedSpaceId: ctx.sharedSpaceId }).get(),
        db.collection('completed_records').where({ sharedSpaceId: ctx.sharedSpaceId }).get(),
      ])

      const members = ctx.members
        .filter((item) => item._openid || item.openid)
        .map((item) => ({
          openid: item.openid || item._openid,
          nickname: item.nickname || '我',
          avatarUrl: item.avatarUrl || '',
        }))

      return {
        ok: true,
        sharedSpaceId: ctx.sharedSpaceId,
        members,
        plans: plansRes.data || [],
        records: recordsRes.data || [],
        hasPartner: ctx.members.length > 1,
      }
    }

    if (action === 'list') {
      const res = await db.collection(COLLECTION).where({ sharedSpaceId: ctx.sharedSpaceId }).get()
      const sessions = (res.data || []).map((doc) => {
        const member = ctx.memberMap[doc.userId] || {}
        return {
          ...doc,
          nickname: member.nickname || (doc.userId === openid ? ctx.nickname : '对方'),
          avatarUrl: member.avatarUrl || '',
        }
      })

      return {
        ok: true,
        openid,
        sharedSpaceId: ctx.sharedSpaceId,
        sessions,
      }
    }

    return { ok: false, message: `未知 action: ${action}` }
  } catch (error) {
    console.error('[focusPresence]', error)
    return {
      ok: false,
      message: error.message || 'focusPresence 失败',
    }
  }
}
