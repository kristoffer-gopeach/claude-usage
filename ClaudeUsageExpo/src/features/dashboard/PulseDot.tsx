import { useContext, useEffect } from 'react';
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

/**
 * A slow halo behind a solid dot, used to mark that quota is being consumed right now.
 * The dot itself never moves or fades, so the state is still readable when the system
 * asks for reduced motion and the halo stands still.
 */
export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const isReducedMotion = useReducedMotion();
  const active = useContext(AnimationActivityContext);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (isReducedMotion || !active) {
      progress.set(0.45);
      return;
    }

    progress.set(withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    ));

    return () => cancelAnimation(progress);
  }, [active, isReducedMotion, progress]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.get()),
    transform: [{ scale: 1 + progress.get() * 1.9 }],
  }));

  const halo = size * 1.5;

  return (
    <View style={[styles.host, { width: halo, height: halo }]}>
      <Animated.View
        style={[
          styles.halo,
          { backgroundColor: color, width: size, height: size, borderRadius: size / 2 },
          haloStyle,
        ]}
      />
      <View style={{ backgroundColor: color, width: size, height: size, borderRadius: size / 2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute' },
});
