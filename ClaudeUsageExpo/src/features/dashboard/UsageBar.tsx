import { useEffect } from 'react';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MOTION } from '@/src/features/dashboard/motion';

/**
 * A usage track whose fill eases to a new length when fresh data lands. The movement is
 * the feedback that a refresh actually changed something, which a number swapping in
 * place does not give you.
 *
 * The fill is full width and scaled horizontally rather than having its width animated.
 * Width is a layout property, so animating it made React Native recompute layout on every
 * frame of the ease; scaleX runs on the GPU and touches no layout at all.
 *
 * Hidden from assistive technology on purpose. The bar restates a percentage that is
 * already announced as text right beside it, so exposing it as a progress bar would make
 * a screen reader say the same number twice.
 *
 * Used for every track in the app so all four of them behave identically.
 */
export function UsageBar({
  fillStyle,
  trackStyle,
  utilization,
}: {
  fillStyle: StyleProp<ViewStyle>;
  trackStyle: StyleProp<ViewStyle>;
  utilization: number;
}) {
  const isReducedMotion = useReducedMotion();
  const width = useSharedValue(utilization);

  useEffect(() => {
    width.set(isReducedMotion ? utilization : withTiming(utilization, MOTION.value));
  }, [isReducedMotion, utilization, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(100, Math.max(0, width.get())) / 100 }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={trackStyle}>
      <Animated.View style={[styles.fill, fillStyle, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The fill spans the track and is scaled down from the left edge, so 0 percent collapses
  // to nothing and 100 percent fills it exactly.
  fill: { width: '100%', transformOrigin: 'left' },
});
