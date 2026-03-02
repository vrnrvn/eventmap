import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, AlertTriangle, MapPin, Bell, Shield, FileText } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';

// Theme compatibility: some themes expose `Colors.border` as a string, others as an object.
const subtleBorderColor =
  (Colors as any)?.border?.subtle ??
  (Colors as any)?.border?.primary ??
  (Colors as any)?.border ??
  'rgba(255,255,255,0.08)';

type DisclaimerBlock = {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: string;
};

export default function DisclaimersScreen() {
  const insets = useSafeAreaInsets();

  const blocks = useMemo<DisclaimerBlock[]>(
    () => [
      {
        id: 'community-content',
        icon: <AlertTriangle size={18} color={Colors.text.primary} />,
        title: 'Community-posted content',
        body:
          'Event Maps is community-driven. We do not guarantee that event details (time, location, price, age limits, capacity, etc.) are accurate or up to date. Always verify details with the organizer before attending.',
      },
      {
        id: 'safety',
        icon: <Shield size={18} color={Colors.text.primary} />,
        title: 'Safety & personal responsibility',
        body:
          'Attend events at your own discretion. Use good judgment, meet in public places when possible, and leave if anything feels unsafe. You are responsible for your own actions and decisions when using the app.',
      },
      {
        id: 'maps',
        icon: <MapPin size={18} color={Colors.text.primary} />,
        title: 'Map & location accuracy',
        body:
          'Maps and location services rely on third-party providers and your device settings. Location results may be approximate or incorrect due to GPS limitations, network conditions, VPN usage, or device configuration.',
      },
      {
        id: 'notifications',
        icon: <Bell size={18} color={Colors.text.primary} />,
        title: 'Notifications',
        body:
          'Notifications depend on your device settings and network connectivity. Delivery may be delayed, duplicated, or not delivered. You can control notification permissions in your device settings at any time.',
      },
      {
        id: 'compliance',
        icon: <FileText size={18} color={Colors.text.primary} />,
        title: 'Organizer compliance',
        body:
          'Event organizers are solely responsible for complying with applicable laws, venue rules, licensing requirements, and local regulations. Event Maps is not responsible for organizer conduct or compliance.',
      },
    ],
    []
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Disclaimers</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Please read these notes carefully. Using the app means you understand and accept the points below.
        </Text>

        <View style={styles.card}>
          {blocks.map((b, idx) => (
            <View key={b.id}>
              <View style={styles.row}>
                <View style={styles.iconWrap}>{b.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.blockTitle}>{b.title}</Text>
                  <Text style={styles.blockBody}>{b.body}</Text>
                </View>
              </View>
              {idx !== blocks.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </View>

        <Text style={styles.footerNote}>Last updated: Mar 2, 2026</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.background.primary,
  },
  backBtn: { marginRight: 12 },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: {
    marginTop: 4,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular ?? Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  card: {
    marginTop: 14,
    borderRadius: 14,
    paddingVertical: 6,
    backgroundColor: Colors.background.secondary ?? Colors.background.primary,
    borderWidth: 1,
    borderColor: subtleBorderColor,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.primary,
    borderWidth: 1,
    borderColor: subtleBorderColor,
  },
  blockTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    lineHeight: 20,
  },
  blockBody: {
    marginTop: 4,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular ?? Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    marginHorizontal: 14,
    backgroundColor: subtleBorderColor,
  },
  footerNote: {
    marginTop: 18,
    fontSize: Typography.sizes.xs ?? 12,
    fontFamily: Typography.fontFamilies.regular ?? Typography.fontFamily,
    color: Colors.text.secondary,
    opacity: 0.9,
  },
});