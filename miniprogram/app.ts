// app.ts — MyForest 小程序全局入口
// 面向两人共用的计划/专注计时应用，启动时完成本地初始化并尝试恢复云共享空间会话
import { ensureLocalData } from './utils/data'
import { initCloud, bootstrapSharedSpace } from './utils/cloud-sync'
import { applyFontOnLaunch } from './utils/font-preference'
import { isSessionReady, isSoloMode, tryRestoreSessionFromCloud } from './utils/session'

App<IAppOption>({
  globalData: {
    // 云共享空间是否已就绪；页面可据此决定是否展示双人数据
    cloudReady: false,
  },
  onLaunch() {
    // 启动顺序：字体偏好 → 本地缓存 → 云开发 SDK → 异步恢复会话
    void applyFontOnLaunch()
    ensureLocalData()
    initCloud()

    void this.bootstrapCloudSession()
  },
  /** 从云端恢复登录态；已通过邀请码或单人模式时再拉取共享空间数据 */
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
