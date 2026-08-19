import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Platform,
} from 'react-native';
import { colors, spacing, fontSize, radius } from '../lib/theme';
import TamamHealthLogo from '../components/TamamHealthLogo';

type Props = {
  onGetStarted: () => void;
};

export default function LandingScreen({ onGetStarted }: Props) {
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(20));
  const [logoScale] = useState(() => new Animated.Value(0.85));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, logoScale, slideAnim]);

  return (
    <View style={styles.container}>
      {/* Background accents */}
      <View style={styles.bgAccent1} />
      <View style={styles.bgAccent2} />

      {/* Top section — Logo + Title */}
      <View style={styles.topSection}>
        <Animated.View style={{ transform: [{ scale: logoScale }] }}>
          <TamamHealthLogo size={100} />
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <Text style={styles.title}>TamamHealth</Text>
          <Text style={styles.subtitle}>Patient Portal</Text>
        </Animated.View>
      </View>

      {/* Middle section — Tagline + Features */}
      <Animated.View style={[styles.middleSection, { opacity: fadeAnim }]}>
        <Text style={styles.tagline}>
          Your health records, prescriptions, lab results, and billing — all in one place.
        </Text>

        <View style={styles.featureRow}>
          <FeatureChip icon="📋" label="Records" />
          <FeatureChip icon="🔬" label="Labs" />
          <FeatureChip icon="💊" label="Meds" />
          <FeatureChip icon="📅" label="Visits" />
        </View>

        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeDot}>●</Text>
            <Text style={styles.badgeText}>Works Offline</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeDot}>●</Text>
            <Text style={styles.badgeText}>Encrypted</Text>
          </View>
        </View>
      </Animated.View>

      {/* Bottom section — CTA + Footer */}
      <Animated.View style={[styles.bottomSection, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.ctaButton} onPress={onGetStarted} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Get Started</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>

        {/* Flag stripe */}
        <View style={styles.flagStripe}>
          <View style={[styles.stripe, { backgroundColor: '#000' }]} />
          <View style={[styles.stripe, { backgroundColor: '#C44536' }]} />
          <View style={[styles.stripe, { backgroundColor: '#FFF' }]} />
          <View style={[styles.stripe, { backgroundColor: '#1B9E77' }]} />
          <View style={[styles.stripe, { backgroundColor: '#2A7A6E' }]} />
          <View style={[styles.stripe, { backgroundColor: '#E4A84B' }]} />
        </View>

        <Text style={styles.footer}>TamamHealth Health Technologies</Text>
      </Animated.View>
    </View>
  );
}

function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipIcon}>{icon}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },

  // Background accents
  bgAccent1: {
    position: 'absolute', top: -100, right: -60,
    width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(42, 122, 110, 0.06)',
  },
  bgAccent2: {
    position: 'absolute', bottom: 80, left: -80,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(228, 168, 75, 0.05)',
  },

  // Top
  topSection: {
    alignItems: 'center',
    flex: 2,
    justifyContent: 'center',
  },
  title: {
    fontSize: 44,
    fontWeight: '900',
    color: colors.navy,
    textAlign: 'center',
    letterSpacing: -1,
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.lg,
    fontWeight: '500',
    color: colors.teal,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // Middle
  middleSection: {
    flex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagline: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cream200,
    gap: 4,
  },
  chipIcon: { fontSize: 14 },
  chipLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textPrimary },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeDot: { color: colors.gold, fontSize: 8 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.goldDark },

  // Bottom
  bottomSection: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    width: '100%',
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
    ...Platform.select({
      ios: {
        shadowColor: colors.green,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  ctaText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '800' },
  ctaArrow: { color: colors.white, fontSize: fontSize.xl, fontWeight: '300' },

  // Flag
  flagStripe: {
    flexDirection: 'row',
    width: 120,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  stripe: { flex: 1 },

  // Footer
  footer: { fontSize: fontSize.xs, color: colors.textTertiary },
});
