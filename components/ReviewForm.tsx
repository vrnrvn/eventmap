import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';

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
      Alert.alert('Rating required', 'Please select a star rating.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(rating, text.trim());
    } catch {
      Alert.alert('Error', 'Failed to submit review');
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
          >
            <Star
              size={28}
              color={value <= rating ? '#F59E0B' : '#D1D5DB'}
              fill={value <= rating ? '#F59E0B' : 'transparent'}
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
      />
      <View style={styles.actions}>
        {onCancel && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={saving}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.submitBtn, rating < 1 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={saving || rating < 1}
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
    backgroundColor: Colors.background.secondary,
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
    backgroundColor: Colors.background.primary,
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
