#!/usr/bin/env bash
# Screenpipe 集成验证脚本
# 前提：screenpipe 已在运行（npx screenpipe@latest record）
# 并且终端有屏幕录制权限

set -euo pipefail

SCREENPIPE_URL="http://localhost:3030"

echo "🦦 Ottie Screenpipe 集成测试"
echo "==========================="

# 1. Health check
echo ""
echo "1. Health check..."
if curl -sf --max-time 5 "$SCREENPIPE_URL/health" > /dev/null 2>&1; then
  echo "   ✅ Screenpipe API 可达"
else
  echo "   ❌ Screenpipe API 不可达"
  echo "   请先运行: npx screenpipe@latest record"
  echo "   并确保终端有屏幕录制权限"
  exit 1
fi

# 2. Search OCR content
echo ""
echo "2. 搜索屏幕 OCR 内容..."
SEARCH=$(curl -s --max-time 10 "$SCREENPIPE_URL/search?content_type=ocr&limit=5")
COUNT=$(echo "$SEARCH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [ "$COUNT" -gt "0" ]; then
  echo "   ✅ 找到 $COUNT 条屏幕内容"
  echo "$SEARCH" | python3 -c "
import sys,json
data = json.load(sys.stdin).get('data',[])
for r in data[:3]:
    c = r.get('content',{})
    print(f'   [{c.get(\"app_name\",\"?\")}] {c.get(\"text\",\"\")[:60]}')
" 2>/dev/null
else
  echo "   ⚠️  没有 OCR 数据（可能刚启动，需要等几秒）"
fi

# 3. Search UI elements
echo ""
echo "3. 搜索 UI 元素..."
ELEMENTS=$(curl -s --max-time 10 "$SCREENPIPE_URL/elements?q=button&limit=3" 2>/dev/null)
ECOUNT=$(echo "$ELEMENTS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [ "$ECOUNT" -gt "0" ]; then
  echo "   ✅ 找到 $ECOUNT 个 UI 元素"
else
  echo "   ⚠️  没有 UI 元素数据"
fi

# 4. Test pattern matching (our OttieScreen patterns)
echo ""
echo "4. 模拟 OttieScreen pattern 匹配..."
# Search for common patterns that our gui-detect/cli-watch would catch
for pattern in "Allow" "Y/n" "Password" "error"; do
  MATCH=$(curl -s --max-time 5 "$SCREENPIPE_URL/search?q=$pattern&content_type=ocr&limit=1" 2>/dev/null)
  MCOUNT=$(echo "$MATCH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
  if [ "$MCOUNT" -gt "0" ]; then
    echo "   📍 检测到 '$pattern' 模式"
  else
    echo "   - '$pattern' 未检测到（正常，除非屏幕上有）"
  fi
done

echo ""
echo "==========================="
echo "测试完成。如果有 ✅，说明 Screenpipe 集成路径是通的。"
echo "OttieScreen 会自动轮询这些 API 并匹配 patterns.ts 中的规则。"
