const ENABLED_KEY = 'myforest_bark_enabled'
const KEY_CONFIGURED_KEY = 'myforest_bark_key_configured'

export const BARK_APP_STORE_URL = 'https://apps.apple.com/cn/app/bark-custom-notifications/id1403753865'
export const BARK_APP_STORE_ID = '1403753865'

import { openAppStorePage } from './open-app-store'

export interface BarkSessionPayload {
  sessionStartedAt: number
  accumulatedSeconds: number
  segmentStartedAt: number
  isPaused: boolean
  tag?: string
  detail?: string
}

export interface BarkKeyStatus {
  configured: boolean
  maskedKey: string
}

export interface RoomFocusChangePayload {
  eventType: 'start' | 'pause' | 'resume' | 'end'
  tag?: string
  elapsedMinutes: number
}

interface BarkResult {
  ok?: boolean
  skipped?: boolean
  configured?: boolean
  maskedKey?: string
  message?: string
}

export const isBarkKeyConfigured = () => wx.getStorageSync(KEY_CONFIGURED_KEY) === true

export const setBarkKeyConfigured = (configured: boolean) => {
  wx.setStorageSync(KEY_CONFIGURED_KEY, configured)
}

export const isBarkEnabled = () => wx.getStorageSync(ENABLED_KEY) === true

export const setBarkEnabled = (enabled: boolean) => {
  wx.setStorageSync(ENABLED_KEY, enabled)
}

export const getBarkStatusLabel = () => {
  if (!isBarkKeyConfigured()) {
    return '未配置 Device Key'
  }

  if (isBarkEnabled()) {
    return '已开启，计划与专注推送'
  }

  return '已配置 Device Key，未开启'
}

export const openBarkAppStore = async () => {
  await openAppStorePage({
    httpsUrl: BARK_APP_STORE_URL,
    appStoreId: BARK_APP_STORE_ID,
    appName: 'Bark',
  })
}

const callBark = async (action: string, payload?: unknown) => {
  const result = await wx.cloud.callFunction({
    name: 'bark',
    data: {
      action,
      payload,
    },
  })

  return (result.result || {}) as BarkResult
}

export const fetchBarkKeyStatus = async (): Promise<BarkKeyStatus> => {
  try {
    const response = await callBark('getKeyStatus')

    if (!response.ok) {
      throw new Error(response.message || '读取 Device Key 状态失败')
    }

    const configured = Boolean(response.configured)
    setBarkKeyConfigured(configured)

    return {
      configured,
      maskedKey: response.maskedKey || '',
    }
  } catch (error) {
    console.warn('[bark] fetch key status failed', error)
    return {
      configured: isBarkKeyConfigured(),
      maskedKey: '',
    }
  }
}

export const saveBarkDeviceKey = async (deviceKey: string) => {
  const response = await callBark('saveDeviceKey', { deviceKey: deviceKey.trim() })

  if (!response.ok) {
    throw new Error(response.message || '保存 Device Key 失败')
  }

  setBarkKeyConfigured(true)

  return {
    configured: true,
    maskedKey: response.maskedKey || '',
  }
}

export const registerBarkFocusSession = async (payload: BarkSessionPayload) => {
  if (!isBarkEnabled()) {
    return
  }

  if (!`${payload.tag || ''}`.trim()) {
    return
  }

  try {
    const response = await callBark('upsertFocusSession', payload)

    if (response.skipped) {
      console.warn('[bark]', response.message)
      wx.showToast({ title: '请先在设置中配置 Bark Key', icon: 'none' })
      return
    }

    if (!response.ok) {
      throw new Error(response.message || 'Bark 注册 session 失败')
    }
  } catch (error) {
    console.error('[bark] register focus session failed', error)
    wx.showToast({
      title: error instanceof Error ? error.message : 'Bark 推送失败',
      icon: 'none',
    })
  }
}

export const endBarkFocusSession = async () => {
  if (!isBarkEnabled()) {
    return
  }

  try {
    const response = await callBark('endFocusSession')

    if (!response.ok) {
      throw new Error(response.message || 'Bark 结束 session 失败')
    }
  } catch (error) {
    console.warn('[bark] end focus session failed', error)
  }
}

export const sendBarkEnableTestPush = async () => {
  const response = await callBark('sendEnableTestPush')

  if (response.skipped) {
    throw new Error(response.message || '未配置 Bark Device Key')
  }

  if (!response.ok) {
    throw new Error(response.message || '发送测试推送失败')
  }
}

/**
 * 通知同组成员当前用户的专注状态变化（开始/暂停/继续/结束）
 * 仅 sharedSpace 模式下有效；云函数内自动跳过 solo 用户和非组用户
 */
export const notifyRoomFocusChange = async (payload: RoomFocusChangePayload) => {
  try {
    await callBark('notifyRoomFocusChange', payload)
  } catch (error) {
    console.warn('[bark] notify room focus change failed', error)
  }
}
