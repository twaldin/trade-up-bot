#!/bin/bash
# extract-tiktok-clip.sh — Extract a clip and format for TikTok/Shorts/Reels
# Usage: ./content/extract-tiktok-clip.sh <raw-video.mp4> <start-time> <duration> <output-name>
#
# For standalone TikTok recordings (already vertical or to be reformatted):
#   ./content/extract-tiktok-clip.sh recording.mp4 00:00:00 45 myth-bust-trap
#
# For clips pulled from YouTube raw footage (horizontal → vertical with bars):
#   ./content/extract-tiktok-clip.sh youtube-raw.mp4 00:07:00 40 theory-vs-reality

set -euo pipefail

RAW="$1"
START="$2"
DURATION="$3"
OUTPUT="$4"

mkdir -p content/edited/{tiktok,shorts,reels}

# Step 1: Extract clip
TEMP="content/edited/tiktok/temp-${OUTPUT}.mp4"
ffmpeg -y -i "$RAW" -ss "$START" -t "$DURATION" -c copy "$TEMP" 2>/dev/null

# Step 2: Convert to vertical (1080x1920)
# For horizontal source: adds dark bars top/bottom to fit 9:16
# For vertical source: scales to fit
FINAL="content/edited/tiktok/${OUTPUT}.mp4"
ffmpeg -y -i "$TEMP" \
    -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x1a1a2e" \
    -c:a copy "$FINAL" 2>/dev/null

# Step 3: Copy to Shorts and Reels (same format)
cp "$FINAL" "content/edited/shorts/${OUTPUT}.mp4"
cp "$FINAL" "content/edited/reels/${OUTPUT}.mp4"

# Cleanup
rm -f "$TEMP"

echo "Clip saved to:"
echo "  tiktok:  content/edited/tiktok/${OUTPUT}.mp4"
echo "  shorts:  content/edited/shorts/${OUTPUT}.mp4"
echo "  reels:   content/edited/reels/${OUTPUT}.mp4"
