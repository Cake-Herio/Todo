export interface TagBindingOption {
  id: string
  name: string
}

export const resolveTagBindingFromList = (
  tag: string,
  tagId: string | undefined,
  options: TagBindingOption[],
  fallbackId = 'builtin-other',
) => {
  if (tagId) {
    const byId = options.find((item) => item.id === tagId)
    if (byId) {
      return { tagId: byId.id, tag: byId.name }
    }
  }

  const byId = options.find((item) => item.id === tag)
  if (byId) {
    return { tagId: byId.id, tag: byId.name }
  }

  const byName = options.find((item) => item.name === tag)
  if (byName) {
    return { tagId: byName.id, tag: byName.name }
  }

  const fallback = options.find((item) => item.id === fallbackId)
  return {
    tagId: fallback?.id || fallbackId,
    tag: tag || fallback?.name || '其它',
  }
}
