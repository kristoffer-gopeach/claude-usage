/**
 * Design tokens for the glass theme, in one place so no component hardcodes its own
 * blur, tint, border or shadow. Every glass surface in the app reads from here.
 *
 * The numbers are not taste. The central one is not even a single number, because the safe
 * fill depends entirely on whether the backdrop is known:
 *
 *   - Over a BUILT-IN gradient the backdrop is known and dark, so contrast is already
 *     guaranteed by the gradient. Measured against the lightest stop any built-in contains
 *     (#233156, the top of Skymning), even a fully transparent pane passes AA. A dark scrim
 *     here buys nothing and costs the whole effect, so the pane LIFTS with light instead,
 *     the way iOS thin material reads over a dark wallpaper. That light is spent as a
 *     gradient across the pane rather than a flat wash, for the reason below.
 *
 *   - Over a CUSTOM PHOTO the backdrop is unknown, so the worst case is a pure white image
 *     and the pane has to SINK with dark to create its own contrast.
 *
 * A raised pane is the exception to that split: it always darkens whatever is beneath it,
 * whichever backdrop is in use. Lifting again on top of an already-lifted pane compounded
 * (#3d4a6a became #5e6984) and dropped secondary text to 3.40:1; darkening is one rule for
 * both backdrops and can only ever add contrast.
 *
 * A BLUR IS NOT ENOUGH ON ITS OWN. It only shows where the backdrop has detail to smear,
 * and the built-in gradients deliberately have none, so over the default background a pane
 * with nothing but a blur is indistinguishable from a flat card. On Android below SDK 31
 * there is no blur at all: expo-blur's dimezisBlurViewSdk31Plus falls back to none. The
 * sheen is what carries the surface in both cases, and it needs no blur, no GPU feature and
 * no platform support. Over the default graphite gradient it gives a 1.20x to 1.27x light
 * gradient across each pane, and makes the pane 1.25x to 1.36x brighter than the bare
 * background beside it.
 *
 * The sheen could not simply be added on top of what was already there: the palette sat at
 * 4.52:1 in the worst case, with no headroom for more light. It replaces the flat lift
 * rather than joining it, so the pane spends the same light with direction instead of
 * evenly, and contrast came out slightly better than before.
 *
 * ANDROID. expo-blur does not blur at all unless a BlurView is given a blurTarget: its
 * ExpoBlurView forces BlurMethod.NONE without one and paints a flat tint instead. Even with
 * a target, the tint is applied as an overlay whose alpha is intensity/100 * 0.70 for every
 * dark material, so Android always lays an extra dark wash under the pane. That wash only
 * darkens, so it can never break light-on-glass text. Both platforms are measured below.
 *
 * Every combination that can appear on screen, at the sheen's bright corner, which is the
 * only place contrast can break:
 *
 *   ios     gradient base   #394667   ios     gradient raised #333d55
 *   ios     photo    base   #47484b   ios     photo    raised #38393c
 *   android gradient base   #39435d   android gradient raised #343b4e
 *   android photo    base   #3d3f41   android photo    raised #313235
 *
 * Worst ratio across all eight: ink 8.54, secondary 5.64, tertiary 4.64, Claude accent 4.58,
 * Codex accent 4.56, success 4.55, danger 4.54.
 *
 * Two rules here come from Expo's own native UI guidance rather than from preference: blur
 * tints should use the system materials so they follow the OS appearance, and shadows must
 * use the CSS `boxShadow` prop rather than the legacy shadow properties.
 */
export type GlassTokens = {
  /** expo-blur intensity, 0 to 100. On Android this also sets the flat tint's alpha. */
  blurIntensity: number;
  /** A system material so the blur follows the OS appearance instead of a fixed tint. */
  blurTint: 'systemMaterialDark' | 'systemThinMaterialDark' | 'systemUltraThinMaterialDark';
  /**
   * Android divides the blur radius by this. The default of 4 left the blur almost invisible
   * at the intensity the tint budget allows, so it is halved here to bring the two platforms
   * closer without raising the intensity and darkening the pane.
   */
  blurReductionFactor: number;
  /**
   * The pane's own light, spent as a gradient across its surface rather than as a flat
   * wash. This is what makes a pane read as glass when the blur has nothing to reveal,
   * which is the normal case over a built-in gradient and the only case on Android below
   * SDK 31, where expo-blur turns the blur off entirely.
   */
  sheenTint: string;
  sheenPeakAlpha: number;
  /**
   * Over a photo the pane has to stay dark to carry text, and the blur genuinely has
   * detail to reveal, so the sheen is only a hint there. Measured, not chosen: a uniform
   * sheen is throttled by this case to 1.06x across the pane, which is invisible.
   */
  photoSheenPeakAlpha: number;
  /** The dim end of the sheen, as a fraction of the peak. */
  sheenDimRatio: number;
  /** Over an unknown photo the pane sinks with dark, which is what creates contrast. */
  scrimTint: string;
  scrimAlpha: number;
  /** A pane stacked on a pane darkens what is beneath it, whichever backdrop is in use. */
  raisedAlpha: number;
  /** Darkens a picked photo before any pane sits on it. Part of the contrast budget. */
  photoScrimTint: string;
  photoScrimAlpha: number;
  /** The hairline edge does more for the illusion than the blur does. */
  borderColor: string;
  /** A brighter top edge, as if light catches the lip of the pane. */
  highlightColor: string;
  radius: number;
  /** CSS boxShadow. Expo's guidance is to never use the legacy shadow props. */
  boxShadow: string;
};

export const GLASS_TOKENS: GlassTokens = {
  blurIntensity: 32,
  blurTint: 'systemThinMaterialDark',
  blurReductionFactor: 2,
  sheenTint: '#FFFFFF',
  sheenPeakAlpha: 0.1,
  photoSheenPeakAlpha: 0.025,
  sheenDimRatio: 0.25,
  scrimTint: '#0E1014',
  scrimAlpha: 0.62,
  raisedAlpha: 0.3,
  photoScrimTint: '#07080A',
  photoScrimAlpha: 0.42,
  borderColor: 'rgba(255, 255, 255, 0.16)',
  highlightColor: 'rgba(255, 255, 255, 0.22)',
  radius: 18,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.32)',
};

/**
 * The tone a pane paints over the blur: dark where the backdrop is unknown or the pane is
 * stacked on another, and nothing at all over a known-dark gradient, where the sheen
 * carries the surface on its own. Returns null when no tone layer is needed.
 */
export function glassTone({ photo, raised }: { photo: boolean; raised: boolean }): string | null {
  if (raised) return withAlpha(GLASS_TOKENS.scrimTint, GLASS_TOKENS.raisedAlpha);
  if (photo) return withAlpha(GLASS_TOKENS.scrimTint, GLASS_TOKENS.scrimAlpha);
  return null;
}

/**
 * The two ends of the sheen gradient, brightest corner first. Only the bright end can
 * break contrast, so that is the value the derivation above is measured against.
 */
export function glassSheen({ photo }: { photo: boolean }): [string, string] {
  const peak = photo ? GLASS_TOKENS.photoSheenPeakAlpha : GLASS_TOKENS.sheenPeakAlpha;
  return [
    withAlpha(GLASS_TOKENS.sheenTint, peak),
    withAlpha(GLASS_TOKENS.sheenTint, peak * GLASS_TOKENS.sheenDimRatio),
  ];
}

/** Turns a hex colour and an alpha into the rgba string React Native wants. */
export function withAlpha(hex: string, alpha: number): string {
  const parts = hex.replace('#', '').match(/../g);
  if (!parts) return hex;
  const [r, g, b] = parts.map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type BackgroundId = 'graphite' | 'dusk' | 'forest' | 'ember' | 'custom';

export type BuiltInBackground = {
  id: Exclude<BackgroundId, 'custom'>;
  label: string;
  note: string;
  /** Three stops read as depth where two read as a flat wash. */
  colors: [string, string, string];
};

/**
 * Built-in backgrounds are painted as gradients rather than shipped as images, so the
 * bundle stays the same size and each one is correct at any screen size. A gradient also
 * gives the blur something to actually blur: over a flat colour the effect is invisible.
 *
 * Every stop here is part of the contrast derivation above. Adding a lighter one than
 * #233156 would invalidate it, so re-measure before changing this list.
 *
 * CSS gradients via experimental_backgroundImage would avoid the dependency, but they
 * are New Architecture only and unavailable in Expo Go, which is what this app runs in.
 */
export const BUILT_IN_BACKGROUNDS: BuiltInBackground[] = [
  { id: 'graphite', label: 'Grafit', note: 'Standard, neutralt mörk', colors: ['#1E222B', '#12151B', '#08090C'] },
  { id: 'dusk', label: 'Skymning', note: 'Djupblå mot lila', colors: ['#233156', '#1A1836', '#0C0A18'] },
  { id: 'forest', label: 'Skog', note: 'Mörkgrön mot svart', colors: ['#17332A', '#0E1F19', '#050A08'] },
  { id: 'ember', label: 'Glöd', note: 'Varm brun mot svart', colors: ['#3A1F16', '#22110C', '#0A0504'] },
];

export const DEFAULT_BACKGROUND_ID: BackgroundId = 'graphite';

export function findBuiltInBackground(id: BackgroundId): BuiltInBackground {
  return (
    BUILT_IN_BACKGROUNDS.find((background) => background.id === id) ??
    BUILT_IN_BACKGROUNDS[0]
  );
}
