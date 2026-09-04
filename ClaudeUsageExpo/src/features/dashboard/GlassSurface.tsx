import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { GLASS_TOKENS, glassSheen, glassTone } from '@/src/features/dashboard/glass';

type GlassBackdrop = {
  /** Whether the backdrop is a user-picked photo, which decides lift versus sink. */
  photo: boolean;
  /**
   * The view Android blurs. expo-blur's ExpoBlurView forces BlurMethod.NONE unless a
   * BlurView is handed a target, so without this Android renders a flat tint and no blur
   * at all. On iOS the target is an ordinary View and the prop is ignored.
   */
  targetRef: RefObject<View | null> | null;
};

/**
 * A pane cannot read either of these off the screen, and threading them through every call
 * site would mean touching all of them, so they travel by context and are provided once at
 * the dashboard root.
 */
const GlassBackdropContext = createContext<GlassBackdrop>({ photo: false, targetRef: null });

export function GlassBackdropProvider({
  children,
  photo,
  targetRef,
}: GlassBackdrop & { children: ReactNode }) {
  return (
    <GlassBackdropContext.Provider value={{ photo, targetRef }}>
      {children}
    </GlassBackdropContext.Provider>
  );
}

/**
 * The one glass pane in the app. It renders as an absolutely positioned fill inside an
 * existing container, so a card keeps its own layout, padding and children and only gains a
 * backdrop. That is why the glass theme needed no restructuring of the screen.
 *
 * Four layers, in order, and each one earns its place:
 *   1. the blur, which is the only part that actually samples the background
 *   2. a tone, dark where the backdrop is an unknown photo or the pane is stacked on
 *      another, which is what guarantees text contrast in those cases, and absent over a
 *      known-dark gradient where it would buy nothing
 *   3. the sheen, a light gradient across the surface. This is the layer that makes a pane
 *      read as glass when the blur shows nothing, which is the normal case over a built-in
 *      gradient and the only case on Android below SDK 31, where there is no blur at all
 *   4. a hairline edge and a brighter top lip, which is what the eye reads as an edge
 *
 * Deliberately not animated. An earlier version eased the fill with useAnimatedStyle and
 * crashed the app: the worklet ran the fill helper on the UI runtime, where that module and its
 * regex do not exist, and the thrown error aborted the process. Nothing was gained by it
 * either, because the fill only changes when the background does and AppBackground's
 * cross-fade already covers that moment. A dozen of these render at once, so staying a plain
 * component also keeps the pane cheap.
 *
 * The parent needs `overflow: 'hidden'` for the blur to respect its corner radius.
 */
export function GlassSurface({
  elevated = false,
  radius = GLASS_TOKENS.radius,
}: {
  /** A pane stacked on another pane, which needs to separate from the one below it. */
  elevated?: boolean;
  radius?: number;
}) {
  const { photo, targetRef } = useContext(GlassBackdropContext);
  const tone = glassTone({ photo, raised: elevated });
  const sheen = glassSheen({ photo });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fill, { borderRadius: radius }]}>
      <BlurView
        // dimezisBlurViewSdk31Plus rather than dimezisBlurView: expo-blur documents the
        // latter as costing performance on Android SDK 30 and below, and falling back to a
        // flat tint there is a better trade than a janky one on an old phone.
        blurMethod="dimezisBlurViewSdk31Plus"
        blurReductionFactor={GLASS_TOKENS.blurReductionFactor}
        blurTarget={targetRef ?? undefined}
        intensity={elevated ? GLASS_TOKENS.blurIntensity * 0.6 : GLASS_TOKENS.blurIntensity}
        style={styles.fill}
        tint={GLASS_TOKENS.blurTint}
      />

      {tone ? <View style={[styles.fill, { backgroundColor: tone }]} /> : null}

      <LinearGradient
        colors={sheen}
        // Diagonal, so the light reads as falling across the surface rather than down it.
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.fill}
      />

      <View
        style={[
          styles.fill,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: GLASS_TOKENS.borderColor,
            borderTopColor: GLASS_TOKENS.highlightColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Written out rather than using StyleSheet.absoluteFillObject, which React Native 0.86
  // removed. Spreading that missing helper is what silently broke the login overlay.
  // pointerEvents belongs in the style rather than as a prop, which RN now warns about.
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
});
