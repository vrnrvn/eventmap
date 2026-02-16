import { useState } from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';

const GRADIENT_PAIRS: [string, string][] = [
  [Colors.primary, Colors.accent],
  [Colors.secondary, Colors.secondaryLight],
  ['#EC4899', '#F43F5E'],
  [Colors.accent, Colors.accentDark],
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
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
  const [imgFailed, setImgFailed] = useState(false);
  const borderRadius = size / 2;
  const fontSize = size * 0.38;
  const cameraSize = Math.max(size * 0.3, 20);

  const showImage = imageUrl && !imgFailed;

  const content = showImage ? (
    <Image
      source={{ uri: imageUrl }}
      style={{ width: size, height: size, borderRadius }}
      onError={() => setImgFailed(true)}
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
          color: '#FFFFFF',
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
          <Camera size={cameraSize * 0.5} color="#FFFFFF" />
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
