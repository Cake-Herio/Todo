export const MODAL_EXIT_MS = 220

type ModalContext = {
  data: Record<string, unknown>
  setData: WechatMiniprogram.Component.TrivialInstance['setData']
}

export interface DismissModalOptions {
  extraData?: Record<string, unknown>
  durationMs?: number
  onDismissed?: () => void
}

export const dismissModal = (
  ctx: ModalContext,
  visibleKey: string,
  closingKey: string,
  options?: DismissModalOptions,
): boolean => {
  const { extraData, durationMs = MODAL_EXIT_MS, onDismissed } = options || {}

  if (ctx.data[closingKey] || !ctx.data[visibleKey]) {
    return false
  }

  ctx.setData({ [closingKey]: true })

  setTimeout(() => {
    ctx.setData({
      [visibleKey]: false,
      [closingKey]: false,
      ...extraData,
    })
    onDismissed?.()
  }, durationMs)

  return true
}

export const openModal = (
  ctx: ModalContext,
  visibleKey: string,
  closingKey: string,
  extraData?: Record<string, unknown>,
) => {
  ctx.setData({
    [visibleKey]: true,
    [closingKey]: false,
    ...extraData,
  })
}
