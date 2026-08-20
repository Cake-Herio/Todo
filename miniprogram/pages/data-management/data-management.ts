import { deletePlansByIds, removeCompletedRecordLocally } from '../../utils/data'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { runDataMaintenance, type MaintenanceItem, type MaintenanceResult } from '../../utils/data-maintenance'

Component({
  data: {
    commandInput: '',
    previewVisible: false,
    previewDestructive: false,
    previewCount: 0,
    previewItems: [] as MaintenanceItem[],
    resultMessage: '',
    isLoading: false,
    actionType: '' as 'preview' | 'execute' | '',
    pageFontStyle: getFontPageStyle(),
  },
  pageLifetimes: {
    show() {
      refreshPageFontStyle(this)
    },
  },
  methods: {
    onCommandInput(e: WechatMiniprogram.Input) {
      this.setData({
        commandInput: e.detail.value,
        previewVisible: false,
        resultMessage: '',
      })
    },
    async previewCommand() {
      const command = this.data.commandInput.trim()
      if (!command) {
        wx.showToast({ title: '请输入指令', icon: 'none' })
        return
      }

      this.setData({ isLoading: true, actionType: 'preview', resultMessage: '' })
      try {
        const result = await runDataMaintenance(command)
        if (!result.ok) {
          throw new Error(result.message || '指令执行失败')
        }

        this.applyPreviewResult(result)
        this.setData({ resultMessage: result.count ? '请确认影响范围后再执行删除' : '' })
      } catch (error) {
        this.setData({ previewVisible: false })
        wx.showToast({
          title: error instanceof Error ? error.message : '指令执行失败',
          icon: 'none',
        })
      } finally {
        this.setData({ isLoading: false, actionType: '' })
      }
    },
    applyPreviewResult(result: MaintenanceResult) {
      this.setData({
        previewVisible: true,
        previewDestructive: Boolean(result.destructive),
        previewCount: result.count || 0,
        previewItems: result.items || [],
      })
    },
    async executeCommand() {
      if (!this.data.previewDestructive || this.data.previewCount <= 0) {
        return
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        wx.showModal({
          title: '确认删除',
          content: `将删除当前预览中的 ${this.data.previewCount} 条云端数据，删除后不可恢复。`,
          confirmText: '删除',
          confirmColor: '#D96C62',
          success: (res) => resolve(res.confirm),
          fail: () => resolve(false),
        })
      })

      if (!confirmed) {
        return
      }

      const command = this.data.commandInput.trim()
      this.setData({ isLoading: true, actionType: 'execute', resultMessage: '' })
      try {
        const result = await runDataMaintenance(command, true)
        if (!result.ok) {
          throw new Error(result.message || '删除失败')
        }

        const items = result.items || []
        deletePlansByIds(items.filter((item) => item.collection === 'plans').map((item) => item.id))
        items
          .filter((item) => item.collection === 'completed_records')
          .forEach((item) => removeCompletedRecordLocally(item.id))

        this.setData({
          previewVisible: false,
          previewDestructive: false,
          previewCount: 0,
          previewItems: [],
          resultMessage: `已删除 ${result.count || 0} 条数据`,
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '删除失败',
          icon: 'none',
        })
      } finally {
        this.setData({ isLoading: false, actionType: '' })
      }
    },
  },
})
