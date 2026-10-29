# Wonton Book Effects

These bitmap assets are the user-approved animation storyboard artwork, generated
with the built-in ImageGen tool and exported at game-sized resolution.

- `series-cover.jpg`: powerful brush title "万豚記シリーズ" and a sumi-ink pig.
- `old-paper.jpg`: lightly aged washi, fibers and faint vertical ink traces.
- `ending-brush.png`: transparent calligraphy atlas, "完" on the left and "卒業"
  on the right. Keep the original alpha and equal-width cells.
- `count-brush.png`: transparent 4 x 4 brush-numeral atlas. Row-major order is
  `零一二三 / 四五六七 / 八九十百 / 千万億兆`. Generated with built-in ImageGen
  using the prompt: one correctly ordered numeral per equal square cell, bold
  sumi brushwork and dry-brush edges, transparent margins, no extra marks.
  Exported to 800 x 800 pixels without changing the cell layout.

The animation is presentation-only. Count changes, damage and reset belong to
`resolveWontonSubmission` in `index.html`.
