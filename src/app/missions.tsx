import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Modal, Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import Swipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { colors } from '../theme';
import {
  deleteTask,
  getTasks,
  getWeeklyReportStatus,
  getWeeklyStats,
  markWeeklyReportSeen,
  spawnDailiesIfNewDay,
  toggleTaskStatus,
} from '../utils/storage';

type Task = {
  id: string;
  title: string;
  points: number;
  type: 'daily' | 'side';
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'done';
};

type Variant = 'active' | 'done' | 'failed';

type WeeklyStats = {
  totalEarned: number;
  totalPossible: number;
  percentage: number;
  weekStart: string; // "YYYY-MM-DD" of the Monday
};

type Section = {
  key: string;
  title: string;
  variant: Variant;
  data: Task[];
};

// ---------- Constants ----------
const XP_PER_LEVEL = 100;
const URGENT_MS = 60 * 60 * 1000;   // under 1 hour: orange
const CRITICAL_MS = 10 * 60 * 1000; // under 10 minutes: red
const ORANGE = '#FF9F43';

// Weekly report: set to false to show the report on the first open of any new week
// (with true, a week is skipped if you don't open the app on Monday)
const REPORT_ONLY_ON_MONDAY = true;

// Muted red for the failed section
const FAILED_BG = '#150C12';
const FAILED_BORDER = '#3D1B22';
const FAILED_TEXT = '#B66A6F';

// ---------- Helpers ----------
// 3725000 ms -> "01:02:05"
function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function timerColor(remaining: number) {
  if (remaining < CRITICAL_MS) return colors.danger;
  if (remaining < URGENT_MS) return ORANGE;
  return colors.primary;
}

const sumPoints = (list: Task[]) => list.reduce((sum, t) => sum + t.points, 0);

// Hunter rank from the weekly percentage
function getRank(percentage: number) {
  if (percentage >= 90) return { letter: 'S', color: '#FFD54A', line: 'A flawless week, Hunter.' };
  if (percentage >= 80) return { letter: 'A', color: colors.danger, line: 'Elite performance.' };
  if (percentage >= 70) return { letter: 'B', color: colors.primary, line: 'Solid work. Push harder.' };
  if (percentage >= 50) return { letter: 'C', color: colors.success, line: 'There is room to grow.' };
  return { letter: 'E', color: '#8A94A6', line: 'The system expects more.' };
}

function WeeklyReportModal({
  visible,
  stats,
  onAccept,
}: {
  visible: boolean;
  stats: WeeklyStats | null;
  onAccept: () => void;
}) {
  if (!stats) return null;
  const rank = getRank(stats.percentage);
  const weekLabel = new Date(stats.weekStart + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onAccept}>
      <View style={styles.overlay}>
        <Animated.View
          entering={FadeInDown.duration(350)}
          style={[styles.reportCard, { borderColor: rank.color, shadowColor: rank.color }]}
        >
          <Text style={styles.reportKicker}>WEEKLY EVALUATION</Text>
          <Text style={styles.reportWeek}>Week of {weekLabel}</Text>

          <View style={[styles.reportDivider, { backgroundColor: rank.color }]} />

          <Text style={styles.rankLabel}>HUNTER RANK</Text>
          <Text
            style={[
              styles.rankLetter,
              { color: rank.color, textShadowColor: rank.color },
            ]}
          >
            {rank.letter}
          </Text>
          <Text style={[styles.rankName, { color: rank.color }]}>{rank.letter}-RANK</Text>

          <Text style={styles.reportXp}>{stats.totalEarned} XP</Text>
          <Text style={styles.reportSub}>
            earned of {stats.totalPossible} possible · {stats.percentage}%
          </Text>
          <Text style={styles.reportLine}>{rank.line}</Text>

          <Pressable
            onPress={onAccept}
            style={({ pressed }) => [
              styles.acceptButton,
              { backgroundColor: rank.color },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.acceptText}>Accept Evaluation</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Colored panel revealed behind the card while swiping
function SwipeAction({ progress, side }: { progress: SharedValue<number>; side: 'complete' | 'delete' }) {
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0.8, 1], 'clamp'),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.6, 1], 'clamp') }],
  }));
  const complete = side === 'complete';
  return (
    <View style={[styles.swipeAction, complete ? styles.swipeComplete : styles.swipeDelete]}>
      <Animated.View style={iconStyle}>
        <Ionicons name={complete ? 'checkmark-circle' : 'trash'} size={30} color={colors.background} />
      </Animated.View>
    </View>
  );
}

// Swipe right = complete, swipe left = abandon
function SwipeRow({
  onComplete,
  onDelete,
  children,
}: {
  onComplete: () => void;
  onDelete: (cancel: () => void) => void;
  children: ReactNode;
}) {
  const ref = useRef<SwipeableMethods>(null);
  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={(progress) => <SwipeAction progress={progress} side="complete" />}
      renderRightActions={(progress) => <SwipeAction progress={progress} side="delete" />}
      onSwipeableOpen={(direction) => {
        if (direction === SwipeDirection.RIGHT) {
          onComplete(); // dragged to the right: the "complete" panel opened
        } else {
          onDelete(() => ref.current?.close()); // snap back if the user cancels
        }
      }}
    >
      {children}
    </Swipeable>
  );
}

function TrashButton({ onPress, label, color }: { onPress: () => void; label: string; color: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name="trash-outline" size={18} color={color} />
    </Pressable>
  );
}

// ---------- Screen ----------
export default function MissionTracking() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());
  const loadedDay = useRef(dayKey(Date.now()));

  // Weekly evaluation popup
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);

  // Spawn today's dailies first, then read the updated list
  const load = useCallback(async () => {
    await spawnDailiesIfNewDay();
    const data: Task[] = await getTasks();
    loadedDay.current = dayKey(Date.now());
    setTasks(data);
  }, []);

  // Runs every time the tab gains focus; also starts the 1s ticker
  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().then(() => active && setNow(Date.now()));

      const interval = setInterval(() => {
        const current = Date.now();
        setNow(current);
        // Midnight passed while the screen was open: spawn the new day's dailies
        if (dayKey(current) !== loadedDay.current) load();
      }, 1000);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [load])
  );

  // Show the weekly report when it hasn't been seen this week (and today is Monday)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (REPORT_ONLY_ON_MONDAY && new Date().getDay() !== 1) return;
        if (await getWeeklyReportStatus()) return;

        const stats: WeeklyStats = await getWeeklyStats();
        if (!active) return;

        if (stats.totalPossible === 0) {
          await markWeeklyReportSeen(); // nothing to evaluate (e.g. brand new install)
          return;
        }
        setWeeklyStats(stats);
        setShowWeeklyReport(true);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const handleAcceptReport = async () => {
    await markWeeklyReportSeen();
    setShowWeeklyReport(false);
  };

  const handleToggle = async (id: string) => {
    const updated = await toggleTaskStatus(id);
    if (!updated) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));

    if (updated.status === 'done') {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // haptics are not available everywhere (e.g. some browsers): ignore
      }
    }
  };

  const handleDelete = (id: string, title: string, onCancel?: () => void) => {
    const isDaily = tasks.find((t) => t.id === id)?.type === 'daily';
    const message = isDaily
      ? `"${title}" will be removed for today. The routine still returns at the next reset.`
      : `"${title}" will be removed permanently.`;

    const confirmDelete = async () => {
      const removed = await deleteTask(id);
      if (removed) setTasks((prev) => prev.filter((t) => t.id !== id));
    };

    // Alert.alert does nothing on the web version, so use the browser confirm there
    if (Platform.OS === 'web') {
      const confirmFn = (globalThis as any).confirm as ((text: string) => boolean) | undefined;
      if (confirmFn && confirmFn(`Abandon Quest?\n\n${message}`)) confirmDelete();
      else onCancel?.();
      return;
    }

    Alert.alert(
      'Abandon Quest?',
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ],
      { cancelable: true, onDismiss: onCancel }
    );
  };

  // ---------- Derived data ----------
  const todayStart = startOfDay(now);
  // Only tasks whose deadline is today or later are on the board (older ones stay in history)
  const visible = tasks.filter((t) => new Date(t.expiresAt).getTime() >= todayStart);
  const remainingOf = (t: Task) => new Date(t.expiresAt).getTime() - now;
  const byDeadline = (a: Task, b: Task) =>
    new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();

  const activeTasks = visible.filter((t) => t.status === 'active' && remainingOf(t) > 0).sort(byDeadline);
  const doneTasks = visible.filter((t) => t.status === 'done').sort(byDeadline);
  const failedTasks = visible.filter((t) => t.status === 'active' && remainingOf(t) <= 0).sort(byDeadline);

  const allSections: Section[] = [
    { key: 'daily', title: 'Daily Routines', variant: 'active', data: activeTasks.filter((t) => t.type === 'daily') },
    { key: 'side', title: 'Side Quests', variant: 'active', data: activeTasks.filter((t) => t.type !== 'daily') },
    { key: 'done', title: 'Completed', variant: 'done', data: doneTasks },
    { key: 'failed', title: 'Failed', variant: 'failed', data: failedTasks },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  // Header stats
  const totalToday = sumPoints(visible);
  const completedToday = sumPoints(doneTasks);
  const progress = totalToday > 0 ? completedToday / totalToday : 0;

  const lifetimeXp = sumPoints(tasks.filter((t) => t.status === 'done'));
  const level = Math.floor(lifetimeXp / XP_PER_LEVEL) + 1;
  const xpToNext = XP_PER_LEVEL - (lifetimeXp % XP_PER_LEVEL);

  // ---------- Renderers ----------
  const header = (
    <View style={styles.hud}>
      <View style={styles.levelBox}>
        <Text style={styles.levelLabel}>LV</Text>
        <Text style={styles.levelValue}>{level}</Text>
      </View>
      <View style={styles.hudBody}>
        <View style={styles.hudRow}>
          <Text style={styles.hudLabel}>TODAY'S XP</Text>
          <Text style={styles.hudValue}>
            {completedToday} / {totalToday}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: progress >= 1 ? colors.success : colors.primary },
            ]}
          />
        </View>
        <Text style={styles.hudSub}>
          {lifetimeXp} XP total · {xpToNext} to LV {level + 1}
        </Text>
      </View>
    </View>
  );

  const renderSectionHeader = ({ section }: { section: Section }) => {
    const tint =
      section.variant === 'done' ? colors.success : section.variant === 'failed' ? FAILED_TEXT : colors.primary;
    return (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: tint }]}>{section.title}</Text>
        <Text style={[styles.sectionCount, { color: tint }]}>{section.data.length}</Text>
        <View style={[styles.sectionLine, { backgroundColor: tint }]} />
      </View>
    );
  };

  const renderItem = ({ item, section }: { item: Task; section: Section }) => {
    const remaining = remainingOf(item);

    // Prominent card for active quests
    if (section.variant === 'active') {
      const color = timerColor(remaining);
      const urgent = remaining < URGENT_MS;
      return (
        <Animated.View
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(150)}
          layout={LinearTransition.springify()}
        >
          <SwipeRow
            onComplete={() => handleToggle(item.id)}
            onDelete={(cancel) => handleDelete(item.id, item.title, cancel)}
          >
            <View style={[styles.card, { borderLeftColor: urgent ? color : colors.primary }]}>
              <View style={styles.cardTop}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.xpPill}>
                  <Text style={styles.xpText}>+{item.points} XP</Text>
                </View>
                <TrashButton
                  onPress={() => handleDelete(item.id, item.title)}
                  label={`Delete ${item.title}`}
                  color={colors.textMuted}
                />
              </View>

              <View style={styles.timerRow}>
                <Text style={styles.timerLabel}>{item.type === 'daily' ? 'RESETS IN' : 'TIME LEFT'}</Text>
                <Text style={[styles.timer, { color }]}>{formatCountdown(remaining)}</Text>
              </View>

              <Pressable
                onPress={() => handleToggle(item.id)}
                style={({ pressed }) => [styles.completeButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="checkmark" size={18} color={colors.background} />
                <Text style={styles.completeText}>Complete Quest</Text>
              </Pressable>
            </View>
          </SwipeRow>
        </Animated.View>
      );
    }

    // Compact row for completed quests
    if (section.variant === 'done') {
      const locked = remaining <= 0; // after the deadline the result is final
      return (
        <Animated.View
          style={styles.doneRow}
          entering={FadeIn.duration(250)}
          layout={LinearTransition.springify()}
        >
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={styles.doneTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.doneXp}>+{item.points} XP</Text>
          {locked ? (
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
          ) : (
            <Pressable
              onPress={() => handleToggle(item.id)}
              hitSlop={12}
              style={({ pressed }) => pressed && styles.pressed}
              accessibilityRole="button"
              accessibilityLabel={`Undo ${item.title}`}
            >
              <Ionicons name="arrow-undo" size={18} color={colors.textMuted} />
            </Pressable>
          )}
          <TrashButton
            onPress={() => handleDelete(item.id, item.title)}
            label={`Delete ${item.title}`}
            color={colors.textMuted}
          />
        </Animated.View>
      );
    }

    // Compact muted row for failed quests
    return (
      <Animated.View
        style={styles.failedRow}
        entering={FadeIn.duration(250)}
        layout={LinearTransition.springify()}
      >
        <Ionicons name="close-circle" size={20} color={FAILED_TEXT} />
        <Text style={styles.failedTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.failedTag}>FAILED</Text>
        <Text style={styles.failedXp}>{item.points} XP</Text>
        <TrashButton
          onPress={() => handleDelete(item.id, item.title)}
          label={`Delete ${item.title}`}
          color={FAILED_TEXT}
        />
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={() => <View style={styles.sectionGap} />}
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: Task }) => {
          // Cards get more breathing room than compact rows
          const isCard = leadingItem?.status === 'active' && remainingOf(leadingItem) > 0;
          return <View style={{ height: isCard ? 12 : 6 }} />;
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No quests yet</Text>
            <Text style={styles.emptyText}>Create a quest in the New Quest tab to begin.</Text>
          </View>
        }
        stickySectionHeadersEnabled={false}
        extraData={now}
        contentContainerStyle={styles.list}
      />

      <WeeklyReportModal
        visible={showWeeklyReport}
        stats={weeklyStats}
        onAccept={handleAcceptReport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center', flexGrow: 1 },

  // HUD (progress + level)
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  levelBox: {
    width: 56,
    height: 56,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  levelValue: { color: colors.primary, fontSize: 24, fontWeight: '800', lineHeight: 26 },
  hudBody: { flex: 1, gap: 6 },
  hudRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  hudLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  hudValue: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 5 },
  hudSub: { color: colors.textMuted, fontSize: 12 },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  sectionCount: { fontSize: 13, fontWeight: '700' },
  sectionLine: { flex: 1, height: 1, opacity: 0.35 },
  sectionGap: { height: 22 },

  // Active cards (prominent)
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 16,
    gap: 14,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  xpPill: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  xpText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  timerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  timerLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  timer: {
    fontSize: 30,
    fontWeight: '800',
    fontVariant: ['tabular-nums'], // stops digits from jittering as they change
    letterSpacing: 1,
  },
  completeButton: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeText: { color: colors.background, fontWeight: '800', fontSize: 15 },
  pressed: { opacity: 0.7 },

  // Weekly report modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  reportCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(12, 22, 38, 0.92)', // glass-style: translucent dark panel
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  reportKicker: { color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: 4 },
  reportWeek: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  reportDivider: { height: 1, width: '60%', opacity: 0.5, marginVertical: 20 },
  rankLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 3 },
  rankLetter: {
    fontSize: 110,
    lineHeight: 124,
    fontWeight: '900',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 26,
  },
  rankName: { fontSize: 18, fontWeight: '800', letterSpacing: 4, marginBottom: 20 },
  reportXp: { color: colors.text, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  reportSub: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  reportLine: { color: colors.textMuted, fontSize: 14, fontStyle: 'italic', marginTop: 14, marginBottom: 24 },
  acceptButton: { alignSelf: 'stretch', borderRadius: 6, paddingVertical: 14, alignItems: 'center' },
  acceptText: { color: colors.background, fontSize: 16, fontWeight: '800', letterSpacing: 1 },

  // Swipe panels
  swipeAction: { width: 100, alignItems: 'center', justifyContent: 'center' },
  swipeComplete: {
    backgroundColor: colors.success,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  swipeDelete: {
    backgroundColor: colors.danger,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },

  // Completed rows (compact)
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  doneTitle: { flex: 1, color: colors.textMuted, fontSize: 15, textDecorationLine: 'line-through' },
  doneXp: { color: colors.success, fontSize: 13, fontWeight: '700' },

  // Failed rows (compact, muted red)
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: FAILED_BG,
    borderWidth: 1,
    borderColor: FAILED_BORDER,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  failedTitle: { flex: 1, color: FAILED_TEXT, fontSize: 15 },
  failedTag: { color: FAILED_TEXT, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  failedXp: { color: FAILED_TEXT, fontSize: 13, fontWeight: '700', opacity: 0.8 },

  // Empty state
  empty: { flex: 1, justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginTop: 6 },
});