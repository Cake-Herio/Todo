export type FontPreferenceKey = 'kai' | 'sans' | 'song'

export interface FontOptionView {
  key: FontPreferenceKey
  label: string
  desc: string
  previewFamily: string
}

const STORAGE_KEY = 'myforest_font_preference'
const KAI_FONT_FAMILY = 'LXGW WenKai'
const FONT_CDN_URL =
  'https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai-Lite@1.501/fonts/TTF/LXGWWenKaiLite-Regular.ttf'
const LOCAL_FONT_PATH = '/assets/fonts/LXGWWenKaiLite-Regular.ttf'

const FONT_STACKS: Record<FontPreferenceKey, string> = {
  kai: `"${KAI_FONT_FAMILY}", "Kaiti SC", "STKaiti", "KaiTi", "楷体", serif`,
  sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  song: '"Songti SC", "STSong", "SimSun", serif',
}

export const FONT_OPTIONS: FontOptionView[] = [
  {
    key: 'kai',
    label: '楷体',
    desc: '默认，温润手写感',
    previewFamily: FONT_STACKS.kai,
  },
  {
    key: 'sans',
    label: '黑体',
    desc: '清晰易读的系统字体',
    previewFamily: FONT_STACKS.sans,
  },
  {
    key: 'song',
    label: '宋体',
    desc: '传统书卷感',
    previewFamily: FONT_STACKS.song,
  },
]

let kaiFontLoadPromise: Promise<boolean> | null = null

const isFontPreferenceKey = (value: string): value is FontPreferenceKey =>
  value === 'kai' || value === 'sans' || value === 'song'

export const getFontPreference = (): FontPreferenceKey => {
  const stored = wx.getStorageSync(STORAGE_KEY) as string
  return isFontPreferenceKey(stored) ? stored : 'kai'
}

export const getFontFamilyStack = (key: FontPreferenceKey = getFontPreference()) => FONT_STACKS[key]

export const getFontPreferenceLabel = (key: FontPreferenceKey = getFontPreference()) =>
  FONT_OPTIONS.find((item) => item.key === key)?.label || '楷体'

export const getFontPageStyle = (key: FontPreferenceKey = getFontPreference()) =>
  `font-family: ${FONT_STACKS[key]};`

export const createPageFontData = () => ({
  pageFontStyle: getFontPageStyle(),
})

export const refreshPageFontStyle = (pageInstance: { setData: WechatMiniprogram.Component.TrivialInstance['setData'] }) => {
  pageInstance.setData({
    pageFontStyle: getFontPageStyle(),
  })
}

const loadKaiFontFrom = (source: string) =>
  new Promise<boolean>((resolve) => {
    wx.loadFontFace({
      family: KAI_FONT_FAMILY,
      global: true,
      source: `url("${source}")`,
      success: () => resolve(true),
      fail: (error) => {
        console.warn('[fonts] load failed', source, error)
        resolve(false)
      },
    })
  })

export const loadKaiFont = () => {
  if (kaiFontLoadPromise) {
    return kaiFontLoadPromise
  }

  kaiFontLoadPromise = (async () => {
    const loadedLocal = await loadKaiFontFrom(LOCAL_FONT_PATH)
    if (loadedLocal) {
      return true
    }

    return loadKaiFontFrom(FONT_CDN_URL)
  })()

  return kaiFontLoadPromise
}

export const refreshAllPagesFontStyle = (key?: FontPreferenceKey) => {
  const pageStyle = getFontPageStyle(key)
  const pages = getCurrentPages()

  pages.forEach((page) => {
    if (typeof page.setData === 'function') {
      page.setData({ pageFontStyle: pageStyle })
    }

    const meta = page.selectComponent?.('#font-page-meta') as WechatMiniprogram.Component.TrivialInstance & {
      refresh?: (style?: string) => void
    } | null

    meta?.refresh?.(pageStyle)
  })
}

export const setFontPreference = async (key: FontPreferenceKey) => {
  wx.setStorageSync(STORAGE_KEY, key)

  if (key === 'kai') {
    await loadKaiFont()
  }

  refreshAllPagesFontStyle(key)
}

export const applyFontOnLaunch = async () => {
  if (getFontPreference() === 'kai') {
    await loadKaiFont()
  }
}
