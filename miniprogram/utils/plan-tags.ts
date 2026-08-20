import { isCloudEnabled, SHARED_SPACE_CLOUD_FUNCTION } from './cloud-config'
import { resolveTagBindingFromList } from './tag-binding'
import { getSession, isSessionReady } from './session'

export type PlanTagVisibility = 'shared' | 'private'

export interface PlanTagOption {
  id: string
  name: string
  color: string
  visibility: PlanTagVisibility
  ownerOpenid?: string
  sharedSpaceId?: string
  isBuiltin?: boolean
}

export interface PlanTagView extends PlanTagOption {
  textColor: string
}

interface CloudPlanTagDoc {
  id: string
  name: string
  color: string
  visibility: PlanTagVisibility
  ownerOpenid?: string
  sharedSpaceId?: string
  createdAt?: number
  updatedAt?: number
}

interface TagCloudResult {
  ok?: boolean
  message?: string
  tags?: CloudPlanTagDoc[]
  tag?: CloudPlanTagDoc
}

const TAG_CACHE_KEY = 'myforest_plan_tags_cache_v1'
const TAG_CACHE_READY_KEY = 'myforest_plan_tags_cache_ready_v1'
const TAG_CACHE_SCOPE_KEY = 'myforest_plan_tags_cache_scope_v1'
const LEGACY_CUSTOM_KEY = 'myforest_custom_plan_tags_v1'
const PERSONAL_TAGS_KEY = 'myforest_personal_plan_tags_v1'
const TAGS_MIGRATED_KEY = 'myforest_plan_tags_migrated_v1'

const DEFAULT_TAG_OPTIONS: PlanTagOption[] = [
  { id: 'builtin-english', name: '英语', color: '#98C6A8', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-code', name: '写代码', color: '#98C6A8', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-reading', name: '阅读', color: '#98C6A8', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-sport', name: '运动', color: '#7DA7D9', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-meditation', name: '冥想', color: '#9B8DD9', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-writing', name: '写作', color: '#F1B86A', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-study', name: '学习', color: '#8BC4D9', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-organize', name: '整理', color: '#7BC8B8', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-review', name: '复盘', color: '#D98BB0', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-draw', name: '绘画', color: '#E09A7A', visibility: 'shared', isBuiltin: true },
  { id: 'builtin-other', name: '其它', color: '#7A857D', visibility: 'shared', isBuiltin: true },
]

export const TAG_PALETTE = [
  '#98C6A8',
  '#7DA7D9',
  '#F1B86A',
  '#D98BB0',
  '#9B8DD9',
  '#E09A7A',
  '#7BC8B8',
  '#8BC4D9',
  '#7FB592',
  '#4A90E2',
  '#F5A623',
  '#E15B64',
  '#9013FE',
  '#50E3C2',
  '#B8E986',
  '#4A4A4A',
]

export const DEFAULT_PLAN_TAGS = DEFAULT_TAG_OPTIONS.map((item) => item.name)

const normalizeHexColor = (value: string) => {
  const trimmed = `${value || ''}`.trim()
  if (!trimmed) {
    return ''
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return ''
  }

  return withHash.toUpperCase()
}

const getBuiltinTag = (name: string) => DEFAULT_TAG_OPTIONS.find((item) => item.name === name)

const normalizeTagColor = (name: string, color: string) => {
  const builtin = getBuiltinTag(name)
  const normalized = normalizeHexColor(color)

  if (!normalized) {
    return builtin?.color || '#7A857D'
  }

  // Older cloud tag records could lose their color and fall back to the
  // neutral "其它" color. Restore the canonical color for built-in tags.
  if (builtin && normalized === '#7A857D' && builtin.color !== '#7A857D') {
    return builtin.color
  }

  return normalized
}

const mapCloudTag = (doc: CloudPlanTagDoc): PlanTagOption => ({
  id: doc.id,
  name: doc.name,
  color: normalizeTagColor(doc.name, doc.color),
  visibility: doc.visibility,
  ownerOpenid: doc.ownerOpenid,
  sharedSpaceId: doc.sharedSpaceId,
  isBuiltin: Boolean(getBuiltinTag(doc.name)),
})

const getLegacyCustomTags = (): PlanTagOption[] => {
  const stored = wx.getStorageSync(LEGACY_CUSTOM_KEY) as Array<{ name: string; color: string }> | ''
  if (!Array.isArray(stored)) {
    return []
  }

  return stored
    .filter((item) => item?.name && item?.color)
    .map((item, index) => ({
      id: `legacy-${index}-${item.name}`,
      name: item.name,
      color: normalizeHexColor(item.color) || item.color,
      visibility: 'private' as const,
    }))
}

const getPersonalTags = (): PlanTagOption[] => {
  const stored = wx.getStorageSync(PERSONAL_TAGS_KEY) as PlanTagOption[] | ''
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((item) => item?.name && item?.color)
}

const savePersonalTags = (tags: PlanTagOption[]) => {
  wx.setStorageSync(PERSONAL_TAGS_KEY, tags)
}

export const getCachedCloudTags = (): PlanTagOption[] => {
  const stored = wx.getStorageSync(TAG_CACHE_KEY) as PlanTagOption[] | ''
  if (!Array.isArray(stored)) {
    return []
  }

  return stored
    .filter((item) => item?.name && item?.id)
    .map((item) => ({
      ...item,
      color: normalizeTagColor(item.name, item.color),
      isBuiltin: item.isBuiltin || Boolean(getBuiltinTag(item.name)),
    }))
}

export const saveCachedCloudTags = (tags: PlanTagOption[]) => {
  wx.setStorageSync(TAG_CACHE_KEY, tags)
  wx.setStorageSync(TAG_CACHE_READY_KEY, true)
  const session = getSession()
  wx.setStorageSync(
    TAG_CACHE_SCOPE_KEY,
    session?.sharedSpaceId && session.openid ? `${session.sharedSpaceId}:${session.openid}` : '',
  )
}

const hasCachedCloudTags = () => {
  const session = getSession()
  const scope = session?.sharedSpaceId && session.openid ? `${session.sharedSpaceId}:${session.openid}` : ''
  return Boolean(wx.getStorageSync(TAG_CACHE_READY_KEY)) && wx.getStorageSync(TAG_CACHE_SCOPE_KEY) === scope
}

const mergeTagsByName = (...groups: PlanTagOption[]) => {
  const map = new Map<string, PlanTagOption>()
  groups.forEach((item) => {
    if (!item?.name) {
      return
    }
    map.set(item.name, item)
  })
  return Array.from(map.values())
}

const getEffectiveTags = (): PlanTagOption[] => {
  if (!isSessionReady()) {
    return mergeTagsByName(...DEFAULT_TAG_OPTIONS, ...getPersonalTags(), ...getLegacyCustomTags())
  }

  if (isSessionReady()) {
    const cloudTags = getCachedCloudTags()
    if (hasCachedCloudTags()) {
      // Keep built-in tags available even when an older cloud cache is
      // incomplete; cloud-defined custom tags still override by name.
      return mergeTagsByName(...DEFAULT_TAG_OPTIONS, ...cloudTags)
    }
  }

  return mergeTagsByName(...DEFAULT_TAG_OPTIONS, ...getLegacyCustomTags())
}

const callTagCloud = async (action: 'listTags' | 'upsertTag' | 'deleteTag', payload?: Record<string, unknown>) => {
  const result = await wx.cloud.callFunction({
    name: SHARED_SPACE_CLOUD_FUNCTION,
    data: {
      action,
      payload,
    },
  })

  return result.result as TagCloudResult
}

const migrateLegacyTagsToCloud = async () => {
  if (!isSessionReady() || wx.getStorageSync(TAGS_MIGRATED_KEY)) {
    return
  }

  const legacyTags = getLegacyCustomTags()
  for (const tag of legacyTags) {
    try {
      await callTagCloud('upsertTag', {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        visibility: 'private',
      })
    } catch (error) {
      console.warn('[plan-tags] migrate legacy tag failed', error)
    }
  }

  wx.removeStorageSync(LEGACY_CUSTOM_KEY)
  wx.setStorageSync(TAGS_MIGRATED_KEY, true)
}

export const syncPlanTagsFromCloud = async (): Promise<boolean> => {
  if (!isCloudEnabled() || !isSessionReady()) {
    return false
  }

  try {
    await migrateLegacyTagsToCloud()
    const payload = await callTagCloud('listTags')
    if (!payload?.ok) {
      throw new Error(payload?.message || 'listTags 失败')
    }

    const tags = (payload.tags || []).map(mapCloudTag)
    const changed = JSON.stringify(getCachedCloudTags()) !== JSON.stringify(tags)
    saveCachedCloudTags(tags)
    return changed
  } catch (error) {
    console.warn('[plan-tags] sync failed', error)
    return false
  }
}

export const getPlanTagOptions = (): PlanTagOption[] => getEffectiveTags()

export const getPlanTagById = (id: string) => getPlanTagOptions().find((item) => item.id === id)

export const getPlanTagNames = () => getPlanTagOptions().map((item) => item.name)

export const resolveTagBinding = (tag: string, tagId?: string) =>
  resolveTagBindingFromList(tag, tagId, getPlanTagOptions())

export const isTagNameTaken = (name: string, excludeId?: string) => {
  const trimmedName = name.trim()
  return getPlanTagOptions().some((item) => item.name === trimmedName && item.id !== excludeId)
}

export const getSharedPlanTags = (): PlanTagView[] =>
  getCachedCloudTags()
    .filter((item) => item.visibility === 'shared')
    .map((item) => ({
      ...item,
      textColor: getContrastTextColor(item.color),
    }))

export const getPrivatePlanTags = (): PlanTagView[] => {
  const session = getSession()
  return getCachedCloudTags()
    .filter((item) => item.visibility === 'private' && item.ownerOpenid === session?.openid)
    .map((item) => ({
      ...item,
      textColor: getContrastTextColor(item.color),
    }))
}

export const resolvePlanTag = (tag: string) => {
  const names = getPlanTagNames()
  return names.includes(tag) ? tag : '其它'
}

const parseHexChannels = (hex: string) => {
  const normalized = normalizeHexColor(hex)
  if (!normalized) {
    return null
  }

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  }
}

const toLinearChannel = (channel: number) => {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export const getRelativeLuminance = (hex: string) => {
  const channels = parseHexChannels(hex)
  if (!channels) {
    return 0
  }

  const r = toLinearChannel(channels.r)
  const g = toLinearChannel(channels.g)
  const b = toLinearChannel(channels.b)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const getContrastTextColor = (backgroundColor: string) => {
  return getRelativeLuminance(backgroundColor) > 0.56 ? '#2F3A34' : '#FFFFFF'
}

export const getPlanTagColor = (tag: string) => {
  const byId = getPlanTagById(tag)
  if (byId) {
    return normalizeTagColor(byId.name, byId.color)
  }

  const resolved = resolvePlanTag(tag)
  const option = getPlanTagOptions().find((item) => item.name === resolved)
  return option ? normalizeTagColor(option.name, option.color) : '#7A857D'
}

export const getTagPillColorsById = (tagId: string) => {
  const tag = getPlanTagById(tagId)
  const backgroundColor = tag?.color || '#7A857D'
  return {
    backgroundColor,
    textColor: getContrastTextColor(backgroundColor),
  }
}

export const getTagPillColors = (tag: string) => {
  const backgroundColor = getPlanTagColor(tag)
  return {
    backgroundColor,
    textColor: getContrastTextColor(backgroundColor),
  }
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

export const hexToHsl = (hex: string) => {
  const channels = parseHexChannels(hex)
  if (!channels) {
    return { h: 0, s: 62, l: 48 }
  }

  const r = channels.r / 255
  const g = channels.g / 255
  const b = channels.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) }
  }

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let hue = 0
  if (max === r) {
    hue = ((g - b) / delta) % 6
  } else if (max === g) {
    hue = (b - r) / delta + 2
  } else {
    hue = (r - g) / delta + 4
  }

  return {
    h: Math.round((((hue * 60) % 360) + 360) % 360),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  }
}

export const hexToHue = (hex: string) => hexToHsl(hex).h

export const addPlanTagOption = async (
  name: string,
  color: string,
  visibility: PlanTagVisibility = 'private',
): Promise<{ ok: boolean; message?: string; tagId?: string }> => {
  const trimmedName = name.trim()
  const normalizedColor = normalizeHexColor(color)

  if (!trimmedName) {
    return { ok: false, message: '请输入主题名称' }
  }

  if (!normalizedColor) {
    return { ok: false, message: '请选择有效颜色' }
  }

  if (isTagNameTaken(trimmedName)) {
    return { ok: false, message: '这个主题已存在' }
  }

  if (isSessionReady()) {
    try {
      const payload = await callTagCloud('upsertTag', {
        name: trimmedName,
        color: normalizedColor,
        visibility,
      })

      if (!payload?.ok || !payload.tag) {
        return { ok: false, message: payload?.message || '保存标签失败' }
      }

      await syncPlanTagsFromCloud()
      return { ok: true, tagId: payload.tag.id }
    } catch (error) {
      console.warn('[plan-tags] upsert failed', error)
      return { ok: false, message: '保存标签失败' }
    }
  }

  const nextTag: PlanTagOption = {
    id: `personal-${Date.now()}`,
    name: trimmedName,
    color: normalizedColor,
    visibility: 'private',
  }
  savePersonalTags([...getPersonalTags(), nextTag])
  return { ok: true, tagId: nextTag.id }
}

export const updatePlanTagOption = async (
  id: string,
  name: string,
  color: string,
): Promise<{ ok: boolean; message?: string; tagId?: string; name?: string }> => {
  const trimmedName = name.trim()
  const normalizedColor = normalizeHexColor(color)

  if (!id) {
    return { ok: false, message: '缺少标签 id' }
  }

  if (!trimmedName) {
    return { ok: false, message: '请输入主题名称' }
  }

  if (!normalizedColor) {
    return { ok: false, message: '请选择有效颜色' }
  }

  if (isTagNameTaken(trimmedName, id)) {
    return { ok: false, message: '这个主题已存在' }
  }

  const existing = getPlanTagById(id)
  if (!existing || existing.isBuiltin) {
    return { ok: false, message: '无法修改此标签' }
  }

  if (isSessionReady()) {
    try {
      const payload = await callTagCloud('upsertTag', {
        id,
        name: trimmedName,
        color: normalizedColor,
        visibility: existing.visibility,
      })

      if (!payload?.ok || !payload.tag) {
        return { ok: false, message: payload?.message || '保存标签失败' }
      }

      await syncPlanTagsFromCloud()
      return { ok: true, tagId: id, name: trimmedName }
    } catch (error) {
      console.warn('[plan-tags] update failed', error)
      return { ok: false, message: '保存标签失败' }
    }
  }

  const personalTags = getPersonalTags()
  const targetIndex = personalTags.findIndex((item) => item.id === id)
  if (targetIndex < 0) {
    return { ok: false, message: '标签不存在' }
  }

  const nextTags = [...personalTags]
  nextTags[targetIndex] = {
    ...nextTags[targetIndex],
    name: trimmedName,
    color: normalizedColor,
  }
  savePersonalTags(nextTags)
  return { ok: true, tagId: id, name: trimmedName }
}

export const deletePlanTagOption = async (id: string): Promise<{ ok: boolean; message?: string }> => {
  if (!id) {
    return { ok: false, message: '缺少标签 id' }
  }

  if (isSessionReady()) {
    try {
      const payload = await callTagCloud('deleteTag', { id })
      if (!payload?.ok) {
        return { ok: false, message: payload?.message || '删除标签失败' }
      }

      saveCachedCloudTags(getCachedCloudTags().filter((item) => item.id !== id))
      await syncPlanTagsFromCloud()
      return { ok: true }
    } catch (error) {
      console.warn('[plan-tags] delete failed', error)
      return { ok: false, message: '删除标签失败' }
    }
  }

  savePersonalTags(getPersonalTags().filter((item) => item.id !== id))
  return { ok: true }
}
