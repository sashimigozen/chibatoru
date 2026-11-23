# Scout Student Attendance Condition — 2026-11-23

- Added printed Cheerful to Scout Student. On attendance only, an empty opposing classroom grants Super Cheerful through the common keyword-grant path. Removed the former continuously recalculated condition and its obsolete status explanation. The granted keyword persists when the opponent attends; clearing the opposing classroom later does not promote an already-attended Scout. Attendance from hand, generated cards, copies and trash uses the same entry-time check; movement does not retrigger it.
- Kept cost 2, attack 2, HP 1, seat-only placement and expansion category. AI attendance evaluation now predicts the empty-classroom condition while respecting effect suppression. Compared the low-HP immediate attacker with General Student (2/2 without Cheerful), Aggro Princess (unconditional face access with self-damage) and Zombie (transformation effect); these retain different roles. No repeat-attack or resource loop was introduced in the checked paths; this is not a full environment win-rate study.
- Updated canonical rules, card ledger, full before/after notice and card-test setup. The test supplies two Scouts and one opposing General Student: trade the first Scout immediately, then attend the second and deal 2 to the opposing player. Reviewed `/tmp/chibatoru-scout-attendance-final/` screenshot.
- Six focused cases pass: actual card-test sequence, refusal of premature face attack, normal attack and single-use attack rights, exact displayed text, both owners' entry-time persistence/no late promotion, generated/copy/trash attendance, and online guest snapshots. The movement case also passes after switching to the actual movement API.
- Two broader text-format assertions still expect an old Double Diamond fusion heading. Confirmed that heading is already absent in the unchanged HEAD runtime; left that unrelated behavior and its assertions alone. The Scout-specific display assertion and focused behavior checks pass.

---

# Batched Multi-Type Search — 2026-11-22

- Efficient Experiment Method now searches student, teacher and item as one batch; Dry Meal Ticket likewise searches its two named cards together. Each uses one draw presentation and exactly one final deck shuffle. Separate numbered effects and intervening actions retain their current order. Recorded this policy in AGENTS.md and the rule ledger.
- Existing selection restrictions, per-type counts, random selection, hand limits, overflow, draw locks, card stats and text are unchanged. The grouped draw only includes cards actually added to the hand, so overflow cannot animate unrelated cards already held.
- Own searched cards appear together at viewport center using the existing draw and card-face presentation; opponent and spectator views retain backs. Reviewed actual Efficient Experiment card-test screenshots at 1440 × 900 and 390 × 844 in `/tmp/chibatoru-multi-search-regression/`.
- Six new focused cases pass: actual card-test action and centered previews at both sizes, both owners for Dry Meal Ticket, missing candidates/zero matches/overflow/draw lock, and guest/spectator repeated snapshots without duplicate flights or revealed faces. All 47 relevant cases pass across the regression run (46) and isolated recheck (1); the rechecked existing mobile generation case had sampled an already-finished animation while running concurrently. Existing return → shuffle → draw, ten-card generation, ordinary draws, cancellation and reduced-motion behavior remain covered.

---

# Centered Generated-Card Presentation — 2026-11-22

- Changed generated deck-card previews from the owner's pile vicinity to the center of the viewport, matching the existing card-use overlay's centered presentation. Incomplete final rows are individually centered as well.
- Kept every card visible, including ten identical cards, and retained face-to-back insertion followed by shuffle and then draw. Owner, online role, motion cancellation and game effects do not change.
- All 10 focused checks pass: 1/3/10 cards at desktop and mobile sizes, both owners for the three-card case, each row's horizontal center, the full group's vertical center, viewport bounds, online repeated snapshots and insertion → shuffle → draw order. Viewed the 1440 × 900 and 390 × 844 ten-card screenshots under `/tmp/chibatoru-centered-generation/`.

---

# Reference Shuffle Motion and Full Generation Count — 2026-11-22

- Reviewed both user videos in full through extracted frame sequences: `shuffle_normal_compatible.mp4` (480 × 1038, 30 fps, 1.27 s) and `shuffle_slow_compatible.mp4` (480 × 854, 30 fps, 1.63 s). Examined the slow clip's pile every 0.1 s. References: `/tmp/chibatoru-shuffle-reference/normal-sheet.jpg`, `slow-sheet.jpg`, `shuffle-detail.jpg`.
- Replaced the sideways, rotating fan with two upright vertical packet lifts and restacks (900 ms). A small initial lift and final settle follow the reference, with vertical travel limited near the upper viewport edge.
- Every generated card now has its own face and insertion flight: 3 means 3, 10 means 10. No identical-card grouping or generation count badge remains. Preview rows adapt to the viewport so ten faces remain on screen; the cards turn to backs and enter in a short stagger. Shuffle waits for the final card, and a subsequent draw waits for shuffle.
- Kept current card faces, card effects, card counts, randomness, queue/cancellation and online event sharing. Only motion, presentation layout and asset cache keys changed. Recorded the no-grouping requirement in AGENTS.md for future work.
- 21 focused cases pass across the full-count and final motion runs. They cover 3/10 individual faces, viewport bounds, staggered face-to-back insertion, both vertical packet cuts, waiting for every insertion, subsequent draws, both owners, cancellation, reduced motion, repeated online snapshots and actual Lecturer generation. The four new motion cases pass at desktop and mobile sizes.
- Visual review: `/tmp/chibatoru-shuffle-reference/implementation-motion.jpg` is an extracted timeline of the implementation recording; `/tmp/chibatoru-packet-demo/` contains the clip. Inspected 3-card preview, turn/insertion and both packet cuts, plus the ten-card mobile grid under `/tmp/chibatoru-full-count-shuffle-tests/`.

---

# Deck Shuffle and Transfers — 2026-11-22

final result: passed

- Centralized deck insertions: mulligan, hand redraw, hand trimming, board/trash recovery, Confucius, Folder Galaxy, Endless Talker, and generated deck cards now share transfer → shuffle presentation. Explicit top/bottom placements preserve their position; ordinary draws and top-card milling preserve the remaining order.
- Added omitted shuffles to Amphisbaena Sofa's deck selection, Illegal Cafeteria's selected deck-card adjustment, and Information Tired Student's deck/hand search. Existing return/reset/submission behavior is retained; card stats and text are unchanged. The rule ledger and AGENTS.md record the common policy for future cards.
- Generated faces use the existing card renderer and a count badge for duplicate cards. Preview, insertion and shuffle play in order; all returning private cards use backs. Per-side queues keep both players independent and serialize subsequent draws. Public event history is bounded to 100 entries and excluded from private replay checkpoints; return events contain no card faces or screen rectangles.
- Inspected desktop (1440 × 900) and mobile (390 × 844) generated-card screenshots under `/tmp/chibatoru-deck-shuffle-visual-final/`. Previews stay within the viewport and use stable layout scaling while travelling. Existing board/card styles are retained.
- 17 new focused cases cover preserved top/bottom order, actual shuffled permutations, both sides' return → shuffle → draw order, batched generation, immediate draws of generated cards, actual Cornering Lecturer attendance, mulligan timing, hidden information, reduced motion, skip, leaving/reset/resize cancellation, and guest/spectator snapshots. Repeated snapshots during playback do not cancel or replay the effect.
- Existing relevant suites pass: 9 Sofa cases, 9 deck-to-trash cases, 3 mulligan cases, 18 draw cases, 7 deck-choice cases, 2 Sofa and 2 Endless Talker real-WebSocket cases, 5 Lecturer/Yohabari effect cases, and 5 renderer/timing Node cases. One additional real-WebSocket case runs eight host/guest Thin-item scenarios and verifies private-backed returns, shuffle and final synchronization (47.6 s).
- Updated stale test assumptions: Sofa now shuffles rather than preserves deck order; TRPG searches for its current two students; direct actions are tested separately from the UI's existing action reservation; room-code entry is expanded before typing. No game rules were changed to satisfy those tests.
- Wider legacy checks found two unrelated test setup issues: `versioning.test.cjs` searches for a removed `LATEST_UPDATE_VERSION` marker (also absent in unmodified HEAD a355df5), and the old Yohabari catalog-entry case starts inside an active card test but tries to click hidden home navigation. The five relevant Yohabari/Lecturer effect tests and the new actual Lecturer card-test case pass. Those unrelated files were not modified.

---

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
