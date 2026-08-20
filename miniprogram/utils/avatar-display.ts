const DEFAULT_AVATAR_URL = '/images/avatar.png'
const AVATAR_CACHE_STORAGE_KEY = 'myforest_avatar_file_cache_v1'
const SHARED_SPACE_CLOUD_FUNCTION = 'sharedSpace'

const displayUrlCache = new Map<string, string>()
const pendingAvatarCache = new Map<string, Promise<string>>()
const failedAvatarRetryAt = new Map<string, number>()
const AVATAR_RETRY_COOLDOWN_MS = 30_000

/**
 * Avatar storage contract:
 * - CloudBase stores the cloud:// file ID as the source of truth.
 * - The first display resolves that file ID to a persistent local file.
 * - Pages use the local file path afterwards; temporary HTTPS URLs are not
 *   stored in the session and are not used as the long-term avatar address.
 */
export const isAvatarFileId = (avatarUrl: string) => avatarUrl.startsWith('cloud://')

const isDirectAvatarUrl = (avatarUrl: string) => /^https?:\/\//i.test(avatarUrl)
const isLocalAvatarPath = (avatarUrl: string) => avatarUrl.startsWith('wxfile://')

type AvatarCacheMap = Record<string, string>

const getFileSystemManager = () => wx.getFileSystemManager()

const isLocalFileAvailable = (filePath: string) => {
  try {
    getFileSystemManager().accessSync(filePath)
    return true
  } catch (_error) {
    return false
  }
}

const readPersistentAvatarCache = (): AvatarCacheMap => {
  const cache = wx.getStorageSync(AVATAR_CACHE_STORAGE_KEY) as AvatarCacheMap | ''
  return cache && typeof cache === 'object' ? cache : {}
}

const getCachedLocalAvatar = (source: string) => {
  const memoryPath = displayUrlCache.get(source)
  if (memoryPath) {
    return memoryPath
  }

  const localPath = readPersistentAvatarCache()[source]
  if (!localPath || !isLocalFileAvailable(localPath)) {
    return ''
  }

  displayUrlCache.set(source, localPath)
  return localPath
}

const rememberLocalAvatar = (source: string, localPath: string) => {
  displayUrlCache.set(source, localPath)
  failedAvatarRetryAt.delete(source)
  wx.setStorageSync(AVATAR_CACHE_STORAGE_KEY, {
    ...readPersistentAvatarCache(),
    [source]: localPath,
  })
}

const saveDownloadedAvatar = async (source: string, tempFilePath: string) => {
  const existingPath = getCachedLocalAvatar(source)
  if (existingPath) {
    return existingPath
  }

  const result = await new Promise<{ savedFilePath: string }>((resolve, reject) => {
    getFileSystemManager().saveFile({
      tempFilePath,
      success: resolve,
      fail: reject,
    })
  })

  if (!result.savedFilePath) {
    throw new Error('头像本地缓存失败')
  }

  rememberLocalAvatar(source, result.savedFilePath)
  return result.savedFilePath
}

const downloadDirectAvatar = async (source: string) => {
  const result = await new Promise<{ tempFilePath?: string; statusCode?: number }>((resolve, reject) => {
    wx.downloadFile({
      url: source,
      success: resolve,
      fail: reject,
    })
  })

  if (!result.tempFilePath || (result.statusCode && result.statusCode >= 400)) {
    throw new Error(`头像下载失败（${result.statusCode || 'unknown'}）`)
  }

  return result.tempFilePath
}

const getCloudAvatarTempUrlViaFunction = async (source: string) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action: 'resolveAvatar',
      payload: { fileID: source },
    },
  })
  const payload = result.result as { ok?: boolean; tempFileURL?: string; message?: string }
  if (!payload?.ok || !payload.tempFileURL) {
    throw new Error(payload?.message || '云函数临时地址获取失败')
  }

  return payload.tempFileURL
}

const getCloudAvatarTempUrl = async (source: string) => {
  try {
    const result = await wx.cloud.getTempFileURL({ fileList: [source] })
    const item = result.fileList?.[0]
    if (!item?.tempFileURL || (item.status && item.status !== 0)) {
      throw new Error(item?.errMsg || '云文件临时地址获取失败')
    }

    return item.tempFileURL
  } catch (clientError) {
    try {
      return await getCloudAvatarTempUrlViaFunction(source)
    } catch (functionError) {
      const clientMessage = clientError instanceof Error ? clientError.message : '客户端临时地址获取失败'
      const functionMessage = functionError instanceof Error ? functionError.message : '云函数临时地址获取失败'
      throw new Error(`${clientMessage}；${functionMessage}`)
    }
  }
}

const downloadCloudAvatar = async (source: string) => {
  try {
    return (await wx.cloud.downloadFile({ fileID: source })).tempFilePath
  } catch (directError) {
    // 某些云存储权限下客户端不能直接 downloadFile，临时地址只用于本次落盘下载。
    try {
      const tempUrl = await getCloudAvatarTempUrl(source)
      return await downloadDirectAvatar(tempUrl)
    } catch (fallbackError) {
      try {
        const serverTempUrl = await getCloudAvatarTempUrlViaFunction(source)
        return await downloadDirectAvatar(serverTempUrl)
      } catch (serverFallbackError) {
        const directMessage = directError instanceof Error ? directError.message : '直接下载失败'
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : '临时地址下载失败'
        const serverMessage = serverFallbackError instanceof Error ? serverFallbackError.message : '云函数头像下载失败'
        throw new Error(`${directMessage}；${fallbackMessage}；${serverMessage}`)
      }
    }
  }
}

const downloadAvatarToLocal = async (source: string) => {
  const tempFilePath = isAvatarFileId(source)
    ? await downloadCloudAvatar(source)
    : await downloadDirectAvatar(source)

  return saveDownloadedAvatar(source, tempFilePath)
}

export const getDefaultAvatarUrl = () => DEFAULT_AVATAR_URL

export const uploadAvatarFile = async (filePath: string) => {
  if (!filePath) {
    throw new Error('请选择头像')
  }

  const extension = filePath.match(/\.(\w+)(?:\?|$)/)?.[1] || 'png'
  const result = await wx.cloud.uploadFile({
    cloudPath: `avatars/${Date.now()}.${extension}`,
    filePath,
  })

  if (!result.fileID || !isAvatarFileId(result.fileID)) {
    throw new Error('头像上传失败：未获得云文件 ID')
  }

  return result.fileID
}

export const getAvatarDisplayUrl = (avatarUrl: string) => {
  const source = `${avatarUrl || ''}`.trim()
  if (!source) {
    return DEFAULT_AVATAR_URL
  }

  if (isLocalAvatarPath(source)) {
    return source
  }

  const cachedPath = getCachedLocalAvatar(source)
  if (cachedPath) {
    return cachedPath
  }

  if (isDirectAvatarUrl(source)) {
    return source
  }

  if (!isAvatarFileId(source)) {
    return DEFAULT_AVATAR_URL
  }

  return DEFAULT_AVATAR_URL
}

export const resolveAvatarDisplayUrl = async (avatarUrl: string) => {
  const source = `${avatarUrl || ''}`.trim()
  if (!source) {
    return DEFAULT_AVATAR_URL
  }

  if (isLocalAvatarPath(source)) {
    return source
  }

  const cached = getCachedLocalAvatar(source)
  if (cached) {
    return cached
  }

  if (!isAvatarFileId(source) && !isDirectAvatarUrl(source)) {
    return DEFAULT_AVATAR_URL
  }

  const retryAt = failedAvatarRetryAt.get(source) || 0
  if (retryAt > Date.now()) {
    return getAvatarDisplayUrl(source)
  }

  const pending = pendingAvatarCache.get(source)
  if (pending) {
    return pending
  }

  const task = downloadAvatarToLocal(source)
    .catch((error) => {
      failedAvatarRetryAt.set(source, Date.now() + AVATAR_RETRY_COOLDOWN_MS)
      const message = error instanceof Error ? error.message : '云文件不存在或无权访问'
      throw new Error(`头像读取失败：${message}`)
    })
    .finally(() => {
      pendingAvatarCache.delete(source)
    })

  pendingAvatarCache.set(source, task)
  return task
}

export const preloadAvatar = async (avatarUrl: string) => {
  try {
    return await resolveAvatarDisplayUrl(avatarUrl)
  } catch (error) {
    console.warn('[avatar] resolve failed', { avatarUrl, error })
    return getAvatarDisplayUrl(avatarUrl)
  }
}
