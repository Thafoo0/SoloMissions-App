import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '../theme';
import { saveDailyTemplate, saveSideQuest } from '../utils/storage';

type QuestType = 'daily' | 'side';

const POINT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const TYPE_OPTIONS: { value: QuestType; label: string; hint: string }[] = [
  { value: 'daily', label: 'Daily Routine', hint: 'Repeats every day and resets at midnight.' },
  { value: 'side', label: 'Side Quest', hint: 'One-time mission. You have 24 hours once it starts.' },
];

const SUCCESS_MESSAGES: Record<QuestType, string> = {
  daily: 'Daily routine added. It returns every day.',
  side: 'Quest accepted. The clock is running.',
};

export default function TaskCreation() {
  const router = useRouter();

  const [questType, setQuestType] = useState<QuestType>('side');
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState<number>(5);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Keep timers so we can clean them up if the screen unmounts
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('Enter a quest title.');
      return;
    }
    setError('');
    setSaving(true);

    try {
      if (questType === 'daily') {
        await saveDailyTemplate(title, points);
      } else {
        await saveSideQuest(title, points);
      }

      setSuccessMessage(SUCCESS_MESSAGES[questType]);
      setTitle('');
      setPoints(5);

      timers.current.push(setTimeout(() => setSuccessMessage(''), 2500));
      timers.current.push(setTimeout(() => router.navigate('/missions'), 700));
    } catch {
      setError('Could not save the quest. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const activeHint = TYPE_OPTIONS.find((o) => o.value === questType)?.hint;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.panel}>
          <Text style={styles.heading}>New Quest</Text>

          {/* Quest type switch */}
          <View style={styles.segment}>
            {TYPE_OPTIONS.map((option) => {
              const selected = option.value === questType;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setQuestType(option.value)}
                  style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{activeHint}</Text>

          <Text style={styles.label}>Quest</Text>
          <TextInput
            style={[styles.input, !!error && !title.trim() && styles.inputError]}
            value={title}
            onChangeText={(text) => {
              setTitle(text);
              if (error) setError('');
            }}
            placeholder={
              questType === 'daily' ? 'e.g. 100 pushups' : 'e.g. Finish chapter 3 exercises'
            }
            placeholderTextColor={colors.textMuted}
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />

          <Text style={styles.label}>Points</Text>
          <View style={styles.chipRow}>
            {POINT_OPTIONS.map((value) => {
              const selected = value === points;
              return (
                <Pressable
                  key={value}
                  onPress={() => setPoints(value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {value}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            onPress={handleCreate}
            disabled={saving}
            style={({ pressed }) => [
              styles.button,
              (pressed || saving) && styles.buttonPressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>
              {saving ? 'Saving...' : questType === 'daily' ? 'Add Daily Routine' : 'Create Quest'}
            </Text>
          </Pressable>

          {!!successMessage && (
            <View style={styles.toast}>
              <Text style={styles.toastText}>{successMessage}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 20,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  heading: { color: colors.primary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  segmentButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  segmentButtonSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  segmentTextSelected: { color: colors.background, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 14, marginTop: 8, marginBottom: 20 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 20,
  },
  inputError: { borderColor: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  chipTextSelected: { color: colors.background },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 12 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '700' },
  toast: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 6,
    padding: 12,
  },
  toastText: { color: colors.success, fontSize: 14, textAlign: 'center' },
});