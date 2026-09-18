#!/usr/bin/env bash
#
# Rebuilds the storefront hero clip from its master.
#
# The masters in `media-source/` are big and are kept out of the deploy by
# `.vercelignore`; what ships is whatever this writes into `public/media/`. So
# nothing in `public/media/` is precious — delete any of it and run this.
#
# Two things happen here that are worth knowing about:
#
#   1. The loop is closed. The hero plays on `loop`, and the master runs from a
#      napkin sketch to a finished pot — first frame and last frame could not
#      be less alike, so a plain loop slams. The tail is crossfaded onto the
#      head instead, which costs FADE seconds off the length and turns the seam
#      into the point of the clip: idea, object, idea.
#
#   2. It stays at the master's own resolution. The master is 478 wide; the
#      hero panel is wider than that on a desktop, but upscaling here only
#      spends bytes inventing pixels that the browser would otherwise invent
#      for free. Bitrate at native size is the part that shows.
#
# Requires ffmpeg on PATH. Run from the repo root: bash scripts/encode-hero.sh
set -euo pipefail

SRC=media-source/clip-napkin-portrait.mp4
OUT=public/media/napkin-fold
FADE=0.8

# The master's length, so the crossfade maths does not hard-code it.
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
BODY=$(awk -v d="$DUR" -v f="$FADE" 'BEGIN { printf "%.3f", d - f }')
OFFSET=$(awk -v d="$DUR" -v f="$FADE" 'BEGIN { printf "%.3f", d - 2 * f }')

# body = the master minus its first FADE seconds; head = those first seconds.
# xfade lays head over the end of body, so the clip ends on the frame it opens
# with.
ffmpeg -y -v error -i "$SRC" -filter_complex "
  [0:v]split=2[a][b];
  [a]trim=start=$FADE,setpts=PTS-STARTPTS[body];
  [b]trim=start=0:end=$FADE,setpts=PTS-STARTPTS[head];
  [body][head]xfade=transition=fade:duration=$FADE:offset=$OFFSET,format=yuv420p[v]" \
  -map "[v]" \
  -an \
  -c:v libx264 -preset slow -crf 29 -profile:v high -level 4.0 -g 48 \
  -movflags +faststart \
  "$OUT.mp4"

# The poster is frame zero of the finished clip, not of the master — they are
# FADE seconds apart, and a poster that does not match the first frame shows as
# a jump the moment playback starts.
ffmpeg -y -v error -i "$OUT.mp4" -frames:v 1 -q:v 4 "$OUT.jpg"

ls -l "$OUT.mp4" "$OUT.jpg" | awk '{ printf "%-32s %6.0f KB\n", $NF, $5 / 1024 }'
echo "loop: ${BODY}s (master ${DUR}s, ${FADE}s crossfade seam)"
