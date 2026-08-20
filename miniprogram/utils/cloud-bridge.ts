export interface CloudMutation {
  planIds?: string[]
  completedRecordIds?: string[]
  deletedPlanIds?: string[]
  deletedCompletedRecordIds?: string[]
}

type CloudMutateHandler = (mutation?: CloudMutation) => void

let mutateHandler: CloudMutateHandler | null = null

export const registerCloudMutateHandler = (handler: CloudMutateHandler | null) => {
  mutateHandler = handler
}

export const notifyCloudMutate = (mutation?: CloudMutation) => {
  mutateHandler?.(mutation)
}
