/**
 * JS mirror of the CSS colour tokens in `src/app/globals.css`.
 *
 * `globals.css` is the source of truth — it is what the whole app resolves,
 * and it is what org branding overrides at runtime (`brandingToCSSVars`).
 * This file exists only for the handful of places that need a *literal*
 * colour a CSS variable cannot supply: canvas, a standalone print/receipt
 * document, or a value handed to a library that does not run inside our
 * cascade. Everywhere else, use `var(--token)` — a literal here silently
 * ignores tenant branding.
 *
 * `src/__tests__/design/color-tokens.test.ts` parses globals.css and fails if
 * any value below drifts from its token, so the two cannot disagree again.
 * They previously did: `danger` was #C44536 while `--color-danger` was
 * #DC2626, and `success` was #1B9E77 while `--color-success` was #059669 —
 * one meaning, two colours, depending on which file you happened to read.
 *
 * ── The two-tone rule ────────────────────────────────────────────────────
 * Every status colour comes in two strengths, and which one you want depends
 * on the *size of the text*, not on taste:
 *
 *   BASE (`SUCCESS`, `WARNING`, `DANGER`, `INFO`) clears 3:1 on white.
 *     Use for: icons, borders, meter and chart fills, and surfaces behind
 *     large (≥18.66px bold / ≥24px) text.
 *   STRONG (`*_STRONG`) clears 4.5:1 both as text on white and as a surface
 *     under white text.
 *     Use for: any normal-size text — coloured words on a light background,
 *     and white words on a coloured background (toasts, banners, pills).
 *
 * Getting this backwards is how "critical" ended up as the least readable
 * text on the page: #F87171 scored 2.77:1 in 58 places.
 */

export const THEME_COLORS = {
  // ── Brand. Mirrors --tb-blue-*; org branding replaces --accent-primary at
  // runtime, so prefer var(--accent-primary) over BRAND_PRIMARY in the UI.
  brandPrimary: '#2191D0',
  brandSecondary: '#015697',
  brandDarker: '#2191D0',
  brandOrange: '#CA4D1C',
  brandPurple: '#7847EB',

  // ── Status. base = --color-X, strong = --color-X-text, bg = --color-X-bg
  // flattened onto white (the tints are rgba in CSS; a literal is needed here).
  info: '#2191D0',            // --color-info
  infoStrong: '#015697',      // --color-info-text
  infoLight: '#DDF2FB',       // --tb-blue-100
  success: '#059669',         // --color-success
  successStrong: '#15795C',   // --color-success-text
  successBg: '#E7F5F0',       // --color-success-bg on white
  warning: '#D97706',         // --color-warning
  warningStrong: '#9C5E16',   // --color-warning-text
  warningBg: '#FBEFE2',       // --color-warning-bg on white
  danger: '#DC2626',          // --color-danger
  dangerStrong: '#8B2E24',    // --color-danger-text
  dangerBg: '#F9EAE8',        // --color-danger-bg on white

  // ── Neutrals. Mirrors the --ehr-* / --text-* / --border-* families.
  neutralText: '#39536B',
  neutralMuted: '#8395A8',
  neutralBorder: '#DDEAF3',
  neutralDivider: '#E7EEF5',
  neutralHover: '#FAFCFE',
  neutralPanelHead: '#F7FAFC',
  neutralPanelBg: '#FFFFFF',
  neutralSurface: '#E9F0F5',
  clinicalInfoBg: '#EAF2F8',
  missionBlue: '#2191D0',
  white: '#FFFFFF',
  slate900: '#111827',
  slate700: '#475569',
  slate500: '#64748B',
} as const;

export const BRAND_PRIMARY = THEME_COLORS.brandPrimary;
export const BRAND_SECONDARY = THEME_COLORS.brandSecondary;
export const BRAND_DARKER = THEME_COLORS.brandDarker;
export const BRAND_ORANGE = THEME_COLORS.brandOrange;
export const BRAND_PURPLE = THEME_COLORS.brandPurple;
export const INFO = THEME_COLORS.info;
export const INFO_STRONG = THEME_COLORS.infoStrong;
export const INFO_LIGHT = THEME_COLORS.infoLight;
export const SUCCESS = THEME_COLORS.success;
export const SUCCESS_STRONG = THEME_COLORS.successStrong;
export const SUCCESS_BG = THEME_COLORS.successBg;
export const WARNING = THEME_COLORS.warning;
export const WARNING_STRONG = THEME_COLORS.warningStrong;
export const WARNING_BG = THEME_COLORS.warningBg;
export const DANGER = THEME_COLORS.danger;
export const DANGER_STRONG = THEME_COLORS.dangerStrong;
export const DANGER_BG = THEME_COLORS.dangerBg;
export const NEUTRAL_TEXT = THEME_COLORS.neutralText;
export const NEUTRAL_MUTED = THEME_COLORS.neutralMuted;
export const NEUTRAL_BORDER = THEME_COLORS.neutralBorder;
export const NEUTRAL_DIVIDER = THEME_COLORS.neutralDivider;
export const NEUTRAL_HOVER = THEME_COLORS.neutralHover;
export const NEUTRAL_PANEL_HEAD = THEME_COLORS.neutralPanelHead;
export const NEUTRAL_PANEL_BG = THEME_COLORS.neutralPanelBg;
export const NEUTRAL_SURFACE = THEME_COLORS.neutralSurface;
export const CLINICAL_INFO_BG = THEME_COLORS.clinicalInfoBg;
export const MISSION_BLUE = THEME_COLORS.missionBlue;
export const WHITE = THEME_COLORS.white;
