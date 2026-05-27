type CloudMutateHandler = () => void

let mutateHandler: CloudMutateHandler | null = null

export const registerCloudMutateHandler = (handler: CloudMutateHandler | null) => {
  mutateHandler = handler
}

export const notifyCloudMutate = () => {
  mutateHandler?.()
}
