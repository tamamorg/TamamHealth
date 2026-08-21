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
 * They previously did: `danger` was #E03127 while `--color-danger` was
 * #D92B20, and `success` was #0FA06A while `--color-success` was #0E9463 —
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
 * text on the page: #F26D64 scored 2.77:1 in 58 places.
 */

export const THEME_COLORS = {
  // ── Brand. Mirrors --tb-blue-*; org branding replaces --accent-primary at
  // runtime, so prefer var(--accent-primary) over BRAND_PRIMARY in the UI.
  brandPrimary: '#015697',
  brandSecondary: '#001D3F',
  brandDarker: '#015697',
  brandOrange: '#FF7F00',
  brandPurple: '#B35900',

  // ── Status. base = --color-X, strong = --color-X-text, bg = --color-X-bg
  // flattened onto white (the tints are rgba in CSS; a literal is needed here).
  info: '#2191D0',            // --color-info
  infoStrong: '#015697',      // --color-info-text
  infoLight: '#C9F4FF',       // --tb-blue-100
  success: '#0E9463',         // --color-success
  successStrong: '#0A6E4A',   // --color-success-text
  successBg: '#E2F2EC',       // --color-success-bg on white
  warning: '#E67200',         // --color-warning
  warningStrong: '#B35900',   // --color-warning-text
  warningBg: '#FFF7DC',       // --color-warning-bg on white
  danger: '#D92B20',          // --color-danger
  dangerStrong: '#9E1B14',    // --color-danger-text
  dangerBg: '#FAE6E4',        // --color-danger-bg on white

  // ── Neutrals. Mirrors the --ehr-* / --text-* / --border-* families.
  neutralText: '#3C5574',
  neutralMuted: '#5D728B',
  neutralBorder: '#E2E6EB',
  neutralDivider: '#ECEEF1',
  neutralHover: '#FAFBFC',
  neutralPanelHead: '#F5F7F8',
  neutralPanelBg: '#FFFFFF',
  neutralSurface: '#ECEEF1',
  clinicalInfoBg: '#F2FCFF',
  missionBlue: '#015697',
  white: '#FFFFFF',
  slate900: '#113055',
  slate700: '#3C5574',
  slate500: '#5D728B',
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
