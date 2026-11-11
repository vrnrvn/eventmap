import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { BadgeCheck, AlertTriangle } from '@/components/icons.generated';
import { hostTrustService } from '@/services/hostTrust';
import { notify } from '@/utils/notify';
import {
  SUPPORT_EMAIL,
  VERIFICATION_COPY,
  appealMailto,
  canRequestVerification,
  effectiveStanding,
  normaliseEvidenceUrl,
  standingNotice,
  trustErrorKind,
  trustErrorMessage,
  verificationState,
} from '@/utils/hostTrust';
import type { Business } from '@/types/database';

const NOTE_MAX = 500;

/**
 * Settings → Host profile: standing notice and verification (Stage 6).
 * Hosts see where they stand and can ask to be verified with a link EventMap
 * can check. No document upload (plan §9 Q3).
 */
export function HostVerificationRow({ business }: { business: Business }) {
  const queryClient = useQueryClient();
  // Shared with hooks/useHostChecklist so the checklist ticks after a request.
  const key = ['host', 'verification', business.id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => hostTrustService.getLatestRequest(business.id) });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const standing = effectiveStanding(business);
  const notice = standingNotice(business);
  const state = query.data === undefined ? null : verificationState(business, query.data);
  const copy = state ? VERIFICATION_COPY[state.kind] : null;
  const reviewerNote =
    state && (state.kind === 'needs_info' || state.kind === 'rejected') ? state.request.reviewer_note : null;

  const submit = async () => {
    const evidence = normaliseEvidenceUrl(url);
    if (!evidence) {
      setError('Enter a web address EventMap can check, like yoursite.com or instagram.com/you.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await hostTrustService.submitRequest(evidence, note.trim() || null);
      setOpen(false);
      setUrl('');
      setNote('');
      notify.success('Request sent. We’ll let you know here once it’s reviewed.');
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      const kind = trustErrorKind(e);
      setError(kind ? trustErrorMessage(kind, e) : e instanceof Error ? e.message : 'Could not send the request.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {notice ? (
        <View style={[styles.notice, notice.tone === 'danger' && styles.noticeDanger]} accessibilityRole="alert">
          <AlertTriangle size={16} color={notice.tone === 'danger' ? Colors.error : Colors.warningText} />
          <View style={styles.flex}>
            <Text style={styles.title}>{notice.title}</Text>
            <Text style={styles.body}>{notice.body}</Text>
            {effectiveStanding(business) === 'restricted' ? (
              <Button
                label="Appeal to support"
                onPress={() => Linking.openURL(appealMailto(business)).catch(() => notify.error(`Email ${SUPPORT_EMAIL}`))}
                variant="secondary"
                size="md"
                fullWidth
                style={styles.spaced}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {!state || !copy ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <>
          <View style={styles.row}>
            <BadgeCheck size={18} color={state.kind === 'verified' ? Colors.primary : Colors.text.tertiary} />
            <View style={styles.flex}>
              <Text style={styles.title}>{copy.title}</Text>
              <Text style={styles.body}>{copy.body}</Text>
              {reviewerNote ? <Text style={styles.reviewer}>From EventMap: {reviewerNote}</Text> : null}
            </View>
          </View>

          {canRequestVerification(state, standing, !!business.archived_at) && !open ? (
            <Button
              label={state.kind === 'needs_info' ? 'Add Information' : state.kind === 'rejected' ? 'Try Again' : 'Request Verification'}
              onPress={() => setOpen(true)}
              variant="secondary"
              size="md"
              fullWidth
            />
          ) : null}

          {open ? (
            <View style={styles.form}>
              <Text style={styles.label} nativeID="verify-url-label">
                A link that shows it’s you
              </Text>
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={(t) => {
                  setUrl(t);
                  setError(null);
                }}
                placeholder="yoursite.com or instagram.com/you"
                placeholderTextColor={Colors.text.tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="A link that shows it's you"
                aria-labelledby="verify-url-label"
              />
              <TextInput
                style={[styles.input, styles.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="Anything that helps us check (optional)"
                placeholderTextColor={Colors.text.tertiary}
                multiline
                maxLength={NOTE_MAX}
                accessibilityLabel="Note for EventMap (optional)"
              />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              <Button label="Send Request" onPress={submit} loading={sending} size="md" fullWidth />
              <Button label="Cancel" onPress={() => setOpen(false)} variant="ghost" size="md" fullWidth />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.warningText,
  },
  noticeDanger: { borderColor: Colors.error },
  title: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  body: { marginTop: 2, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 19 },
  reviewer: { marginTop: 6, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.primary },
  spaced: { marginTop: 10 },
  form: { gap: 8 },
  label: { fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border.light,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
  },
  noteInput: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  error: { fontSize: Typography.sizes.sm, color: Colors.error },
});
