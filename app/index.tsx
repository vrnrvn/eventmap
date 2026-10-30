import { useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export default function Index() {
  const { session, loading, profile, profileError, hasCompletedOnboarding, refreshProfile } =
    useAuth();
  const [retrying, setRetrying] = useState(false);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }

  // Profile failed to load (network/server error): do NOT assume the user is
  // un-onboarded — routing to onboarding here would overwrite their saved
  // preferences on completion. Offer a retry instead.
  if (profileError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Couldn&apos;t load your profile</Text>
        <Text style={styles.errorBody}>
          Check your connection and try again.
        </Text>
        {retrying ? (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.retrySpinner} />
        ) : (
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={async () => {
              setRetrying(true);
              try {
                await refreshProfile();
              } finally {
                setRetrying(false);
              }
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading your profile"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Only route to onboarding when the profile actually loaded (or confirmed
  // missing — onboarding creates the row) and the flag isn't set.
  if (!profile || !hasCompletedOnboarding) {
    return <Redirect href="/(onboarding)" />;
  }

  return <Redirect href="/(tabs)/discover" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    paddingHorizontal: Spacing.xl,
  },
  errorTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  retryBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
  },
  retrySpinner: {
    marginTop: Spacing.xs,
  },
  retryText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
});
