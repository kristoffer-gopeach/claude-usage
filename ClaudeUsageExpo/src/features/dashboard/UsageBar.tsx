import { useEffect } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MOTION } from '@/src/features/dashboard/motion';

/**
 * A usage track whose fill eases to a new width when fresh data lands. The movement is
 * the feedback that a refresh actually changed something, which a number swapping in
 * place does not give you.
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
    width.value = isReducedMotion ? utilization : withTiming(utilization, MOTION.value);
  }, [isReducedMotion, utilization, width]);

  const animatedStyle = useAnimatedStyle(() => ({ width: `${Math.min(100, Math.max(0, width.value))}%` }));

  return (
    <View style={trackStyle}>
      <Animated.View style={[fillStyle, animatedStyle]} />
    </View>
  );
}
