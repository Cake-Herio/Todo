import { syncFromCloud } from '../../utils/cloud-sync'
import { DEFAULT_INVITE_CODE } from '../../utils/cloud-config'
import {
  FONT_OPTIONS,
  getFontPageStyle,
  getFontPreference,
  getFontPreferenceLabel,
  setFontPreference,
  type FontPreferenceKey,
} from '../../utils/font-preference'
import { dismissModal, openModal } from '../../utils/modal-dismiss'
import { getDisplayAvatarUrl, getDisplayNickname, getSession, isProfileComplete, isSessionReady, isSharedSpaceMode, isSoloMode, logoutUser, verifyInviteCode } from '../../utils/session'

const buildSettingsItems = (fontPreference: FontPreferenceKey) => [
  { label: '加入共享空间', desc: '填写邀请码，与伙伴共享计划' },
  { label: '从云拉取到本地', desc: '手动触发后台同步' },
  { label: '标签管理', desc: '自定义计划标签' },
  { label: '通知授权', desc: '计划开始前 5 分钟提醒' },
  { label: '字体', desc: getFontPreferenceLabel(fontPreference) },
  { label: '关于 MyForest', desc: '本地优先，云备份同步' },
]

Component({
  data: {
    inviteCode: DEFAULT_INVITE_CODE,
    cloudStatusText: '未连接',
    sharedSpaceId: '',
    profileName: getDisplayNickname(),
    profileAvatarUrl: getDisplayAvatarUrl(),
    profileInitial: getDisplayNickname().slice(0, 1),
    profileHint: isProfileComplete() ? 'UI 读本地 · 云后台同步' : '请在首页完善头像昵称',
    isLoggedIn: isProfileComplete(),
    fontPreference: getFontPreference(),
    fontOptions: FONT_OPTIONS,
    isFontSheetVisible: false,
    isFontSheetClosing: false,
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
    },
  },
  methods: {
    refreshCloudStatus() {
      const session = getSession()
      const profileName = getDisplayNickname()
      const fontPreference = getFontPreference()
      const cloudStatusText = isSharedSpaceMode()
        ? '已连接共享空间'
        : isSoloMode()
          ? '单人模式（仅本地）'
          : isSessionReady()
            ? '已连接（UI 读本地）'
            : '未连接'

      this.setData({
        cloudStatusText,
        sharedSpaceId: isSharedSpaceMode() ? session?.sharedSpaceId || '' : '',
        profileName,
        profileAvatarUrl: getDisplayAvatarUrl(),
        profileInitial: profileName.slice(0, 1),
        profileHint: isSoloMode()
          ? '数据保存在本机，不加入共享分组'
          : isProfileComplete()
            ? 'UI 读本地 · 云后台同步'
            : '请在首页完善头像昵称',
        isLoggedIn: isProfileComplete(),
        fontPreference,
        pageFontStyle: getFontPageStyle(fontPreference),
        items: buildSettingsItems(fontPreference),
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
      this.selectComponent('#font-page-meta')?.refresh?.(pageFontStyle)
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
    onFontOptionTap(e: WechatMiniprogram.BaseEvent) {
      const key = e.currentTarget.dataset.key as FontPreferenceKey

      if (!key) {
        return
      }

      dismissModal(this, 'isFontSheetVisible', 'isFontSheetClosing')
      void this.applyFontPreference(key)
    },
    onLogoutTap() {
      wx.showModal({
        title: '退出登录',
        content: '退出后需重新填写头像和昵称',
        confirmText: '退出',
        confirmColor: '#D86868',
        success: (res) => {
          if (res.confirm) {
            this.logout()
          }
        },
      })
    },
    logout() {
      logoutUser()
      getApp<IAppOption>().globalData.cloudReady = false
      wx.reLaunch({ url: '/pages/index/index' })
    },
    async onItemTap(e: WechatMiniprogram.BaseEvent) {
      const label = e.currentTarget.dataset.label

      if (label === '加入共享空间') {
        await this.verifyInvite()
        return
      }

      if (label === '从云拉取到本地') {
        await this.syncCloudData()
        return
      }

      if (label === '标签管理') {
        wx.navigateTo({
          url: '/pages/tags/tags',
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
    async verifyInvite() {
      wx.showLoading({ title: '验证中' })

      try {
        const session = getSession()
        await verifyInviteCode(this.data.inviteCode, {
          nickname: session?.nickname?.trim() || getDisplayNickname(),
          avatarUrl: session?.avatarUrl || getDisplayAvatarUrl(),
        })
        await syncFromCloud()
        getApp<IAppOption>().globalData.cloudReady = true
        this.refreshCloudStatus()
        wx.showToast({
          title: '已加入共享空间',
          icon: 'success',
        })
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '验证失败',
          icon: 'none',
        })
      } finally {
        wx.hideLoading()
      }
    },
    async syncCloudData() {
      if (!isSessionReady()) {
        wx.showToast({
          title: isSoloMode() ? '单人模式不支持云同步' : '请先加入共享空间',
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
