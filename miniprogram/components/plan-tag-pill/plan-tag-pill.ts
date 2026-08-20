import { getContrastTextColor, getTagPillColors, hexToHsl, hslToHex } from '../../utils/plan-tags'

const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  if (value.length !== 6) {
    return `rgba(47, 58, 52, ${alpha})`
  }

  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

Component({
  externalClasses: ['ext-class'],
  properties: {
    name: {
      type: String,
      value: '',
    },
    size: {
      type: String,
      value: 'md',
    },
    active: {
      type: Boolean,
      value: false,
    },
    color: {
      type: String,
      value: '',
    },
    textColor: {
      type: String,
      value: '',
    },
  },
  data: {
    backgroundColor: '#E4F2E9',
    labelColor: '#2F3A34',
    activeBoxShadow: 'none',
  },
  observers: {
    'name, color, textColor, active'() {
      this.syncColors()
    },
  },
  lifetimes: {
    attached() {
      this.syncColors()
    },
  },
  methods: {
    applyColors(backgroundColor: string, labelColor: string) {
      const active = Boolean(this.properties.active)
      const backgroundHsl = hexToHsl(backgroundColor)
      const activeBorderColor = hslToHex(
        backgroundHsl.h,
        Math.min(90, Math.max(45, backgroundHsl.s + 8)),
        Math.max(24, backgroundHsl.l - 18),
      )
      const activeGlowColor = hexToRgba(backgroundColor, 0.42)

      this.setData({
        backgroundColor,
        labelColor,
        activeBoxShadow: active
          ? `0 0 0 3rpx ${activeBorderColor}, 0 7rpx 14rpx -3rpx ${activeGlowColor}`
          : 'none',
      })
    },
    syncColors() {
      const name = `${this.properties.name || ''}`.trim()
      const color = `${this.properties.color || ''}`.trim()
      const textColor = `${this.properties.textColor || ''}`.trim()

      if (color && textColor) {
        this.applyColors(color, textColor)
        return
      }

      if (color) {
        this.applyColors(color, getContrastTextColor(color))
        return
      }

      if (!name) {
        this.applyColors('#E4F2E9', '#2F3A34')
        return
      }

      const colors = getTagPillColors(name)
      this.applyColors(colors.backgroundColor, colors.textColor)
    },
  },
})
