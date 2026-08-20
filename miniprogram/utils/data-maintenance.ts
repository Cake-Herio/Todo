import { SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'

export interface MaintenanceItem {
  collection: string
  id: string
  title: string
  date: string
}

export interface MaintenanceResult {
  ok?: boolean
  message?: string
  destructive?: boolean
  executed?: boolean
  count?: number
  items?: MaintenanceItem[]
}

export const runDataMaintenance = async (command: string, execute = false): Promise<MaintenanceResult> => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'dataMaintenance',
      payload: { command, execute },
    },
  })

  return (result.result || {}) as MaintenanceResult
}
