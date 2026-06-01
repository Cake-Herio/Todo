export interface AiPlanDraft {
  title: string
  section: string
  defaultTag: string
  remark: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  timeText: string | null
  estimatedMinutes: number | null
  completionMode: 'manual'
  certainty: {
    date: 'certain' | 'vague' | 'unknown'
    time: 'certain' | 'vague' | 'unknown'
  }
}

export interface AiPlanContextItem {
  id: string
  date: string | null
  tag: string
  tagId?: string
  ownerKey: 'me' | 'partner'
  startTime: string | null
  endTime: string | null
  timeText: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  remark: string | null
}

export interface AiDeleteSpec {
  scope: 'by_ids' | 'date_all' | 'date_tag'
  planIds: string[]
  date: string | null
  tag: string | null
  ownerKey: 'me' | 'partner' | 'all' | null
}

export interface AiPlanUpdateItem {
  planId: string
  patch: Partial<Pick<AiPlanDraft, 'defaultTag' | 'remark' | 'date' | 'startTime' | 'endTime' | 'timeText'>>
}

export interface AiReuseItem {
  sourcePlanId: string
  targetDate: string
  patch: Partial<Pick<AiPlanDraft, 'defaultTag' | 'remark' | 'startTime' | 'endTime' | 'timeText'>>
}

export type AiPlanErrorCode = 'INVALID_TIME_RANGE' | 'TIME_OVERLAP' | 'PARSE_UNCERTAIN'

export interface AiPlanError {
  code: AiPlanErrorCode
  message: string
  target?: string
}

export interface AiPlanBatchResponse {
  intent: 'batch_plans'
  sourceText: string
  creates: AiPlanDraft[]
  reuses: AiReuseItem[]
  reusePlans: AiPlanDraft[]
  delete: AiDeleteSpec | null
  updates: AiPlanUpdateItem[]
  warnings: string[]
  errors: AiPlanError[]
}

export type AiPlanResponse =
  | AiPlanBatchResponse
  | {
      intent: 'create_plans'
      sourceText: string
      plans: AiPlanDraft[]
      warnings: string[]
    }
  | {
      intent: 'update_plans'
      sourceText: string
      updates: AiPlanUpdateItem[]
      warnings: string[]
    }
  | {
      intent: 'delete_plans'
      sourceText: string
      delete: AiDeleteSpec
      warnings: string[]
    }
  | {
      intent: 'reuse_plans'
      sourceText: string
      reuses: AiReuseItem[]
      plans: AiPlanDraft[]
      warnings: string[]
    }

const DEEPSEEK_API_KEY = 'sk-a28f48c46f1f4f1db22cb7faba5ebdfc'
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'

const planDraftSchema = `{
      "title": "与 defaultTag 相同的标签名",
      "section": "学习/工作/运动/生活/其他",
      "defaultTag": "标签",
      "remark": "基于用户原文精简整理的一句话备注，或 null",
      "date": "YYYY-MM-DD 或 null",
      "startTime": "HH:mm 或 null",
      "endTime": "HH:mm 或 null",
      "timeText": "上午/下午/晚上/今天/明天/本周 等模糊时间，或 null",
      "estimatedMinutes": 预计分钟数或 null,
      "completionMode": "manual",
      "certainty": {
        "date": "certain/vague/unknown",
        "time": "certain/vague/unknown"
      }
    }`

const voiceCommandSystemPrompt = `你是一个计划表语音指令 JSON 解析器。
你只能返回严格 JSON，不允许 Markdown，不允许解释文字。
同一句口述可以同时包含新增、删除、修改、复用，请统一返回 batch_plans 格式：

{
  "intent": "batch_plans",
  "sourceText": "用户原文",
  "creates": [${planDraftSchema}],
  "reuses": [
    {
      "sourcePlanId": "必须来自相关日期已有计划的 id",
      "targetDate": "YYYY-MM-DD",
      "patch": { "timeText": "下午", "startTime": null, "endTime": null }
    }
  ],
  "reusePlans": [${planDraftSchema}],
  "delete": {
    "scope": "by_ids | date_all | date_tag",
    "planIds": ["id1"],
    "date": "YYYY-MM-DD 或 null",
    "tag": "标签名或 null",
    "ownerKey": "me | partner | all | null"
  },
  "updates": [
    {
      "planId": "必须来自相关日期已有计划的 id",
      "patch": { "defaultTag": "...", "remark": null, "date": "YYYY-MM-DD", "startTime": null, "endTime": null, "timeText": null }
    }
  ],
  "warnings": [],
  "errors": []
}

示例：「删掉明天跑步，再加一个明天冥想」→ delete 填跑步对应 planId，creates 填冥想计划。
无对应操作时：creates/reuses/reusePlans/updates 用 []，delete 用 null。

通用规则：
1. planId / sourcePlanId 必须来自用户消息里的「相关日期已有计划」，禁止编造。
2. 找不到匹配计划时，对应字段留空，在 warnings 说明原因。
3. 模糊时间放到 timeText，不要硬猜 startTime/endTime。
4. 相对日期要根据当前日期换算成 YYYY-MM-DD。
5. defaultTag 必须从「当前可用标签」选择，否则返回「其它」。
6. title 必须与 defaultTag 相同。
7. remark 精简整理，30 字以内，无额外信息返回 null。
8. completionMode 固定 "manual"。
9. 删除「全部/清空」某天时 delete.scope 用 date_all 并填 date；未提到具体日期则 warnings 追问。
10. 默认 ownerKey 为 me，除非用户明确说伴侣/对方。
11. 复用时 reusePlans 应输出合并 patch 后的完整目标草稿。
12. 时段合法性：若同时给出 startTime 与 endTime，必须 startTime < endTime（00:00 为 24:00）。不满足时该条不进 creates/updates/reusePlans，在 errors 追加 { "code": "INVALID_TIME_RANGE", "message": "「标签名」14:00-13:00 开始时间不能晚于结束时间", "target": "creates[0]" }。
13. 时段重叠：与「相关日期已有计划」或同批其他待生效条目时段重叠的，该条不进 creates/updates/reusePlans，errors 追加 { "code": "TIME_OVERLAP", "message": "「A」09:00-10:00 与「B」09:30-11:00 时段重叠", "target": "creates[0]" }。重叠判定：aStart < bEnd && bStart < aEnd。
14. 无法识别：若用户指令模糊、无法确定具体操作，返回 { "code": "PARSE_UNCERTAIN", "message": "说明原因" }，此时 creates/updates/reuses 必须全部为空数组、delete 为 null。绝对不能「猜一个」放进 creates。
15. 修改 vs 新增：用户说「修改/改/换成/调整」某个已有计划时，必须用 updates（填入该计划的 planId + patch），绝对禁止新增一条 creates。仅当用户明确说「再加/新增/另外」时才用 creates。
16. 若 creates/updates/reuses 全空且 delete 为 null，errors 至少一条说明原因（可复用 warnings）。
17. errors 必须是 JSON 数组，每项含 code/message/target；禁止把错误写进 creates。`

const refineBatchSystemPrompt = `${voiceCommandSystemPrompt}

12. 这是「继续调整」场景：你会收到最初口述、当前待确认变更 JSON（含 creates/deletePlanIds/updates）、用户最新补充。
13. 必须综合三者输出完整修订后的 batch_plans。核心原则：优先修改已有条目，而非盲目新增。
14. 当用户说「改那个」「刚才那个」「把那个换成」等指代性语言时，应在对应条目上做 updates 或修改 creates 中的草稿（调整 date/startTime/endTime/remark 等字段），禁止新增一条。
15. 「当前待确认变更」中的 creates 条目尚未入库（无 planId），若要修改它们，请在 creates 中输出修改后的完整草稿替换原条目，defaultTag 保持一致除非用户明确要改标签。
16. 时间校验（规则 12/13）应同样检查「当前待确认变更」中的 creates 条目，与已有计划或同批条目冲突时必须报 TIME_OVERLAP 错误。
17. sourceText 返回「最初口述 + 最新补充」的合并摘要。`

export interface AiDraftRefineSnapshot {
  ownerKey: 'me' | 'partner'
  tag: string
  remark: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  timeText: string | null
  estimatedMinutes: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const validateAiPlanDraft = (value: unknown): value is AiPlanDraft => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.title === 'string' &&
    typeof value.section === 'string' &&
    typeof value.defaultTag === 'string' &&
    (value.remark === null || typeof value.remark === 'string') &&
    (value.date === null || typeof value.date === 'string') &&
    (value.startTime === null || typeof value.startTime === 'string') &&
    (value.endTime === null || typeof value.endTime === 'string') &&
    (value.timeText === null || typeof value.timeText === 'string') &&
    (value.estimatedMinutes === null || typeof value.estimatedMinutes === 'number') &&
    value.completionMode === 'manual'
  )
}

const validateWarnings = (value: unknown) => isStringArray(value)

const validateDeleteSpec = (value: unknown): value is AiDeleteSpec => {
  if (!isRecord(value)) {
    return false
  }

  return (
    (value.scope === 'by_ids' || value.scope === 'date_all' || value.scope === 'date_tag') &&
    isStringArray(value.planIds) &&
    (value.date === null || typeof value.date === 'string') &&
    (value.tag === null || typeof value.tag === 'string')
  )
}

const validateUpdateItems = (value: unknown) =>
  Array.isArray(value) &&
  value.every((item) => isRecord(item) && typeof item.planId === 'string' && isRecord(item.patch))

const validateReuseItems = (value: unknown) =>
  Array.isArray(value) &&
  value.every((item) => isRecord(item) && typeof item.sourcePlanId === 'string' && typeof item.targetDate === 'string')

export const normalizeAiPlanResponse = (value: AiPlanResponse): AiPlanBatchResponse => {
  const withErrors = (errors: unknown): AiPlanError[] =>
    Array.isArray(errors) ? errors.filter((e) => isRecord(e) && typeof e.code === 'string' && typeof e.message === 'string') as AiPlanError[] : []

  if (value.intent === 'batch_plans') {
    return {
      intent: 'batch_plans',
      sourceText: value.sourceText,
      creates: value.creates || [],
      reuses: value.reuses || [],
      reusePlans: value.reusePlans || [],
      delete: value.delete || null,
      updates: value.updates || [],
      warnings: value.warnings || [],
      errors: withErrors((value as Record<string, unknown>).errors),
    }
  }

  if (value.intent === 'create_plans') {
    return {
      intent: 'batch_plans',
      sourceText: value.sourceText,
      creates: value.plans,
      reuses: [],
      reusePlans: [],
      delete: null,
      updates: [],
      warnings: value.warnings,
      errors: [],
    }
  }

  if (value.intent === 'update_plans') {
    return {
      intent: 'batch_plans',
      sourceText: value.sourceText,
      creates: [],
      reuses: [],
      reusePlans: [],
      delete: null,
      updates: value.updates,
      warnings: value.warnings,
      errors: [],
    }
  }

  if (value.intent === 'delete_plans') {
    return {
      intent: 'batch_plans',
      sourceText: value.sourceText,
      creates: [],
      reuses: [],
      reusePlans: [],
      delete: value.delete,
      updates: [],
      warnings: value.warnings,
      errors: [],
    }
  }

  return {
    intent: 'batch_plans',
    sourceText: value.sourceText,
    creates: [],
    reuses: value.reuses,
    reusePlans: value.plans,
    delete: null,
    updates: [],
    warnings: value.warnings,
    errors: [],
  }
}

export const validateAiPlanResponse = (value: unknown): value is AiPlanResponse => {
  if (!isRecord(value) || typeof value.sourceText !== 'string' || !validateWarnings(value.warnings)) {
    return false
  }

  switch (value.intent) {
    case 'batch_plans':
      return (
        (value.creates === undefined || (Array.isArray(value.creates) && value.creates.every(validateAiPlanDraft))) &&
        (value.reuses === undefined || validateReuseItems(value.reuses)) &&
        (value.reusePlans === undefined || (Array.isArray(value.reusePlans) && value.reusePlans.every(validateAiPlanDraft))) &&
        (value.delete === undefined || value.delete === null || validateDeleteSpec(value.delete)) &&
        (value.updates === undefined || validateUpdateItems(value.updates)) &&
        (value.errors === undefined || Array.isArray(value.errors))
      )
    case 'create_plans':
      return Array.isArray(value.plans) && value.plans.every(validateAiPlanDraft)
    case 'update_plans':
      return validateUpdateItems(value.updates)
    case 'delete_plans':
      return validateDeleteSpec(value.delete)
    case 'reuse_plans':
      return (
        validateReuseItems(value.reuses) &&
        Array.isArray(value.plans) &&
        value.plans.every(validateAiPlanDraft)
      )
    default:
      return false
  }
}

export const parseVoicePlanCommandWithDeepSeek = (
  sourceText: string,
  today?: string,
  availableTags: string[] = [],
  contextItems: AiPlanContextItem[] = [],
): Promise<AiPlanBatchResponse> => {
  if (!DEEPSEEK_API_KEY) {
    return Promise.reject(new Error('DeepSeek API Key 未配置'))
  }

  return requestAiPlanResponse(DEEPSEEK_API_KEY, voiceCommandSystemPrompt, [
    today ? `当前日期：${today}` : '',
    availableTags.length ? `当前可用标签：${availableTags.join('、')}` : '',
    contextItems.length ? `相关日期已有计划：\n${JSON.stringify(contextItems, null, 2)}` : '相关日期已有计划：[]',
    `用户原文：${sourceText}`,
  ].filter(Boolean).join('\n'))
}

export const parsePlanTextWithDeepSeek = (
  sourceText: string,
  today?: string,
  availableTags: string[] = [],
): Promise<AiPlanBatchResponse> => parseVoicePlanCommandWithDeepSeek(sourceText, today, availableTags, [])

export interface AiConfirmRefineSnapshot {
  creates: AiDraftRefineSnapshot[]
  deletePlanIds: string[]
  updates: AiPlanUpdateItem[]
}

export const refineVoiceCommandWithDeepSeek = (
  originalSourceText: string,
  pendingSnapshot: AiConfirmRefineSnapshot,
  supplementText: string,
  today?: string,
  availableTags: string[] = [],
  contextItems: AiPlanContextItem[] = [],
): Promise<AiPlanBatchResponse> => {
  if (!DEEPSEEK_API_KEY) {
    return Promise.reject(new Error('DeepSeek API Key 未配置'))
  }

  return requestAiPlanResponse(DEEPSEEK_API_KEY, refineBatchSystemPrompt, [
    today ? `当前日期：${today}` : '',
    availableTags.length ? `当前可用标签：${availableTags.join('、')}` : '',
    contextItems.length ? `相关日期已有计划：\n${JSON.stringify(contextItems, null, 2)}` : '相关日期已有计划：[]',
    `最初口述：${originalSourceText}`,
    `当前待确认变更：${JSON.stringify(pendingSnapshot, null, 2)}`,
    `用户最新补充：${supplementText}`,
  ].filter(Boolean).join('\n'))
}

export const refinePlanDraftsWithDeepSeek = (
  originalSourceText: string,
  currentDrafts: AiDraftRefineSnapshot[],
  supplementText: string,
  today?: string,
  availableTags: string[] = [],
): Promise<AiPlanBatchResponse> =>
  refineVoiceCommandWithDeepSeek(
    originalSourceText,
    { creates: currentDrafts, deletePlanIds: [], updates: [] },
    supplementText,
    today,
    availableTags,
    [],
  )

const requestAiPlanResponse = (apiKey: string, system: string, userContent: string): Promise<AiPlanBatchResponse> => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: DEEPSEEK_ENDPOINT,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        model: 'deepseek-chat',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      },
      success: (res) => {
        const data = res.data as {
          choices?: Array<{
            message?: {
              content?: string
            }
          }>
          error?: {
            message?: string
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.error?.message || `DeepSeek 请求失败：${res.statusCode}`))
          return
        }

        const content = data.choices?.[0]?.message?.content

        if (!content) {
          reject(new Error('DeepSeek 返回为空'))
          return
        }

        try {
          const parsed = JSON.parse(content) as unknown

          if (!validateAiPlanResponse(parsed)) {
            reject(new Error('DeepSeek JSON 格式不符合计划合同'))
            return
          }

          resolve(normalizeAiPlanResponse(parsed as AiPlanResponse))
        } catch (_error) {
          reject(new Error('DeepSeek 返回不是合法 JSON'))
        }
      },
      fail: (error) => {
        const errMsg = error.errMsg || ''
        const isDomainError = /domain|url|合法|not in|不在/i.test(errMsg)

        if (isDomainError) {
          reject(new Error('DeepSeek 请求域名未配置。预览/真机需在公众平台 request 合法域名添加 https://api.deepseek.com'))
          return
        }

        reject(new Error(`DeepSeek 网络请求失败${errMsg ? `：${errMsg}` : ''}`))
      },
    })
  })
}
