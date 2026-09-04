import { StyleSheet, Text, View } from 'react-native';

import type { ActivityBucket } from '@/src/domain/history';

/**
 * Consumption per 20 minute slot over the last five hours. A percentage shows a level,
 * this shows where the work happened, which is what makes a burst visible.
 *
 * Deliberately not animated. It is data, and a chart that moves on its own invites the
 * reader to watch it rather than read it.
 */
export function ActivityStrip({
  buckets,
  color,
  emptyColor,
  labelColor,
  titleColor,
}: {
  buckets: ActivityBucket[];
  color: string;
  emptyColor: string;
  labelColor: string;
  titleColor: string;
}) {
  const peak = Math.max(...buckets.map((bucket) => bucket.rise));
  const total = buckets.reduce((sum, bucket) => sum + bucket.rise, 0);
  const lastActive = buckets.reduce(
    (index, bucket, current) => (bucket.rise > 0 ? current : index),
    -1,
  );

  return (
    <View
      accessibilityLabel={`Förbrukning senaste fem timmarna, ${formatPercent(total)} procent totalt`}
      accessibilityRole="image">
      <View style={styles.header}>
        <Text style={[styles.title, { color: titleColor }]}>Förbrukning senaste 5 h</Text>
        <Text style={[styles.total, { color: titleColor }]}>{`${formatPercent(total)} %`}</Text>
      </View>

      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bars}>
        {buckets.map((bucket, index) => {
          const isEmpty = bucket.rise <= 0;
          // Empty slots keep a hairline so the five hour span stays readable as a span,
          // instead of the bars appearing to start wherever the first work happened.
          const height = isEmpty ? 2 : Math.max(4, Math.round((bucket.rise / peak) * 28));

          return (
            <View
              key={bucket.from}
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: isEmpty ? emptyColor : color,
                  opacity: isEmpty || index === lastActive ? 1 : 0.72,
                },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={[styles.axis, { color: labelColor }]}>5 h sedan</Text>
        <Text style={[styles.axis, { color: labelColor }]}>nu</Text>
      </View>
    </View>
  );
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 },
  title: { fontSize: 13, fontWeight: '700' },
  total: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 28 },
  bar: { flex: 1, borderRadius: 2, minWidth: 3 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axis: { fontSize: 11 },
});
