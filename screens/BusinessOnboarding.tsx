import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { businessesService } from '@/services/businesses';
import { geocodingService } from '@/services/geocoding';
import { useApp } from '@/contexts/AppContext';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { GoogleMapView } from '@/components/GoogleMapView';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { ArrowLeft } from 'lucide-react-native';

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

export default function BusinessOnboarding() {
  const { refreshBusiness, setUserMode } = useApp();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    address: '',
    lat: 37.7749,
    lng: -122.4194,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep1 = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Business name is required';
    }

    if (!formData.category) {
      newErrors.category = 'Please select a category';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.description.trim()) {
      newErrors.description = 'Business description is required';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Business address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep2()) return;

    setLoading(true);
    try {
      await businessesService.createBusiness({
        name: formData.name,
        description: formData.description,
        category: formData.category,
        address: formData.address,
        lat: formData.lat,
        lng: formData.lng,
      });

      await refreshBusiness();
      setUserMode('business');

      Alert.alert(
        'Success',
        'Your business profile has been created!',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)/profile'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create business profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => (step === 1 ? router.back() : setStep(1))}
      >
        <ArrowLeft size={24} color={Colors.text.primary} />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Create Business Profile</Text>
        <Text style={styles.subtitle}>
          Step {step} of 2 - {step === 1 ? 'Basic Info' : 'Details'}
        </Text>

        {step === 1 && (
            <ScrollView
              style={styles.step1Scroll}
              contentContainerStyle={styles.step1ScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.form}>
              <Input
                label="Business Name"
                value={formData.name}
                onChangeText={(text) =>
                  setFormData({ ...formData, name: text })
                }
                placeholder="Enter your business name"
                error={errors.name}
              />

              <Text style={styles.label}>Category</Text>
              <View style={styles.categoriesGrid}>
                {BUSINESS_CATEGORIES.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.categoryChip,
                      formData.category === category &&
                        styles.categoryChipSelected,
                    ]}
                    onPress={() =>
                      setFormData({ ...formData, category })
                    }
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        formData.category === category &&
                          styles.categoryChipTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {errors.category && (
                <Text style={styles.errorText}>{errors.category}</Text>
              )}

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleNext}
            >
              <Text style={styles.primaryButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
            </ScrollView>
        )}

        {step === 2 && (
          <>
            <Text style={styles.tapHint}>Tap on the map to set exact location</Text>
            <View style={styles.mapPreview}>
              <GoogleMapView
                center={{ lat: formData.lat, lng: formData.lng }}
                zoom={15}
                markers={[
                  {
                    id: 'business',
                    lat: formData.lat,
                    lng: formData.lng,
                    title: formData.name || 'Business location',
                  },
                ]}
                style={styles.mapPreviewInner}
                onMapPress={async (lat, lng) => {
                  const result = await geocodingService.reverseGeocode(lat, lng, {
                    preferAddress: true,
                  });
                  if (result) {
                    setFormData((f) => ({
                      ...f,
                      address: result.formattedAddress,
                      lat: result.lat,
                      lng: result.lng,
                    }));
                  }
                }}
              />
            </View>
          </>
        )}
      </View>

      {step === 2 && (
        <ScrollView
          style={styles.formScroll}
          contentContainerStyle={styles.formScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Input
            label="Description"
            value={formData.description}
            onChangeText={(text) =>
              setFormData({ ...formData, description: text })
            }
            placeholder="Tell people about your business"
            multiline
            numberOfLines={4}
            style={styles.textArea}
            error={errors.description}
          />

          <AddressSearchInput
            label="Business address"
            value={formData.address}
            onChangeText={(text) =>
              setFormData((f) => ({ ...f, address: text }))
            }
            onSelect={(result) =>
              setFormData((f) => ({
                ...f,
                address: result.formattedAddress,
                lat: result.lat,
                lng: result.lng,
              }))
            }
            placeholder="Building, street address, business or condo name"
            error={errors.address}
            approximate={false}
            addressPrecision="full"
            showSetButton
          />
          {formData.address && (
            <Text style={styles.locationHint}>
              Pin at {formData.lat.toFixed(4)}, {formData.lng.toFixed(4)}
            </Text>
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.text.inverse} />
            ) : (
              <Text style={styles.primaryButtonText}>
                Create Business Profile
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  scrollContent: {
    flexGrow: 1,
  },
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  step1Scroll: {
    flex: 1,
  },
  step1ScrollContent: {
    paddingBottom: Spacing.xxl,
  },
  backButton: {
    padding: Spacing.md,
    marginTop: Spacing.xl,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  title: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    marginBottom: Spacing.xl,
  },
  form: {
    marginTop: Spacing.lg,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
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
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  locationHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  tapHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  mapPreview: {
    height: 320,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  mapPreviewInner: {
    flex: 1,
    minHeight: 320,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  primaryButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
});
