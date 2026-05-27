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

export interface AiPlanResponse {
  intent: 'create_plans'
  sourceText: string
  plans: AiPlanDraft[]
  warnings: string[]
}

const DEEPSEEK_API_KEY = 'sk-a28f48c46f1f4f1db22cb7faba5ebdfc'
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'

const systemPrompt = `你是一个计划表 JSON 解析器。
你只能返回严格 JSON，不允许 Markdown，不允许解释文字，不允许额外字段。
第一版能力边界：只把用户口述整理成计划表草稿，不写入已完成表，不开始计时。

返回格式：
{
  "intent": "create_plans",
  "sourceText": "用户原文",
  "plans": [
    {
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
    }
  ],
  "warnings": []
}

规则：
1. completionMode 第一版固定为 "manual"。
2. 模糊时间不能硬猜成具体时间，例如“晚上”要放到 timeText，startTime/endTime 返回 null。
3. 如果用户说“9 点到 11 点”，startTime/endTime 分别返回 "09:00" 和 "11:00"。
4. 如果用户说“今天/明天/后天”等相对日期，要根据用户消息中提供的当前日期换算成 YYYY-MM-DD。
5. defaultTag 必须从用户消息提供的“当前可用标签”里选择；如果没有合适标签，固定返回 "其它"。
6. title 必须与 defaultTag 相同，不要额外生成一个计划标题。
7. remark 必须基于用户原文精简整理，不能原样复述整句；把除标签、日期、时间以外的计划内容都放到 remark，控制在 30 个汉字以内。没有额外信息就返回 null。
8. 如果日期仍不确定，date 返回 null。
9. 可以把一句话拆成多条 plans。`

const refineSystemPrompt = `${systemPrompt}

10. 这是“继续调整”场景：你会收到最初口述、当前草稿 JSON、用户最新补充。
11. 请综合三者输出完整修订后的 plans 数组，可以新增、删除或修改条目。
12. 当前草稿里已经手动改过的内容，除非用户补充里明确要求更改，否则应尽量保留。
13. sourceText 返回“最初口述 + 最新补充”的合并摘要。`

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

const validateAiPlanResponse = (value: unknown): value is AiPlanResponse => {
  const response = value as AiPlanResponse

  return (
    response &&
    response.intent === 'create_plans' &&
    typeof response.sourceText === 'string' &&
    Array.isArray(response.plans) &&
    Array.isArray(response.warnings)
  )
}

export const parsePlanTextWithDeepSeek = (sourceText: string, today?: string, availableTags: string[] = []): Promise<AiPlanResponse> => {
  if (!DEEPSEEK_API_KEY) {
    return Promise.reject(new Error('DeepSeek API Key 未配置'))
  }

  return requestAiPlanResponse(DEEPSEEK_API_KEY, systemPrompt, [
    today ? `当前日期：${today}` : '',
    availableTags.length ? `当前可用标签：${availableTags.join('、')}` : '',
    `用户原文：${sourceText}`,
  ].filter(Boolean).join('\n'))
}

export const refinePlanDraftsWithDeepSeek = (
  originalSourceText: string,
  currentDrafts: AiDraftRefineSnapshot[],
  supplementText: string,
  today?: string,
  availableTags: string[] = [],
): Promise<AiPlanResponse> => {
  if (!DEEPSEEK_API_KEY) {
    return Promise.reject(new Error('DeepSeek API Key 未配置'))
  }

  return requestAiPlanResponse(DEEPSEEK_API_KEY, refineSystemPrompt, [
    today ? `当前日期：${today}` : '',
    availableTags.length ? `当前可用标签：${availableTags.join('、')}` : '',
    `最初口述：${originalSourceText}`,
    `当前草稿：${JSON.stringify(currentDrafts, null, 2)}`,
    `用户最新补充：${supplementText}`,
  ].filter(Boolean).join('\n'))
}

const requestAiPlanResponse = (apiKey: string, system: string, userContent: string): Promise<AiPlanResponse> => {
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

          resolve(parsed)
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
