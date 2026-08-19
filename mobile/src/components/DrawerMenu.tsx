import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Platform, ScrollView,
} from 'react-native';
import { Icon } from '@/components/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (screen: string) => void;
};

const HEALTH_ITEMS = [
  { key: 'home', icon: 'home-outline', label: 'Home' },
  { key: 'records', icon: 'document-text-outline', label: 'Medical Records' },
  { key: 'labs', icon: 'flask-outline', label: 'Lab Results' },
  { key: 'prescriptions', icon: 'medkit-outline', label: 'Prescriptions' },
  { key: 'appointments', icon: 'calendar-outline', label: 'Appointments' },
  { key: 'immunizations', icon: 'shield-checkmark-outline', label: 'Immunizations' },
];

const SERVICES_ITEMS = [
  { key: 'billing', icon: 'wallet-outline', label: 'Billing & Payments' },
  { key: 'messages', icon: 'chatbubble-outline', label: 'Messages' },
];

const ACCOUNT_ITEMS = [
  { key: 'profile', icon: 'person-outline', label: 'My Profile' },
];

export default function DrawerMenu({ visible, onClose, onNavigate }: Props) {
  const insets = useSafeAreaInsets();
  const { patient, logout } = useAuth();

  const initials = patient
    ? `${patient.firstName.charAt(0)}${patient.surname.charAt(0)}`
    : '?';

  const handleTap = (key: string) => {
    onNavigate(key);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.drawer, { paddingTop: insets.top }]} onPress={(e) => e.stopPropagation()}>

          {/* Close button */}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.6}>
            <Icon name="close" size={22} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Patient profile area */}
          <View style={styles.profileArea}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.profileName}>{patient?.firstName} {patient?.surname}</Text>
            <View style={styles.hnRow}>
              <Icon name="id-card-outline" size={12} color={colors.textTertiary} />
              <Text style={styles.hnText}>{patient?.hospitalNumber}</Text>
            </View>
          </View>

          {/* Scrollable menu */}
          <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
            {/* Health section */}
            <Text style={styles.groupLabel}>HEALTH</Text>
            {HEALTH_ITEMS.map((item, i) => (
              <MenuItem key={item.key} item={item} onTap={handleTap} isLast={i === HEALTH_ITEMS.length - 1} />
            ))}

            {/* Services section */}
            <Text style={styles.groupLabel}>SERVICES</Text>
            {SERVICES_ITEMS.map((item, i) => (
              <MenuItem key={item.key} item={item} onTap={handleTap} isLast={i === SERVICES_ITEMS.length - 1} />
            ))}

            {/* Account section */}
            <Text style={styles.groupLabel}>ACCOUNT</Text>
            {ACCOUNT_ITEMS.map((item, i) => (
              <MenuItem key={item.key} item={item} onTap={handleTap} isLast={i === ACCOUNT_ITEMS.length - 1} />
            ))}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.logoutBtn} onPress={() => { logout(); onClose(); }} activeOpacity={0.6}>
              <Icon name="log-out-outline" size={18} color={colors.red} />
              <Text style={styles.logoutText}>Sign Out</Text>
            </TouchableOpacity>

            <View style={styles.flagStripe}>
              {['#000', '#C44536', '#FFF', '#1B9E77', '#2A7A6E', '#E4A84B'].map((c, i) => (
                <View key={i} style={[styles.stripe, { backgroundColor: c }]} />
              ))}
            </View>
            <Text style={styles.brand}>TamamHealth Health Technologies</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({ item, onTap, isLast }: {
  item: { key: string; icon: string; label: string };
  onTap: (key: string) => void;
  isLast: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, !isLast && styles.menuItemBorder]}
      onPress={() => onTap(item.key)}
      activeOpacity={0.5}
    >
      <Icon name={item.icon as any} size={20} color={colors.textSecondary} />
      <Text style={styles.menuLabel}>{item.label}</Text>
      <Icon name="chevron-forward" size={15} color={colors.cream300} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 58, 58, 0.5)',
  },
  drawer: {
    width: '80%',
    maxWidth: 320,
    flex: 1,
    backgroundColor: colors.white,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 6, height: 0 }, shadowOpacity: 0.12, shadowRadius: 24 },
      android: { elevation: 20 },
    }),
  },

  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 16,
    right: 16,
    zIndex: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center',
  },

  // Profile
  profileArea: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.cream200,
    alignItems: 'center',
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { color: colors.gold, fontSize: 20, fontWeight: '800' },
  profileName: { fontSize: 17, fontWeight: '700', color: colors.navy },
  hnRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  hnText: {
    fontSize: 12, color: colors.textTertiary, fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Menu
  menuScroll: { flex: 1 },
  groupLabel: {
    fontSize: 10, fontWeight: '700', color: colors.textTertiary,
    letterSpacing: 1.2, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 20,
    gap: 12,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cream200,
    marginHorizontal: 20,
    paddingHorizontal: 0,
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    borderTopWidth: 1,
    borderTopColor: colors.cream200,
    alignItems: 'center',
  },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: radius.sm, borderWidth: 1, borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    width: '100%',
    marginBottom: 16,
  },
  logoutText: { fontSize: 14, fontWeight: '600', color: colors.red },

  flagStripe: {
    flexDirection: 'row', width: 100, height: 3, borderRadius: 2,
    overflow: 'hidden', marginBottom: 6,
  },
  stripe: { flex: 1 },
  brand: { fontSize: 10, color: colors.cream300 },
});
