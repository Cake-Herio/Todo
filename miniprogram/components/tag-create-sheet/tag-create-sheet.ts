import { TAG_PALETTE, hslToHex } from '../../utils/plan-tags'
import { MODAL_EXIT_MS } from '../../utils/modal-dismiss'

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    pageFontStyle: {
      type: String,
      value: '',
    },
  },
  data: {
    shouldShow: false,
    isClosing: false,
    tagName: '',
    tagColor: TAG_PALETTE[0],
    paletteColors: TAG_PALETTE,
    hueValue: 120,
  },
  observers: {
    visible(visible: boolean) {
      if (visible) {
        this.setData({
          shouldShow: true,
          isClosing: false,
        })
        this.resetForm()
        return
      }

      if (!this.data.isClosing && this.data.shouldShow) {
        this.setData({
          shouldShow: false,
        })
      }
    },
  },
  methods: {
    resetForm() {
      this.setData({
        tagName: '',
        tagColor: TAG_PALETTE[0],
        hueValue: 120,
      })
    },
    noop() {},
    dismissSheet(onDismissed?: () => void) {
      if (this.data.isClosing || !this.data.shouldShow) {
        return
      }

      this.setData({ isClosing: true })

      setTimeout(() => {
        this.setData({
          shouldShow: false,
          isClosing: false,
        })
        onDismissed?.()
      }, MODAL_EXIT_MS)
    },
    closeSheet() {
      this.dismissSheet(() => {
        this.triggerEvent('close')
      })
    },
    confirmSheet() {
      this.dismissSheet(() => {
        this.triggerEvent('confirm', {
          name: this.data.tagName,
          color: this.data.tagColor,
        })
      })
    },
    onTagNameInput(e: WechatMiniprogram.Input) {
      this.setData({
        tagName: e.detail.value,
      })
    },
    onHexInput(e: WechatMiniprogram.Input) {
      const raw = e.detail.value || ''
      const withHash = raw.startsWith('#') ? raw : `#${raw}`

      if (/^#[0-9A-Fa-f]{0,6}$/.test(withHash)) {
        this.setData({
          tagColor: withHash.toUpperCase(),
        })
      }
    },
    choosePaletteColor(e: WechatMiniprogram.BaseEvent) {
      const color = e.currentTarget.dataset.color as string

      if (!color) {
        return
      }

      this.setData({
        tagColor: color,
      })
    },
    onHueChanging(e: WechatMiniprogram.SliderChange) {
      const hueValue = Number(e.detail.value)
      this.setData({
        hueValue,
        tagColor: hslToHex(hueValue),
      })
    },
    onHueChange(e: WechatMiniprogram.SliderChange) {
      this.onHueChanging(e)
    },
  },
})
