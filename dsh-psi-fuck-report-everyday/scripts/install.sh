#!/usr/bin/env bash
# Install dsh-psi-fuck-report-everyday into a DSH profile as a linked local bundle.
#
# Usage: scripts/install.sh [profile-dir]
# Default profile: ${DSH_PROFILE_DIR:-${DSH_HOME:-$HOME/.dsh}/profiles/web}
# The script backs up package.json and cordis.patch.yml first, links this
# checkout, mounts the plugin through the profile patch, and runs pnpm install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="${1:-${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}}"
PROFILE_DIR="$(cd "$PROFILE_DIR" 2>/dev/null && pwd)" || {
  echo "[install] profile 目录不存在：${1:-${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}}" >&2
  exit 1
}
STAMP="$(date +%Y%m%d-%H%M%S)"

for file in package.json cordis.patch.yml; do
  if [[ ! -f "$PROFILE_DIR/$file" ]]; then
    echo "[install] 缺少 $PROFILE_DIR/$file" >&2
    exit 1
  fi
done
if [[ ! -f "$ROOT/dist/index.js" ]]; then
  echo "[install] 未找到 $ROOT/dist/index.js，请先在插件目录运行 pnpm build" >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[install] 未找到 pnpm" >&2
  exit 1
fi

for file in package.json cordis.patch.yml; do
  cp -p "$PROFILE_DIR/$file" "$PROFILE_DIR/$file.bak-eod-$STAMP"
done
echo "[install] 已备份 package.json / cordis.patch.yml，stamp=$STAMP"

node "$SCRIPT_DIR/patch-profile.mjs" add --profile "$PROFILE_DIR"

echo "[install] 正在 profile 中安装依赖：$PROFILE_DIR"
(cd "$PROFILE_DIR" && pnpm install)

echo "[install] 安装完成，stamp=$STAMP"
echo "[install] 重启 DSH Web 后生效（面板标题：下班日报）"
echo "[install] 回滚：scripts/rollback.sh $STAMP \"$PROFILE_DIR\""
