import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { EventmapCalendar } from '@/components/icons/EventmapIcons';
import { useImageFallback } from '@/hooks/useImageFallback';

const DEFAULT_IMAGE_HEIGHT = 180;
/** Fallback only; the real default comes from useWindowDimensions below. */
const FALLBACK_CARD_WIDTH = 320;

type EventCardCarouselProps = {
  imageUrls: string[];
  imageHeight?: number;
  /** Available width for the carousel (defaults to window width minus 32). */
  width?: number;
  /** Optional: subtle skew on images for editorial feel (e.g. alternating cards) */
  applySkew?: boolean;
};

export function EventCardCarousel({
  imageUrls,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  width,
  applySkew = false,
}: EventCardCarouselProps) {
  // Measured per render so rotation, split-screen and browser resize all
  // reflow; a module-level Dimensions.get() froze this at first import.
  const { width: windowWidth } = useWindowDimensions();
  const fallback = windowWidth > 32 ? windowWidth - 32 : FALLBACK_CARD_WIDTH;
  // A zero/negative width (e.g. measured before layout) would make
  // snapToInterval invalid natively and collapse the scale interpolation's
  // input range to [0, 0, 0].
  const safeWidth = width != null && width > 0 ? width : fallback;
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const images = imageUrls.length > 0 ? imageUrls : [''];
  const isPlaceholder = images.length === 1 && !images[0];

  // The overwhelmingly common case (one image, or none) needs no pager: a
  // scroll view per card costs a view and a scroll handler for nothing, and
  // every Discover card renders one.
  if (images.length === 1) {
    return (
      <View style={[styles.container, { width: safeWidth, height: imageHeight }]}>
        <StaticImage
          uri={images[0]}
          isPlaceholder={isPlaceholder}
          imageHeight={imageHeight}
          cardWidth={safeWidth}
          applySkew={applySkew}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: safeWidth, height: imageHeight }]}>
      <Animated.ScrollView
        horizontal
        pagingEnabled={images.length > 1}
        snapToInterval={safeWidth}
        snapToAlignment="start"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {images.map((uri, index) => (
          <CarouselImage
            key={`img-${index}`}
            uri={uri}
            index={index}
            scrollX={scrollX}
            isPlaceholder={isPlaceholder}
            imageHeight={imageHeight}
            cardWidth={safeWidth}
            applySkew={applySkew}
          />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

/** Single-image variant: same visuals, no animation or scroll machinery. */
function StaticImage({
  uri,
  isPlaceholder,
  imageHeight,
  cardWidth,
  applySkew,
}: {
  uri: string;
  isPlaceholder: boolean;
  imageHeight: number;
  cardWidth: number;
  applySkew: boolean;
}) {
  const image = useImageFallback(uri);
  return (
    <View
      style={[
        styles.imageWrapper,
        { width: cardWidth, height: imageHeight },
        applySkew ? styles.skewed : null,
      ]}
    >
      {uri && !isPlaceholder && !image.failed ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={150}
          onError={image.onError}
        />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <EventmapCalendar size={40} color={Colors.text.tertiary} />
        </View>
      )}
    </View>
  );
}

function CarouselImage({
  uri,
  index,
  scrollX,
  isPlaceholder,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  cardWidth = FALLBACK_CARD_WIDTH,
  applySkew = false,
}: {
  uri: string;
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  isPlaceholder: boolean;
  imageHeight?: number;
  cardWidth?: number;
  applySkew?: boolean;
}) {
  const image = useImageFallback(uri);
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * cardWidth,
      index * cardWidth,
      (index + 1) * cardWidth,
    ];
    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.92, 1, 0.92],
      Extrapolation.CLAMP
    );
    const skewStr = applySkew ? '-0.5deg' : '0deg';
    return { transform: [{ scale }, { skewX: skewStr }] };
  });

  return (
    <Animated.View style={[styles.imageWrapper, { width: cardWidth, height: imageHeight }, animatedStyle]}>
      {uri && !isPlaceholder && !image.failed ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={150}
          onError={image.onError}
        />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <EventmapCalendar size={40} color={Colors.text.tertiary} />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Concrete width/height are applied inline from the measured window.
    height: DEFAULT_IMAGE_HEIGHT,
  },
  imageWrapper: {
    overflow: 'hidden',
    borderRadius: 18,
  },
  skewed: {
    transform: [{ skewX: '-0.5deg' }],
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: Colors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
