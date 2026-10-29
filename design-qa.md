# Wonton Animation QA

final result: passed

## Follow-Up: Brush Counts, Cover Hold And Larger Books

- Brief: write the updated count in kanji on the turned page; show the 4-cost
  Wonton environment's cover for a few seconds; enlarge books throughout.
- Before captures: `/tmp/wonton-kanji-before-1440.png` and
  `/tmp/wonton-kanji-before-390.png`.
- After captures: `/tmp/chibatoru-wonton-kanji-tests/`, the `kanji-count-1440.png`,
  `kanji-count-390.png`, `cover-1440.png`, `cover-390.png`, and
  `kanji-21-mobile.png` test attachments.
- Full-view comparison: `/tmp/wonton-kanji-comparison.png` places the before and
  after captures side by side at the same 390 x 844 viewport and DPR 1. The state
  is the first count increment after turning a page. The larger book and the
  page's brush numeral are intentional requested changes, not layout drift.
- Typography/image check: inspected the 16-cell brush atlas on white, confirmed
  all glyphs and their row-major order, then inspected the rendered "一" and
  vertically composed "二十一". Original cover and final-page assets are retained.
- Layout: the book size increases from 180 to 260px on desktop, with width/height
  constraints at 390 and 320px. Page lettering fits within the right page. The
  overlay remains temporary and pointer-transparent; no controls are added.
- Colors and copy: black brush numerals on the existing aged paper; the red final
  glyph is unchanged. Normal counts increment once. The cover has no +1 and does
  not change counts. Graduation still does not increment its count.
- Timing: the count is written after the page turns, held briefly, then returned
  to the counter. Cover fade-in ends at 180ms and fade-out starts at 2200ms,
  leaving just over two seconds for reading at normal playback speed.
- Validation: all 56 submission/animation Playwright cases pass, including
  desktop/mobile pixels, kanji unit boundaries through trillion, cover duration,
  host/guest/spectator cover sharing, snapshot deduplication, and existing
  graduation behavior. No new P0/P1/P2 findings; no visual repair iteration needed.

## Initial Rollout Evidence

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
