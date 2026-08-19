/**
 * Patient login screen.
 *
 * Authenticates the user against /api/patient-portal/login on the platform.
 * Uses the same portal username/password and optional SMS verification flow
 * as the web patient portal.
 *
 * The demo username hint is fail-closed: it is rendered only when
 * EXPO_PUBLIC_DEMO_MODE is explicitly "true", and never embeds a password.
 *
 * TODO (v2): wire `expo-local-authentication` for biometric unlock once
 * the package is added to mobile/package.json. The scaffold is in
 * `triggerBiometricUnlock` below.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { colors, spacing, radius, fontSize } from '../lib/theme';
import { useAuth } from '../lib/auth';
import TamamHealthLogo from '../components/TamamHealthLogo';

const DEMO_MODE_ENABLED = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

const DEMO_USERNAME = 'patient.mary';

/**
 * Stub for biometric unlock. Returns true if biometric auth succeeded.
 * Currently a no-op because expo-local-authentication is not installed —
 * see TODO at top of file.
 */
async function triggerBiometricUnlock(): Promise<boolean> {
  // Intentionally false: feature gated until the package lands.
  return false;
}

export default function LoginScreen() {
  const { signIn, verifyOtp, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpChallenge, setOtpChallenge] = useState<{ challengeId: string; maskedPhone?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || isLoading;

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert('Required', 'Please enter your username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn({ username: username.trim(), password });
      if (result.otpRequired) {
        setOtpChallenge({ challengeId: result.challengeId, maskedPhone: result.maskedPhone });
        setOtpCode('');
      }
      // On success, the AuthProvider flips isAuthenticated and the root
      // navigator routes us into the tab stack. Nothing to do here.
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to sign in right now. Please try again.';
      Alert.alert('Login Failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpChallenge || otpCode.length !== 6) {
      Alert.alert('Required', 'Enter the 6-digit verification code.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyOtp(otpChallenge.challengeId, otpCode);
    } catch (err) {
      Alert.alert('Verification Failed', err instanceof Error ? err.message : 'Please sign in again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBiometric = async () => {
    const ok = await triggerBiometricUnlock();
    if (!ok) {
      Alert.alert('Unavailable', 'Biometric unlock is not enabled on this build.');
    }
  };

  const fillDemo = () => {
    setUsername(DEMO_USERNAME);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.header}>
          <TamamHealthLogo size={72} />
          <Text style={styles.title}>TamamHealth</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {otpChallenge ? (
            <>
              <Text style={styles.instructions}>
                {otpChallenge.maskedPhone
                  ? `Enter the 6-digit code sent to ${otpChallenge.maskedPhone}.`
                  : 'Enter the 6-digit code sent to the phone number on your record.'}
              </Text>
              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor={colors.textTertiary}
                value={otpCode}
                onChangeText={value => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                editable={!busy}
              />
              <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]}
                onPress={handleVerifyOtp} disabled={busy || otpCode.length !== 6}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Verify and Sign In</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.biometricButton} disabled={busy}
                onPress={() => { setOtpChallenge(null); setOtpCode(''); }}>
                <Text style={styles.biometricText}>Back to Sign In</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your portal username"
                placeholderTextColor={colors.textTertiary}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                editable={!busy}
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                editable={!busy}
              />
              <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]}
                onPress={handleLogin} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Sign In</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.biometricButton} onPress={handleBiometric} disabled={busy}>
                <Text style={styles.biometricText}>Use Biometric Unlock</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Demo accounts — gated on EXPO_PUBLIC_DEMO_MODE */}
        {DEMO_MODE_ENABLED && (
          <View style={styles.demoSection}>
            <Text style={styles.demoTitle}>DEMO ACCOUNTS</Text>
            <TouchableOpacity style={styles.demoButton} onPress={fillDemo} disabled={busy}>
              <Text style={styles.demoName}>{DEMO_USERNAME}</Text>
              <Text style={styles.demoId}>Tap to fill username</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.flagStripe}>
            <View style={[styles.stripe, { backgroundColor: '#000' }]} />
            <View style={[styles.stripe, { backgroundColor: '#C44536' }]} />
            <View style={[styles.stripe, { backgroundColor: '#FFF' }]} />
            <View style={[styles.stripe, { backgroundColor: '#1B9E77' }]} />
            <View style={[styles.stripe, { backgroundColor: '#2A7A6E' }]} />
            <View style={[styles.stripe, { backgroundColor: '#E4A84B' }]} />
          </View>
          <Text style={styles.footerText}>TamamHealth Health Technologies</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  scroll: { flexGrow: 1, padding: spacing.lg },
  header: { alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.xl },
  title: { fontSize: fontSize.hero, fontWeight: '800', color: colors.navy, marginTop: spacing.md },
  subtitle: { fontSize: fontSize.lg, color: colors.textSecondary, marginTop: spacing.xs },
  form: {},
  instructions: { fontSize: fontSize.md, color: colors.textSecondary, marginBottom: spacing.sm },
  label: {
    fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary,
    marginBottom: spacing.xs, marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.cream300,
    borderRadius: radius.sm, padding: spacing.md, fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  button: {
    backgroundColor: colors.green, borderRadius: radius.sm,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
  biometricButton: {
    alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.sm,
  },
  biometricText: {
    fontSize: fontSize.sm, color: colors.teal, fontWeight: '600',
  },
  demoSection: {
    marginTop: spacing.xl, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.cream300,
  },
  demoTitle: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textTertiary,
    letterSpacing: 1, marginBottom: spacing.sm,
  },
  demoButton: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.cream100, borderWidth: 1, borderColor: colors.cream300,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  demoName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  demoId: { fontSize: fontSize.xs, color: colors.textTertiary },
  footer: { alignItems: 'center', marginTop: 'auto', paddingTop: spacing.xl },
  flagStripe: { flexDirection: 'row', width: 120, height: 4, borderRadius: 2, overflow: 'hidden' },
  stripe: { flex: 1 },
  footerText: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.sm },
});
