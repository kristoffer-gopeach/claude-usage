import { Pressable, type StyleProp, Text, type TextStyle } from 'react-native';

export type ResetFormat = 'clock' | 'remaining';

/**
 * Shows when a limit resets, either as a clock time or as the time left. Tapping switches
 * between the two and the choice is remembered, so this is a display preference rather
 * than a peek: every reset label in the app follows the same setting and it survives a
 * restart. It used to hold its own state and snap back after a few seconds, which meant
 * the same screen could show both formats at once.
 *
 * The swap happens in place rather than in a bubble, so it cannot be clipped inside the
 * narrow landscape panel. Both readings live in the accessibility label, since a screen
 * reader should not have to discover a tap to get the other one.
 */
export function ResetLabel({
  clockText,
  format,
  numberOfLines,
  onToggle,
  remainingText,
  style,
}: {
  clockText: string;
  format: ResetFormat;
  numberOfLines?: number;
  onToggle: () => void;
  remainingText: string | null;
  style?: StyleProp<TextStyle>;
}) {
  // Nothing to switch to, so it should not look or behave like a button.
  if (!remainingText) {
    return (
      <Text numberOfLines={numberOfLines} style={style}>
        {clockText}
      </Text>
    );
  }

  return (
    <Pressable
      accessibilityHint="Byter mellan klockslag och återstående tid"
      accessibilityLabel={`${clockText}. ${remainingText}.`}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onToggle}
      style={{ flex: 1 }}>
      <Text numberOfLines={numberOfLines} style={style}>
        {format === 'remaining' ? remainingText : clockText}
      </Text>
    </Pressable>
  );
}
