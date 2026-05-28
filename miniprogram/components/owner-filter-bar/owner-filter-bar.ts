import { splitOwnerFilters, type OwnerFilterOption } from '../../utils/owner-filters'
import { getScrollFadeState } from '../../utils/scroll-fade'

Component({
  properties: {
    filters: {
      type: Array,
      value: [] as OwnerFilterOption[],
    },
    activeFilter: {
      type: String,
      value: 'all',
    },
  },
  data: {
    pinnedFilter: null as OwnerFilterOption | null,
    scrollFilters: [] as OwnerFilterOption[],
    showFilterScrollFadeLeft: false,
    showFilterScrollFadeRight: false,
  },
  observers: {
    filters(filters: OwnerFilterOption[]) {
      const { pinnedFilter, scrollFilters } = splitOwnerFilters(filters || [])
      this.setData({ pinnedFilter, scrollFilters })
      this.updateFilterScrollFades()
    },
  },
  methods: {
    onFilterTap(e: WechatMiniprogram.BaseEvent) {
      const filter = e.currentTarget.dataset.filter as string | undefined
      if (!filter) {
        return
      }

      this.triggerEvent('change', { filter })
    },
    onFilterScroll(e: WechatMiniprogram.ScrollViewScroll) {
      const { scrollLeft, scrollWidth } = e.detail
      const viewportWidth = (this as WechatMiniprogram.IAnyObject)._filterScrollViewportWidth as number || 0
      const fades = getScrollFadeState(scrollLeft, scrollWidth, viewportWidth)

      this.setData({
        showFilterScrollFadeLeft: fades.showLeft,
        showFilterScrollFadeRight: fades.showRight,
      })
    },
    updateFilterScrollFades(scrollLeft = 0) {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.owner-filter-scroll').boundingClientRect()
        query.select('.owner-filter-scroll-list').boundingClientRect()
        query.exec((res) => {
          const viewportWidth = res[0]?.width || 0
          const listWidth = res[1]?.width || 0
          ;(this as WechatMiniprogram.IAnyObject)._filterScrollViewportWidth = viewportWidth

          const fades = getScrollFadeState(scrollLeft, listWidth, viewportWidth)
          this.setData({
            showFilterScrollFadeLeft: fades.showLeft,
            showFilterScrollFadeRight: fades.showRight,
          })
        })
      })
    },
  },
})
