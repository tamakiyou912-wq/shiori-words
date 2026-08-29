# 詞織 / SHIORI — Design specification

## Product character

詞織 is a fast translation and Japanese-learning tool, not a marketing site or an AI dashboard. The first screen is the translator. The interface should feel like a quiet, modern dictionary: accurate, immediate, compact, and comfortable on iPad.

Tagline: **words, woven clearly.**

Priority order: accuracy, speed, simplicity, iPad/mobile usability, maintainability, self-deployment, and forkability.

## Selected visual direction

The selected direction is the first Product Design concept: a warm, paper-like dictionary sheet with Claude-like calm typography and a restrained warm accent. The result reads as one continuous document instead of many cards.

Preserve these traits:

- Compact wordmark at the top, with the small serif tagline “words, woven clearly.” aligned beside 「詞織」; no hero or marketing prelude.
- A prominent but restrained translation input.
- Dictionary-style result hierarchy driven by type, spacing, and thin rules.
- Warm near-white light theme, charcoal text, one muted vermilion accent.
- Very little elevation and only small corner radii on interactive controls.
- Follow-up stays inline beneath the current result.

## Layout

- Content max width: `880px`; preferred reading width: `760–820px`.
- iPad is the primary canvas, in both portrait and landscape.
- Mobile horizontal padding: `18px`; tablet: `28–36px`; desktop: `40px`.
- Header is compact and remains usable with safe-area insets.
- Signed-in avatar is a quiet circular typographic monogram using 「栞」 (しおり), never a photographic default avatar.
- Signed-out navigation says “登录 / 体验”. The login screen presents account login and guest-code entry together so first-time visitors never need to hunt for the guest path.
- Input and result share the same visual column.
- Result is one document surface. Use grouped sections and dividers, never a card per field.
- Settings and history are ordinary pages with simple rows and sections, not dashboards.
- No persistent sidebar. Desktop may use a compact top navigation only.

## Typography

Use the system stack only:

```css
-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI",
"Noto Sans JP", "Segoe UI", sans-serif
```

- Body: `15–17px`, line-height `1.65–1.75`.
- Main dictionary surface: responsive `44–68px`, medium weight.
- Reading and romaji: `20–28px`.
- English headword/primary translation: `24–34px`.
- Labels and metadata: `12–14px`, with restrained letter spacing.
- Avoid ultra-light weights and decorative typefaces.

## Color tokens

Light:

- Background: `#f8f6f1`
- Raised/field surface: `#fffdf8`
- Text: `#24211e`
- Secondary text: `#6f6962`
- Rule: `#ded8cf`
- Accent: `#b44835`
- Accent hover: `#993a2b`
- Error: `#a3382d`
- Success: `#386b4b`

Dark (system preference):

- Background: `#181715`
- Raised/field surface: `#211f1c`
- Text: `#f1ede6`
- Secondary text: `#aaa39a`
- Rule: `#3c3833`
- Accent: `#d87561`

Use no gradients. Do not introduce additional decorative colors.

## Components and interaction

- Buttons: 42–48px minimum touch target, modest radius (`8–10px`).
- Primary action: solid accent, short label, never oversized.
- Secondary actions: text or subtle outline.
- Inputs always have visible labels (visually hidden is acceptable when context is clear), strong focus state, and no key-shaped decoration.
- Translation textarea supports `Cmd/Ctrl + Enter`; ordinary Enter may submit single-line input while Shift+Enter inserts a line break.
- Show streaming progress in the result document as soon as data arrives.
- Follow-up composer remains near the result and respects the mobile keyboard/safe area.
- Ruby/furigana is opt-in for sentences; dictionary headwords show one compact reading line by default.
- Corrected or ambiguous romaji results offer one quiet “继续联想相似发音” action. It reveals a short set of clickable candidates; selecting one replaces the input and immediately runs a new translation.
- While a single romaji term is being typed, show a compact input-recognition row with one-click hiragana, katakana, and dictionary/kanji interpretation choices. Automatic interpretation stays the default.
- Word pronunciation uses the browser/operating-system Japanese speech voice (`ja-JP`) locally. The control must announce playback state and must never call the AI Provider.
- Sentence results are learning views, not a single translated line. Always show a compact Chinese/Japanese/English comparison, full-sentence kana and romaji, token-level pronunciation/meaning, and 3–4 useful register or context variants. Use continuous rows and rules rather than separate cards.
- Motion is limited to short opacity/position transitions (`120–180ms`) when it clarifies state. Respect `prefers-reduced-motion`.

## Result hierarchy

Recommended order:

1. Surface form / main translation
2. Reading and romaji
3. Concise English and Chinese meaning
4. Part of speech or register metadata
5. Meanings grouped by common use when needed
6. Examples
7. Short usage, grammar, correction, or katakana-origin note
8. Alternatives
9. Inline follow-up

Optional fields are omitted rather than shown empty. Do not force every answer into the same visual density.

## Responsive rules

- Phone: single column; language controls wrap; primary action remains reachable; result type scales down; follow-up is never obscured by browser chrome or keyboard.
- iPad portrait: single reading column with comfortable margins.
- iPad landscape/desktop: maintain the central reading column; do not expand text to the full viewport. Small utilities may align to the right only when they remain visually secondary.
- Apply `env(safe-area-inset-*)` to the outer shell and sticky/fixed controls.

## Accessibility

- WCAG AA contrast for text and controls.
- Visible `:focus-visible` ring using the accent plus offset.
- Keyboard-accessible navigation, dialogs, menus, and forms.
- Semantic headings and landmarks.
- Explicit labels and concise error text; use `aria-live` for streaming/status updates.
- Minimum touch target approximately `44px`.
- Dark mode must preserve hierarchy and readable borders.

## Strict prohibitions

No gradients, glassmorphism, giant hero, decorative illustrations, glowing AI marks, purple-blue AI SaaS palette, excessive cards, nested cards, giant rounded rectangles, unnecessary animation, marketing landing page, dashboard aesthetic, admin UI, or sidebar-first navigation.

## Design QA checklist

Verify in a real browser at phone (`390×844`), iPad portrait (`834×1194`), iPad landscape (`1194×834`), and desktop (`1440×1024`):

- The translator is immediately visible and usable.
- Content density is calm but not sparse.
- Result hierarchy is typographic, not card-driven.
- Buttons, fields, focus, dark mode, loading, empty, success, and error states are clear.
- Header, follow-up composer, and safe-area padding work on Safari-like viewports.
- No horizontal overflow, clipped content, odd wrapping, console errors, or keyboard traps.
