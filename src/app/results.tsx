import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { getTasks } from '../utils/storage';

type Task = {
  id: string;
  title: string;
  points: number;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'done';
};

type DayStats = {
  total: number;      // points created that day
  completed: number;  // points of done tasks
  failed: number;     // points of active tasks past their deadline
  pending: number;    // points of active tasks still running
  score: number;      // 0..10
};

const WEEKS = 14;     // ~3 months, fits a phone screen
const CELL = 18;
const GAP = 4;

const SCORE_COLORS = {
  low: colors.danger,
  mid: '#F5A524',
  high: colors.success,
};

// Local-time "YYYY-MM-DD" (toISOString would give UTC and shift days near midnight)
function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const EMPTY_STATS: DayStats = { total: 0, completed: 0, failed: 0, pending: 0, score: 0 };

// Group tasks by the day they were created and compute each day's score
function buildStats(tasks: Task[], now: number) {
  const map = new Map<string, DayStats>();

  for (const task of tasks) {
    const key = dateKey(new Date(task.createdAt));
    const s = map.get(key) ?? { ...EMPTY_STATS };
    s.total += task.points;

    if (task.status === 'done') s.completed += task.points;
    else if (new Date(task.expiresAt).getTime() <= now) s.failed += task.points;
    else s.pending += task.points;

    map.set(key, s);
  }

  // (completed / created) * 10, defaulting to 0 when nothing exists
  map.forEach((s) => {
    s.score = s.total > 0 ? (s.completed / s.total) * 10 : 0;
  });
  return map;
}

function scoreColor(score: number) {
  const rounded = Math.round(score);
  if (rounded >= 8) return SCORE_COLORS.high;
  if (rounded >= 4) return SCORE_COLORS.mid;
  return SCORE_COLORS.low;
}

// Build 14 week-columns (Mon..Sun) ending with the current week
function buildGrid() {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - (WEEKS - 1) * 7);

  const todayKey = dateKey(today);
  const weeks = [];
  for (let w = 0; w < WEEKS; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const key = dateKey(date);
      days.push({ key, date, isFuture: key > todayKey });
    }
    weeks.push(days);
  }
  return { weeks, todayKey };
}

export default function ResultsCalendar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);

  // Reload on focus; refresh "now" every 30s so pending -> failed updates
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTasks().then((data: Task[]) => active && setTasks(data));
      setNow(Date.now());
      const interval = setInterval(() => setNow(Date.now()), 30000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [])
  );

  const stats = useMemo(() => buildStats(tasks, now), [tasks, now]);
  const { weeks, todayKey } = useMemo(buildGrid, []);

  const activeKey = selected ?? todayKey;
  const day = stats.get(activeKey) ?? EMPTY_STATS;
  const label =
    activeKey === todayKey
      ? 'Today'
      : new Date(activeKey + 'T00:00:00').toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Results</Text>

        <View style={styles.grid}>
          {weeks.map((week, w) => (
            <View key={w} style={styles.column}>
              {week.map(({ key, isFuture }) => {
                const s = stats.get(key);
                const bg = isFuture ? 'transparent' : s ? scoreColor(s.score) : colors.background;
                return (
                  <Pressable
                    key={key}
                    disabled={isFuture}
                    onPress={() => setSelected(key)}
                    accessibilityLabel={`${key}${s ? `, score ${s.score.toFixed(1)}` : ', no quests'}`}
                    style={[
                      styles.cell,
                      { backgroundColor: bg },
                      isFuture && styles.cellFuture,
                      key === todayKey && styles.cellToday,
                      key === activeKey && styles.cellSelected,
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.legend}>
          <LegendItem color={colors.background} text="No quests" />
          <LegendItem color={SCORE_COLORS.low} text="0-3" />
          <LegendItem color={SCORE_COLORS.mid} text="4-7" />
          <LegendItem color={SCORE_COLORS.high} text="8-10" />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={[styles.score, { color: day.total ? scoreColor(day.score) : colors.textMuted }]}>
          {day.score.toFixed(1)}
          <Text style={styles.scoreMax}> / 10</Text>
        </Text>

        <SummaryRow name="Completed" value={day.completed} color={colors.success} />
        <SummaryRow name="Failed" value={day.failed} color={colors.danger} />
        <SummaryRow name="In progress" value={day.pending} color={colors.primary} />

        {day.total === 0 && <Text style={styles.emptyText}>No quests on this day.</Text>}
      </View>
    </ScrollView>
  );
}

function LegendItem({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

function SummaryRow({ name, value, color }: { name: string; value: number; color: string }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.rowName}>{name}</Text>
      <Text style={styles.rowValue}>{value} pts</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 16, alignItems: 'center' },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    width: '100%',
    maxWidth: 520,
  },
  heading: { color: colors.primary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  grid: { flexDirection: 'row', gap: GAP, alignSelf: 'center' },
  column: { gap: GAP },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellFuture: { borderColor: 'transparent' },
  cellToday: { borderColor: colors.text },
  cellSelected: { borderColor: colors.primary, borderWidth: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: colors.border },
  legendText: { color: colors.textMuted, fontSize: 12 },
  sectionLabel: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  score: { fontSize: 44, fontWeight: '700', marginVertical: 8 },
  scoreMax: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  rowName: { color: colors.text, fontSize: 15, flex: 1 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 14, marginTop: 8 },
});