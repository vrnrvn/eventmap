import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Colors, Typography } from '@/constants/theme';
import { useImageFallback } from '@/hooks/useImageFallback';

type Props = {
  uri: string | null;
  /** For the initial shown when there is no image or it failed to load. */
  title: string;
  size: number;
};

/**
 * Cover thumbnail for the compare tray and cards. Same fallback as the list
 * rows (`useImageFallback`): a missing or broken cover shows the event's
 * initial on the brand tint instead of a blank square.
 */
export function CompareThumb({ uri, title, size }: Props) {
  const thumb = useImageFallback(uri, { thumbnail: true });
  const shape = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  if (uri && !thumb.failed) {
    return (
      <Image
        source={{ uri: thumb.src ?? undefined }}
        style={[styles.image, shape]}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={thumb.src ?? undefined}
        transition={120}
        onError={thumb.onError}
      />
    );
  }
  return (
    <View style={[styles.placeholder, shape]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>
        {title.trim().charAt(0).toUpperCase() || '•'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: Colors.background.secondary },
  placeholder: {
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.primary,
  },
});
