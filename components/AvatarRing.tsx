import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';
import { Colors } from '@/constants/theme';

export const AVATAR_RING_SIZE = 128;
const RING_WIDTH = 4;
const GAP = 4;

type AvatarRingProps = {
  imageUrl: string | null | undefined;
  name: string;
  /** Outer diameter including the gradient ring. */
  size?: number;
  loading?: boolean;
  /** Small element rendered at the bottom-right corner (camera, verified badge). */
  badge?: React.ReactNode;
};

/**
 * The gradient-ringed avatar used on the profile tab and in onboarding, so both
 * places share one size and one look.
 */
export function AvatarRing({ imageUrl, name, size = AVATAR_RING_SIZE, loading, badge }: AvatarRingProps) {
  const inner = size - RING_WIDTH * 2;
  const avatar = inner - GAP * 2;
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={[Colors.primary, Colors.primaryLight, Colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.inner, { width: inner, height: inner, borderRadius: inner / 2 }]}>
          {loading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Avatar imageUrl={imageUrl} name={name} size={avatar} />
          )}
        </View>
      </LinearGradient>
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    backgroundColor: Colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
  },
});
