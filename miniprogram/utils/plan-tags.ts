export interface PlanTagOption {
  name: string
  color: string
}

const CUSTOM_TAG_STORAGE_KEY = 'myforest_custom_plan_tags_v1'

const DEFAULT_TAG_OPTIONS: PlanTagOption[] = [
  { name: '英语', color: '#A9C7B5' },
  { name: '写代码', color: '#A9C7B5' },
  { name: '阅读', color: '#A9C7B5' },
  { name: '运动', color: '#7DA7D9' },
  { name: '其它', color: '#7A857D' },
]

export const TAG_PALETTE = [
  '#A9C7B5',
  '#7DA7D9',
  '#F1B86A',
  '#D98BB0',
  '#9B8DD9',
  '#E09A7A',
  '#7BC8B8',
  '#8BC4D9',
  '#8AA394',
  '#4A90E2',
  '#F5A623',
  '#E15B64',
  '#9013FE',
  '#50E3C2',
  '#B8E986',
  '#4A4A4A',
]

export const DEFAULT_PLAN_TAGS = DEFAULT_TAG_OPTIONS.map((item) => item.name)

const getCustomTagOptions = () => {
  const stored = wx.getStorageSync(CUSTOM_TAG_STORAGE_KEY) as PlanTagOption[] | ''

  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((item) => item && item.name && item.color)
}

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`

  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return ''
  }

  return withHash.toUpperCase()
}

export const hslToHex = (hue: number, saturation = 62, lightness = 48) => {
  const h = ((hue % 360) + 360) % 360
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  const toHex = (channel: number) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

export const getPlanTagOptions = (): PlanTagOption[] => {
  const map = new Map<string, PlanTagOption>()

  DEFAULT_TAG_OPTIONS.forEach((item) => {
    map.set(item.name, item)
  })

  getCustomTagOptions().forEach((item) => {
    map.set(item.name, item)
  })

  return Array.from(map.values())
}

export const getPlanTagNames = () => getPlanTagOptions().map((item) => item.name)

export const resolvePlanTag = (tag: string) => {
  const names = getPlanTagNames()
  return names.includes(tag) ? tag : '其它'
}

export const addPlanTagOption = (name: string, color: string) => {
  const trimmedName = name.trim()
  const normalizedColor = normalizeHexColor(color)

  if (!trimmedName) {
    return { ok: false, message: '请输入主题名称' }
  }

  if (!normalizedColor) {
    return { ok: false, message: '请选择有效颜色' }
  }

  if (getPlanTagOptions().some((item) => item.name === trimmedName)) {
    return { ok: false, message: '这个主题已存在' }
  }

  const customTags = getCustomTagOptions()
  customTags.push({
    name: trimmedName,
    color: normalizedColor,
  })
  wx.setStorageSync(CUSTOM_TAG_STORAGE_KEY, customTags)

  return { ok: true }
}
