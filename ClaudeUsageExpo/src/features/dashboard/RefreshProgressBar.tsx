import { useContext, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AnimationActivityContext } from './renderActivity';

const SEGMENT_RATIO = 0.34;
const SWEEP_DURATION_MS = 1150;

/**
 * An indeterminate strip shown while a usage request is in flight. It reports that the
 * app is fetching, which is the only kind of progress this app can actually observe. It
 * deliberately does not claim anything about what a model is doing, because the usage
 * endpoint carries no session or activity information.
 *
 * The bar keeps its height whether or not it is active, so the layout below never shifts.
 */
export function RefreshProgressBar({
  color,
  isActive,
  trackColor,
}: {
  color: string;
  isActive: boolean;
  trackColor: string;
}) {
  const isReducedMotion = useReducedMotion();
  const active = useContext(AnimationActivityContext);
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);

  useEffect(() => {
    if (!isActive || !active || width === 0) {
      cancelAnimation(offset);
      offset.set(0);
      return;
    }

    if (isReducedMotion) {
      // A still bar at rest reads as "busy" without any movement at all.
      offset.set(width * (1 - SEGMENT_RATIO) / 2);
      return;
    }

    offset.set(-width * SEGMENT_RATIO);
    offset.set(withRepeat(
      withTiming(width, { duration: SWEEP_DURATION_MS, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    ));

    return () => cancelAnimation(offset);
  }, [active, isActive, isReducedMotion, offset, width]);

  const segmentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: isActive ? trackColor : 'transparent' }]}>
      {isActive && width > 0 ? (
        <Animated.View
          style={[
            styles.segment,
            { backgroundColor: color, width: width * SEGMENT_RATIO },
            segmentStyle,
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 3, borderRadius: 2, overflow: 'hidden', pointerEvents: 'none' },
  segment: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
});
