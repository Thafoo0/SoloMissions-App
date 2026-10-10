import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
import { supabase } from '../utils/supabase';

type Mode = 'signin' | 'signup';

const MIN_PASSWORD_LENGTH = 6; // Supabase's default minimum
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MODES: { value: Mode; label: string; tagline: string }[] = [
  { value: 'signin', label: 'Sign In', tagline: 'The system has been waiting for you, Hunter.' },
  { value: 'signup', label: 'Sign Up', tagline: 'Register as a Hunter and accept your first quest.' },
];

// Haptics are not available everywhere (e.g. some browsers), so never let them crash the screen
async function tap(kind: 'light' | 'success' | 'error') {
  try {
    if (kind === 'light') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // ignore
  }
}

export default function Auth() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const isSignUp = mode === 'signup';
  const tagline = MODES.find((m) => m.value === mode)?.tagline;

  const switchMode = (next: Mode) => {
    tap('light');
    setMode(next);
    setError('');
    setInfo('');
    setConfirm('');
  };

  const validate = () => {
    if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD_LENGTH)
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (isSignUp && password !== confirm) return 'Passwords do not match.';
    return '';
  };

  const handleSubmit = async () => {
    if (loading) return;
    tap('light');

    const problem = validate();
    if (problem) {
      setError(problem);
      setInfo('');
      tap('error');
      return;
    }

    setError('');
    setInfo('');
    setLoading(true);

    try {
      const credentials = { email: email.trim(), password };

      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp(credentials);
        if (signUpError) throw signUpError;

        if (data.session) {
          // Email confirmation is off: the user is already signed in
          tap('success');
          router.replace('/');
        } else {
          // Email confirmation is on: the user must confirm before signing in
          tap('success');
          setMode('signin');
          setPassword('');
          setConfirm('');
          setInfo('Account created. Check your email to confirm it, then sign in.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword(credentials);
        if (signInError) throw signInError;

        tap('success');
        router.replace('/');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Try again.');
      tap('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>MISSION REMINDER</Text>
        <Text style={styles.tagline}>{tagline}</Text>

        <View style={styles.panel}>
          {/* Sign in / Sign up switch */}
          <View style={styles.segment}>
            {MODES.map((option) => {
              const selected = option.value === mode;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => switchMode(option.value)}
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

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (error) setError('');
            }}
            placeholder="hunter@example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              returnKeyType={isSignUp ? 'next' : 'done'}
              onSubmitEditing={isSignUp ? undefined : handleSubmit}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={10}
              style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          {isSignUp && (
            <>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={(text) => {
                  setConfirm(text);
                  if (error) setError('');
                }}
                placeholder="Repeat your password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </>
          )}

          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {!!info && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>{info}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.buttonText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  brand: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
    textShadowColor: colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
    maxWidth: 320,
  },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 20,
  },
  segmentButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  segmentButtonSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  segmentTextSelected: { color: colors.background, fontWeight: '700' },
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
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 44 },
  eye: { position: 'absolute', right: 12, top: 12 },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 12 },
  infoBox: {
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  infoText: { color: colors.success, fontSize: 14, textAlign: 'center' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '700' },
});