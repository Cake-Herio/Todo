import { getContrastTextColor, getTagPillColors } from '../../utils/plan-tags'

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
  },
  observers: {
    'name, color, textColor'() {
      this.syncColors()
    },
  },
  lifetimes: {
    attached() {
      this.syncColors()
    },
  },
  methods: {
    syncColors() {
      const name = `${this.properties.name || ''}`.trim()
      const color = `${this.properties.color || ''}`.trim()
      const textColor = `${this.properties.textColor || ''}`.trim()

      if (color && textColor) {
        this.setData({
          backgroundColor: color,
          labelColor: textColor,
        })
        return
      }

      if (color) {
        this.setData({
          backgroundColor: color,
          labelColor: getContrastTextColor(color),
        })
        return
      }

      if (!name) {
        this.setData({
          backgroundColor: '#E4F2E9',
          labelColor: '#2F3A34',
        })
        return
      }

      const colors = getTagPillColors(name)
      this.setData({
        backgroundColor: colors.backgroundColor,
        labelColor: colors.textColor,
      })
    },
  },
})
