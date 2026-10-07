# PC・教室素材の生成記録

2026-10-07。組み込み画像生成を使用。ホーム画像そのものは未変更。
参照画像: `assets/home/home-ui-preview-desk-clean.png`（色・素材・昼光・画風のみ）。
生成画像の透明余白除去とWebP変換を行い、画像内容の描き直しは生成ツールで行った。

## 教室

最終素材: `classroom-laptop-view.webp`
元出力: `/Users/asaishimariku/.codex/generated_images/01a02cce-d497-7f12-a8f4-e74a11a2c6a1/exec-ad655b23-48e6-4527-9919-76f8d5c912b3.png`
透明背景: false

プロンプト:

> Use case: stylized-concept. Asset type: production game environment background, wide 16:9 landscape. Input image 1 is ONLY a STYLE, MATERIAL and DAYLIGHT REFERENCE, do not edit that home image. Create a new viewpoint from the seated student's eye level in the same quiet Japanese university classroom, looking forward across a clean pale wood desk. This will sit BEHIND a large interactive laptop UI; do NOT draw any laptop, computer, screen or UI. Show subtle classroom context around the edges: tall classroom windows with pale blue sky and diffuse daylight, simple off-white classroom walls, a few wooden desks farther away. The near desktop occupies the bottom 20 percent, left side natural sunlight consistent with the reference. Match the reference's grounded softly illustrated anime game-background rendering, muted blue-gray tones, warm beige wood, realistic materials, gentle shadows; NOT cartoon toy style, NOT photorealism. Low visual noise, softly out of focus room, center unobtrusive because covered by the UI. No people, no clutter, no notebooks, phones, bottles, props, posters, writing, lettering, symbols, logos or watermark. Calm daylight not orange sunset.

## PC本体

最終素材: `laptop-keyboard-graphite-v2.webp`
最終出力: `/Users/asaishimariku/.codex/generated_images/01a02cce-d497-7f12-a8f4-e74a11a2c6a1/exec-8ebf97b8-43d2-4c69-8478-abcd5adfce42.png`
透明背景: true（全工程で維持）

初回生成:

> Use case: stylized-concept. Asset type: transparent game UI laptop keyboard base asset only. Input image 1 is a material/color/style reference: the actual dark blue-gray graphite laptop cropped at the right of the home scene. Generate ONLY that laptop's lower keyboard/base, viewed centered head-on from the seated user's eye level, shallow perspective. No upright lid, no display, no room, no tabletop, no objects. Very wide, shallow trapezoid, top/back edge is 95.2% of full object width, bottom/front edge is 100% of full object width. Orthographically symmetric left-right. The entire object's width-to-height ratio should be 12:1, with genuinely transparent background around it, not white. Fill width of image, leave generous transparent vertical space if necessary; do not turn it into a tall object. Matte dark blue-gray graphite aluminum as in the reference, realistic finely detailed dark keyboard in the back half, simple rectangular dark touchpad centered in the front half, subtle beveled edges, a little sunlight catching the left rim. Stylish restrained grounded anime background rendering matching reference, not cartoon toy, no glowing neon, no white/silver case. No letters on keys, no logos or text, no fake interface, no watermark. Top back edge exactly horizontal so code-rendered screen bezel can connect to it.

低い視点への修正（初回生成画像を参照）:

> Edit this laptop keyboard base asset ONLY. Preserve its graphite blue-gray material, fine keyboard keys and centered trackpad. Change only viewpoint: lower the camera to nearly the same height as the keyboard, viewing it almost edge-on, so the physical deck is strongly foreshortened and occupies a very shallow horizontal band. The opaque laptop silhouette MUST be twelve times wider than it is high (12:1 silhouette, about 2000 pixels wide by 166 high), NOT the current four-times-wide trapezoid. Back top edge must be 95% of front width, so the edge slopes are modest, not strongly flared. Everything, keys and trackpad, should be naturally foreshortened by the new low-angle perspective rather than simply flattened. No upright screen, no lid, no room, no table. Keep genuinely transparent background above, below and around the entire object. No text, logo, lighting change or other objects.

最終修正（低い視点の生成画像を参照）:

> Precise object edit of this transparent graphite laptop keyboard base. Preserve its shallow 12:1 silhouette height, material, color, fine realistic keys, trackpad, transparency and low viewpoint. The ONLY change: widen the BACK TOP EDGE until it is 95.2 percent as wide as the front bottom edge. Move the rear top left corner nearly to the left edge (2.4 percent horizontal inset), and rear top right corner nearly to the right edge (2.4 percent horizontal inset). The current rear edge is only about 77 percent wide and is WRONG. The left and right trapezoid edges must therefore be almost vertical, slanting outward only slightly, not the current long dramatic slopes. This asset connects to a screen which is 95.2 percent of the base width. Strict symmetric, nearly rectangular shallow chassis. Do not add a display, hinges above, room or text. Keep genuine transparent alpha background.

生成結果の寸法と上辺幅を測定し、画面枠は実際の上辺幅（87%）へ合わせた。プロンプトの数値を実画像の測定値として扱わない。
