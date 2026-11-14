# Change summary — 2026-11-15

## R148: show the copied prompt in the Gemini guide

The Gemini guide now contains a prefilled, read-only text area displaying the complete prompt that was copied to the clipboard. The dialog remains scrollable on short screens, and the cache/version identifiers are bumped to R148.

## Verification

- `node tests/google-ai-button.test.cjs` — passed.

## R147: Gemini guidance and clipboard import

The Google AI action now copies the prompt and displays a short step-by-step dialog before opening Gemini. The user opens Gemini only after choosing “Next: open Gemini.” When “Process this text” is clicked with an empty text box, the page reads the copied Gemini response from the clipboard and processes it directly; if clipboard access is denied or empty, the page explains that the answer can be pasted manually. Cache and app release identifiers are bumped to R147.

## Verification

- `node tests/google-ai-button.test.cjs` — passed.
- `node tests/text-import.cjs` — not run: Playwright is not installed in this checkout.


## R146: keep the settlement action clear of the bottom hint bar

The “Go to settlement” action scrolls directly to “Share claim link.” The previous scroll helper tried to locate the bottom overlay with `div.fixed.bottom-0[role="status"]`, but the app’s actual compact hint/status bar is `data-testid="status-compact-region"` and does not have that role. The lookup therefore missed the overlay, fell back to the viewport edge, and could leave the share button partly behind the fixed bar.

The shared `visibleScrollBottom()` helper now measures the real compact status bar. This improves clearance for the settlement scroll and the existing OCR-progress alignment that uses the same helper. Browser regressions now compare the share button’s position directly with the compact bar and require a safe gap.

## Recent related UI behavior

R145 uses one full-size receipt-photo gallery with a trash control on each existing photo card; it does not render a second small-thumbnail gallery. Removal remains persisted in the local draft. The R146 change does not alter this behavior.

## Verification

- Static UI/version and whitespace checks.
- Local browser test for one-at-a-time photo deletion and draft persistence.
- Local browser test that the “Share claim link” button remains above the fixed compact status bar after “Go to settlement.”
