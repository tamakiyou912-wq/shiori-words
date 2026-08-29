# Design QA — 詞織 / SHIORI

**Source visual truth**

- The original design reference was reviewed locally and is not distributed with the repository.
- Source pixels: `1048 × 1501`.
- Selected concept: Product Design option 1, warm paper dictionary sheet / Claude-like calm hierarchy.
- User-directed brand refinement: replace the illustrated avatar with the typographic monogram 「栞」 (しおり) and place the lowercase tagline `words, woven clearly.` beside 「詞織」.

**Browser-rendered implementation evidence**

- QA captures were kept in the ignored `work/` directory and are not published with the repository.
- Implementation pixels: `1280 × 720` at CSS viewport `1280 × 720`, browser DPR `2`; Browser returned a CSS-pixel-normalized `1280 × 720` capture.
- Full top-view, focused result, brand, guest-entry, fuzzy-romaji, sentence-learning, narrow-layout, input-choice, and katakana-result captures were inspected.
- The fuzzy-romaji capture confirms `basuminntonn` resolves to a complete Japanese/Chinese/English dictionary result before the similar-sound candidate state.
- The sentence-learning capture confirms the first viewport includes Japanese, kana, romaji, Chinese, English, and the start of token analysis; the narrow `632 × 892` capture has no horizontal overflow.
- The romaji controls capture confirms `konnsennto` exposes one-tap hiragana, katakana (`コンセント`), and kanji/word association paths before submission.
- State: authenticated local test user, light system theme, `gakkou` result, top of page, no loading/error state.
- Comparison normalization: the source top was cropped to `1048 × 590`; the implementation central product frame was cropped to `916 × 516`. Both were resampled to `1280 × 720` before placing them side by side. The focused result crops were normalized to `700 × 430` each.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Fonts and typography: system UI plus Japanese system serif/sans fallbacks reproduce the selected editorial hierarchy. The implementation keeps the headword slightly denser than the generated mock to support longer real results; this is an intentional production constraint and does not change hierarchy.
- Spacing and layout rhythm: header, compact input, document-style result, dividers, examples, and inline follow-up use the same ordering and calm rhythm as the source. Result content remains one surface rather than a card stack.
- Colors and tokens: warm paper, charcoal, muted gray rules, and one restrained vermilion accent match the source direction. There are no gradients, glass effects, glow, or purple-blue AI styling.
- Image quality and asset fidelity: the photographic default avatar was intentionally removed. The new 「栞」 monogram is crisp at native text density in light and dark modes; the PWA icon remains a sharp PNG asset. Interface icons come from Phosphor, not handcrafted SVG/CSS placeholders.
- Copy and content: branding includes the exact lowercase `words, woven clearly.` lockup and 「栞」 avatar requested by the user. `gakkou`, `学校`, `がっこう · gakkō`, English/Chinese meaning, part of speech, example, and follow-up affordance remain correct.
- Access clarity: signed-out navigation now says “登录 / 体验”. At desktop width the login page uses two quiet columns separated by one rule, making the experience-code input visible without scrolling; smaller viewports stack the same semantic sections without adding cards.
- Ambiguity recovery: fuzzy romaji results no longer stop at one guess. A single text action reveals concise, bordered candidate buttons; each candidate includes a readable surface/reading pair and triggers a new query when selected.
- Script recovery: a compact input-recognition row appears for single romaji terms, keeping automatic interpretation as the default while making hiragana, katakana, and kanji/word searches explicit one-tap alternatives.
- Pronunciation: the headword control now invokes the browser/device Japanese `SpeechSynthesis` voice (`ja-JP`) without using the AI provider. Browser QA observed the live-region transition to “正在播放本地日语发音…”.
- Sentence learning: sentence searches no longer stop at one translated line. The result now exposes a five-line Chinese/Japanese/English comparison, full kana and romaji, token-level reading/meaning, and four concise context/register variants. Duplicate top-level “natural/literal” blocks are suppressed for sentence analyses so English remains visible without excessive scrolling.
- Accessibility: semantic headings/regions, explicit labels, visible focus, keyboard submission, 44px touch targets, reduced-motion handling, and AA-oriented token contrast are present.

## Responsive evidence

Browser viewport override measurements:

| Viewport | Main/input width | Horizontal overflow | Result top | Notes |
| --- | ---: | ---: | ---: | --- |
| Phone `390 × 844` | `362px` | none (`390 = 390`) | `347px` | Controls wrap; one-column reading flow |
| iPad portrait `834 × 1194` | `798px` | none (`834 = 834`) | `325px` | Matches primary tablet canvas |
| iPad landscape `1194 × 834` | `880px` | none (`1194 = 1194`) | `325px` | Centered reading width maintained |
| Desktop `1440 × 1024` | `880px` | none (`1440 = 1440`) | `325px` | No dashboard expansion or sidebar |

The input/result state was re-opened from history at every breakpoint so measurements used the same content. Safe-area insets are applied to the shell and bottom padding. System dark colors are defined in the same token layer; no light-only fixed backgrounds remain in interactive components.

## Primary interactions tested

- Login and persistent HttpOnly session.
- Enter-to-translate.
- `gakkou`, tolerant `gakko`, `预约`, `コンセント`, `かける`, and the required Chinese sentence.
- History list and re-opening a full result.
- Settings form structure, masked credential contract, disabled pre-credential actions, and guest-code controls.
- Login-page experience-code entry, real server-side activation, redirect to guest mode, and remaining-use decrement.
- `basuminntonn` → `バドミントン` with visible `badminton` / `羽毛球`, followed by candidate reveal and click-to-requery.
- `amerika` → `アメリカ` with complete Chinese/English meanings and alternatives.
- `konnsennto` → one-tap `コンセント`, followed by complete outlet meaning, source note, local Japanese pronunciation start, and four similar-sound candidates.
- Browser console errors/warnings checked after the final cold restart: none.

## Comparison history

1. Initial implementation showed a correction note for already-correct `gakkou` and used a `190px` input field at tablet width. These were P2 density/copy issues.
2. The correction predicate was changed to compare the raw tolerant input against the normalized target. The input was reduced to `148px` at iPad width and the result moved to `325px` from the top, restoring the source hierarchy.
3. A cold development-server restart exposed bundled PGlite path handling. `@electric-sql/pglite` was moved to `serverExternalPackages`; a second cold restart and browser reload passed with no console errors.
4. Final side-by-side and focused comparisons found no remaining P0/P1/P2 differences.
5. Brand refinement pass removed the illustrated avatar, added the restrained 「栞」 monogram, and aligned the lowercase tagline with the primary wordmark. The final production-browser capture shows intact spacing, legibility, and header hierarchy at `1280 × 720`; an additional `632 × 892` browser pass had no horizontal overflow. Prior `390px`, iPad, and desktop layout measurements remain structurally unchanged.
6. The first guest-entry revision placed the experience-code form below the account form; at `1280 × 720` the heading appeared but the actual input fell below the fold, a P2 discoverability issue. The login page was changed to a two-column method layout at desktop width. The revised `1280 × 720` capture places the full input and action at `y=325–367`, with no horizontal overflow.
7. A fuzzy Provider result exposed only a Japanese transliteration and left learners unsure whether Chinese/English content had failed to render. The local tolerant entry, Provider contract, explicit incomplete-result message, and similar-sound candidate interaction were added. Browser QA confirmed all three languages, four candidates, automatic requery, guest use decrement, and no runtime error.
8. A Chinese sentence result initially showed only its Japanese translation and left a large empty document area. Sentence-specific structured output and continuous learning sections were added; a second browser pass at `1280 × 720` and `632 × 892` confirmed English, kana, romaji, token segmentation, four context variants, compact header spacing, and no horizontal overflow.
9. An uncleanly interrupted embedded PGlite instance contained an invalid checkpoint and could surface a raw server stack during session lookup. The damaged directory was preserved as `data/shiori-recovery-20260829-0345`, a fresh active database was migrated, session restoration now fails closed to signed-out state, and graceful database shutdown handlers were added. Browser QA after recovery found no console errors or raw database output.
10. The final katakana/romaji pass made input interpretation explicit, added complete local entries for `amerika` and `konnsennto`, widened the candidate recovery affordance, and connected the word speaker to device TTS. The resulting controls remain compact and consistent with the document-style interface.

## Follow-up polish

- P3: a future optional pass could tune Japanese Mincho optical sizing per OS, but the current system-font-only choice is intentionally faster and smaller.

## Implementation checklist

- [x] Selected visual direction reproduced.
- [x] Core translator interactions work.
- [x] Phone, iPad portrait, iPad landscape, and desktop checked.
- [x] Console checked.
- [x] P0/P1/P2 issues fixed and compared again.

final result: passed
