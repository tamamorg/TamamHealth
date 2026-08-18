/**
 * SyncStatusBar — a compact indicator shown below the header.
 *
 * Shows connectivity state, sync progress, and pending item count.
 * Tapping it triggers an immediate sync when online.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { Icon } from '@/components/icons';
import { useSync } from '../lib/sync-context';
import { colors, fontSize, spacing } from '../lib/theme';

export default function SyncStatusBar() {
  const { state, pendingCount, lastSyncTime, syncNow, isOnline } = useSync();
  const [pulseAnim] = useState(() => new Animated.Value(1));

  // Pulse animation during active sync
  useEffect(() => {
    if (state === 'pushing' || state === 'pulling') {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  const isSyncing = state === 'pushing' || state === 'pulling';

  // Don't show bar when everything is synced and online
  if (isOnline && state === 'idle' && pendingCount === 0 && lastSyncTime) {
    return null;
  }

  const { icon, label, bg, fg } = getDisplay(state, isOnline, pendingCount, lastSyncTime);

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: bg }]}
      onPress={syncNow}
      activeOpacity={0.7}
      disabled={isSyncing}
    >
      <Animated.View style={{ opacity: isSyncing ? pulseAnim : 1, flexDirection: 'row', alignItems: 'center' }}>
        <Icon name={icon as any} size={14} color={fg} style={styles.icon} />
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      </Animated.View>
      {pendingCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function getDisplay(
  state: string,
  isOnline: boolean,
  pending: number,
  lastSync: string | null,
): { icon: string; label: string; bg: string; fg: string } {
  if (!isOnline) {
    return {
      icon: 'cloud-offline-outline',
      label: pending > 0
        ? `Offline \u00B7 ${pending} change${pending > 1 ? 's' : ''} waiting`
        : 'Offline \u00B7 data saved locally',
      bg: '#FFF3DC',
      fg: colors.goldDark,
    };
  }

  switch (state) {
    case 'pushing':
      return { icon: 'cloud-upload-outline', label: 'Uploading changes\u2026', bg: '#E8F5F1', fg: colors.teal };
    case 'pulling':
      return { icon: 'cloud-download-outline', label: 'Downloading updates\u2026', bg: '#E8F5F1', fg: colors.teal };
    case 'error':
      return { icon: 'alert-circle-outline', label: 'Sync error \u00B7 tap to retry', bg: colors.redLight, fg: colors.red };
    case 'disabled':
      return { icon: 'cloud-offline-outline', label: 'Sync not configured', bg: '#F5F3EF', fg: colors.textTertiary };
    default:
      // idle but online
      if (pending > 0) {
        return {
          icon: 'cloud-upload-outline',
          label: `${pending} change${pending > 1 ? 's' : ''} pending \u00B7 tap to sync`,
          bg: '#E8F5F1',
          fg: colors.teal,
        };
      }
      if (!lastSync) {
        return { icon: 'cloud-outline', label: 'Tap to sync with server', bg: '#E8F5F1', fg: colors.teal };
      }
      return { icon: 'checkmark-circle-outline', label: 'All synced', bg: '#E8F5F1', fg: colors.green };
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  icon: {
    marginRight: 6,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  badge: {
    marginLeft: 8,
    backgroundColor: colors.gold,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
});
