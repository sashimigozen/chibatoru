# Wonton Animation QA

final result: passed

## Visual Target And Evidence

- Target: the user-approved `wonton-motion-storyboard.html` in the thread's
  visualization directory, with the old-paper and brush-ending revisions.
- Source capture: `/tmp/wonton-paper-book-360.png` (360 x 740, CSS pixels, DPR 1).
- Implementation captures: `/tmp/chibatoru-wonton-animation-final/`, the
  `graduation-1440.png` and `graduation-390.png` test attachments.
- Implementation viewports: 1440 x 900 and 390 x 844, DPR 1.
- State: graduation, count 4, final page before impact (1.10-1.45 seconds).
- Full-view review: opened the source and both game captures. Existing battle
  navigation and the field layout remain unchanged; the book is a temporary,
  pointer-transparent effect over the existing field.
- Focused comparison: `/tmp/wonton-book-comparison.png` contains the source
  book and implementation book together. The 190 x 152 implementation crop was
  normalized to the 158 x 126 source crop without changing its aspect ratio.
  The storyboard's schematic blue border becomes a dark book edge in the game;
  the approved page texture and calligraphy are preserved.

## Required Fidelity Surfaces

- Typography: original brush lettering is retained as bitmap artwork, including
  the title and final glyph. Count labels remain readable system text.
- Layout: the spread remains centered and fits both tested viewports. No new
  controls, permanent panels or changes to the existing battle layout.
- Color: the final glyph uses a restrained vermilion tint; natural paper retains
  its light aged surface and the existing game keeps its own colors.
- Images: all three approved assets are bundled locally, with transparent alpha
  preserved for the brush atlas. No external image dependency or replacement art.
- Copy: normal submissions show +1; graduation references the existing count,
  shows no +1, and resets to 0. Damage uses the existing game damage feedback.

## Interaction And Runtime Checks

- Submitted through the actual card-test setup without replacing its initial
  hand, field or count. Count 4 stays at most 4, then damage is 8 and count is 0.
- Desktop/mobile screenshots and nonblank canvas-pixel checks pass over HTTP.
- Host, guest and spectator snapshot delivery remaps the owner correctly and
  does not replay the same event on another snapshot.
- Skip, reduced motion, unavailable Canvas, and leaving battle resolve safely.
- No page errors in desktop/mobile animation tests.

## Findings And Comparison History

- First visual comparison: no actionable P0/P1/P2 findings. No subsequent visual
  correction was needed. HTTP is used for pixel QA because browsers disallow
  reading pixels from file-origin canvases containing local image files.
- All 50 Wonton submission/animation Playwright cases pass, along with 11 focused
  Node tests. The broader regression run passed 39/42 cases. The opponent-hand
  discard count and TRPG three-card animation failures reproduce on unchanged
  commit `d4f8487`; the remaining draw-position case passes on serialized reruns
  in both baseline and updated builds. No unrelated test or rule was changed.
