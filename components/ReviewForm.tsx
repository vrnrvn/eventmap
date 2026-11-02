import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { notify } from '@/utils/notify';

type ReviewFormProps = {
  initialRating?: number;
  initialText?: string;
  onSubmit: (rating: number, text: string) => Promise<void>;
  onCancel?: () => void;
  isEditing?: boolean;
};

export function ReviewForm({
  initialRating = 0,
  initialText = '',
  onSubmit,
  onCancel,
  isEditing = false,
}: ReviewFormProps) {
  const [rating, setRating] = useState(initialRating);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) {
      notify.error('Please select a star rating.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(rating, text.trim());
    } catch {
      notify.error('Failed to submit review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Your rating</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity
            key={value}
            onPress={() => setRating(value)}
            style={styles.starBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${value} of 5 stars`}
            accessibilityState={{ selected: value <= rating }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Star
              size={28}
              color={value <= rating ? Colors.warning : Colors.border.light}
              fill={value <= rating ? Colors.warning : 'transparent'}
            />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Your review (optional)</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Share your experience..."
        placeholderTextColor={Colors.text.tertiary}
        multiline
        numberOfLines={3}
        editable={!saving}
        accessibilityLabel="Your review"
      />
      <View style={styles.actions}>
        {onCancel && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.submitBtn, rating < 1 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={saving || rating < 1}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Update review' : 'Submit review'}
          hitSlop={{ top: 6, bottom: 6 }}
        >
          <Text style={styles.submitText}>
            {saving ? 'Submitting…' : isEditing ? 'Update Review' : 'Submit Review'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: Spacing.md,
  },
  starBtn: {
    padding: 2,
  },
  input: {
    backgroundColor: Colors.background.secondary,
    borderRadius: 8,
    padding: Spacing.sm,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: Spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
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
