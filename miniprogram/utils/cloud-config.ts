/** 云环境 ID（与微信云开发控制台一致） */
export const CLOUD_ENV_ID = 'cloudbase-d4gssgn9yb53a9fc0'

/** 首版固定邀请码 */
export const DEFAULT_INVITE_CODE = 'FOREST2026'

export const isCloudEnabled = () => typeof wx.cloud !== 'undefined'

export const getCloudEnvId = () => CLOUD_ENV_ID || undefined
