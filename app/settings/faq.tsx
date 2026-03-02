import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, ChevronDown, Mail } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';
// Theme compatibility: some themes expose `Colors.border` as a string, others as an object.
const subtleBorderColor =
  (Colors as any)?.border?.subtle ??
  (Colors as any)?.border?.primary ??
  (Colors as any)?.border ??
  'rgba(255,255,255,0.08)';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FAQItem = {
  id: string;
  question: string;
  answer: string;
};

type FAQSection = {
  id: string;
  title: string;
  items: FAQItem[];
};

export default function FAQScreen() {
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo<FAQSection[]>(
    () => [
      {
        id: 'getting-started',
        title: 'Getting started',
        items: [
          {
            id: 'what-is-eventmaps',
            question: 'What is Event Maps?',
            answer:
              'Event Maps helps you discover events on a map and share your own events with people nearby. You can browse, save, and get notified about updates depending on your settings.',
          },
          {
            id: 'create-event',
            question: 'How do I create an event?',
            answer:
              'From the main map, tap the “+” button, add the event details, choose a location, and publish. Your account limits (free vs. premium) are applied automatically when you submit.',
          },
          {
            id: 'edit-or-delete',
            question: 'Can I edit or delete an event after posting?',
            answer:
              'Yes. Go to your Profile → Your Events, select the event, then edit or delete it. If you can’t see an event you posted, make sure you’re signed into the correct account.',
          },
        ],
      },
      {
        id: 'limits-and-premium',
        title: 'Limits & premium',
        items: [
          {
            id: 'limits',
            question: 'What are the posting limits?',
            answer:
              'Free accounts have a monthly posting limit. Premium accounts have a higher limit. The app enforces limits automatically when you publish so you’ll see a message if you’ve reached your cap.',
          },
          {
            id: 'upgrade',
            question: 'How do I upgrade to premium?',
            answer:
              'Open your Profile → Premium to see available options. If your account was upgraded by an admin (e.g., business onboarding), you’ll see premium status there as well.',
          },
          {
            id: 'billing',
            question: 'I upgraded but premium didn’t activate. What should I do?',
            answer:
              'First, force close and reopen the app. Then check that you’re logged into the same account used to purchase. If it still doesn’t update, contact support and include your account email.',
          },
        ],
      },
      {
        id: 'map-and-location',
        title: 'Map & location',
        items: [
          {
            id: 'location-needed',
            question: 'Why does the app ask for location permission?',
            answer:
              'Location helps center the map around you and show nearby events. You can still browse without location, but results may be less relevant and you may need to manually search/scroll the map.',
          },
          {
            id: 'wrong-location',
            question: 'My location looks wrong on the map—how do I fix it?',
            answer:
              'Check that Location Services are enabled for your device and that Event Maps has permission. If you’re using a VPN or mock location, it can also affect accuracy.',
          },
        ],
      },
      {
        id: 'notifications',
        title: 'Notifications',
        items: [
          {
            id: 'enable-notifs',
            question: 'How do I turn notifications on or off?',
            answer:
              'Use your device settings to control notification permissions. In-app notification preferences (when available) let you choose which types of updates you want to receive.',
          },
          {
            id: 'not-receiving',
            question: 'I’m not receiving notifications. What should I check?',
            answer:
              'Make sure notifications are enabled for Event Maps in your device settings, Low Power Mode is off (iOS), and you have a stable connection. If the issue continues, contact support.',
          },
        ],
      },
      {
        id: 'privacy-and-safety',
        title: 'Privacy & safety',
        items: [
          {
            id: 'safety',
            question: 'Any safety tips for attending events?',
            answer:
              'Meet in public places when possible, trust your instincts, and verify details with the organizer. Event Maps is a discovery tool—always use good judgment and confirm event information.',
          },
          {
            id: 'data',
            question: 'What data do you collect?',
            answer:
              'We collect the minimum needed to run the app (such as account info and event content). Location access is optional and used for map context. For full details, see the Privacy Policy when available.',
          },
        ],
      },
    ],
    []
  );

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}> 
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>FAQ</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Quick answers to common questions. If you can’t find what you need, contact support.
        </Text>

        {/* Support CTA */}
        <View style={styles.supportCard}>
          <View style={styles.supportRow}>
            <Mail size={18} color={Colors.text.primary} />
            <Text style={styles.supportTitle}>Support</Text>
          </View>
          <Text style={styles.supportText}>
            Email us at support@eventmaps.app with your account email and a short description of the issue.
          </Text>
          {/* Optional: wire up to a mailto link later */}
        </View>

        {sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            <View style={styles.card}>
              {section.items.map((item, idx) => {
                const isOpen = openId === item.id;
                return (
                  <View key={item.id}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => toggle(item.id)}
                      style={styles.itemHeader}
                    >
                      <Text style={styles.question} numberOfLines={2}>
                        {item.question}
                      </Text>
                      <ChevronDown
                        size={18}
                        color={Colors.text.secondary}
                        style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}
                      />
                    </TouchableOpacity>

                    {isOpen ? <Text style={styles.answer}>{item.answer}</Text> : null}

                    {idx !== section.items.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <Text style={styles.footerNote}>
          Last updated: Mar 2, 2026
        </Text>
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
  supportCard: {
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    backgroundColor: Colors.background.secondary ?? Colors.background.primary,
    borderWidth: 1,
    borderColor: subtleBorderColor,
  },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  supportTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  supportText: {
    marginTop: 6,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular ?? Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  section: { marginTop: 18 },
  sectionTitle: {
    marginBottom: 10,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  card: {
    borderRadius: 14,
    paddingVertical: 4,
    backgroundColor: Colors.background.secondary ?? Colors.background.primary,
    borderWidth: 1,
    borderColor: subtleBorderColor,
    overflow: 'hidden',
  },
  itemHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  question: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    lineHeight: 20,
  },
  answer: {
    paddingHorizontal: 14,
    paddingBottom: 12,
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