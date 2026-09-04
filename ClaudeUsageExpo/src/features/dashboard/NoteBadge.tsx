import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { MOTION } from '@/src/features/dashboard/motion';

export type NoteTone = 'warning' | 'burning' | 'holding' | 'info';

const TONE_ICONS: Record<NoteTone, keyof typeof Ionicons.glyphMap> = {
  warning: 'alert-circle',
  burning: 'trending-up',
  holding: 'trending-down',
  info: 'layers-outline',
};

const AUTO_HIDE_MS = 6000;

/**
 * The supporting fact on the hero card, reduced to a single glyph. Arrow up means the
 * current rate outpaces the reset, arrow down means it holds. Tapping reveals the full
 * sentence, so the card keeps its height and the big number keeps its size.
 *
 * The whole sentence also lives in the accessibility label, because a tooltip that has to
 * be discovered by tapping is no way to deliver information to a screen reader.
 */
export function NoteBadge({
  bubbleBackground,
  bubbleText,
  color,
  label,
  labelStyle,
  placement = 'below',
  size = 20,
  text,
  tone,
}: {
  bubbleBackground: string;
  bubbleText: string;
  color: string;
  /** Short reading shown beside the glyph. The full sentence stays behind the tap. */
  label?: string;
  labelStyle?: StyleProp<TextStyle>;
  /**
   * Where the bubble opens. In portrait the badge is the card's last row and the space
   * below is free background, so `below` covers nothing. In landscape the card sits near
   * the bottom edge and a bubble below it is cut off, so it opens upward and briefly
   * covers the reset line instead. Being clipped is worse than being covered.
   */
  placement?: 'above' | 'below';
  size?: number;
  text: string;
  tone: NoteTone;
}) {
  const isReducedMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => setIsOpen(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [isOpen]);

  return (
    <View style={styles.host}>
      {isOpen ? (
        <Animated.View
          entering={isReducedMotion ? undefined : FadeIn.duration(MOTION.enter.duration)}
          exiting={isReducedMotion ? undefined : FadeOut.duration(MOTION.exit.duration)}
          style={[
            styles.bubble,
            placement === 'above' ? styles.bubbleAbove : styles.bubbleBelow,
            { backgroundColor: bubbleBackground },
          ]}>
          <Text style={[styles.bubbleText, { color: bubbleText }]}>{text}</Text>
        </Animated.View>
      ) : null}

      <Pressable
        accessibilityHint="Visar förklaringen"
        accessibilityLabel={text}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        hitSlop={10}
        onPress={() => setIsOpen((current) => !current)}
        style={label ? styles.buttonWithLabel : styles.button}>
        <Ionicons color={color} name={TONE_ICONS[tone]} size={size} />
        {label ? <Text style={labelStyle}>{label}</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { alignSelf: 'stretch' },
  button: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  buttonWithLabel: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bubble: {
    position: 'absolute',
    left: 0,
    zIndex: 5,
    minWidth: 190,
    maxWidth: 260,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  bubbleAbove: { bottom: 38 },
  bubbleBelow: { top: 38 },
  bubbleText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
