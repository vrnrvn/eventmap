import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Star } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { Colors, Spacing, Typography } from '@/constants/theme';
import type { ReviewWithProfile } from '@/services/reviews';

type ReviewCardProps = {
  review: ReviewWithProfile;
  isOwner?: boolean;
  onRespond?: (reviewId: string, response: string) => Promise<void>;
};

export function ReviewCard({ review, isOwner, onRespond }: ReviewCardProps) {
  const [editing, setEditing] = useState(false);
  const [responseText, setResponseText] = useState(review.business_response || '');
  const [saving, setSaving] = useState(false);

  const handleSubmitResponse = async () => {
    if (!onRespond || !responseText.trim()) return;
    setSaving(true);
    try {
      await onRespond(review.id, responseText.trim());
      setEditing(false);
    } catch {
      Alert.alert('Error', 'Failed to post response');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar
          imageUrl={review.profile?.avatar_url}
          name={review.profile?.name || 'User'}
          size={36}
        />
        <View style={styles.meta}>
          <Text style={styles.name}>{review.profile?.name || 'User'}</Text>
          <View style={styles.ratingRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={14}
                color={i < review.rating ? '#F59E0B' : '#D1D5DB'}
                fill={i < review.rating ? '#F59E0B' : 'transparent'}
              />
            ))}
            <Text style={styles.date}>{formatDate(review.created_at)}</Text>
          </View>
        </View>
      </View>
      {review.text ? (
        <Text style={styles.text}>{review.text}</Text>
      ) : null}
      {review.business_response && !editing ? (
        <View style={styles.response}>
          <Text style={styles.responseLabel}>Response from business</Text>
          <Text style={styles.responseText}>{review.business_response}</Text>
        </View>
      ) : isOwner && onRespond ? (
        editing ? (
          <View style={styles.responseForm}>
            <TextInput
              style={styles.input}
              value={responseText}
              onChangeText={setResponseText}
              placeholder="Write a response..."
              placeholderTextColor={Colors.text.tertiary}
              multiline
              editable={!saving}
            />
            <View style={styles.responseActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setEditing(false);
                  setResponseText(review.business_response || '');
                }}
                disabled={saving}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, !responseText.trim() && styles.submitBtnDisabled]}
                onPress={handleSubmitResponse}
                disabled={saving || !responseText.trim()}
              >
                <Text style={styles.submitText}>{saving ? 'Posting…' : 'Post Response'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.respondBtn}
            onPress={() => setEditing(true)}
          >
            <Text style={styles.respondBtnText}>
              {review.business_response ? 'Edit response' : 'Respond'}
            </Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.background.secondary,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  date: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginLeft: 6,
  },
  text: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
    marginTop: Spacing.xs,
  },
  response: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  responseLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    marginBottom: 4,
  },
  responseText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  respondBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
  },
  respondBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },
  responseForm: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  input: {
    backgroundColor: Colors.background.primary,
    borderRadius: 8,
    padding: Spacing.sm,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  responseActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  cancelText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  submitBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
});
