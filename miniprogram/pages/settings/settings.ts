import {
  endActivitySmithSession,
  fetchActivitySmithApiKeyStatus,
  getActivitySmithStatusLabel,
  isActivitySmithEnabled,
  isActivitySmithKeyConfigured,
  openActivitySmithAppStore,
  saveActivitySmithApiKey,
  setActivitySmithEnabled,
} from '../../utils/activitysmith'
import {
  endBarkFocusSession,
  fetchBarkKeyStatus,
  getBarkStatusLabel,
  isBarkEnabled,
  isBarkKeyConfigured,
  openBarkAppStore,
  saveBarkDeviceKey,
  sendBarkEnableTestPush,
  setBarkEnabled,
} from '../../utils/bark'
import { syncFromCloud } from '../../utils/cloud-sync'
import {
  FONT_OPTIONS,
  getFontPageStyle,
  getFontPreference,
  getFontPreferenceLabel,
  setFontPreference,
  type FontPreferenceKey,
} from '../../utils/font-preference'
import { getMyTimedRecords, getToday } from '../../utils/data'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { createRoom, deleteRoom, joinRoom, leaveRoom, listMyRooms, switchRoom, type RoomSummary } from '../../utils/shared-space-room'
import { getDisplayAvatarUrl, getDisplayNickname, getSession, isProfileComplete, isSessionReady, isSharedSpaceMode } from '../../utils/session'

const buildSettingsItems = (fontPreference: FontPreferenceKey, roomTotalCount = 0) => {
  const todayTimedCount = getMyTimedRecords(getToday()).length

  return [
  {
    label: '加入共享空间',
    desc: roomTotalCount > 0 ? `已加入 ${roomTotalCount} 个房间` : '新建或加入房间，与伙伴共享计划',
  },
  
  { label: '标签管理', desc: '自定义计划标签' },
  { label: '计时记录', desc: todayTimedCount > 0 ? `今天 ${todayTimedCount} 条` : '查看专注计时历史' },
  // { label: '灵动岛', desc: getActivitySmithStatusLabel() },
  { label: 'Bark 推送', desc: getBarkStatusLabel() },
  { label: '字体', desc: getFontPreferenceLabel(fontPreference) },
  { label: '数据处理', desc: '预览并清理当前房间中的测试数据' },
  { label: '数据同步', desc: '强触云同步' },
  // { label: '关于 MyForest', desc: '本地优先，云备份同步' },
]
}

Component({
  data: {
    activeRoomName: '',
    cloudStatusText: '未连接',
    sharedSpaceId: '',
    roomTotalCount: 0,
    ownedRooms: [] as RoomSummary[],
    joinedRooms: [] as RoomSummary[],
    activeSharedSpaceId: '',
    sharedSpaceView: 'main' as 'main' | 'create' | 'createResult' | 'join',
    createRoomNameInput: '',
    createdRoomName: '',
    createdInviteCode: '',
    joinInviteCodeInput: '',
    isSharedSpaceSheetVisible: false,
    isSharedSpaceSheetClosing: false,
    profileName: getDisplayNickname(),
    profileAvatarUrl: getDisplayAvatarUrl(),
    profileInitial: getDisplayNickname().slice(0, 1),
    profileHint: isProfileComplete() ? 'UI 读本地 · 云后台同步' : '请在首页完善头像昵称',
    fontPreference: getFontPreference(),
    fontOptions: FONT_OPTIONS,
    isFontSheetVisible: false,
    isFontSheetClosing: false,
    isActivitySmithSheetVisible: false,
    isActivitySmithSheetClosing: false,
    activitySmithEnabled: isActivitySmithEnabled(),
    activitySmithKeyConfigured: isActivitySmithKeyConfigured(),
    activitySmithKeyMasked: '',
    activitySmithApiKeyInput: '',
    isBarkSheetVisible: false,
    isBarkSheetClosing: false,
    barkEnabled: isBarkEnabled(),
    barkKeyConfigured: isBarkKeyConfigured(),
    barkKeyMasked: '',
    barkDeviceKeyInput: '',
    pageFontStyle: getFontPageStyle(),
    items: buildSettingsItems(getFontPreference()),
  },
  lifetimes: {
    attached() {
      this.refreshCloudStatus()
    },
  },
  pageLifetimes: {
    show() {
      this.refreshCloudStatus()
      if (isProfileComplete()) {
        void this.refreshRoomList()
      }
    },
  },
  methods: {
    refreshCloudStatus() {
      const session = getSession()
      const profileName = getDisplayNickname()
      const fontPreference = getFontPreference()
      const cloudStatusText = isSharedSpaceMode()
        ? '已连接共享空间'
        : isProfileComplete()
          ? '账号已同步'
          : '未连接'

      this.setData({
        cloudStatusText,
        sharedSpaceId: isSharedSpaceMode() ? session?.sharedSpaceId || '' : '',
        profileName,
        profileAvatarUrl: getDisplayAvatarUrl(),
        profileInitial: profileName.slice(0, 1),
        profileHint: isProfileComplete()
          ? '账号资料已同步到云端'
          : '请在首页完善头像昵称',
        activitySmithEnabled: isActivitySmithEnabled(),
        activitySmithKeyConfigured: isActivitySmithKeyConfigured(),
        barkEnabled: isBarkEnabled(),
        barkKeyConfigured: isBarkKeyConfigured(),
        fontPreference,
        pageFontStyle: getFontPageStyle(fontPreference),
        items: buildSettingsItems(fontPreference, this.data.roomTotalCount),
      })
    },
    async applyFontPreference(key: FontPreferenceKey) {
      if (key === this.data.fontPreference) {
        return
      }

      const pageFontStyle = getFontPageStyle(key)
      await setFontPreference(key)
      this.setData({
        fontPreference: key,
        pageFontStyle,
        items: buildSettingsItems(key),
      })
      wx.showToast({
        title: '已切换字体',
        icon: 'success',
      })
    },
    noop() {},
    openFontPicker() {
      openModal(this, 'isFontSheetVisible', 'isFontSheetClosing')
    },
    closeFontPickerSheet() {
      dismissModal(this, 'isFontSheetVisible', 'isFontSheetClosing')
    },
    openActivitySmithSheet() {
      openModal(this, 'isActivitySmithSheetVisible', 'isActivitySmithSheetClosing')
      void this.refreshActivitySmithKeyStatus()
    },
    closeActivitySmithSheet() {
      dismissModal(this, 'isActivitySmithSheetVisible', 'isActivitySmithSheetClosing')
    },
    async refreshActivitySmithKeyStatus() {
      const status = await fetchActivitySmithApiKeyStatus()
      this.setData({
        activitySmithEnabled: isActivitySmithEnabled(),
        activitySmithKeyConfigured: status.configured,
        activitySmithKeyMasked: status.maskedKey,
        items: buildSettingsItems(this.data.fontPreference),
      })
    },
    onActivitySmithSwitchChange(e: WechatMiniprogram.SwitchChange) {
      const nextEnabled = e.detail.value

      if (nextEnabled && !this.data.activitySmithKeyConfigured) {
        this.setData({ activitySmithEnabled: false })
        wx.showToast({
          title: '请先保存 API Key',
          icon: 'none',
        })
        return
      }

      setActivitySmithEnabled(nextEnabled)
      this.setData({
        activitySmithEnabled: nextEnabled,
        items: buildSettingsItems(this.data.fontPreference),
      })

      if (!nextEnabled) {
        void endActivitySmithSession()
      }
    },
    onActivitySmithApiKeyInput(e: WechatMiniprogram.Input) {
      this.setData({
        activitySmithApiKeyInput: e.detail.value,
      })
    },
    onOpenActivitySmithAppStore() {
      void openActivitySmithAppStore()
    },
    async onSaveActivitySmithApiKey() {
      const apiKey = this.data.activitySmithApiKeyInput.trim()

      if (!apiKey) {
        wx.showToast({
          title: '请先粘贴 API Key',
          icon: 'none',
        })
        return
      }

      wx.showLoading({ title: '保存中', mask: true })

      try {
        const status = await saveActivitySmithApiKey(apiKey)
        this.setData({
          activitySmithApiKeyInput: '',
          activitySmithKeyConfigured: status.configured,
          activitySmithKeyMasked: status.maskedKey,
          items: buildSettingsItems(this.data.fontPreference),
        })
        wx.showToast({
          title: 'API Key 已保存',
          icon: 'success',
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '保存失败',
          icon: 'none',
        })
      } finally {
        wx.hideLoading()
      }
    },
    openBarkSheet() {
      openModal(this, 'isBarkSheetVisible', 'isBarkSheetClosing')
      void this.refreshBarkKeyStatus()
    },
    closeBarkSheet() {
      dismissModal(this, 'isBarkSheetVisible', 'isBarkSheetClosing')
    },
    async refreshBarkKeyStatus() {
      const status = await fetchBarkKeyStatus()
      this.setData({
        barkEnabled: isBarkEnabled(),
        barkKeyConfigured: status.configured,
        barkKeyMasked: status.maskedKey,
        items: buildSettingsItems(this.data.fontPreference),
      })
    },
    onBarkSwitchChange(e: WechatMiniprogram.SwitchChange) {
      const nextEnabled = e.detail.value

      if (nextEnabled && !this.data.barkKeyConfigured) {
        this.setData({ barkEnabled: false })
        wx.showToast({
          title: '请先保存 Device Key',
          icon: 'none',
        })
        return
      }

      if (!nextEnabled) {
        setBarkEnabled(false)
        this.setData({
          barkEnabled: false,
          items: buildSettingsItems(this.data.fontPreference),
        })
        void endBarkFocusSession()
        return
      }

      setBarkEnabled(true)
      this.setData({
        barkEnabled: true,
        items: buildSettingsItems(this.data.fontPreference),
      })

      wx.showLoading({ title: '开启中', mask: true })

      void sendBarkEnableTestPush()
        .then(() => {
          wx.hideLoading()
          wx.showModal({
            title: '开启成功',
            content: 'Bark 推送已开启，已向你的设备发送测试通知。专注计时将每 15 分钟推送一次。',
            showCancel: false,
          })
        })
        .catch((error: unknown) => {
          wx.hideLoading()
          setBarkEnabled(false)
          this.setData({
            barkEnabled: false,
            items: buildSettingsItems(this.data.fontPreference),
          })
          wx.showModal({
            title: '开启失败',
            content: error instanceof Error ? error.message : '请稍后重试',
            showCancel: false,
          })
        })
    },
    onBarkDeviceKeyInput(e: WechatMiniprogram.Input) {
      this.setData({
        barkDeviceKeyInput: e.detail.value,
      })
    },
    onOpenBarkAppStore() {
      void openBarkAppStore()
    },
    async onSaveBarkDeviceKey() {
      const deviceKey = this.data.barkDeviceKeyInput.trim()

      if (!deviceKey) {
        wx.showToast({
          title: '请先粘贴 Device Key',
          icon: 'none',
        })
        return
      }

      wx.showLoading({ title: '保存中', mask: true })

      try {
        const status = await saveBarkDeviceKey(deviceKey)
        this.setData({
          barkDeviceKeyInput: '',
          barkKeyConfigured: status.configured,
          barkKeyMasked: status.maskedKey,
          items: buildSettingsItems(this.data.fontPreference),
        })
        wx.showToast({
          title: 'Device Key 已保存',
          icon: 'success',
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '保存失败',
          icon: 'none',
        })
      } finally {
        wx.hideLoading()
      }
    },
    openSharedSpaceSheet() {
      if (!isProfileComplete()) {
        wx.showToast({
          title: '请先在首页完善头像昵称',
          icon: 'none',
        })
        return
      }

      openModal(this, 'isSharedSpaceSheetVisible', 'isSharedSpaceSheetClosing', {
        sharedSpaceView: 'main',
        joinInviteCodeInput: '',
        createdInviteCode: '',
      })
      void this.refreshRoomList()
    },
    closeSharedSpaceSheet() {
      dismissModal(this, 'isSharedSpaceSheetVisible', 'isSharedSpaceSheetClosing', {
        extraData: {
          sharedSpaceView: 'main',
          joinInviteCodeInput: '',
        },
      })
    },
    async refreshRoomList() {
      try {
        const rooms = await listMyRooms()
        const activeRoom =
          [...rooms.owned, ...rooms.joined].find((room) => room.isActive) ||
          [...rooms.owned, ...rooms.joined].find((room) => room.sharedSpaceId === rooms.activeSharedSpaceId)

        this.setData({
          ownedRooms: rooms.owned,
          joinedRooms: rooms.joined,
          activeSharedSpaceId: rooms.activeSharedSpaceId,
          roomTotalCount: rooms.totalCount,
          activeRoomName: activeRoom?.roomName || '',
          items: buildSettingsItems(this.data.fontPreference, rooms.totalCount),
        })
      } catch (error) {
        console.warn('[settings] refreshRoomList failed', error)
      }
    },
    onSharedSpaceCreateTap() {
      this.setData({
        sharedSpaceView: 'create',
        createRoomNameInput: '',
      })
    },
    onCreateRoomNameInput(e: WechatMiniprogram.Input) {
      this.setData({
        createRoomNameInput: `${e.detail.value || ''}`.trim(),
      })
    },
    onConfirmCreateRoom() {
      const roomName = this.data.createRoomNameInput.trim()

      if (!roomName) {
        wx.showToast({
          title: '请输入房间名称',
          icon: 'none',
        })
        return
      }

      wx.showLoading({ title: '创建中', mask: true })

      void createRoom(roomName)
        .then((result) => {
          wx.hideLoading()
          this.setData({
            sharedSpaceView: 'createResult',
            createdRoomName: result.roomName,
            createdInviteCode: result.code,
            activeRoomName: result.roomName,
          })
          void this.refreshRoomList()
          this.refreshCloudStatus()
        })
        .catch((error: unknown) => {
          wx.hideLoading()
          wx.showToast({
            title: error instanceof Error ? error.message : '创建失败',
            icon: 'none',
          })
        })
    },
    onSharedSpaceJoinTap() {
      this.setData({
        sharedSpaceView: 'join',
        joinInviteCodeInput: '',
      })
    },
    onSharedSpaceBackToMain() {
      this.setData({
        sharedSpaceView: 'main',
        joinInviteCodeInput: '',
      })
    },
    onJoinInviteCodeInput(e: WechatMiniprogram.Input) {
      this.setData({
        joinInviteCodeInput: `${e.detail.value || ''}`.trim().toUpperCase(),
      })
    },
    async onConfirmJoinRoom() {
      const code = this.data.joinInviteCodeInput.trim()

      if (!code) {
        wx.showToast({
          title: '请输入邀请码',
          icon: 'none',
        })
        return
      }

      wx.showLoading({ title: '加入中', mask: true })

      try {
        const result = await joinRoom(code)
        wx.hideLoading()
        this.setData({
          sharedSpaceView: 'main',
          joinInviteCodeInput: '',
          activeRoomName: result.roomName || this.data.activeRoomName,
        })
        await this.refreshRoomList()
        this.refreshCloudStatus()
        wx.showToast({
          title: '已加入房间',
          icon: 'success',
        })
      } catch (error) {
        wx.hideLoading()
        wx.showToast({
          title: error instanceof Error ? error.message : '加入失败',
          icon: 'none',
        })
      }
    },
    onCopyRoomInviteCode(e: WechatMiniprogram.BaseEvent) {
      const code = `${e.currentTarget.dataset.inviteCode || ''}`.trim()

      if (!code) {
        wx.showToast({
          title: '暂无邀请码',
          icon: 'none',
        })
        return
      }

      wx.setClipboardData({
        data: code,
        success: () => {
          wx.showToast({
            title: '已复制邀请码',
            icon: 'success',
          })
        },
      })
    },
    onCopyInviteCode() {
      const code = this.data.createdInviteCode.trim()

      if (!code) {
        return
      }

      wx.setClipboardData({
        data: code,
        success: () => {
          wx.showToast({
            title: '已复制邀请码',
            icon: 'success',
          })
        },
      })
    },
    onSharedSpaceCreateDone() {
      this.setData({ sharedSpaceView: 'main' })
    },
    async onRoomTap(e: WechatMiniprogram.BaseEvent) {
      const sharedSpaceId = `${e.currentTarget.dataset.spaceId || ''}`.trim()
      const isActive = Boolean(e.currentTarget.dataset.active)

      if (!sharedSpaceId || isActive) {
        return
      }

      wx.showLoading({ title: '切换中', mask: true })

      try {
        await switchRoom(sharedSpaceId)
        wx.hideLoading()
        await this.refreshRoomList()
        this.refreshCloudStatus()
        wx.showToast({
          title: '已切换房间',
          icon: 'success',
        })
      } catch (error) {
        wx.hideLoading()
        wx.showToast({
          title: error instanceof Error ? error.message : '切换失败',
          icon: 'none',
        })
      }
    },
    onDeleteRoomTap(e: WechatMiniprogram.BaseEvent) {
      const sharedSpaceId = `${e.currentTarget.dataset.spaceId || ''}`.trim()
      const roomName = `${e.currentTarget.dataset.roomName || '该房间'}`.trim()

      if (!sharedSpaceId) {
        return
      }

      wx.showModal({
        title: '删除房间',
        content: `确定删除「${roomName}」？房间成员将收到通知，且邀请码失效。`,
        confirmText: '删除',
        confirmColor: '#D86868',
        success: (res) => {
          if (res.confirm) {
            void this.handleDeleteRoom(sharedSpaceId)
          }
        },
      })
    },
    onLeaveRoomTap(e: WechatMiniprogram.BaseEvent) {
      const sharedSpaceId = `${e.currentTarget.dataset.spaceId || ''}`.trim()
      const roomName = `${e.currentTarget.dataset.roomName || '该房间'}`.trim()

      if (!sharedSpaceId) {
        return
      }

      wx.showModal({
        title: '退出房间',
        content: `确定退出「${roomName}」？其他成员将收到通知。`,
        confirmText: '退出',
        confirmColor: '#D86868',
        success: (res) => {
          if (res.confirm) {
            void this.handleLeaveRoom(sharedSpaceId)
          }
        },
      })
    },
    async handleDeleteRoom(sharedSpaceId: string) {
      wx.showLoading({ title: '删除中', mask: true })

      try {
        await deleteRoom(sharedSpaceId)
        wx.hideLoading()
        await this.refreshRoomList()
        this.refreshCloudStatus()
        wx.showToast({
          title: '房间已删除',
          icon: 'success',
        })
      } catch (error) {
        wx.hideLoading()
        wx.showToast({
          title: error instanceof Error ? error.message : '删除失败',
          icon: 'none',
        })
      }
    },
    async handleLeaveRoom(sharedSpaceId: string) {
      wx.showLoading({ title: '退出中', mask: true })

      try {
        await leaveRoom(sharedSpaceId)
        wx.hideLoading()
        await this.refreshRoomList()
        this.refreshCloudStatus()
        wx.showToast({
          title: '已退出房间',
          icon: 'success',
        })
      } catch (error) {
        wx.hideLoading()
        wx.showToast({
          title: error instanceof Error ? error.message : '退出失败',
          icon: 'none',
        })
      }
    },
    onFontOptionTap(e: WechatMiniprogram.BaseEvent) {
      const key = e.currentTarget.dataset.key as FontPreferenceKey

      if (!key) {
        return
      }

      if (key === this.data.fontPreference) {
        dismissModal(this, 'isFontSheetVisible', 'isFontSheetClosing')
        return
      }

      dismissModal(this, 'isFontSheetVisible', 'isFontSheetClosing')
      wx.showModal({
        title: '更换字体',
        content: '更换字体后需要重启小程序',
        showCancel: true,
        confirmText: '确定',
        success: async (res) => {
          if (!res.confirm) {
            return
          }

          await this.applyFontPreference(key)
          wx.reLaunch({ url: '/pages/index/index' })
        },
      })
    },
    async onItemTap(e: WechatMiniprogram.BaseEvent) {
      const label = e.currentTarget.dataset.label

      if (label === '加入共享空间') {
        this.openSharedSpaceSheet()
        return
      }

      if (label === '数据同步') {
        await this.syncCloudData()
        return
      }

      if (label === '灵动岛') {
        this.openActivitySmithSheet()
        return
      }

      if (label === 'Bark 推送') {
        this.openBarkSheet()
        return
      }

      if (label === '标签管理') {
        wx.navigateTo({
          url: '/pages/tags/tags',
        })
        return
      }

      if (label === '计时记录') {
        wx.navigateTo({
          url: '/pages/focus-records/focus-records',
        })
        return
      }

      if (label === '数据处理') {
        wx.navigateTo({
          url: '/pages/data-management/data-management',
        })
        return
      }

      if (label === '字体') {
        this.openFontPicker()
        return
      }

      wx.showToast({
        title: '后续接入设置项',
        icon: 'none',
      })
    },
    async syncCloudData() {
      if (!isSessionReady()) {
        wx.showToast({
          title: '请先加入共享空间',
          icon: 'none',
        })
        return
      }

      wx.showLoading({ title: '同步中' })

      try {
        const changed = await syncFromCloud()
        wx.showToast({
          title: changed ? '已更新本地' : '本地已是最新',
          icon: 'success',
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '同步失败',
          icon: 'none',
        })
      } finally {
        wx.hideLoading()
      }
    },
  },
})
