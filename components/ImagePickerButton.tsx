import { useState, useEffect } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X } from 'lucide-react-native';
import { Colors, Typography, Spacing } from '@/constants/theme';

export type ImageAsset = {
  uri: string;
  name: string;
  type: string;
  /** Remote URL if this is an existing photo already uploaded */
  remoteUrl?: string;
  /** Database photo id if this is an existing photo */
  photoId?: string;
};

type ImagePickerButtonProps = {
  images: ImageAsset[];
  onChange: (images: ImageAsset[]) => void;
  maxImages?: number;
};

const THUMB_SIZE = 100;

export function ImagePickerButton({ images, onChange, maxImages = 5 }: ImagePickerButtonProps) {
  const handleAdd = async () => {
    if (images.length >= maxImages) {
      Alert.alert('Limit reached', `You can upload up to ${maxImages} images.`);
      return;
    }

    const remaining = maxImages - images.length;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const newAssets: ImageAsset[] = result.assets.map((asset) => {
      const ext = asset.uri.split('.').pop() || 'jpg';
      return {
        uri: asset.uri,
        name: `photo-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`,
        type: asset.mimeType || `image/${ext}`,
      };
    });

    onChange([...images, ...newAssets].slice(0, maxImages));
  };

  const handleRemove = (index: number) => {
    const updated = [...images];
    updated.splice(index, 1);
    onChange(updated);
  };

  return (
    <View style={styles.container}>
      {images.map((img, index) => (
        <View key={img.uri} style={styles.thumbWrapper}>
          <Image source={{ uri: img.remoteUrl || img.uri }} style={styles.thumb} />
          {index === 0 && (
            <View style={styles.coverBadge}>
              <Text style={styles.coverBadgeText}>Cover</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => handleRemove(index)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ))}

      {images.length < maxImages && (
        <TouchableOpacity style={styles.addButton} onPress={handleAdd} activeOpacity={0.7}>
          <Plus size={24} color={Colors.text.tertiary} />
          <Text style={styles.addText}>Add</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  thumbWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
  },
  coverBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coverBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border.light,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  addText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
});
