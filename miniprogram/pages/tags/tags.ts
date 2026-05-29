import {
  addPlanTagOption,
  deletePlanTagOption,
  getPlanTagOptions,
  getPrivatePlanTags,
  getSharedPlanTags,
  getContrastTextColor,
  syncPlanTagsFromCloud,
  updatePlanTagOption,
  type PlanTagView,
} from '../../utils/plan-tags'
import { applyTagUpdate } from '../../utils/data'
import { refreshWithLocalFirst } from '../../utils/cloud-sync'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { isSessionReady, isSoloMode } from '../../utils/session'

const toTagViews = (tags: ReturnType<typeof getPlanTagOptions>): PlanTagView[] =>
  tags.map((item) => ({
    ...item,
    textColor: getContrastTextColor(item.color),
  }))

Component({
  data: {
    sharedTags: [] as PlanTagView[],
    privateTags: [] as PlanTagView[],
    isTagCreateVisible: false,
    editingTag: null as PlanTagView | null,
    pageFontStyle: getFontPageStyle(),
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
      refreshWithLocalFirst(() => {
        this.refreshTags()
      })
    },
  },
  methods: {
    refreshTags() {
      if (isSoloMode()) {
        const customTags = getPlanTagOptions().filter((item) => !item.isBuiltin)
        this.setData({
          sharedTags: [],
          privateTags: toTagViews(customTags),
        })
        return
      }

      this.setData({
        sharedTags: isSessionReady() ? getSharedPlanTags() : [],
        privateTags: isSessionReady() ? getPrivatePlanTags() : [],
      })
    },
    addTag() {
      this.setData({
        isTagCreateVisible: true,
        editingTag: null,
      })
    },
    onTagTap(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      if (!id) {
        return
      }

      const tag = [...this.data.sharedTags, ...this.data.privateTags].find((item) => item.id === id)
      if (!tag) {
        return
      }

      this.setData({
        isTagCreateVisible: true,
        editingTag: tag,
      })
    },
    closeTagCreateSheet() {
      this.setData({
        isTagCreateVisible: false,
        editingTag: null,
      })
    },
    async onTagCreateConfirm(
      e: WechatMiniprogram.CustomEvent<{ id?: string; name: string; color: string; visibility?: 'shared' | 'private' }>,
    ) {
      const { id, name, color, visibility = 'shared' } = e.detail

      wx.showLoading({
        title: id ? '保存中...' : '添加中...',
        mask: true,
      })

      try {
        if (id) {
          const result = await updatePlanTagOption(id, name, color)

          if (!result.ok) {
            wx.showToast({
              title: result.message || '保存失败',
              icon: 'none',
            })
            this.setData({
              isTagCreateVisible: true,
              editingTag: this.data.editingTag || { id, name, color, visibility } as PlanTagView,
            })
            return
          }

          if (result.name) {
            applyTagUpdate(id, { name: result.name })
          }

          await syncPlanTagsFromCloud()
          this.setData({
            isTagCreateVisible: false,
            editingTag: null,
          })
          this.refreshTags()
          wx.showToast({
            title: '已保存',
            icon: 'success',
          })
          return
        }

        const result = await addPlanTagOption(name, color, visibility)

        if (!result.ok) {
          wx.showToast({
            title: result.message || '添加失败',
            icon: 'none',
          })
          this.setData({ isTagCreateVisible: true, editingTag: null })
          return
        }

        await syncPlanTagsFromCloud()
        this.setData({
          isTagCreateVisible: false,
          editingTag: null,
        })
        this.refreshTags()
        wx.showToast({
          title: '已添加标签',
          icon: 'success',
        })
      } finally {
        wx.hideLoading()
      }
    },
    onTagLongPress(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      const name = e.currentTarget.dataset.name as string | undefined

      if (!id || !name) {
        return
      }

      wx.showModal({
        title: '删除标签',
        content: `确定删除「${name}」吗？`,
        confirmColor: '#D96565',
        success: async (res) => {
          if (!res.confirm) {
            return
          }

          wx.showLoading({ title: '删除中...', mask: true })

          try {
            const result = await deletePlanTagOption(id)
            if (!result.ok) {
              wx.showToast({
                title: result.message || '删除失败',
                icon: 'none',
              })
              return
            }

            this.refreshTags()
            wx.showToast({
              title: '已删除',
              icon: 'none',
            })
          } finally {
            wx.hideLoading()
          }
        },
      })
    },
    async onTagDelete(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
      const { id } = e.detail
      if (!id) {
        return
      }

      const tag = [...this.data.sharedTags, ...this.data.privateTags].find((item) => item.id === id)
      if (!tag) {
        return
      }

      wx.showModal({
        title: '删除标签',
        content: `确定删除「${tag.name}」吗？`,
        confirmColor: '#D96565',
        success: async (res) => {
          if (!res.confirm) {
            return
          }

          wx.showLoading({ title: '删除中...', mask: true })

          try {
            const result = await deletePlanTagOption(id)
            if (!result.ok) {
              wx.showToast({
                title: result.message || '删除失败',
                icon: 'none',
              })
              return
            }

            this.setData({
              isTagCreateVisible: false,
              editingTag: null,
            })
            this.refreshTags()
            wx.showToast({
              title: '已删除',
              icon: 'none',
            })
          } finally {
            wx.hideLoading()
          }
        },
      })
    },
  },
})
