#!/bin/bash
TARGET_DIR="$1"
TARGET_NAME="$2"
LOG_FILE="$3"
PROMPT="$4"

cd "$TARGET_DIR" || exit 1

echo "=========================================="
echo "🚀 [Vibe Maker] agy 코딩 시작: $TARGET_NAME"
echo "📂 경로: $TARGET_DIR"
echo "💬 명령: $PROMPT"
echo "=========================================="

/home/kw/.local/bin/agy --dangerously-skip-permissions -p "$PROMPT"
EXIT_CODE=$?

echo ""
echo "=========================================="
echo "📦 [Git & 등록 자동화 진행]"
echo "=========================================="

(
  git init 2>/dev/null || true
  git add -A
  git commit -m "Auto update via agy: $PROMPT" 2>/dev/null || true
  (gh repo create "kyungwonchai/$TARGET_NAME" --public --source=. --remote=origin --push 2>/dev/null || git push origin main 2>/dev/null || git push origin master:main 2>/dev/null || true)
)

# Auto registration to kwboard
node /home/kw/kwsoft/vibe-maker/scripts/auto-register.mjs "$TARGET_NAME" 10148 "🚀" "$TARGET_NAME 앱" 2>/dev/null || true

echo ""
echo "=========================================="
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ [Vibe Maker] 작업이 성공적으로 완료되었습니다!"
else
  echo "⚠️ [Vibe Maker] 작업 완료 (코드: $EXIT_CODE)"
fi
echo "=========================================="
