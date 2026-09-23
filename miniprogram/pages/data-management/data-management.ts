import { deletePlansByIds, removeCompletedRecordLocally } from '../../utils/data'
import { getFontPageStyle, refreshPageFontStyle } from '../../utils/font-preference'
import { runDataMaintenance, type MaintenanceItem, type MaintenanceResult } from '../../utils/data-maintenance'

Component({
  data: {
    commandInput: '',
    quickCommands: [
      {
        label: '预览指定日期',
        command: 'preview completed_records where date=2026-09-01 scope=all',
      },
      {
        label: '预览全部记录',
        command: 'preview completed_records scope=all',
      },
      {
        label: '更新记录时间',
        command: 'update completed_records where id=record-xxx startedAt=2026-09-01T09:30:00+08:00 completedAt=2026-09-01T11:00:00+08:00 scope=all',
      },
    ],
    previewVisible: false,
    previewDestructive: false,
    previewOperation: 'preview' as 'preview' | 'delete' | 'update',
    previewStale: false,
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
    onQuickCommandTap(e: WechatMiniprogram.TouchEvent) {
      const command = `${e.currentTarget.dataset.command || ''}`.trim()
      if (!command) {
        return
      }

      this.setData({
        commandInput: command,
        previewDestructive: false,
        previewOperation: 'preview',
        previewStale: this.data.previewVisible,
        resultMessage: this.data.previewVisible ? '指令已修改，请再次点击预览影响范围' : '',
      })
    },
    onCommandInput(e: WechatMiniprogram.Input) {
      this.setData({
        commandInput: e.detail.value,
        previewDestructive: false,
        previewOperation: 'preview',
        previewStale: this.data.previewVisible,
        resultMessage: this.data.previewVisible ? '指令已修改，请再次点击预览影响范围' : '',
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
        this.setData({
          resultMessage: result.count
            ? result.operation === 'update' ? '请确认时间范围后再更新' : '请确认影响范围后再执行删除'
            : '',
        })
      } catch (error) {
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
        previewOperation: result.operation || (result.destructive ? 'delete' : 'preview'),
        previewStale: false,
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
          title: this.data.previewOperation === 'update' ? '确认更新' : '确认删除',
          content: this.data.previewOperation === 'update'
            ? `将更新当前预览中的 ${this.data.previewCount} 条云端记录时间。`
            : `将删除当前预览中的 ${this.data.previewCount} 条云端数据，删除后不可恢复。`,
          confirmText: this.data.previewOperation === 'update' ? '更新' : '删除',
          confirmColor: this.data.previewOperation === 'update' ? '#78B995' : '#D96C62',
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
        if (result.operation === 'update') {
          this.setData({
            previewVisible: false,
            previewDestructive: false,
            previewOperation: 'preview',
            previewStale: false,
            previewCount: 0,
            previewItems: [],
            resultMessage: `已更新 ${result.count || 0} 条云端数据`,
          })
          return
        }

        deletePlansByIds(items.filter((item) => item.collection === 'plans').map((item) => item.id))
        items
          .filter((item) => item.collection === 'completed_records')
          .forEach((item) => removeCompletedRecordLocally(item.id))

        this.setData({
          previewVisible: false,
          previewDestructive: false,
          previewOperation: 'preview',
          previewStale: false,
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
