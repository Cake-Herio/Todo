interface OpenAppStoreOptions {
  httpsUrl: string
  appStoreId: string
  appName: string
}

const tryOpenUrl = (url: string) =>
  new Promise<boolean>((resolve) => {
    if (!wx.canIUse('openUrl')) {
      resolve(false)
      return
    }

    wx.openUrl({
      url,
      success: () => resolve(true),
      fail: () => resolve(false),
    })
  })

const copyAppStoreUrl = (url: string) =>
  new Promise<void>((resolve, reject) => {
    wx.setClipboardData({
      data: url,
      success: () => resolve(),
      fail: (error) => reject(error),
    })
  })

export const openAppStorePage = async ({ httpsUrl, appStoreId, appName }: OpenAppStoreOptions) => {
  const itmsUrl = `itms-apps://apps.apple.com/cn/app/id${appStoreId}`

  let copied = false
  try {
    await copyAppStoreUrl(httpsUrl)
    copied = true
  } catch (error) {
    console.warn('[open-app-store] copy failed', error)
  }

  for (const url of [itmsUrl, httpsUrl]) {
    const opened = await tryOpenUrl(url)
    if (opened) {
      if (copied) {
        wx.showToast({
          title: '正在打开 App Store',
          icon: 'none',
        })
      }
      return
    }
  }

  if (copied) {
    wx.showModal({
      title: `安装 ${appName}`,
      content: `链接已复制。若未自动跳转，请切到 Safari 粘贴打开，或在 App Store 搜索「${appName}」安装。`,
      showCancel: false,
      confirmText: '知道了',
    })
    return
  }

  wx.showToast({
    title: '无法打开 App Store',
    icon: 'none',
  })
}
