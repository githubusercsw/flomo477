#!/usr/bin/env bash
# gitee-backup.mjs 的等价 shell 版（本机无 Node 时用这个）
# 用法: bash tools/gitee-curl.sh
set -euo pipefail

TOKEN="${GITEE_TOKEN:?需要设置 GITEE_TOKEN 环境变量}"
REPO="${1:-flomo477}"
FILE="${2:-flomo-extension-P1.zip}"
TAG="${3:-v0.1.0}"
API="https://gitee.com/api/v5"

echo "▶ 1 测试连通性"
ME=$(curl -s "${API}/user?access_token=${TOKEN}")
echo "$ME" | head -c 300; echo
OWNER=$(echo "$ME" | grep -o '"login":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$OWNER" ]; then echo "❌ 认证失败"; exit 1; fi
echo "✅ 用户: $OWNER"

echo "▶ 2 创建仓库"
curl -s -X POST --header 'Content-Type: application/json;charset=UTF-8' \
  "${API}/user/repos?access_token=${TOKEN}" \
  -d "{\"name\":\"${REPO}\",\"description\":\"flomo 浏览器扩展 P1 备份\",\"private\":true,\"auto_init\":true}" \
  | head -c 300; echo

echo "▶ 3 等待初始化"
for i in $(seq 1 20); do
  N=$(curl -s "${API}/repos/${OWNER}/${REPO}/commits?access_token=${TOKEN}" | grep -c '"sha"' || true)
  if [ "$N" -gt 0 ]; then echo "✅ 就绪，提交数 $N"; break; fi
  echo "   ...第 $i 次"; sleep 2
done

echo "▶ 4 创建 Release"
REL=$(curl -s -X POST --header 'Content-Type: application/json;charset=UTF-8' \
  "${API}/repos/${OWNER}/${REPO}/releases?access_token=${TOKEN}" \
  -d "{\"tag_name\":\"${TAG}\",\"name\":\"${REPO} ${TAG}\",\"body\":\"flomo 浏览器扩展 P1 备份\",\"target_commitish\":\"master\"}")
echo "$REL" | head -c 300; echo
RID=$(echo "$REL" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
if [ -z "$RID" ]; then echo "❌ 创建 Release 失败"; exit 1; fi
echo "✅ release_id=$RID"

echo "▶ 5 上传附件"
curl -s -X POST "${API}/repos/${OWNER}/${REPO}/releases/${RID}/attach_files" \
  -F "access_token=${TOKEN}" -F "file=@${FILE}" | head -c 300; echo

echo "✅ 完成: https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}"
