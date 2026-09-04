import { Easing, type WithTimingConfig } from 'react-native-reanimated';

/**
 * One motion system for the whole app. Every transition picks a duration and a curve from
 * here, so the interface moves the same way everywhere instead of each component
 * inventing its own timing.
 *
 * The durations are deliberately short. Anything slower than this makes a monitoring app
 * that people open for three seconds feel sluggish rather than polished.
 */
export const MOTION = {
  /** Something appearing: menus, bubbles, newly revealed rows. */
  enter: { duration: 180, easing: Easing.out(Easing.cubic) } satisfies WithTimingConfig,
  /** Something leaving. Slightly faster than entering, so dismissal feels immediate. */
  exit: { duration: 130, easing: Easing.in(Easing.cubic) } satisfies WithTimingConfig,
  /** A control moving to a new position, such as the selected tab indicator. */
  move: { duration: 220, easing: Easing.out(Easing.cubic) } satisfies WithTimingConfig,
  /** A value settling to a new size, such as a progress fill after a refresh. */
  value: { duration: 420, easing: Easing.out(Easing.cubic) } satisfies WithTimingConfig,
} as const;

/** Travel distance for entrances. Small on purpose: motion should hint, not swoop. */
export const ENTER_OFFSET = 8;
