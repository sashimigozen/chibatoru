# Card Selection Overflow Fix — 2026-11-22

final result: passed

- Reproduced the user's screenshot with the actual Dropped Cards test and 45 deck candidates. At 1440 × 900, the 1120px dialog had a 6969px implicit grid track; its confirm button was at x=3489. The card rail itself had no overflow because its viewport had expanded to the full contents.
- Cause: the new source/choices wrapper had its default automatic minimum width. Bound the parent track with `minmax(0, 1fr)` and the wrapper with `min-width: 0`. Ordinary card candidates align to the start, while the two-column effect-mode layout remains scoped to modes.
- The candidate rail retains native horizontal/touch scrolling and additionally maps a mouse wheel to horizontal movement. Mode rows retain their vertical scrolling. Short landscape windows keep the heading, instructions and confirmation within the viewport.
- Before: `/tmp/chibatoru-deck-selection-before.png` (1440 × 900). After: `/tmp/chibatoru-deck-selection-1440.png`, `/tmp/chibatoru-deck-selection-390.png`, and `/tmp/chibatoru-deck-selection-landscape-after.png`. Viewed desktop, portrait and landscape captures; cards and existing colors are preserved.
- 25 focused cases pass, covering 45-card lists at 1440 × 900, 1330 × 834, 390 × 844 and 844 × 390; real wheel input; first/last card selection and confirmation; Sage Legacy's hand-to-deck transition; mode-to-deck transition; board peek; existing mode UI; fusion and board-target feedback.
- 1 real-WebSocket case also passes: both host and guest select from 60 candidates, confirm, and synchronize the two removed deck cards and used item. All 26 focused cases pass. No card definitions, effect resolution or communication format were changed.

---

# Effect Mode Selection QA — 2026-11-21

final result: passed

## Reference and implementation

- Reference: user-provided `ScreenRecording_11-20-2026 23-18-15_1.mp4`, 1108 × 512, 30 fps. Reviewed the whole scene, then the 6.4–10.0 s entrance/choice/exit frame sequence. Mode-selection still: `/tmp/chibatoru-mode-reference/mode-reference.png`.
- Combined full-view comparison: `/tmp/chibatoru-mode-reference/comparison.png`. Both views use 1108 × 512 pixels, DPR 1; no scaling or cropping. The reference and implementation were inspected together.
- Multi-choice captures: `/tmp/chibatoru-mode-reference/multiple-desktop.png` (1440 × 900) and `multiple-mobile.png` (390 × 844), DPR 1. Original UI: `/tmp/chibatoru-mode-reference/chibatoru-before.png`.
- Fidelity: translucent dimmed board; one actual source card at left; compact top instruction; stacked navy effect buttons at right. Chibatoru's card faces, typography and colors are retained. No reference game artwork is shipped.
- Motion: source card enters from center toward left over 360 ms; rows fade/slide in with short stagger; chosen row flashes for 200 ms before resolution. System reduced-motion preference removes these animations and delay.
- Adaptation: multi-effect cards retain selection/deselection, selected glow, count and final confirmation. One-effect cards resolve directly from the row. The existing board-peek control remains available, preserving the selection on return.

## Verification and findings

- 8 new UI cases pass: actual card-test actions, single resolution exactly once, two choices and deselection, keyboard focus retention, board peek, both viewport bounds, reduced motion, cancellation when changing battles, and transition to ordinary card selection after a mode.
- 32 existing point-card, fusion-selection and target-feedback cases pass. AI chooses through the existing automatic path; board targets and physical card/material choices retain their current controls.
- 3 real WebSocket cases pass. Host and guest use actual new buttons; source-card delivery, choice replies and final card effects synchronize. The watcher path does not display the actor's selection overlay.
- 3 additional lecturer/attendance cases pass, including the new single-tap smartphone flow. The two old lecturer tests were updated to wait for the existing initial presentation and use the new controls. Wider checks also found an unrelated old synchronous setup failure in `item-usage-rules`; it reproduces on unmodified HEAD `a41601c`. No game-effect changes were made to accommodate legacy tests.
- Initial new test incorrectly expected the first King Ghidorah mode and Environment Setup to open another card choice. Corrected the test to use Ghidorah mode 2 (discard choice) and assert the existing environment draw outcome. All 8 focused cases then passed.
- No outstanding visual P0/P1/P2 findings. Portrait mode permits vertical scrolling for unusually long choices, with no horizontal overflow. Tested four-effect Pinige choices fit within the visible viewport.
- Card definitions, displayed rules, ability values and resolution order are unchanged. Mode option descriptions for Pinige and Gecko show the existing full effects instead of short pseudo-card summaries.

---

# Wonton Animation QA

final result: passed

## Latest Follow-Up: One-Second Cover And No Footer

- Request: shorten the cover to one second and remove the count/+1 text below
  the book. Page calligraphy, book sizing and game rules are unchanged.
- Same-state mobile comparison: `/tmp/wonton-footer-removal-comparison.png`,
  390 x 844 per view, DPR 1. Left is the prior published scene; right is the new
  page-count scene. No rescaling or density normalization was needed.
- New desktop/mobile captures: `/tmp/chibatoru-wonton-1s-tests/`, including
  `kanji-count-1440.png`, `kanji-count-390.png` and both `cover` captures.
- Typography, paper/cover images, colors and book geometry are preserved. The
  requested footer is absent in normal and graduation scenes. The underlying
  board is no longer obscured by that text. Accessible count descriptions remain.
- Cover timeline: 1000ms total, fade-in 0-80ms, fade-out 920-1000ms. No count
  increase or game-effect change is introduced by this timing adjustment.
- All 16 focused Playwright cases pass. Tests measure the cover lifetime on
  desktop/mobile, intercept canvas text drawing to assert the footer is absent,
  and retain page-pixel, graduation, skip, reduced-motion and online checks.
- No P0/P1/P2 visual findings; no repair iteration needed.

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
