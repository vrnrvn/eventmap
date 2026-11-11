import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { businessesService, HostSetupUnsupportedError } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { geocodingService } from '@/services/geocoding';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { CategoryIcon } from '@/components/CategoryIcon';
import { GoogleMapView } from '@/components/GoogleMapView';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { BUSINESS_CATEGORY_LABELS } from '@/constants/businessCategories';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import {
  Briefcase,
  Building2,
  Users,
  User,
  Check,
  CalendarPlus,
  Sparkles,
} from '@/components/icons.generated';
import { choiceA11y, a11yState } from '@/utils/accessibility';
import { notify } from '@/utils/notify';
import { selectionHaptic, successHaptic } from '@/utils/haptics';
import {
  EMPTY_HOST_SETUP,
  HOST_DESCRIPTION_MAX,
  HOST_GUIDELINES,
  HOST_NAME_MAX,
  HOST_SETUP_STEPS,
  HOST_TYPES,
  LOCATION_KIND_LABELS,
  applyHostType,
  buildHostInsert,
  firstInvalidStep,
  hostTypeOption,
  normaliseWebsite,
  validateHostStep,
  type HostSetupErrors,
  type HostSetupForm,
  type HostSetupStep,
} from '@/utils/hostSetup';
import type { HostType } from '@/types/database';

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const draftKey = (userId: string) => `eventmap.hostSetupDraft.${userId}`;

const STEP_TITLES: Record<HostSetupStep, { title: string; subtitle: string }> = {
  type: { title: 'What kind of host are you?', subtitle: 'This sets sensible defaults. You can change details later.' },
  identity: { title: 'How people will see you', subtitle: 'Shown on your events and your host page.' },
  location: { title: 'Where do you host?', subtitle: 'Used as the starting point when you create events.' },
  links: { title: 'Links (optional)', subtitle: 'Help people find out more about you.' },
  guidelines: { title: 'Host guidelines', subtitle: 'What attendees and EventMap expect from hosts.' },
};

const TYPE_ICONS: Record<HostType, React.ReactNode> = {
  venue: <Building2 size={22} color={Colors.primary} />,
  organiser: <Users size={22} color={Colors.primary} />,
  individual: <User size={22} color={Colors.primary} />,
};


export default function HostSetup() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const { hasBusiness, refreshBusiness, setUserMode } = useApp();
  const [form, setForm] = useState<HostSetupForm>(EMPTY_HOST_SETUP);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<HostSetupErrors>({});
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [useProfilePhoto, setUseProfilePhoto] = useState(false);
  const committedAddressRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const step = HOST_SETUP_STEPS[stepIndex];
  const typeOpt = form.hostType ? hostTypeOption(form.hostType) : null;

  // ---- Resume draft (per user) ----------------------------------------------
  useEffect(() => {
    if (!user) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(draftKey(user.id))
      .then((raw) => {
        if (!raw || cancelled) return;
        const d = JSON.parse(raw) as { form?: Partial<HostSetupForm>; stepIndex?: number };
        if (d.form) setForm((f) => ({ ...f, ...d.form, acceptedTerms: false }));
        if (typeof d.stepIndex === 'number' && d.stepIndex >= 0 && d.stepIndex < HOST_SETUP_STEPS.length) {
          setStepIndex(d.stepIndex);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !hydrated || done) return;
    const t = setTimeout(() => {
      // Terms acceptance is never resumed: it must be a fresh, explicit tap.
      const { acceptedTerms: _omit, ...rest } = form;
      AsyncStorage.setItem(draftKey(user.id), JSON.stringify({ form: rest, stepIndex })).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [form, stepIndex, user, hydrated, done]);

  const update = (patch: Partial<HostSetupForm>) => setForm((f) => ({ ...f, ...patch }));

  const goTo = (index: number) => {
    setErrors({});
    setStepIndex(index);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handleBack = () => (stepIndex === 0 ? router.back() : goTo(stepIndex - 1));

  const handleNext = () => {
    const e = validateHostStep(step, form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (stepIndex < HOST_SETUP_STEPS.length - 1) goTo(stepIndex + 1);
    else handleSubmit();
  };

  const selectType = (type: HostType) => {
    selectionHaptic();
    setForm((f) => {
      const next = applyHostType(f, type);
      // Individuals usually host as themselves: offer their profile name.
      if (type === 'individual' && !next.name.trim() && profile?.name) next.name = profile.name;
      return next;
    });
    setErrors({});
  };

  const handleLogoPick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUseProfilePhoto(false);
    update({ logoUri: result.assets[0].uri });
  };

  const setPin = (address: string, lat: number, lng: number) => {
    committedAddressRef.current = address;
    update({ address, lat, lng, locationConfirmed: true });
    setErrors((e) => ({ ...e, address: undefined }));
  };

  const handleSubmit = async () => {
    const invalid = firstInvalidStep(form);
    if (invalid) {
      goTo(HOST_SETUP_STEPS.indexOf(invalid));
      setErrors(validateHostStep(invalid, form));
      return;
    }
    setSubmitting(true);
    try {
      let logoUrl: string | null = null;
      if (useProfilePhoto && profile?.avatar_url) {
        logoUrl = profile.avatar_url;
      } else if (form.logoUri) {
        const ext = form.logoUri.split('.').pop() || 'jpg';
        logoUrl = await eventsService.uploadEventImage(
          { uri: form.logoUri, name: `logo-${Date.now()}.${ext}`, type: `image/${ext}` },
          'logos'
        );
      }
      const { business, schema } = await businessesService.createHost({
        ...buildHostInsert(form),
        logo_url: logoUrl,
      });
      const website = normaliseWebsite(form.website);
      if (website) {
        // Non-fatal: the host exists; the link can be added again in Settings.
        await businessesService.addBusinessLink(business.id, website, 'Website').catch(() => {
          notify.error("Your website link couldn't be saved. Add it in Settings.");
        });
      }
      if (user) AsyncStorage.removeItem(draftKey(user.id)).catch(() => {});
      await refreshBusiness();
      setUserMode('business');
      successHaptic();
      if (schema === 'legacy' && form.hostType !== 'venue') {
        notify.success('Your host profile is saved. Your host type will be added once the server is updated.');
      }
      setDone(true);
    } catch (error: unknown) {
      const code = (error as { code?: string } | null)?.code;
      if (error instanceof HostSetupUnsupportedError) {
        goTo(HOST_SETUP_STEPS.indexOf('location'));
        setErrors({ address: error.message });
      } else if (code === '23505') {
        notify.error('You already have a host profile. Edit it in Settings.');
        refreshBusiness().catch(() => {});
      } else {
        notify.error(error instanceof Error && error.message ? error.message : 'Could not create your host profile');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- States ---------------------------------------------------------------
  if (done) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.doneIcon}>
          <Sparkles size={32} color={Colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          You&apos;re set up as a host
        </Text>
        <Text style={[styles.subtitle, styles.centerText]}>
          Next, create your first event. Free hosts can publish 2 events a month.
        </Text>
        <Button
          label="Create Your First Event"
          onPress={() => router.replace('/(tabs)/create' as never)}
          icon={<CalendarPlus size={20} color={Colors.white} />}
          variant="primary"
          gradient
          size="lg"
          fullWidth
          style={styles.doneCta}
        />
        <Button
          label="Go to My Profile"
          onPress={() => router.replace('/(tabs)/profile' as never)}
          variant="secondary"
          size="lg"
          fullWidth
        />
      </View>
    );
  }

  // One host profile per account (businesses.owner_id is UNIQUE).
  if (hasBusiness) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="" safeArea={false} />
        <View style={styles.centered}>
          <View style={styles.doneIcon}>
            <Briefcase size={32} color={Colors.primary} />
          </View>
          <Text style={styles.title}>You already host on EventMap</Text>
          <Text style={[styles.subtitle, styles.centerText]}>
            Each account has one host profile. You can edit yours in Settings.
          </Text>
          <Button label="Open Settings" onPress={() => router.push('/settings')} size="lg" fullWidth />
        </View>
      </View>
    );
  }

  if (!hydrated) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const { title, subtitle } = STEP_TITLES[step];
  const total = HOST_SETUP_STEPS.length;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title="Set up hosting" safeArea={false} onBack={handleBack} />
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${stepIndex + 1} of ${total}`}
        accessibilityValue={{ min: 0, max: total, now: stepIndex + 1 }}
      >
        {HOST_SETUP_STEPS.map((s, i) => (
          <View key={s} style={[styles.progressSegment, i <= stepIndex && styles.progressSegmentFilled]} />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stepLabel}>
          Step {stepIndex + 1} of {total}
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {step === 'type' && (
          <View accessibilityRole="radiogroup" accessibilityLabel="Host type" style={styles.stack}>
            {HOST_TYPES.map((opt) => {
              const selected = form.hostType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.typeCard, selected && styles.typeCardSelected]}
                  onPress={() => selectType(opt.value)}
                  activeOpacity={0.85}
                  {...choiceA11y(selected, `${opt.label}. ${opt.description}`)}
                >
                  <View style={styles.typeIcon}>{TYPE_ICONS[opt.value]}</View>
                  <View style={styles.flex}>
                    <Text style={styles.typeTitle}>{opt.label}</Text>
                    <Text style={styles.typeDesc}>{opt.description}</Text>
                  </View>
                  {selected ? <Check size={20} color={Colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
            {errors.hostType ? <Text style={styles.errorText}>{errors.hostType}</Text> : null}
          </View>
        )}

        {step === 'identity' && (
          <View style={styles.stack}>
            <View style={styles.logoRow}>
              <Avatar
                imageUrl={useProfilePhoto ? profile?.avatar_url ?? null : form.logoUri}
                name={form.name || 'Host'}
                size={80}
                editable
                onPress={handleLogoPick}
                accessibilityLabel={form.hostType === 'individual' ? 'Add a photo' : 'Add a logo'}
              />
              <View style={styles.flex}>
                <Text style={styles.hint}>
                  {form.hostType === 'individual' ? 'Add a photo (optional)' : 'Add a logo (optional)'}
                </Text>
                {form.hostType === 'individual' && profile?.avatar_url ? (
                  <TouchableOpacity
                    onPress={() => {
                      setUseProfilePhoto((v) => !v);
                      update({ logoUri: null });
                    }}
                    accessibilityRole="checkbox"
                    {...a11yState({ checked: useProfilePhoto })}
                    style={styles.inlineToggle}
                  >
                    <View style={[styles.checkbox, useProfilePhoto && styles.checkboxOn]}>
                      {useProfilePhoto ? <Check size={14} color={Colors.white} /> : null}
                    </View>
                    <Text style={styles.inlineToggleText}>Use my profile photo</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            <Input
              label={form.hostType === 'individual' ? 'Host name' : 'Name'}
              value={form.name}
              onChangeText={(name) => update({ name })}
              placeholder={typeOpt?.namePlaceholder ?? 'Name'}
              maxLength={HOST_NAME_MAX}
              error={errors.name}
            />
            <Text style={styles.label}>Category</Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Category">
              {BUSINESS_CATEGORY_LABELS.map((category) => {
                const selected = form.category === category;
                return (
                  <TouchableOpacity
                    key={category}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => update({ category })}
                    {...choiceA11y(selected, category)}
                  >
                    <CategoryIcon category={category} size="sm" variant="pill" />
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}
            <Input
              label={form.hostType === 'venue' ? 'Description' : 'Description (optional)'}
              value={form.description}
              onChangeText={(description) => update({ description })}
              placeholder="What should people know about you?"
              multiline
              numberOfLines={4}
              maxLength={HOST_DESCRIPTION_MAX}
              style={styles.textArea}
              error={errors.description}
            />
          </View>
        )}

        {step === 'location' && typeOpt && (
          <View style={styles.stack}>
            {typeOpt.locationKinds.length > 1 ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Location type" style={styles.stack}>
                {typeOpt.locationKinds.map((kind) => {
                  const selected = form.locationKind === kind;
                  return (
                    <TouchableOpacity
                      key={kind}
                      style={[styles.typeCard, selected && styles.typeCardSelected]}
                      onPress={() => {
                        update({ locationKind: kind });
                        setErrors({});
                      }}
                      {...choiceA11y(selected, LOCATION_KIND_LABELS[kind].label)}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.typeTitle}>{LOCATION_KIND_LABELS[kind].label}</Text>
                        <Text style={styles.typeDesc}>{LOCATION_KIND_LABELS[kind].description}</Text>
                      </View>
                      {selected ? <Check size={20} color={Colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {form.locationKind !== 'none' ? (
              <>
                <AddressSearchInput
                  label={form.locationKind === 'fixed' ? 'Street address' : 'Home area'}
                  value={form.address}
                  onChangeText={(text) => {
                    // Typing alone never moves the pin, so it is unconfirmed
                    // until a suggestion, Set or a map tap.
                    update({ address: text, ...(text !== committedAddressRef.current ? { locationConfirmed: false } : {}) });
                  }}
                  onSelect={(r) => setPin(r.formattedAddress, r.lat, r.lng)}
                  placeholder={form.locationKind === 'fixed' ? 'Building, street address or venue name' : 'Neighbourhood or city'}
                  error={errors.address}
                  approximate={form.locationKind === 'area'}
                  addressPrecision={form.locationKind === 'fixed' ? 'full' : 'any'}
                  showSetButton
                />
                <Text style={styles.hint}>
                  {form.locationKind === 'fixed'
                    ? 'Tap the map to fine-tune the pin.'
                    : 'Only the area is shown on your host page, never an exact pin.'}
                </Text>
                <View style={styles.map}>
                  <GoogleMapView
                    center={{ lat: form.lat ?? DEFAULT_CENTER.lat, lng: form.lng ?? DEFAULT_CENTER.lng }}
                    zoom={form.locationKind === 'fixed' ? 15 : 12}
                    webViewScrollEnabled={false}
                    nestedScrollEnabled={false}
                    markers={
                      form.lat != null && form.lng != null
                        ? [{ id: 'host', lat: form.lat, lng: form.lng, title: form.name || 'Your location' }]
                        : []
                    }
                    style={styles.mapInner}
                    onMapPress={async (lat, lng) => {
                      const r = await geocodingService.reverseGeocode(lat, lng, {
                        preferAddress: form.locationKind === 'fixed',
                      });
                      if (r) setPin(r.formattedAddress, r.lat, r.lng);
                    }}
                  />
                </View>
              </>
            ) : errors.address ? (
              <Text style={styles.errorText}>{errors.address}</Text>
            ) : null}
          </View>
        )}

        {step === 'links' && (
          <View style={styles.stack}>
            <Input
              label="Website"
              value={form.website}
              onChangeText={(website) => update({ website })}
              placeholder="yoursite.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              error={errors.website}
            />
            <Input
              label="Instagram"
              value={form.instagram}
              onChangeText={(instagram) => update({ instagram })}
              placeholder="@yourhandle"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.instagram}
            />
            <Text style={styles.hint}>Add ticketing pages and more links later in Settings.</Text>
          </View>
        )}

        {step === 'guidelines' && (
          <View style={styles.stack}>
            <View style={styles.card}>
              {HOST_GUIDELINES.map((g, i) => (
                <View key={i} style={styles.guideRow}>
                  <Text style={styles.guideNum}>{i + 1}</Text>
                  <Text style={styles.guideText}>{g}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={styles.inlineToggle}
              onPress={() => {
                update({ acceptedTerms: !form.acceptedTerms });
                setErrors({});
              }}
              accessibilityRole="checkbox"
              accessibilityLabel="I agree to the host guidelines"
              {...a11yState({ checked: form.acceptedTerms })}
            >
              <View style={[styles.checkbox, form.acceptedTerms && styles.checkboxOn]}>
                {form.acceptedTerms ? <Check size={14} color={Colors.white} /> : null}
              </View>
              <Text style={styles.inlineToggleText}>I agree to the host guidelines</Text>
            </TouchableOpacity>
            {errors.terms ? <Text style={styles.errorText}>{errors.terms}</Text> : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={step === 'guidelines' ? 'Create Host Profile' : step === 'links' && !form.website && !form.instagram ? 'Skip' : 'Continue'}
          onPress={handleNext}
          loading={submitting}
          size="lg"
          fullWidth
          gradient
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background.primary },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  centerText: { textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  progressTrack: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginBottom: 12 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.border.light },
  progressSegmentFilled: { backgroundColor: Colors.primary },
  stepLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
    marginBottom: 4,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 20,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  stack: { gap: 12 },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  typeCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  typeDesc: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  hint: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  chipText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.primary },
  chipTextSelected: { color: Colors.primary },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  errorText: { fontSize: Typography.sizes.sm, color: Colors.error },
  map: { height: 220, borderRadius: BorderRadius.lg, overflow: 'hidden' },
  mapInner: { flex: 1 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: 16, gap: 12 },
  guideRow: { flexDirection: 'row', gap: 10 },
  guideNum: {
    width: 20,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.primary,
  },
  guideText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  inlineToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  inlineToggleText: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamily, color: Colors.text.primary },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
    backgroundColor: Colors.background.primary,
  },
  doneIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  doneCta: { marginTop: 12 },
});
