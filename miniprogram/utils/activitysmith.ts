const ENABLED_KEY = 'myforest_activitysmith_enabled'
const KEY_CONFIGURED_KEY = 'myforest_activitysmith_key_configured'
export const ACTIVITYSMITH_APP_STORE_URL = 'https://apps.apple.com/cn/app/activitysmith/id6752254835'
export const ACTIVITYSMITH_APP_STORE_ID = '6752254835'

export interface ActivitySmithSessionPayload {
  sessionStartedAt: number
  accumulatedSeconds: number
  segmentStartedAt: number
  isPaused: boolean
  tag?: string
  detail?: string
}

export interface ActivitySmithEndPayload {
  accumulatedSeconds?: number
  tag?: string
  detail?: string
}

export interface ActivitySmithApiKeyStatus {
  configured: boolean
  maskedKey: string
}

interface ActivitySmithResult {
  ok?: boolean
  skipped?: boolean
  configured?: boolean
  maskedKey?: string
  message?: string
}

export const isActivitySmithKeyConfigured = () => wx.getStorageSync(KEY_CONFIGURED_KEY) === true

export const setActivitySmithKeyConfigured = (configured: boolean) => {
  wx.setStorageSync(KEY_CONFIGURED_KEY, configured)
}

export const isActivitySmithEnabled = () => wx.getStorageSync(ENABLED_KEY) === true

export const setActivitySmithEnabled = (enabled: boolean) => {
  wx.setStorageSync(ENABLED_KEY, enabled)
}

import { openAppStorePage } from './open-app-store'

export const getActivitySmithStatusLabel = () => {
  if (!isActivitySmithKeyConfigured()) {
    return '未配置 API Key'
  }

  if (isActivitySmithEnabled()) {
    return '已开启，专注时同步灵动岛'
  }

  return '已配置 API Key，未开启'
}

export const openActivitySmithAppStore = async () => {
  await openAppStorePage({
    httpsUrl: ACTIVITYSMITH_APP_STORE_URL,
    appStoreId: ACTIVITYSMITH_APP_STORE_ID,
    appName: 'ActivitySmith',
  })
}

const callActivitySmith = async (action: string, payload?: unknown) => {
  const result = await wx.cloud.callFunction({
    name: 'activitySmith',
    data: {
      action,
      payload,
    },
  })

  return (result.result || {}) as ActivitySmithResult
}

export const fetchActivitySmithApiKeyStatus = async (): Promise<ActivitySmithApiKeyStatus> => {
  try {
    const response = await callActivitySmith('getApiKeyStatus')

    if (!response.ok) {
      throw new Error(response.message || '读取 API Key 状态失败')
    }

    const configured = Boolean(response.configured)
    setActivitySmithKeyConfigured(configured)

    return {
      configured,
      maskedKey: response.maskedKey || '',
    }
  } catch (error) {
    console.warn('[activitysmith] fetch api key status failed', error)
    return {
      configured: isActivitySmithKeyConfigured(),
      maskedKey: '',
    }
  }
}

export const saveActivitySmithApiKey = async (apiKey: string) => {
  const response = await callActivitySmith('saveApiKey', { apiKey: apiKey.trim() })

  if (!response.ok) {
    throw new Error(response.message || '保存 API Key 失败')
  }

  setActivitySmithKeyConfigured(true)

  return {
    configured: true,
    maskedKey: response.maskedKey || '',
  }
}

export const registerActivitySmithSession = async (payload: ActivitySmithSessionPayload) => {
  if (!isActivitySmithEnabled()) {
    return
  }

  try {
    const response = await callActivitySmith('upsertSession', payload)

    if (response.skipped) {
      console.warn('[activitysmith]', response.message)
      wx.showToast({ title: '请先在设置中配置 API Key', icon: 'none' })
      return
    }

    if (!response.ok) {
      throw new Error(response.message || 'ActivitySmith 注册 session 失败')
    }
  } catch (error) {
    console.error('[activitysmith] register session failed', error)
    wx.showToast({
      title: error instanceof Error ? error.message : '灵动岛同步失败',
      icon: 'none',
    })
  }
}

export const endActivitySmithSession = async (payload?: ActivitySmithEndPayload) => {
  if (!isActivitySmithEnabled()) {
    return
  }

  try {
    const response = await callActivitySmith('endSession', payload)

    if (response.skipped) {
      console.warn('[activitysmith]', response.message)
      return
    }

    if (!response.ok) {
      throw new Error(response.message || 'ActivitySmith 结束 session 失败')
    }
  } catch (error) {
    console.warn('[activitysmith] end session failed', error)
  }
}
