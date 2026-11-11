import { Redirect, Tabs } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors, Typography } from '@/constants/theme';
import { Compass, PlusCircle, Bell, User } from '@/components/icons.generated';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';

export default function TabsLayout() {
  const {
    session,
    loading: authLoading,
    profile,
    profileError,
    hasCompletedOnboarding,
  } = useAuth();
  const unreadCount = useUnreadNotificationCount(session?.user?.id);

  // Auth guard: tabs must never render for signed-out or un-onboarded users
  // (deep links / pushes can target tab routes directly, bypassing app/index).
  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (profileError) {
    // Profile load failed: let app/index show its retry UI rather than
    // mis-routing to onboarding.
    return <Redirect href="/" />;
  }
  if (!profile || !hasCompletedOnboarding) {
    return <Redirect href="/(onboarding)" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.text.tertiary,
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: Colors.border.light,
          backgroundColor: Colors.surface,
        },
        tabBarLabelStyle: {
          fontFamily: Typography.labelFontFamilies.medium,
          fontSize: Typography.sizes.xxs,
        },
        // Fixed-height bar: cap scaling so labels don't clip at large a11y sizes
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarAccessibilityLabel: 'Discover',
          tabBarIcon: ({ size, color }) => (
            <Compass size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarAccessibilityLabel: 'Create event',
          tabBarIcon: ({ size, color }) => (
            <PlusCircle size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarAccessibilityLabel:
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications',
          tabBarIcon: ({ size, color }) => <Bell size={size} color={color} />,
          ...(unreadCount > 0
            ? {
                tabBarBadge: unreadCount > 99 ? '99+' : unreadCount,
                tabBarBadgeStyle: {
                  backgroundColor: Colors.primary,
                  color: Colors.text.inverse,
                  fontSize: Typography.sizes.xxs,
                },
              }
            : {}),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: ({ size, color }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.primary,
  },
});
