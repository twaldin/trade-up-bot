#!/bin/bash
# edit-youtube.sh — YouTube video editing workflow
# Usage: ./content/edit-youtube.sh <raw-video.mp4> <output-name>
#
# This is a template — adjust timestamps per video before running.
# Tim marks good/bad sections after recording, Claude fills in timestamps.

set -euo pipefail

RAW="$1"
OUTPUT="$2"
EDITED_DIR="content/edited/youtube"

mkdir -p "$EDITED_DIR"

# ============================================================
# STEP 1: Define segments to keep (adjust timestamps per video)
# ============================================================
# Format: start_time end_time
# Example segments for a ~20 min raw recording → 10-12 min final:
SEGMENTS=(
    # "00:00:05 00:02:30"   # Hook + setup
    # "00:03:00 00:07:45"   # Sourcing attempt
    # "00:08:30 00:12:00"   # Math comparison
    # "00:13:00 00:15:30"   # Why this happens + TradeUpBot tour
    # "00:16:00 00:16:30"   # CTA
)

if [ ${#SEGMENTS[@]} -eq 0 ]; then
    echo "ERROR: No segments defined. Edit this script to set timestamps."
    echo "After Tim records, fill in the SEGMENTS array above."
    exit 1
fi

# ============================================================
# STEP 2: Extract each segment
# ============================================================
CONCAT_FILE=$(mktemp)
SEG_NUM=0

for seg in "${SEGMENTS[@]}"; do
    read -r START END <<< "$seg"
    SEG_FILE="${EDITED_DIR}/seg${SEG_NUM}.mp4"
    ffmpeg -y -i "$RAW" -ss "$START" -to "$END" -c copy "$SEG_FILE" 2>/dev/null
    echo "file '$(realpath "$SEG_FILE")'" >> "$CONCAT_FILE"
    SEG_NUM=$((SEG_NUM + 1))
done

# ============================================================
# STEP 3: Concatenate segments
# ============================================================
JOINED="${EDITED_DIR}/${OUTPUT}-joined.mp4"
ffmpeg -y -f concat -safe 0 -i "$CONCAT_FILE" -c copy "$JOINED" 2>/dev/null

# ============================================================
# STEP 4: Scale to 1920x1080 (if not already)
# ============================================================
SCALED="${EDITED_DIR}/${OUTPUT}-scaled.mp4"
ffmpeg -y -i "$JOINED" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x1a1a2e" \
    -c:a copy "$SCALED" 2>/dev/null

# ============================================================
# STEP 5: Add text overlays (uncomment and adjust per video)
# ============================================================
# Example: show "65% ROI → -12% Loss" from 7:00-7:15
# FINAL="${EDITED_DIR}/${OUTPUT}.mp4"
# ffmpeg -y -i "$SCALED" \
#     -vf "drawtext=text='65%% ROI → -12%% Loss':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=50:enable='between(t,420,435)'" \
#     -c:a copy "$FINAL" 2>/dev/null

# For now, scaled version is the final
FINAL="$SCALED"
mv "$FINAL" "${EDITED_DIR}/${OUTPUT}.mp4"

# Cleanup
rm -f "$CONCAT_FILE" "${EDITED_DIR}"/seg*.mp4 "$JOINED"
[ -f "$SCALED" ] && rm -f "$SCALED"

echo "Final video: ${EDITED_DIR}/${OUTPUT}.mp4"
