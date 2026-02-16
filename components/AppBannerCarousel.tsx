import { View, Text, StyleSheet, TouchableOpacity, Image, Linking } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import type { AppBanner } from '@/services/banners';

type AppBannerCarouselProps = {
  banners: AppBanner[];
};

export function AppBannerCarousel({ banners }: AppBannerCarouselProps) {
  if (banners.length === 0) return null;

  const handlePress = (banner: AppBanner) => {
    if (banner.link_url) {
      Linking.openURL(banner.link_url);
    }
  };

  return (
    <View style={styles.container}>
      {banners.map((banner) => (
        <TouchableOpacity
          key={banner.id}
          style={styles.banner}
          onPress={() => handlePress(banner)}
          activeOpacity={banner.link_url ? 0.8 : 1}
          disabled={!banner.link_url}
        >
          {banner.image_url ? (
            <Image source={{ uri: banner.image_url }} style={styles.bannerImage} resizeMode="cover" />
          ) : null}
          <View style={[styles.bannerContent, banner.image_url && styles.bannerContentOverlay]}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {banner.title}
            </Text>
            {banner.content ? (
              <Text style={styles.bannerText} numberOfLines={2}>
                {banner.content}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  banner: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  bannerImage: {
    width: '100%',
    height: 100,
    backgroundColor: Colors.background.tertiary,
  },
  bannerContent: {
    padding: Spacing.md,
  },
  bannerContentOverlay: {
    padding: Spacing.sm,
  },
  bannerTitle: {
    fontSize: Typography.sizes.base,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  bannerText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
  },
});
