import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { ArrowLeft, User, Building2 } from 'lucide-react-native';

const BUSINESS_CATEGORIES = [
  'Restaurant',
  'Bar & Nightlife',
  'Fitness & Wellness',
  'Coffee Shop',
  'Entertainment',
  'Arts & Culture',
  'Sports & Recreation',
  'Education',
  'Community',
  'Other',
];

export default function Settings() {
  const { user, profile, refreshProfile } = useAuth();
  const { userBusiness, refreshBusiness } = useApp();
  const [saving, setSaving] = useState(false);

  const [userForm, setUserForm] = useState({
    name: '',
    hobbies: '',
    city: '',
    lat: null as number | null,
    lng: null as number | null,
  });

  const [businessForm, setBusinessForm] = useState({
    name: '',
    category: '',
    contactEmail: '',
    address: '',
    lat: 0,
    lng: 0,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (profile) {
      setUserForm({
        name: profile.name ?? '',
        hobbies: profile.hobbies ?? '',
        city: profile.city ?? '',
        lat: profile.lat ?? null,
        lng: profile.lng ?? null,
      });
    }
  }, [profile]);

  useEffect(() => {
    if (userBusiness) {
      setBusinessForm({
        name: userBusiness.name ?? '',
        category: userBusiness.category ?? '',
        contactEmail: userBusiness.contact_email ?? '',
        address: userBusiness.address ?? '',
        lat: userBusiness.lat ?? 0,
        lng: userBusiness.lng ?? 0,
      });
    }
  }, [userBusiness]);

  const validateUser = () => {
    const next: Record<string, string> = {};
    if (!userForm.name.trim()) next.name = 'Name is required';
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const validateBusiness = () => {
    const next: Record<string, string> = {};
    if (!businessForm.name.trim()) next.businessName = 'Business name is required';
    if (!businessForm.category) next.category = 'Category is required';
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const handleSaveUser = async () => {
    if (!user || !validateUser()) return;
    setSaving(true);
    try {
      await profilesService.updateProfile(user.id, {
        name: userForm.name.trim(),
        hobbies: userForm.hobbies.trim() || null,
        city: userForm.city.trim() || null,
        lat: userForm.lat,
        lng: userForm.lng,
      });
      await refreshProfile();
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusiness = async () => {
    if (!userBusiness || !validateBusiness()) return;
    setSaving(true);
    try {
      await businessesService.updateBusiness(userBusiness.id, {
        name: businessForm.name.trim(),
        category: businessForm.category,
        contact_email: businessForm.contactEmail.trim() || null,
        address: businessForm.address.trim(),
        lat: businessForm.lat,
        lng: businessForm.lng,
      });
      await refreshBusiness();
      Alert.alert('Saved', 'Your business has been updated.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save business. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <User size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>User Profile</Text>
            </View>
            <Input
              label="Name"
              value={userForm.name}
              onChangeText={(t) => setUserForm((p) => ({ ...p, name: t }))}
              placeholder="Your name"
              error={errors.name}
            />
            <Input
              label="Hobbies"
              value={userForm.hobbies}
              onChangeText={(t) => setUserForm((p) => ({ ...p, hobbies: t }))}
              placeholder="e.g. hiking, music, cooking (comma-separated)"
              error={errors.hobbies}
            />
            <Input
              label="Email"
              value={user?.email ?? ''}
              editable={false}
              placeholder="Email"
            />
            <AddressSearchInput
              label="Location"
              value={userForm.city}
              onChangeText={(t) => setUserForm((p) => ({ ...p, city: t }))}
              onSelect={(r) =>
                setUserForm((p) => ({
                  ...p,
                  city: r.formattedAddress,
                  lat: r.lat,
                  lng: r.lng,
                }))
              }
              placeholder="City or area for event discovery"
              approximate
            />
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSaveUser}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.text.inverse} />
              ) : (
                <Text style={styles.saveButtonText}>Save User Profile</Text>
              )}
            </TouchableOpacity>
          </View>

          {userBusiness && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Building2 size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Business Profile</Text>
              </View>
              <Input
                label="Business Name"
                value={businessForm.name}
                onChangeText={(t) =>
                  setBusinessForm((p) => ({ ...p, name: t }))
                }
                placeholder="Business name"
                error={errors.businessName}
              />
              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoryRow}
                >
                  {BUSINESS_CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.categoryChip,
                        businessForm.category === cat &&
                          styles.categoryChipSelected,
                      ]}
                      onPress={() =>
                        setBusinessForm((p) => ({ ...p, category: cat }))
                      }
                    >
                      <Text
                        style={[
                          styles.categoryChipText,
                          businessForm.category === cat &&
                            styles.categoryChipTextSelected,
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {errors.category && (
                  <Text style={styles.errorText}>{errors.category}</Text>
                )}
              </View>
              <Input
                label="Contact Email"
                value={businessForm.contactEmail}
                onChangeText={(t) =>
                  setBusinessForm((p) => ({ ...p, contactEmail: t }))
                }
                placeholder="Business contact email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <AddressSearchInput
                label="Business Location"
                value={businessForm.address}
                onChangeText={(t) =>
                  setBusinessForm((p) => ({ ...p, address: t }))
                }
                onSelect={(r) =>
                  setBusinessForm((p) => ({
                    ...p,
                    address: r.formattedAddress,
                    lat: r.lat,
                    lng: r.lng,
                  }))
                }
                placeholder="Building, street address, business or condo name"
                addressPrecision="full"
              />
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSaveBusiness}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.text.inverse} />
                ) : (
                  <Text style={styles.saveButtonText}>Save Business Profile</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    paddingTop: Spacing.xl + 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  section: {
    marginBottom: Spacing.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  field: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  categoryChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontWeight: Typography.weights.semibold,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
  },
});
