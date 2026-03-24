#!/bin/bash
# make-thumbnail.sh — Generate YouTube thumbnail
# Usage: ./content/make-thumbnail.sh <screenshot.png> "TITLE TEXT" "+$125.50" profit|loss
#
# Args:
#   $1 - Path to screenshot image
#   $2 - Title text (max ~6 words)
#   $3 - Profit/loss amount string (e.g., "+$125.50" or "-$42.00")
#   $4 - "profit" or "loss" (determines badge color)

set -euo pipefail

SCREENSHOT="$1"
TITLE="$2"
AMOUNT="$3"
TYPE="${4:-profit}"

OUTPUT_DIR="content/thumbnails"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT="${OUTPUT_DIR}/thumb-${TIMESTAMP}.png"

# Badge color
if [ "$TYPE" = "profit" ]; then
    BADGE_COLOR="#22c55e"
else
    BADGE_COLOR="#ef4444"
fi

# Step 1: Create dark gradient background (1280x720)
convert -size 1280x720 gradient:"#1a1a2e-#0d0d1a" /tmp/thumb-bg.png

# Step 2: Resize screenshot to fit center area (1000x450)
convert "$SCREENSHOT" -resize 1000x450 -gravity center -extent 1000x450 /tmp/thumb-screenshot.png

# Step 3: Composite screenshot onto background
convert /tmp/thumb-bg.png \
    /tmp/thumb-screenshot.png -gravity center -geometry +0+40 -composite \
    /tmp/thumb-composed.png

# Step 4: Add title text (top)
convert /tmp/thumb-composed.png \
    -font Helvetica-Bold -pointsize 64 -fill white \
    -gravity north -annotate +0+30 "$TITLE" \
    /tmp/thumb-titled.png

# Step 5: Add profit/loss badge (bottom-right)
convert -size 200x60 xc:"$BADGE_COLOR" -fill white \
    -font Helvetica-Bold -pointsize 36 -gravity center -annotate +0+0 "$AMOUNT" \
    -background none \( +clone -shadow 60x4+0+0 \) +swap -layers merge +repage \
    /tmp/thumb-badge.png

convert /tmp/thumb-titled.png \
    /tmp/thumb-badge.png -gravity southeast -geometry +30+30 -composite \
    "$OUTPUT"

# Cleanup
rm -f /tmp/thumb-bg.png /tmp/thumb-screenshot.png /tmp/thumb-composed.png /tmp/thumb-titled.png /tmp/thumb-badge.png

echo "Thumbnail saved to: $OUTPUT"
