const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const _ = db.command

const API_BASE = 'https://api.day.app'
const USERS_COLLECTION = 'users'
const PLANS_COLLECTION = 'plans'
const FOCUS_COLLECTION = 'bark_focus_sessions'
const PUSH_LOG_COLLECTION = 'bark_push_logs'

/** 开始计时时不再推送给本人（自己知道已开始，避免语义重复） */
const BARK_PUSH_ON_FOCUS_START = false

/** 云存储配图 fileID（免费版无需「所有用户可读」，云函数内 getTempFileURL 换取临时 HTTPS） */
const BARK_PUSH_CLOUD_FILE_ID =
  process.env.BARK_PUSH_CLOUD_FILE_ID ||
  'cloud://cloudbase-d4gssgn9yb53a9fc0.636c-cloudbase-d4gssgn9yb53a9fc0-1437421718/myforest-bark-push.png'

let cachedPushImageUrl = ''
let cachedPushImageUrlExpireAt = 0

const resolveBarkPushImageUrl = async () => {
  const overrideUrl = `${process.env.BARK_PUSH_IMAGE_URL || ''}`.trim()
  if (overrideUrl) {
    return overrideUrl
  }

  if (!BARK_PUSH_CLOUD_FILE_ID) {
    return ''
  }

  const now = Date.now()
  if (cachedPushImageUrl && cachedPushImageUrlExpireAt > now + 60 * 1000) {
    return cachedPushImageUrl
  }

  try {
    const res = await cloud.getTempFileURL({
      fileList: [BARK_PUSH_CLOUD_FILE_ID],
    })
    const file = res.fileList?.[0]
    if (file?.status === 0 && file.tempFileURL) {
      cachedPushImageUrl = file.tempFileURL
      cachedPushImageUrlExpireAt = now + 90 * 60 * 1000
      return cachedPushImageUrl
    }

    console.warn('[bark] getTempFileURL failed', file)
  } catch (error) {
    console.warn('[bark] resolve push image url failed', error)
  }

  return ''
}

const BARK_GROUP = 'MyForest'
const FOCUS_PUSH_INTERVAL_MINUTES = 15
const ACTIVE_PLAN_STATUSES = ['pending', 'in_progress']

const parseBarkDeviceKey = (raw) => {
  const trimmed = `${raw || ''}`.trim()
  if (!trimmed) {
    return ''
  }

  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:api\.)?day\.app\/([A-Za-z0-9_-]+)/i)
  if (urlMatch?.[1]) {
    return urlMatch[1]
  }

  return trimmed.replace(/\/+$/, '')
}

const normalizeDeviceKey = (value) => parseBarkDeviceKey(value)

const isValidDeviceKey = (deviceKey) => /^[A-Za-z0-9_-]{8,128}$/.test(deviceKey)

const maskDeviceKey = (deviceKey) => {
  if (!deviceKey) {
    return ''
  }

  if (deviceKey.length <= 12) {
    return '已配置'
  }

  return `${deviceKey.slice(0, 4)}****${deviceKey.slice(-4)}`
}

const findUserByOpenid = async (openid) => {
  const bySystemOpenid = await db.collection(USERS_COLLECTION).where({ _openid: openid }).limit(1).get()
  if (bySystemOpenid.data[0]) {
    return bySystemOpenid.data[0]
  }

  const byOpenidField = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
  return byOpenidField.data[0] || null
}

const getUserDeviceKey = async (openid) => {
  const user = await findUserByOpenid(openid)
  return normalizeDeviceKey(user?.barkDeviceKey)
}

const getTodayShanghai = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })

const parsePlanStartMs = (dateStr, startTime) => {
  if (!dateStr || !startTime) {
    return 0
  }

  const iso = `${dateStr}T${startTime}:00+08:00`
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

const formatElapsedDuration = (elapsedSeconds) => {
  const minutes = Math.floor(Math.max(elapsedSeconds, 0) / 60)

  if (minutes < 60) {
    return `${minutes}min`
  }

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60

  if (restMinutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${restMinutes}min`
}

const buildFocusStartBody = (tag, detail) => {
  const tagLabel = `${tag || ''}`.trim()
  const detailLabel = detail ? ` · ${detail}` : ''
  return `专注已开始 · ${tagLabel}${detailLabel}`
}

const buildFocusReminderBody = (elapsedSeconds) => formatElapsedDuration(elapsedSeconds)

const resolveElapsedSeconds = (doc) => {
  const accumulatedSeconds = doc.accumulatedSeconds || 0

  if (doc.isPaused || !doc.segmentStartedAt) {
    return accumulatedSeconds
  }

  return accumulatedSeconds + Math.floor((Date.now() - doc.segmentStartedAt) / 1000)
}

const requestBark = (deviceKey, body) =>
  new Promise((resolve, reject) => {
    const https = require('https')
    const payload = JSON.stringify(body)
    const url = new URL(`${API_BASE}/${encodeURIComponent(deviceKey)}`)

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          let parsed = null
          if (raw) {
            try {
              parsed = JSON.parse(raw)
            } catch (error) {
              parsed = { raw }
            }
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              body: parsed,
            })
            return
          }

          reject(
            new Error(
              parsed?.message ||
                parsed?.error ||
                (typeof parsed?.raw === 'string' ? parsed.raw : '') ||
                `Bark 请求失败 (${res.statusCode})`,
            ),
          )
        })
      },
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })

const pushBarkToUser = async (openid, { title, body, group = BARK_GROUP }) => {
  const deviceKey = await getUserDeviceKey(openid)
  if (!deviceKey) {
    return { ok: false, skipped: true, message: '未配置 Bark Device Key' }
  }

  const payload = {
    title: `${title || 'MyForest'}`.trim() || 'MyForest',
    body: `${body || ''}`.trim() || 'MyForest 通知',
    group,
  }

  const imageUrl = await resolveBarkPushImageUrl()
  if (imageUrl) {
    payload.icon = imageUrl
    payload.image = imageUrl
  }

  const response = await requestBark(deviceKey, payload)

  return {
    ok: true,
    response: response.body,
  }
}

const ensureCollection = async (name) => {
  try {
    await db.createCollection(name)
  } catch (error) {
    const msg = `${error?.message || ''} ${error?.errMsg || ''}`
    if (!/exist|已存在|ResourceExist|already/i.test(msg)) {
      console.warn(`[bark] createCollection ${name}:`, error)
    }
  }
}

const ensureCollections = async () => {
  await Promise.all([ensureCollection(FOCUS_COLLECTION), ensureCollection(PUSH_LOG_COLLECTION)])
}

const findFocusSessionDoc = async (openid) => {
  const res = await db.collection(FOCUS_COLLECTION).where({ userId: openid, active: true }).limit(1).get()
  return res.data[0] || null
}

const hasPushLog = async (logKey) => {
  const res = await db.collection(PUSH_LOG_COLLECTION).where({ logKey }).limit(1).get()
  return Boolean(res.data[0])
}

const writePushLog = async (logKey, payload = {}) => {
  await db.collection(PUSH_LOG_COLLECTION).add({
    data: {
      logKey,
      ...payload,
      createdAt: Date.now(),
    },
  })
}

const getApiKeyStatus = async (openid) => {
  const deviceKey = await getUserDeviceKey(openid)

  return {
    ok: true,
    configured: Boolean(deviceKey),
    maskedKey: maskDeviceKey(deviceKey),
  }
}

const saveDeviceKey = async (openid, payload = {}) => {
  const deviceKey = normalizeDeviceKey(payload.deviceKey)

  if (!deviceKey) {
    return { ok: false, message: '请输入 Device Key' }
  }

  if (!isValidDeviceKey(deviceKey)) {
    return { ok: false, message: 'Device Key 格式无效，请粘贴 Bark 首页完整链接或 Key' }
  }

  const existing = await findUserByOpenid(openid)
  const now = Date.now()
  const userPayload = {
    openid,
    barkDeviceKey: deviceKey,
    updatedAt: now,
  }

  if (existing?._id) {
    await db.collection(USERS_COLLECTION).doc(existing._id).update({ data: userPayload })
  } else {
    await db.collection(USERS_COLLECTION).add({
      data: {
        ...userPayload,
        nickname: '我',
        createdAt: now,
      },
    })
  }

  return {
    ok: true,
    configured: true,
    maskedKey: maskDeviceKey(deviceKey),
  }
}

const upsertFocusSession = async (openid, payload = {}) => {
  await ensureCollections()

  const data = {
    userId: openid,
    active: true,
    sessionStartedAt: payload.sessionStartedAt || Date.now(),
    accumulatedSeconds: payload.accumulatedSeconds || 0,
    segmentStartedAt: payload.segmentStartedAt || 0,
    isPaused: Boolean(payload.isPaused),
    tag: `${payload.tag || ''}`.trim(),
    detail: `${payload.detail || ''}`.trim(),
    lastBarkPushSlot: 0,
    updatedAt: Date.now(),
  }

  const existing = await findFocusSessionDoc(openid)
  const isNewSession = !existing

  if (existing?._id) {
    data.lastBarkPushSlot = existing.lastBarkPushSlot || 0
    await db.collection(FOCUS_COLLECTION).doc(existing._id).update({ data })
  } else {
    await db.collection(FOCUS_COLLECTION).add({ data })
  }

  if (BARK_PUSH_ON_FOCUS_START && isNewSession && data.tag) {
    const pushResult = await pushBarkToUser(openid, {
      title: 'MyForest',
      body: buildFocusStartBody(data.tag, data.detail),
    })

    if (pushResult.skipped) {
      return pushResult
    }
  }

  return {
    ok: true,
    isNewSession,
  }
}

const endFocusSession = async (openid) => {
  await ensureCollections()

  const existing = await findFocusSessionDoc(openid)
  if (existing?._id) {
    await db.collection(FOCUS_COLLECTION).doc(existing._id).remove()
  }

  return { ok: true }
}

const sendEnableTestPush = async (openid) => {
  const pushResult = await pushBarkToUser(openid, {
    title: 'MyForest',
    body: 'Bark 推送已开启',
  })

  if (pushResult.skipped) {
    return pushResult
  }

  return { ok: true }
}

const notifyUsers = async (payload = {}) => {
  const openids = Array.isArray(payload.openids) ? payload.openids : []
  const excludeOpenid = `${payload.excludeOpenid || ''}`.trim()
  const title = `${payload.title || 'MyForest'}`.trim() || 'MyForest'
  const body = `${payload.body || ''}`.trim() || 'MyForest 通知'
  const results = []

  for (const targetOpenid of openids) {
    if (!targetOpenid || targetOpenid === excludeOpenid) {
      continue
    }

    try {
      const pushResult = await pushBarkToUser(targetOpenid, { title, body })
      results.push({
        openid: targetOpenid,
        ok: Boolean(pushResult.ok),
        skipped: Boolean(pushResult.skipped),
        message: pushResult.message,
      })
    } catch (error) {
      results.push({
        openid: targetOpenid,
        ok: false,
        message: error.message || '推送失败',
      })
    }
  }

  return {
    ok: true,
    count: results.length,
    results,
  }
}

/**
 * 通知同组成员当前用户的专注状态变化
 * payload: { eventType, tag, elapsedMinutes, actorName }
 */
const notifyRoomFocusChange = async (openid, payload = {}) => {
  const eventType = payload.eventType || 'start'
  const tag = `${payload.tag || ''}`.trim()
  const elapsedMinutes = Math.max(0, Number(payload.elapsedMinutes) || 0)

  // 查找用户所属的 sharedSpaceId
  const user = await findUserByOpenid(openid)
  if (!user?.sharedSpaceId) {
    return { ok: false, skipped: true, message: '未加入共享空间' }
  }

  const actorName = `${payload.actorName || user.nickname || ''}`.trim() || '队友'

  // 查询同组成员
  const membersRes = await db.collection('users')
    .where({ sharedSpaceId: user.sharedSpaceId })
    .get()
  const members = membersRes.data || []

  // 收集其他成员的 openid
  const targetOpenids = members
    .map((m) => m.openid || m._openid)
    .filter((oid) => oid && oid !== openid)

  if (targetOpenids.length === 0) {
    return { ok: true, skipped: true, message: '无其他成员' }
  }

  // 构建推送正文
  const formatMinutes = (mins) => {
    if (mins < 60) return `${mins} 分钟`
    const h = Math.floor(mins / 60)
    const rest = mins % 60
    return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分钟`
  }

  let body = ''
  switch (eventType) {
    case 'start':
      body = `${actorName} 开始专注`
      if (tag) body += ` · ${tag}`
      break
    case 'pause':
      body = `${actorName} 暂停专注`
      if (tag) body += ` · ${tag}`
      body += ` · 已专注 ${formatMinutes(elapsedMinutes)}`
      break
    case 'resume':
      body = `${actorName} 继续专注`
      if (tag) body += ` · ${tag}`
      break
    case 'end':
      body = `${actorName} 结束专注`
      if (tag) body += ` · ${tag}`
      body += ` · 共 ${formatMinutes(elapsedMinutes)}`
      break
    default:
      body = `${actorName} 专注状态更新`
      if (tag) body += ` · ${tag}`
  }

  // 逐个推送
  const results = []
  for (const targetOpenid of targetOpenids) {
    try {
      const pushResult = await pushBarkToUser(targetOpenid, {
        title: 'MyForest',
        body,
      })
      results.push({
        openid: targetOpenid,
        ok: Boolean(pushResult.ok),
        skipped: Boolean(pushResult.skipped),
        message: pushResult.message,
      })
    } catch (error) {
      results.push({
        openid: targetOpenid,
        ok: false,
        message: error.message || '推送失败',
      })
    }
  }

  return {
    ok: true,
    eventType,
    count: results.length,
    results,
  }
}

const buildPlanReminderBody = (plan, slot) => {
  const tag = `${plan.tag || ''}`.trim() || '计划'
  const title = `${plan.title || plan.remark || ''}`.trim()
  const timeLabel = plan.startTime && plan.endTime ? `${plan.startTime}-${plan.endTime}` : plan.startTime || ''
  const prefix = slot === '10m' ? '10 分钟后开始' : '1 分钟后开始'
  const suffix = title ? ` · ${title}` : plan.remark ? ` · ${plan.remark}` : ''

  return `${prefix} · ${tag}${suffix}${timeLabel ? ` · ${timeLabel}` : ''}`
}

const runPlanReminders = async () => {
  const today = getTodayShanghai()
  const res = await db
    .collection(PLANS_COLLECTION)
    .where({
      date: today,
      startTime: _.neq(null),
      endTime: _.neq(null),
      status: _.in(ACTIVE_PLAN_STATUSES),
    })
    .get()

  const plans = res.data || []
  const results = []

  for (const plan of plans) {
    const userId = plan.userId
    if (!userId || !plan.id || !plan.startTime) {
      continue
    }

    const startMs = parsePlanStartMs(plan.date, plan.startTime)
    if (!startMs) {
      continue
    }

    const minutesUntil = Math.floor((startMs - Date.now()) / 60000)

    for (const slot of ['10m', '1m']) {
      const targetMinutes = slot === '10m' ? 10 : 1
      if (minutesUntil !== targetMinutes) {
        continue
      }

      const logKey = `plan:${userId}:${plan.id}:${plan.date}:${slot}`
      if (await hasPushLog(logKey)) {
        continue
      }

      try {
        const pushResult = await pushBarkToUser(userId, {
          title: 'MyForest',
          body: buildPlanReminderBody(plan, slot),
        })

        if (pushResult.skipped) {
          results.push({ userId, planId: plan.id, slot, ok: false, skipped: true, message: pushResult.message })
          continue
        }

        await writePushLog(logKey, { userId, planId: plan.id, slot, type: 'plan' })
        results.push({ userId, planId: plan.id, slot, ok: true })
      } catch (error) {
        console.error('[bark] plan reminder failed', userId, plan.id, slot, error)
        results.push({
          userId,
          planId: plan.id,
          slot,
          ok: false,
          message: error.message || 'plan push failed',
        })
      }
    }
  }

  return results
}

const runFocusReminders = async () => {
  await ensureCollections()

  const res = await db.collection(FOCUS_COLLECTION).where({ active: true, isPaused: false }).get()
  const sessions = res.data || []
  const results = []

  for (const doc of sessions) {
    const openid = doc.userId
    const tag = `${doc.tag || ''}`.trim()
    if (!openid || !tag) {
      continue
    }

    const elapsedSeconds = resolveElapsedSeconds(doc)
    const elapsedMinutes = Math.floor(elapsedSeconds / 60)
    const pushSlot = Math.floor(elapsedMinutes / FOCUS_PUSH_INTERVAL_MINUTES)
    const lastBarkPushSlot = doc.lastBarkPushSlot || 0

    if (pushSlot < 1 || pushSlot <= lastBarkPushSlot) {
      continue
    }

    try {
      const pushResult = await pushBarkToUser(openid, {
        title: 'MyForest',
        body: buildFocusReminderBody(elapsedSeconds),
      })

      if (pushResult.skipped) {
        results.push({ userId: openid, ok: false, skipped: true, message: pushResult.message })
        continue
      }

      await db.collection(FOCUS_COLLECTION).doc(doc._id).update({
        data: {
          lastBarkPushSlot: pushSlot,
          updatedAt: Date.now(),
        },
      })

      results.push({ userId: openid, ok: true, pushSlot, elapsedMinutes })
    } catch (error) {
      console.error('[bark] focus reminder failed', openid, error)
      results.push({
        userId: openid,
        ok: false,
        message: error.message || 'focus push failed',
      })
    }
  }

  return results
}

const runCronPush = async () => {
  const [planResults, focusResults] = await Promise.all([runPlanReminders(), runFocusReminders()])

  return {
    ok: true,
    planCount: planResults.length,
    focusCount: focusResults.length,
    planResults,
    focusResults,
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()

  if (wxContext.SOURCE === 'wx_trigger') {
    try {
      return await runCronPush()
    } catch (error) {
      console.error('[bark] cron failed', error)
      return {
        ok: false,
        message: error.message || 'bark cron 失败',
      }
    }
  }

  const openid = wxContext.OPENID
  if (!openid) {
    return { ok: false, message: '无法获取用户身份' }
  }

  const action = event.action || 'upsertFocusSession'

  try {
    if (action === 'upsertFocusSession') {
      return await upsertFocusSession(openid, event.payload || {})
    }

    if (action === 'endFocusSession') {
      return await endFocusSession(openid)
    }

    if (action === 'saveDeviceKey') {
      return await saveDeviceKey(openid, event.payload || {})
    }

    if (action === 'getKeyStatus') {
      return await getApiKeyStatus(openid)
    }

    if (action === 'sendEnableTestPush') {
      return await sendEnableTestPush(openid)
    }

    if (action === 'notifyUsers') {
      return await notifyUsers(event.payload || {})
    }

    if (action === 'notifyRoomFocusChange') {
      return await notifyRoomFocusChange(openid, event.payload || {})
    }

    return { ok: false, message: `未知 action: ${action}` }
  } catch (error) {
    console.error('[bark]', error)
    return {
      ok: false,
      message: error.message || 'Bark 失败',
    }
  }
}
