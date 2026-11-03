export type ErrorCode =
  | 'E_COLLECT_FAILED'
  | 'E_NO_SESSIONS'
  | 'E_LLM_UNAVAILABLE'
  | 'E_LLM_BAD_OUTPUT'
  | 'E_NO_WEEKLY_SOURCE'
  | 'E_LOCKED'
  | 'E_WRITE_FAILED'
  | 'E_GIT_FAILED'
  | 'E_BAD_REQUEST'
  | 'E_BAD_DATE'

export class PluginError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'PluginError'
  }
}

export function isPluginError(value: unknown): value is PluginError {
  return value instanceof PluginError
}
