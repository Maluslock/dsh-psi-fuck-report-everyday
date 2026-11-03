#!/usr/bin/env bash
# Roll back an install performed by scripts/install.sh.
#
# Usage: scripts/rollback.sh <stamp> [profile-dir]
# Example: scripts/rollback.sh 20261103-153000
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "Usage: $0 <stamp> [profile-dir]" >&2
  echo "可用的 eod 备份：" >&2
  default_profile="${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}"
  if [[ -d "$default_profile" ]]; then
    find "$default_profile" -maxdepth 1 -name 'package.json.bak-eod-*' -printf '  %f\n' 2>/dev/null | sort -r >&2 || true
  fi
  exit 1
fi

STAMP="$1"
PROFILE_DIR="${2:-${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}}"
PROFILE_DIR="$(cd "$PROFILE_DIR" 2>/dev/null && pwd)" || {
  echo "[rollback] profile 目录不存在：${2:-${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}}" >&2
  exit 1
}

if [[ ! "$STAMP" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
  echo "[rollback] 非法 stamp：$STAMP（期望 YYYYMMDD-HHMMSS）" >&2
  exit 1
fi
for file in package.json cordis.patch.yml; do
  if [[ ! -f "$PROFILE_DIR/$file.bak-eod-$STAMP" ]]; then
    echo "[rollback] 缺少备份 $PROFILE_DIR/$file.bak-eod-$STAMP" >&2
    exit 1
  fi
done
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[rollback] 未找到 pnpm" >&2
  exit 1
fi

for file in package.json cordis.patch.yml; do
  cp -p "$PROFILE_DIR/$file.bak-eod-$STAMP" "$PROFILE_DIR/$file"
  echo "[rollback] 已恢复 $file（stamp=$STAMP）"
done

echo "[rollback] 正在同步 profile 依赖：$PROFILE_DIR"
(cd "$PROFILE_DIR" && pnpm install)

echo "[rollback] 回滚完成，重启 DSH Web 后生效"
