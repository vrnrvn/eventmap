import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { Button } from '@/components/ui/Button';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Check, Trash2, ExternalLink, ShieldCheck } from '@/components/icons.generated';
import { businessesService } from '@/services/businesses';
import { HostChecklistCard } from '@/components/HostChecklistCard';
import { HostVerificationRow } from '@/components/HostVerificationRow';
import { choiceA11y } from '@/utils/accessibility';
import { notify } from '@/utils/notify';
import { confirmAction } from '@/utils/confirm';
import { hostTrustService } from '@/services/hostTrust';
import { isMissingColumnError } from '@/utils/hostIntent';
import {
  HOST_GUIDELINES,
  HOST_TYPES,
  LOCATION_KIND_LABELS,
  buildHostShapeUpdate,
  changeHostShape,
  hasHostColumns,
  hostShapeDirty,
  hostShapeFromBusiness,
  hostTermsAccepted,
  hostTypeOption,
  normaliseWebsite,
  validateHostShape,
  type HostShapeDraft,
} from '@/utils/hostSetup';
import type { Business, BusinessLink } from '@/types/database';

const MAX_LINKS = 10;

/**
 * Settings → Host profile (HOST_ONBOARDING_PLAN.md Stage 2): host type and
 * home location, guidelines status, and links. Saves independently of the
 * Business Profile card above (which keeps name/description/street address).
 */
export function HostProfileSection({
  business,
  onChanged,
}: {
  business: Business;
  onChanged: () => Promise<void> | void;
}) {
  const migrated = hasHostColumns(business);
  const saved = useMemo(() => hostShapeFromBusiness(business), [business]);
  const [draft, setDraft] = useState<HostShapeDraft>(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const committedAddressRef = useRef<string | null>(saved.address || null);

  useEffect(() => {
    setDraft(saved);
    committedAddressRef.current = saved.address || null;
  }, [saved]);

  const opt = hostTypeOption(draft.hostType);
  const dirty = hostShapeDirty(draft, saved);
  // A venue's street address is edited in the Business Profile card; here it
  // is only needed when a non-venue switches to "venue" without one.
  const needsFixedAddress = draft.locationKind === 'fixed' && saved.locationKind !== 'fixed';

  const update = (patch: Partial<HostShapeDraft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const changeShape = (change: Parameters<typeof changeHostShape>[2]) => {
    setError(null);
    setDraft((d) => changeHostShape(d, saved, change));
  };

  const selectType = (hostType: HostShapeDraft['hostType']) => changeShape({ hostType });

  const handleSave = async () => {
    const msg = validateHostShape(draft);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    try {
      await businessesService.updateHostShape(business.id, buildHostShapeUpdate(draft));
      await onChanged();
      notify.success('Host profile saved');
    } catch (e) {
      notify.error(isMissingColumnError(e) ? 'Host types are not available on the server yet.' : 'Could not save your host profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await businessesService.acceptHostTerms(business.id);
      await onChanged();
      setShowGuidelines(false);
      notify.success('Thanks for accepting the host guidelines');
    } catch {
      notify.error('Could not save your acceptance. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={styles.sectionLabel}>Host Profile</Text>
      </View>
      <View style={styles.card}>
        {migrated ? (
          <>
            <Text style={styles.label}>Host type</Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Host type">
              {HOST_TYPES.map((t) => {
                const selected = draft.hostType === t.value;
                return (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => selectType(t.value)}
                    {...choiceA11y(selected, t.label)}
                  >
                    {selected ? <Check size={14} color={Colors.primary} /> : null}
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>{opt.description}</Text>

            {opt.locationKinds.length > 1 ? (
              <>
                <Text style={[styles.label, styles.spaced]}>Home location</Text>
                <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Home location">
                  {opt.locationKinds.map((k) => {
                    const selected = draft.locationKind === k;
                    return (
                      <TouchableOpacity
                        key={k}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => changeShape({ locationKind: k })}
                        {...choiceA11y(selected, LOCATION_KIND_LABELS[k].label)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {LOCATION_KIND_LABELS[k].label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.hint}>{LOCATION_KIND_LABELS[draft.locationKind].description}</Text>
              </>
            ) : null}

            {draft.locationKind === 'area' || needsFixedAddress ? (
              <View style={styles.spaced}>
                <AddressSearchInput
                  label={draft.locationKind === 'area' ? 'Home area' : 'Street address'}
                  value={draft.address}
                  onChangeText={(text) =>
                    update({ address: text, ...(text !== committedAddressRef.current ? { locationConfirmed: false } : {}) })
                  }
                  onSelect={(r) => {
                    committedAddressRef.current = r.formattedAddress;
                    update({ address: r.formattedAddress, lat: r.lat, lng: r.lng, locationConfirmed: true });
                  }}
                  placeholder={draft.locationKind === 'area' ? 'Neighbourhood or city' : 'Building or street address'}
                  approximate={draft.locationKind === 'area'}
                  addressPrecision={draft.locationKind === 'area' ? 'any' : 'full'}
                  showSetButton
                />
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {dirty ? (
              <Button label="Save Host Profile" onPress={handleSave} loading={saving} size="md" fullWidth style={styles.spaced} />
            ) : null}

            <View style={styles.separator} />
            <View style={styles.termsRow}>
              <ShieldCheck size={18} color={hostTermsAccepted(business) ? Colors.successText : Colors.text.tertiary} />
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Host guidelines</Text>
                <Text style={styles.hint}>
                  {hostTermsAccepted(business) && business.host_terms_accepted_at
                    ? `Accepted ${new Date(business.host_terms_accepted_at).toLocaleDateString()}`
                    : 'Not accepted yet'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowGuidelines((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showGuidelines ? 'Hide host guidelines' : 'Show host guidelines'}
                style={styles.viewBtn}
              >
                <Text style={styles.linkText}>{showGuidelines ? 'Hide' : 'View'}</Text>
              </TouchableOpacity>
            </View>
            {showGuidelines ? (
              <View style={styles.guidelines}>
                {HOST_GUIDELINES.map((g, i) => (
                  <Text key={i} style={styles.guideText}>
                    {i + 1}. {g}
                  </Text>
                ))}
                {!hostTermsAccepted(business) ? (
                  <Button label="Accept Guidelines" onPress={handleAccept} loading={accepting} size="md" fullWidth />
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.hint}>
            Host type and home-area settings will be available after the next server update.
          </Text>
        )}

        <View style={styles.separator} />
        <HostVerificationRow business={business} />

        <View style={styles.separator} />
        {/* Getting started: the dismissible card lives on Profile and My
            Events; this is the permanent way back to it. */}
        <HostChecklistCard style={styles.checklist} forceVisible />

        <View style={styles.separator} />
        <HostLinksEditor businessId={business.id} />

        <View style={styles.separator} />
        <StopHostingRow business={business} onChanged={onChanged} />
      </View>
    </View>
  );
}

/**
 * Stop hosting / reopen (Stage 7). Archiving cancels upcoming published
 * events — attendees are notified — and hides the host profile. It is
 * reversible, and nothing is deleted, because events, RSVPs and chat history
 * all reference the host.
 */
function StopHostingRow({ business, onChanged }: { business: Business; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const archived = !!business.archived_at;

  const stop = async () => {
    const ok = await confirmAction({
      title: 'Stop hosting?',
      message:
        'Your upcoming events are cancelled and everyone going is told. Past events, chat history and your profile are kept, and you can reopen any time.',
      confirmLabel: 'Stop hosting',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const cancelled = await hostTrustService.archiveHost();
      await onChanged();
      notify.success(
        cancelled > 0
          ? `You stopped hosting. ${cancelled} upcoming event${cancelled === 1 ? '' : 's'} cancelled.`
          : 'You stopped hosting.'
      );
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not stop hosting.');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await hostTrustService.reopenHost();
      await onChanged();
      notify.success('Your host profile is open again. Cancelled events stay cancelled.');
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not reopen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>{archived ? 'Hosting is closed' : 'Stop hosting'}</Text>
      <Text style={styles.hint}>
        {archived
          ? 'Your events are not listed and you cannot publish. Reopening does not bring cancelled events back.'
          : 'Cancels your upcoming events and hides your host profile. Reversible; nothing is deleted.'}
      </Text>
      <Button
        label={archived ? 'Reopen Hosting' : 'Stop Hosting'}
        onPress={archived ? reopen : stop}
        loading={busy}
        variant={archived ? 'secondary' : 'destructive'}
        size="md"
        fullWidth
        style={styles.spaced}
      />
    </View>
  );
}

function HostLinksEditor({ businessId }: { businessId: string }) {
  const [links, setLinks] = useState<BusinessLink[] | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLinks(await businessesService.getBusinessLinks(businessId));
    } catch {
      setLinks([]);
      setError("Couldn't load your links.");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const add = async () => {
    const url = normaliseWebsite(newUrl);
    if (!url || !/^https?:\/\/[^\s/$.?#]+\.[^\s]{2,}$/i.test(url)) {
      setError('Enter a valid web address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextOrder = (links ?? []).reduce((m, l) => Math.max(m, l.sort_order), -1) + 1;
      await businessesService.addBusinessLink(businessId, url, null, nextOrder);
      setNewUrl('');
      await load();
    } catch {
      setError('Could not add the link.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await businessesService.deleteBusinessLink(id);
      await load();
    } catch {
      setError('Could not remove the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>Links</Text>
      <Text style={styles.hint}>Website, ticketing page or socials. Shown on your host page.</Text>
      {links === null ? (
        <ActivityIndicator style={styles.spaced} color={Colors.primary} />
      ) : (
        links.map((l) => (
          <View key={l.id} style={styles.linkRow}>
            <ExternalLink size={16} color={Colors.text.tertiary} />
            <Text style={[styles.flex, styles.linkUrl]} numberOfLines={1}>
              {l.label ? `${l.label}: ` : ''}
              {l.url}
            </Text>
            <TouchableOpacity
              onPress={() => remove(l.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Remove link ${l.url}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Trash2 size={18} color={Colors.error} />
            </TouchableOpacity>
          </View>
        ))
      )}
      {links && links.length < MAX_LINKS ? (
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newUrl}
            onChangeText={(t) => {
              setNewUrl(t);
              setError(null);
            }}
            placeholder="Add a link, e.g. yoursite.com"
            placeholderTextColor={Colors.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="New link address"
            onSubmitEditing={add}
          />
          <Button label="Add" onPress={add} disabled={!newUrl.trim() || busy} size="md" />
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  labelRow: { marginTop: 32, marginBottom: 8, paddingHorizontal: 4 },
  sectionLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: 16, gap: 8 },
  checklist: { backgroundColor: Colors.background.primary },
  label: { fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  spaced: { marginTop: 8 },
  hint: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  chipText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.primary },
  chipTextSelected: { color: Colors.primary },
  errorText: { fontSize: Typography.sizes.sm, color: Colors.error },
  separator: { height: 1, backgroundColor: Colors.border.light, marginVertical: 8 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowTitle: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  // 44 px target: hitSlop does not enlarge the box on web.
  viewBtn: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  linkText: { fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.primary },
  guidelines: { gap: 8, paddingTop: 4 },
  guideText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  linkUrl: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.primary },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border.light,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
  },
});
