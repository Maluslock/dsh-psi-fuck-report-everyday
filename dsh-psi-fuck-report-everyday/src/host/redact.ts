/**
 * 出站文本脱敏。
 *
 * 只作用于「将要离开本机」的文本（发给模型、写周报），本地原始数据保持原样，
 * 便于排查与追溯。规则顺序固定：先抹掉形态明确的凭证，再处理键值对与 URL
 * 内嵌凭证；生成的占位符（`sk-***` 等）不会再命中任何规则，因此可重复调用。
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // OpenAI / Anthropic 风格的 sk- 密钥
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  // GitHub personal access token
  [/ghp_[A-Za-z0-9]{20,}/g, 'ghp_***'],
  // AWS access key id
  [/AKIA[0-9A-Z]{16}/g, 'AKIA***'],
  // Slack bot / user / app / refresh token
  [/xox[baprs]-[A-Za-z0-9-]+/g, 'xox***'],
  // 键值对：保留键名与分隔符，只替换值（分隔符含全角冒号/等号）
  [/((?:password|passwd|pwd|token|secret|api[_-]?key|密码|密钥|口令)\s*[:=：＝]\s*)\S+/gi, '$1***'],
  // URL 内嵌凭证：保留协议、主机与路径
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@'],
]

export function redact(text: string): string {
  let out = text
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement)
  }
  return out
}
