# Change summary — 2026-11-15

## R146: keep the settlement action clear of the bottom hint bar

The “Go to settlement” action scrolls directly to “Share claim link.” The previous scroll helper tried to locate the bottom overlay with `div.fixed.bottom-0[role="status"]`, but the app’s actual compact hint/status bar is `data-testid="status-compact-region"` and does not have that role. The lookup therefore missed the overlay, fell back to the viewport edge, and could leave the share button partly behind the fixed bar.

The shared `visibleScrollBottom()` helper now measures the real compact status bar. This improves clearance for the settlement scroll and the existing OCR-progress alignment that uses the same helper. Browser regressions now compare the share button’s position directly with the compact bar and require a safe gap.

## Recent related UI behavior

R145 uses one full-size receipt-photo gallery with a trash control on each existing photo card; it does not render a second small-thumbnail gallery. Removal remains persisted in the local draft. The R146 change does not alter this behavior.

## Verification

- Static UI/version and whitespace checks.
- Local browser test for one-at-a-time photo deletion and draft persistence.
- Local browser test that the “Share claim link” button remains above the fixed compact status bar after “Go to settlement.”
