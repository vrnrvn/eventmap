import { useState, useEffect, useRef } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumService } from '@/services/premium';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  User,
  Building2,
  Settings,
  Mail,
  Heart,
  MapPin,
  Tag,
  AtSign,
  Navigation,
  Save,
  Check,
  Image as ImageIcon,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: 'rgba(250, 248, 245, 0.75)',
  separator: Colors.border.light,
  badge: Colors.primary,
  successSoft: 'rgba(45, 138, 110, 0.12)',
  successDot: Colors.success,
};

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

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const { userBusiness, refreshBusiness, userMode, hasBusiness } = useApp();
  const { isPremium, refreshSubscription } = usePremium();
  const [saving, setSaving] = useState<'user' | 'business' | null>(null);
  const [savedSection, setSavedSection] = useState<'user' | 'business' | null>(null);

  const isBizMode = hasBusiness && userMode === 'business';
  const accentColor = isBizMode ? Colors.secondary : Colors.primary;
  const accentGradient: [string, string] = isBizMode
    ? [Colors.secondary, Colors.secondaryLight]
    : [Palette.gradientStart, Palette.gradientEnd];
  const accentSoft = isBizMode ? 'rgba(13, 79, 79, 0.12)' : Palette.accentSoft;

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
    venuePhotos: [] as ImageAsset[],
  });
  const originalVenuePhotoIds = useRef<string[]>([]);

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
      const load = async () => {
        const photos = await businessesService
          .getBusinessPhotos(userBusiness.id)
          .catch(() => []);
        const venuePhotos: ImageAsset[] = photos
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((p) => ({
            uri: p.image_url,
            name: `venue-${p.id}`,
            type: 'image/jpeg',
            remoteUrl: p.image_url,
            photoId: p.id,
          }));
        originalVenuePhotoIds.current = venuePhotos
          .map((img) => img.photoId)
          .filter(Boolean) as string[];
        setBusinessForm({
          name: userBusiness.name ?? '',
          category: userBusiness.category ?? '',
          contactEmail: userBusiness.contact_email ?? '',
          address: userBusiness.address ?? '',
          lat: userBusiness.lat ?? 0,
          lng: userBusiness.lng ?? 0,
          venuePhotos,
        });
      };
      load();
    }
  }, [userBusiness]);

  const showSavedFeedback = (section: 'user' | 'business') => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

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
    setSaving('user');
    try {
      await profilesService.updateProfile(user.id, {
        name: userForm.name.trim(),
        hobbies: userForm.hobbies.trim() || null,
        city: userForm.city.trim() || null,
        lat: userForm.lat,
        lng: userForm.lng,
      });
      await refreshProfile();
      showSavedFeedback('user');
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveBusiness = async () => {
    if (!userBusiness || !validateBusiness()) return;
    setSaving('business');
    try {
      await businessesService.updateBusiness(userBusiness.id, {
        name: businessForm.name.trim(),
        category: businessForm.category,
        contact_email: businessForm.contactEmail.trim() || null,
        address: businessForm.address.trim(),
        lat: businessForm.lat,
        lng: businessForm.lng,
      });

      const { venuePhotos } = businessForm;
      const currentPhotoIds = venuePhotos.map((img) => img.photoId).filter(Boolean) as string[];
      const removedIds = originalVenuePhotoIds.current.filter((pid) => !currentPhotoIds.includes(pid));
      for (const pid of removedIds) {
        await businessesService.deleteBusinessPhoto(pid);
      }

      const uploadedUrls: string[] = [];
      for (const img of venuePhotos) {
        if (!img.photoId) {
          const url = await eventsService.uploadEventImage(
            { uri: img.uri, name: img.name, type: img.type },
            'venues'
          );
          uploadedUrls.push(url);
        }
      }

      const existingCount = venuePhotos.filter((i) => i.photoId).length;
      for (let i = 0; i < uploadedUrls.length; i++) {
        await businessesService.addBusinessPhoto(userBusiness.id, uploadedUrls[i], existingCount + i);
      }

      const updatedPhotos = await businessesService.getBusinessPhotos(userBusiness.id);
      const updatedVenuePhotos: ImageAsset[] = updatedPhotos
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p) => ({
          uri: p.image_url,
          name: `venue-${p.id}`,
          type: 'image/jpeg',
          remoteUrl: p.image_url,
          photoId: p.id,
        }));
      originalVenuePhotoIds.current = updatedVenuePhotos
        .map((img) => img.photoId)
        .filter(Boolean) as string[];
      setBusinessForm((prev) => ({ ...prev, venuePhotos: updatedVenuePhotos }));

      await refreshBusiness();
      showSavedFeedback('business');
    } catch (e) {
      Alert.alert('Error', 'Failed to save business. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleUnsubscribePremium = async () => {
    if (!userBusiness || !isPremium) return;
    Alert.alert(
      'Unsubscribe from Premium',
      'Are you sure you want to go back to a regular account? You will lose premium features.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Unsubscribe',
          style: 'destructive',
          onPress: async () => {
            try {
              // Mock downgrade to free plan
              await premiumService.subscribeToPlan(userBusiness.id, 'free', 'monthly');
              await refreshBusiness();
              await refreshSubscription();
              Alert.alert('Premium canceled', 'You are now on a regular account.');
            } catch (e) {
              console.error('Failed to unsubscribe from premium', e);
              Alert.alert('Error', 'Failed to unsubscribe. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerIconWrap, { backgroundColor: accentSoft }]}>
            {isBizMode ? (
              <Building2 size={18} color={accentColor} />
            ) : (
              <Settings size={18} color={accentColor} />
            )}
          </View>
          <Text style={styles.headerTitle}>
            {isBizMode ? 'Business Settings' : 'Settings'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isBizMode && userBusiness ? (
            <>
              {/* ── Business Profile Section ── */}
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>Business Profile</Text>
                {savedSection === 'business' && (
                  <View style={styles.savedBadge}>
                    <Check size={12} color={Palette.successDot} />
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                {/* Business Name */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Building2 size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Business Name"
                      value={businessForm.name}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, name: t }))
                      }
                      placeholder="Business name"
                      error={errors.businessName}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Category */}
                <View style={styles.fieldRowNoPad}>
                  <View style={[styles.fieldIcon, { marginTop: 14, backgroundColor: accentSoft }]}>
                    <Tag size={16} color={accentColor} />
                  </View>
                  <View style={styles.catContainer}>
                    <Text style={styles.catLabel}>Category</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.catScrollContent}
                    >
                      {BUSINESS_CATEGORIES.map((cat) => {
                        const selected = businessForm.category === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[
                              styles.catChip,
                              selected && { backgroundColor: accentColor, borderColor: accentColor },
                            ]}
                            onPress={() =>
                              setBusinessForm((p) => ({ ...p, category: cat }))
                            }
                            activeOpacity={0.7}
                          >
                            <CategoryIcon category={cat} size="sm" variant="pill" />
                            <Text
                              style={[
                                styles.catChipText,
                                selected && styles.catChipTextSelected,
                              ]}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {errors.category && (
                      <Text style={styles.errorText}>{errors.category}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Contact Email */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
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
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Business Address */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Navigation size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
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
                      placeholder="Full business address"
                      addressPrecision="full"
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Venue Photos */}
                <View style={styles.fieldRowNoPad}>
                  <View style={[styles.fieldIcon, { marginTop: 14, backgroundColor: accentSoft }]}>
                    <ImageIcon size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={styles.venuePhotosLabel}>Venue Photos</Text>
                    <Text style={styles.venuePhotosHint}>
                      Add photos of your venue, gym, or place. Shown on your business page.
                    </Text>
                    <ImagePickerButton
                      images={businessForm.venuePhotos}
                      onChange={(imgs) =>
                        setBusinessForm((p) => ({ ...p, venuePhotos: imgs }))
                      }
                      maxImages={10}
                    />
                  </View>
                </View>
              </View>

              {/* Save business */}
              <TouchableOpacity
                style={styles.saveWrap}
                onPress={handleSaveBusiness}
                disabled={saving !== null}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={
                    saving === 'business'
                      ? ['#5EEAD4', '#99F6E4']
                      : accentGradient
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveGradient}
                >
                  {saving === 'business' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Save size={16} color="#FFFFFF" />
                      <Text style={styles.saveText}>Save Business</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {/* Unsubscribe from premium – only for premium business users */}
              {isBizMode && userBusiness && isPremium && (
                <TouchableOpacity
                  style={styles.unsubscribeWrap}
                  onPress={handleUnsubscribePremium}
                  activeOpacity={0.85}
                >
                  <Text style={styles.unsubscribeText}>Unsubscribe from premium</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              {/* ── User Profile Section ── */}
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>Personal Profile</Text>
                {savedSection === 'user' && (
                  <View style={styles.savedBadge}>
                    <Check size={12} color={Palette.successDot} />
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                {/* Name */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <User size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Name"
                      value={userForm.name}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, name: t }))}
                      placeholder="Your name"
                      error={errors.name}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Hobbies */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <Heart size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Hobbies"
                      value={userForm.hobbies}
                      onChangeText={(t) =>
                        setUserForm((p) => ({ ...p, hobbies: t }))
                      }
                      placeholder="e.g. hiking, music, cooking"
                      error={errors.hobbies}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Email (read-only) */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, styles.fieldIconMuted]}>
                    <Mail size={16} color={Colors.text.tertiary} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Email"
                      value={user?.email ?? ''}
                      editable={false}
                      placeholder="Email"
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Location */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <MapPin size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <AddressSearchInput
                      label="Location"
                      value={userForm.city}
                      onChangeText={(t) =>
                        setUserForm((p) => ({ ...p, city: t }))
                      }
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
                  </View>
                </View>
              </View>

              {/* Save user */}
              <TouchableOpacity
                style={styles.saveWrap}
                onPress={handleSaveUser}
                disabled={saving !== null}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={
                    saving === 'user'
                      ? ['#A5B4FC', '#C4B5FD']
                      : accentGradient
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveGradient}
                >
                  {saving === 'user' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Save size={16} color="#FFFFFF" />
                      <Text style={styles.saveText}>Save Profile</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Palette.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  headerSpacer: {
    width: 40,
  },

  keyboardView: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  /* ── Section label ── */
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  savedBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.successDot,
  },

  /* ── Card ── */
  card: {
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },

  /* ── Field rows ── */
  fieldRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  fieldRowNoPad: {
    flexDirection: 'row',
    paddingLeft: 16,
    paddingRight: 0,
    gap: 10,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldIconMuted: {
    backgroundColor: Palette.surfaceMuted,
  },
  fieldContent: {
    flex: 1,
  },
  fieldSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 66,
  },

  /* ── Category chips ── */
  catContainer: {
    flex: 1,
    paddingVertical: 10,
  },
  venuePhotosLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
    marginBottom: 4,
  },
  venuePhotosHint: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  catLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginBottom: 8,
    marginLeft: 4,
  },
  catScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
    paddingBottom: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Palette.surfaceMuted,
    borderWidth: 1.5,
    borderColor: Palette.separator,
  },
  catChipSelected: {
    backgroundColor: Palette.badge,
    borderColor: Palette.badge,
  },
  catChipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  catChipTextSelected: {
    color: '#FFFFFF',
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },

  /* ── Error ── */
  errorText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 4,
  },

  /* ── Save button ── */
  saveWrap: {
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  saveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  saveText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  unsubscribeWrap: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  unsubscribeText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    textDecorationLine: 'underline',
  },

  /* ── No-business empty (not used but kept consistent) ── */
});