/** 计划时段相关的公共时间工具，供首页预览、日历排序、冲突检测等复用 */
export class ScheduleTimeHelper {
  /** 默认「即将开始/结束」预览窗口：2 小时内 */
  static readonly UPCOMING_WINDOW_MINUTES = 120

  /** 将 HH:mm 转为当天分钟数；00:00 作为结束时刻时可视为 24:00 */
  static parseToMinutes(time: string, treatMidnightAsEnd = false): number {
    const [hourText, minuteText] = time.split(':')
    let hour = Number(hourText)
    const minute = Number(minuteText || '0')

    if (treatMidnightAsEnd && hour === 0 && minute === 0) {
      hour = 24
    }

    return hour * 60 + minute
  }

  /** 当前时刻在一天中的分钟数 */
  static getNowMinutes(date = new Date()): number {
    return date.getHours() * 60 + date.getMinutes()
  }

  /** 距离某时刻的文案提示，如「15 分钟后开始」 */
  static formatMinutesHint(minutesUntil: number, kind: 'start' | 'end'): string {
    if (minutesUntil <= 0) {
      return kind === 'start' ? '马上开始' : '马上结束'
    }

    if (minutesUntil < 60) {
      return `${minutesUntil} 分钟后${kind === 'start' ? '开始' : '结束'}`
    }

    const hours = Math.floor(minutesUntil / 60)
    const minutes = minutesUntil % 60

    if (minutes === 0) {
      return `${hours} 小时后${kind === 'start' ? '开始' : '结束'}`
    }

    return `${hours} 小时 ${minutes} 分钟后${kind === 'start' ? '开始' : '结束'}`
  }

  /** 首页预览卡片的状态样式：即将类为 soon，其余为 wait */
  static resolveStatusClass(statusLabel: string): 'soon' | 'wait' {
    return statusLabel === '即将开始' || statusLabel === '即将结束' ? 'soon' : 'wait'
  }

  /** 判断 start/end 时刻是否合法（结束须晚于开始） */
  static isValidTimeRange(startTime: string, endTime: string): boolean {
    return (
      ScheduleTimeHelper.parseToMinutes(startTime) <
      ScheduleTimeHelper.parseToMinutes(endTime, true)
    )
  }
}
