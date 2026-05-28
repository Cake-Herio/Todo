// app.ts
import { ensureLocalData } from './utils/data'
import { initCloud, bootstrapSharedSpace } from './utils/cloud-sync'
import { applyFontOnLaunch } from './utils/font-preference'
import { isSessionReady, isSoloMode, tryRestoreSessionFromCloud } from './utils/session'

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
      await tryRestoreSessionFromCloud()

      if (isSessionReady() || isSoloMode()) {
        await bootstrapSharedSpace()
        this.globalData.cloudReady = true
      }
    } catch (error) {
      console.warn('[cloud] bootstrap failed', error)
    }
  },
})
