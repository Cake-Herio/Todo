const TRACE_KEY = 'myforest_record_debug_v1'
const TRACE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface RecordTrace {
  ids: string[]
  startedAt: number
}

interface DebugRecord {
  id: string
  startedAt?: number | null
  completedAt?: number
  actualSeconds?: number
  actualMinutes?: number | null
  ownerKey?: string
}

export const beginRecordTrace = (ids: string[]) => {
  wx.setStorageSync(TRACE_KEY, { ids, startedAt: Date.now() })
}

export const debugRecords = (stage: string, records: DebugRecord[], extra: Record<string, unknown> = {}) => {
  const trace = wx.getStorageSync(TRACE_KEY) as RecordTrace | ''
  if (!trace || !Array.isArray(trace.ids) || Date.now() - trace.startedAt > TRACE_MAX_AGE_MS) return
  const matches = records.filter((record) => trace.ids.includes(record.id))
  console.log('[record-debug]', JSON.stringify({
    stage,
    elapsedMs: Date.now() - trace.startedAt,
    traceIds: trace.ids,
    count: records.length,
    found: matches.map((record) => ({
      id: record.id,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      actualSeconds: record.actualSeconds,
      actualMinutes: record.actualMinutes,
      ownerKey: record.ownerKey,
    })),
    missing: trace.ids.filter((id) => !matches.some((record) => record.id === id)),
    ...extra,
  }))
}
