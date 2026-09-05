import { BlurTargetView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { RefObject } from 'react';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import {
  GLASS_TOKENS,
  findBuiltInBackground,
  withAlpha,
  type BackgroundId,
} from '@/src/features/dashboard/glass';
import { MOTION } from '@/src/features/dashboard/motion';

/**
 * What the glass panes actually blur. It sits behind every other layer and never takes
 * touches, so nothing above it changes behaviour.
 *
 * A picked photo gets a scrim on top of it. Without one, a bright or busy image drags the
 * whole screen's contrast down even though each pane is safe on its own, because the
 * background is also visible in the gaps between panes where nothing protects the eye.
 * That scrim's strength is part of the contrast derivation in glass.ts, not a taste knob.
 *
 * Everything here sits inside a BlurTargetView, which is what Android actually blurs: a
 * BlurView with no target falls back to a flat tint and no blur at all. Only the background
 * is inside it, never the panes, or the blur would sample itself. On iOS BlurTargetView is
 * an ordinary View and this costs nothing.
 *
 * Switching background cross-fades rather than cutting. The new layer is keyed so it
 * mounts fresh and fades in, while the old one is held on screen by its exit animation and
 * fades out underneath it. That is cheaper than animating a gradient's colour stops and
 * reads the same. The two overlap, so a static base colour sits below both: without it,
 * any frame where neither layer is fully opaque would show the bare window through.
 */
export function AppBackground({
  backgroundId,
  customUri,
  targetRef,
}: {
  backgroundId: BackgroundId;
  customUri: string | null;
  targetRef: RefObject<View | null>;
}) {
  const isCustom = backgroundId === 'custom' && customUri !== null;
  const selectedBackground = findBuiltInBackground(backgroundId);
  const imageSource = isCustom
    ? { uri: customUri }
    : selectedBackground.image;
  const reduceMotion = useReducedMotion();
  const entering = reduceMotion ? undefined : FadeIn.duration(MOTION.move.duration);
  const exiting = reduceMotion ? undefined : FadeOut.duration(MOTION.move.duration);

  return (
    <BlurTargetView ref={targetRef} style={styles.layer}>
      <View style={[styles.layer, styles.base]} />
      {imageSource ? (
        <Animated.View
          entering={entering}
          exiting={exiting}
          key={isCustom ? customUri : backgroundId}
          style={styles.layer}>
          <Image
            // cover keeps any aspect ratio filling the screen without distorting it,
            // which matters because the user can pick a photo of any shape.
            contentFit="cover"
            source={imageSource}
            style={styles.layer}
            // The parent already cross-fades; avoid a second full-screen transition.
            transition={0}
          />
          <View
            style={[
              styles.layer,
              { backgroundColor: withAlpha(GLASS_TOKENS.photoScrimTint, GLASS_TOKENS.photoScrimAlpha) },
            ]}
          />
        </Animated.View>
      ) : (
        <Animated.View entering={entering} exiting={exiting} key={backgroundId} style={styles.layer}>
          <LinearGradient
            colors={findBuiltInBackground(backgroundId).colors}
            end={{ x: 0.9, y: 1 }}
            start={{ x: 0.1, y: 0 }}
            style={styles.layer}
          />
        </Animated.View>
      )}
    </BlurTargetView>
  );
}

const styles = StyleSheet.create({
  // Written out rather than using StyleSheet.absoluteFillObject, which React Native 0.86
  // removed. Spreading that missing helper is what silently broke the login overlay.
  // pointerEvents belongs in the style rather than as a prop, which RN now warns about.
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  // The darkest stop any background reaches, so a mid-cross-fade frame is never brighter
  // than the panes above it were measured against.
  base: { backgroundColor: '#050A08' },
});
