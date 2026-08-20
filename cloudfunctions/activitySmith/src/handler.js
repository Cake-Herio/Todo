const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const API_BASE = 'https://activitysmith.com/api/live-activity/stream'
const COLLECTION = 'activitysmith_sessions'
const USERS_COLLECTION = 'users'

const FOCUS_ACCENT_COLOR = 'green'
const PAUSE_ACCENT_COLOR = 'gray'
const COMPLETE_ACCENT_COLOR = 'lime'
const FOCUS_CYCLE_MINUTES = 60
const PROGRESS_STEPS = 10
const MINUTES_PER_STEP = FOCUS_CYCLE_MINUTES / PROGRESS_STEPS

const getStreamKey = (openid) => `myforest-focus-${openid.slice(-12)}`

const maskApiKey = (apiKey) => {
  if (!apiKey) {
    return ''
  }

  if (apiKey.length <= 12) {
    return '已配置'
  }

  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

const normalizeApiKey = (value) => `${value || ''}`.trim()

const isValidApiKey = (apiKey) => /^ask_[A-Za-z0-9_-]+$/.test(apiKey)

const findUserByOpenid = async (openid) => {
  const bySystemOpenid = await db.collection(USERS_COLLECTION).where({ _openid: openid }).limit(1).get()
  if (bySystemOpenid.data[0]) {
    return bySystemOpenid.data[0]
  }

  const byOpenidField = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
  return byOpenidField.data[0] || null
}

const getUserApiKey = async (openid) => {
  const user = await findUserByOpenid(openid)
  const storedKey = normalizeApiKey(user?.activitySmithApiKey)
  if (storedKey) {
    return storedKey
  }

  return normalizeApiKey(process.env.ACTIVITYSMITH_API_KEY)
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

  return `${hours}h${restMinutes}min`
}

const buildCycleProgress = (elapsedSeconds) => {
  const totalMinutes = Math.floor(Math.max(elapsedSeconds, 0) / 60)
  const minutesInCycle = totalMinutes % FOCUS_CYCLE_MINUTES

  if (totalMinutes > 0 && minutesInCycle === 0) {
    return {
      number_of_steps: PROGRESS_STEPS,
      current_step: PROGRESS_STEPS,
    }
  }

  const filledSteps = Math.floor(minutesInCycle / MINUTES_PER_STEP)

  // 每满 6 分钟亮一格：0-5m→1，6-11m→2，12-17m→3 …（API 要求 current_step >= 1）
  return {
    number_of_steps: PROGRESS_STEPS,
    current_step: Math.max(1, Math.min(PROGRESS_STEPS, filledSteps + 1)),
  }
}

const resolveElapsedSeconds = (doc) => {
  const accumulatedSeconds = doc.accumulatedSeconds || 0

  if (doc.isPaused || !doc.segmentStartedAt) {
    return accumulatedSeconds
  }

  return accumulatedSeconds + Math.floor((Date.now() - doc.segmentStartedAt) / 1000)
}

const buildContentState = (payload, options = {}) => {
  const elapsedSeconds = Math.max(Number(payload.elapsedSeconds) || 0, 0)
  const isPaused = Boolean(payload.isPaused)
  const isComplete = Boolean(options.isComplete)
  const durationText = formatElapsedDuration(elapsedSeconds)

  let statusLabel = '专注中'
  let color = FOCUS_ACCENT_COLOR

  if (isComplete) {
    statusLabel = '专注完成'
    color = COMPLETE_ACCENT_COLOR
  } else if (isPaused) {
    statusLabel = '专注暂停'
    color = PAUSE_ACCENT_COLOR
  }

  const progress = isComplete
    ? { number_of_steps: PROGRESS_STEPS, current_step: PROGRESS_STEPS }
    : buildCycleProgress(elapsedSeconds)

  return {
    title: 'MyForest',
    subtitle: `${statusLabel} · 累计时间 ${durationText}`,
    type: 'segmented_progress',
    color,
    number_of_steps: progress.number_of_steps,
    current_step: progress.current_step,
  }
}

const requestActivitySmith = (method, streamKey, apiKey, body) =>
  new Promise((resolve, reject) => {
    const https = require('https')
    const payload = body ? JSON.stringify(body) : ''
    const url = new URL(`${API_BASE}/${encodeURIComponent(streamKey)}`)

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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
                `ActivitySmith 请求失败 (${res.statusCode})`,
            ),
          )
        })
      },
    )

    req.on('error', reject)

    if (payload) {
      req.write(payload)
    }

    req.end()
  })

const ensureCollection = async () => {
  try {
    await db.createCollection(COLLECTION)
  } catch (error) {
    const msg = `${error?.message || ''} ${error?.errMsg || ''}`
    if (!/exist|已存在|ResourceExist|already/i.test(msg)) {
      console.warn(`[activitySmith] createCollection ${COLLECTION}:`, error)
    }
  }
}

const pushSessionToActivitySmith = async (openid, sessionDoc, options = {}) => {
  const apiKey = await getUserApiKey(openid)
  if (!apiKey) {
    return { ok: false, skipped: true, message: '未配置 ActivitySmith API Key' }
  }

  const elapsedSeconds = resolveElapsedSeconds(sessionDoc)
  const streamKey = getStreamKey(openid)
  const contentState = buildContentState(
    {
      elapsedSeconds,
      isPaused: sessionDoc.isPaused,
      tag: sessionDoc.tag,
      detail: sessionDoc.detail,
    },
    options,
  )

  const response = await requestActivitySmith('PUT', streamKey, apiKey, {
    content_state: contentState,
  })

  return {
    ok: true,
    streamKey,
    elapsedSeconds,
    operation: response.body?.operation || 'updated',
  }
}

const endSessionOnActivitySmith = async (openid, sessionDoc) => {
  const apiKey = await getUserApiKey(openid)
  if (!apiKey) {
    return { ok: false, skipped: true, message: '未配置 ActivitySmith API Key' }
  }

  const elapsedSeconds = resolveElapsedSeconds(sessionDoc)
  const streamKey = getStreamKey(openid)
  const contentState = buildContentState(
    {
      elapsedSeconds,
      isPaused: false,
      tag: sessionDoc.tag,
      detail: sessionDoc.detail,
    },
    { isComplete: true },
  )

  const response = await requestActivitySmith('DELETE', streamKey, apiKey, {
    content_state: {
      ...contentState,
      auto_dismiss_minutes: 0,
    },
  })

  return {
    ok: true,
    streamKey,
    operation: response.body?.operation || 'ended',
  }
}

const findSessionDoc = async (openid) => {
  const res = await db.collection(COLLECTION).where({ userId: openid, active: true }).limit(1).get()
  return res.data[0] || null
}

const getApiKeyStatus = async (openid) => {
  const apiKey = await getUserApiKey(openid)

  return {
    ok: true,
    configured: Boolean(apiKey),
    maskedKey: maskApiKey(apiKey),
  }
}

const saveApiKey = async (openid, payload = {}) => {
  const apiKey = normalizeApiKey(payload.apiKey)

  if (!apiKey) {
    return { ok: false, message: '请输入 API Key' }
  }

  if (!isValidApiKey(apiKey)) {
    return { ok: false, message: 'API Key 格式无效，请检查是否完整复制' }
  }

  const existing = await findUserByOpenid(openid)
  const now = Date.now()
  const userPayload = {
    openid,
    activitySmithApiKey: apiKey,
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
    maskedKey: maskApiKey(apiKey),
  }
}

const upsertSession = async (openid, payload = {}) => {
  await ensureCollection()

  const data = {
    userId: openid,
    active: true,
    sessionStartedAt: payload.sessionStartedAt || Date.now(),
    accumulatedSeconds: payload.accumulatedSeconds || 0,
    segmentStartedAt: payload.segmentStartedAt || 0,
    isPaused: Boolean(payload.isPaused),
    tag: `${payload.tag || ''}`.trim(),
    detail: `${payload.detail || ''}`.trim(),
    updatedAt: Date.now(),
  }

  const existing = await findSessionDoc(openid)
  if (existing?._id) {
    await db.collection(COLLECTION).doc(existing._id).update({ data })
  } else {
    await db.collection(COLLECTION).add({ data })
  }

  const pushResult = await pushSessionToActivitySmith(openid, data)
  if (pushResult.skipped) {
    return pushResult
  }

  return {
    ok: true,
    push: pushResult,
  }
}

const endSession = async (openid, payload = {}) => {
  await ensureCollection()

  const existing = await findSessionDoc(openid)
  const sessionDoc = existing || {
    userId: openid,
    accumulatedSeconds: payload.accumulatedSeconds || 0,
    segmentStartedAt: 0,
    isPaused: true,
    tag: payload.tag || '',
    detail: payload.detail || '',
  }

  if (payload.accumulatedSeconds != null) {
    sessionDoc.accumulatedSeconds = payload.accumulatedSeconds
    sessionDoc.segmentStartedAt = 0
    sessionDoc.isPaused = true
  }

  const endResult = await endSessionOnActivitySmith(openid, sessionDoc)

  if (existing?._id) {
    await db.collection(COLLECTION).doc(existing._id).remove()
  }

  if (endResult.skipped) {
    return endResult
  }

  return {
    ok: true,
    end: endResult,
  }
}

const runCronPush = async () => {
  await ensureCollection()

  const res = await db.collection(COLLECTION).where({ active: true }).get()
  const sessions = res.data || []
  const results = []

  for (const doc of sessions) {
    const openid = doc.userId
    if (!openid) {
      continue
    }

    try {
      const pushResult = await pushSessionToActivitySmith(openid, doc)
      if (pushResult.skipped) {
        results.push({
          userId: openid,
          ok: false,
          skipped: true,
          message: pushResult.message,
        })
        continue
      }

      await db.collection(COLLECTION).doc(doc._id).update({
        data: {
          updatedAt: Date.now(),
          lastPushedAt: Date.now(),
        },
      })
      results.push({
        userId: openid,
        ok: true,
        elapsedSeconds: pushResult.elapsedSeconds,
        operation: pushResult.operation,
      })
    } catch (error) {
      console.error('[activitySmith] cron push failed', openid, error)
      results.push({
        userId: openid,
        ok: false,
        message: error.message || 'push failed',
      })
    }
  }

  return {
    ok: true,
    count: results.length,
    results,
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()

  if (wxContext.SOURCE === 'wx_trigger') {
    try {
      return await runCronPush()
    } catch (error) {
      console.error('[activitySmith] cron failed', error)
      return {
        ok: false,
        message: error.message || 'activitySmith cron 失败',
      }
    }
  }

  const openid = wxContext.OPENID
  if (!openid) {
    return { ok: false, message: '无法获取用户身份' }
  }

  const action = event.action || 'upsertSession'

  try {
    if (action === 'upsertSession') {
      return await upsertSession(openid, event.payload || {})
    }

    if (action === 'endSession') {
      return await endSession(openid, event.payload || {})
    }

    if (action === 'saveApiKey') {
      return await saveApiKey(openid, event.payload || {})
    }

    if (action === 'getApiKeyStatus') {
      return await getApiKeyStatus(openid)
    }

    return { ok: false, message: `未知 action: ${action}` }
  } catch (error) {
    console.error('[activitySmith]', error)
    return {
      ok: false,
      message: error.message || 'ActivitySmith 失败',
    }
  }
}
