import { useContext, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { AnimationActivityContext } from './renderActivity';

/**
 * Decorative Halloween layer. It sits behind every card, never receives touches and never
 * covers a number, so the usage figures stay exactly as legible as in the other themes.
 * Everything stands still when the system asks for reduced motion.
 */

type Floater = {
  glyph: string;
  left: `${number}%`;
  top: `${number}%`;
  size: number;
  opacity: number;
  /** Vertical travel in points. Negative drifts upward. */
  drift: number;
  spin: number;
  durationMs: number;
  delayMs: number;
};

const FLOATERS: Floater[] = [
  { glyph: '🎃', left: '6%', top: '13%', size: 30, opacity: 0.2, drift: -16, spin: 7, durationMs: 5200, delayMs: 0 },
  { glyph: '🦇', left: '78%', top: '8%', size: 24, opacity: 0.26, drift: 14, spin: -12, durationMs: 3900, delayMs: 700 },
  { glyph: '👻', left: '85%', top: '45%', size: 26, opacity: 0.18, drift: -20, spin: 5, durationMs: 6100, delayMs: 1500 },
  { glyph: '🎃', left: '69%', top: '74%', size: 34, opacity: 0.18, drift: -12, spin: -6, durationMs: 5800, delayMs: 400 },
  { glyph: '🦇', left: '15%', top: '61%', size: 20, opacity: 0.22, drift: 18, spin: 14, durationMs: 4400, delayMs: 1100 },
  { glyph: '🕸️', left: '-1%', top: '80%', size: 40, opacity: 0.13, drift: 0, spin: 0, durationMs: 0, delayMs: 0 },
  { glyph: '🕸️', left: '85%', top: '0%', size: 36, opacity: 0.13, drift: 0, spin: 0, durationMs: 0, delayMs: 0 },
];

export function HalloweenAmbience() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.layer}>
      {FLOATERS.map((floater, index) => (
        <FloatingGlyph floater={floater} key={`${floater.glyph}-${index}`} />
      ))}
    </View>
  );
}

function FloatingGlyph({ floater }: { floater: Floater }) {
  const isReducedMotion = useReducedMotion();
  const active = useContext(AnimationActivityContext);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active || isReducedMotion || floater.durationMs === 0) {
      progress.set(0);
      return;
    }

    progress.set(withDelay(
      floater.delayMs,
      withRepeat(
        withTiming(1, { duration: floater.durationMs, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    ));

    return () => cancelAnimation(progress);
  }, [active, floater.delayMs, floater.durationMs, isReducedMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.get() * floater.drift },
      { rotate: `${progress.get() * floater.spin}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.floater,
        { left: floater.left, top: floater.top, opacity: floater.opacity },
        animatedStyle,
      ]}>
      <Text style={{ fontSize: floater.size }}>{floater.glyph}</Text>
    </Animated.View>
  );
}

/**
 * A jack-o-lantern flicker for the primary card. Only a warm translucent wash flickers,
 * never the text on top of it, which is why the opacity range stops far short of opaque.
 */
export function CandleGlow() {
  const isReducedMotion = useReducedMotion();
  const active = useContext(AnimationActivityContext);
  const glow = useSharedValue(0.7);

  useEffect(() => {
    if (!active || isReducedMotion) {
      glow.set(0.7);
      return;
    }

    // Deliberately uneven steps. An even pulse reads as a loading spinner, not a candle.
    glow.set(withRepeat(
      withSequence(
        withTiming(1, { duration: 140 }),
        withTiming(0.62, { duration: 110 }),
        withTiming(0.94, { duration: 260 }),
        withTiming(0.7, { duration: 180 }),
        withTiming(1, { duration: 90 }),
        withTiming(0.78, { duration: 320 }),
      ),
      -1,
      true,
    ));

    return () => cancelAnimation(glow);
  }, [active, glow, isReducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: glow.get() * 0.15 }));

  return <Animated.View style={[styles.glow, animatedStyle]} />;
}

const styles = StyleSheet.create({
  // Written out rather than using StyleSheet.absoluteFillObject, which React Native 0.86
  // removed. Spreading that missing helper is what silently broke the login overlay.
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' },
  floater: { position: 'absolute' },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: '#FFD9A0',
    pointerEvents: 'none',
  },
});
