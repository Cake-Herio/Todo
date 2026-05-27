// app.ts
import { ensureLocalData } from './utils/data'
import { initCloud, syncFromCloud } from './utils/cloud-sync'
import { applyFontOnLaunch } from './utils/font-preference'
import { isSessionReady } from './utils/session'

App<IAppOption>({
  globalData: {
    cloudReady: false,
  },
  onLaunch() {
    void applyFontOnLaunch()
    ensureLocalData()
    initCloud()

    void this.bootstrapCloudSession()
  },
  async bootstrapCloudSession() {
    try {
      if (!isSessionReady()) {
        return
      }

      await syncFromCloud()
      this.globalData.cloudReady = true
    } catch (error) {
      console.warn('[cloud] bootstrap failed', error)
    }
  },
})
