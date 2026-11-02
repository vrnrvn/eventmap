import { useState } from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';

// Brand-token pairs only — every background is dark enough for white
// initials to pass contrast (no accent #FF8EAA / secondaryLight tints).
const GRADIENT_PAIRS: [string, string][] = [
  [Colors.primary, Colors.secondary],
  [Colors.secondary, Colors.secondaryDark],
  [Colors.accentDark, Colors.primary],
  [Colors.primaryDark, Colors.accentDark],
  [Colors.primaryDark, Colors.primary],
];

function getGradient(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENT_PAIRS[Math.abs(hash) % GRADIENT_PAIRS.length];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'U';
  return words
    .slice(0, 2)
    // Array.from is code-point aware; w[0] would split emoji/astral chars
    // into a lone surrogate that renders as "�".
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
}

type AvatarProps = {
  imageUrl: string | null | undefined;
  name: string;
  size: number;
  /** Show camera overlay — make avatar editable */
  editable?: boolean;
  /** Called when editable avatar is tapped */
  onPress?: () => void;
};

export function Avatar({ imageUrl, name, size, editable, onPress }: AvatarProps) {
  // Track which URL failed so a newly uploaded avatar isn't blocked by a
  // previous URL's load error.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const borderRadius = size / 2;
  const fontSize = size * 0.38;
  const cameraSize = Math.max(size * 0.3, 20);

  const showImage = imageUrl && failedUrl !== imageUrl;

  const content = showImage ? (
    <Image
      source={{ uri: imageUrl }}
      style={{ width: size, height: size, borderRadius }}
      onError={() => setFailedUrl(imageUrl)}
    />
  ) : (
    <LinearGradient
      colors={getGradient(name || 'U')}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text
        style={{
          fontSize,
          fontFamily: Typography.fontFamilies.bold,
          fontWeight: Typography.weights.bold,
          color: Colors.white,
          letterSpacing: 1,
        }}
      >
        {getInitials(name || 'U')}
      </Text>
    </LinearGradient>
  );

  if (editable && onPress) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={{ position: 'relative' }}>
        <View style={{ width: size, height: size, borderRadius, overflow: 'hidden' }}>
          {content}
        </View>
        <View
          style={[
            styles.cameraBadge,
            {
              width: cameraSize,
              height: cameraSize,
              borderRadius: cameraSize / 2,
              bottom: 0,
              right: 0,
            },
          ]}
        >
          <Camera size={cameraSize * 0.5} color={Colors.white} />
        </View>
      </TouchableOpacity>
    );
  }

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={onPress}>
        <View style={{ width: size, height: size, borderRadius, overflow: 'hidden' }}>
          {content}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ width: size, height: size, borderRadius, overflow: 'hidden' }}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  cameraBadge: {
    position: 'absolute',
    backgroundColor: Colors.overlay.dark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
});
