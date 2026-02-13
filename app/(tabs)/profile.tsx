import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { router } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  User,
  Building2,
  LogOut,
  ChevronRight,
  Briefcase,
} from 'lucide-react-native';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const { hasBusiness, userMode, setUserMode, userBusiness } = useApp();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  const handleCreateBusiness = () => {
    router.push('/business/onboarding' as any);
  };

  const toggleMode = () => {
    if (!hasBusiness) {
      handleCreateBusiness();
      return;
    }
    setUserMode(userMode === 'user' ? 'business' : 'user');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <User size={48} color={Colors.text.secondary} />
        </View>
        <Text style={styles.name}>{profile?.name || 'User'}</Text>
        {hasBusiness && userBusiness && (
          <Text style={styles.businessName}>{userBusiness.name}</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mode</Text>
        <TouchableOpacity style={styles.menuItem} onPress={toggleMode}>
          <View style={styles.menuItemLeft}>
            {userMode === 'user' ? (
              <User size={24} color={Colors.text.primary} />
            ) : (
              <Building2 size={24} color={Colors.text.primary} />
            )}
            <Text style={styles.menuItemText}>
              {userMode === 'user' ? 'User Mode' : 'Business Mode'}
            </Text>
          </View>
          <ChevronRight size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      {!hasBusiness && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.createBusinessButton} onPress={handleCreateBusiness}>
            <Briefcase size={20} color={Colors.text.inverse} />
            <Text style={styles.createBusinessText}>Create Business Profile</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/saved-events' as any)}
        >
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuItemText}>Saved Events</Text>
          </View>
          <ChevronRight size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => Alert.alert('Coming Soon', 'Following list will be available soon')}
        >
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuItemText}>Following</Text>
          </View>
          <ChevronRight size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => Alert.alert('Coming Soon', 'Settings will be available soon')}
        >
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuItemText}>Settings</Text>
          </View>
          <ChevronRight size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <LogOut size={20} color={Colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  name: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  businessName: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  section: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  menuItemText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  createBusinessButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  createBusinessText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  signOutText: {
    color: Colors.error,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
  },
});
