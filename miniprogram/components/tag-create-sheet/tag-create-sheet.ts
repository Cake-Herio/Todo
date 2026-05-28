import { TAG_PALETTE, hexToHsl, hslToHex } from '../../utils/plan-tags'
import { MODAL_EXIT_MS } from '../../utils/modal-dismiss'

const DEFAULT_HSL = hexToHsl(TAG_PALETTE[0])

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
    showVisibilityPicker: {
      type: Boolean,
      value: false,
    },
    defaultVisibility: {
      type: String,
      value: 'shared',
    },
    editTag: {
      type: Object,
      value: null,
    },
  },
  data: {
    shouldShow: false,
    isClosing: false,
    isEditMode: false,
    editingTagId: '',
    tagName: '',
    tagColor: TAG_PALETTE[0],
    tagVisibility: 'shared' as 'shared' | 'private',
    paletteColors: TAG_PALETTE,
    hueValue: DEFAULT_HSL.h,
    saturationValue: DEFAULT_HSL.s,
    lightnessValue: DEFAULT_HSL.l,
  },
  observers: {
    visible(visible: boolean) {
      if (visible) {
        this.setData({
          shouldShow: true,
          isClosing: false,
        })
        const editTag = this.properties.editTag as { id?: string; name?: string; color?: string; visibility?: 'shared' | 'private' } | null
        if (editTag?.id) {
          this.loadEditForm(editTag)
        } else {
          this.resetForm()
        }
        return
      }

      if (!this.data.isClosing && this.data.shouldShow) {
        this.dismissSheet()
      }
    },
  },
  methods: {
    colorStateFromHex(color: string) {
      const hsl = hexToHsl(color)
      return {
        tagColor: color,
        hueValue: hsl.h,
        saturationValue: hsl.s,
        lightnessValue: hsl.l,
      }
    },
    resetForm() {
      const defaultVisibility = this.properties.defaultVisibility === 'private' ? 'private' : 'shared'
      this.setData({
        isEditMode: false,
        editingTagId: '',
        tagName: '',
        tagVisibility: defaultVisibility,
        ...this.colorStateFromHex(TAG_PALETTE[0]),
      })
    },
    loadEditForm(tag: { id: string; name: string; color: string; visibility?: 'shared' | 'private' }) {
      this.setData({
        isEditMode: true,
        editingTagId: tag.id,
        tagName: tag.name,
        tagVisibility: tag.visibility === 'private' ? 'private' : 'shared',
        ...this.colorStateFromHex(tag.color),
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
          id: this.data.editingTagId || undefined,
          name: this.data.tagName,
          color: this.data.tagColor,
          visibility: this.data.tagVisibility,
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
        const tagColor = withHash.toUpperCase()
        const patch: Record<string, string | number> = { tagColor }

        if (/^#[0-9A-Fa-f]{6}$/.test(tagColor)) {
          Object.assign(patch, this.colorStateFromHex(tagColor))
        }

        this.setData(patch)
      }
    },
    choosePaletteColor(e: WechatMiniprogram.BaseEvent) {
      const color = e.currentTarget.dataset.color as string

      if (!color) {
        return
      }

      this.setData(this.colorStateFromHex(color))
    },
    onHueChanging(e: WechatMiniprogram.SliderChange) {
      const hueValue = Number(e.detail.value)
      let { saturationValue, lightnessValue } = this.data

      if (saturationValue < 8) {
        saturationValue = 62
      }

      this.setData({
        hueValue,
        saturationValue,
        tagColor: hslToHex(hueValue, saturationValue, lightnessValue),
      })
    },
    onHueChange(e: WechatMiniprogram.SliderChange) {
      this.onHueChanging(e)
    },
    chooseVisibility(e: WechatMiniprogram.BaseEvent) {
      const visibility = e.currentTarget.dataset.visibility as 'shared' | 'private' | undefined
      if (!visibility) {
        return
      }

      this.setData({ tagVisibility: visibility })
    },
  },
})
