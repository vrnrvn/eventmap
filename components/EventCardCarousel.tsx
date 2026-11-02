import { View, Image, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { EventmapCalendar } from '@/components/icons/EventmapIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEFAULT_CARD_WIDTH = SCREEN_WIDTH - 32;
const DEFAULT_IMAGE_HEIGHT = 180;

type EventCardCarouselProps = {
  imageUrls: string[];
  imageHeight?: number;
  /** Available width for the carousel (defaults to screen width minus 32). */
  width?: number;
  /** Optional: subtle skew on images for editorial feel (e.g. alternating cards) */
  applySkew?: boolean;
};

export function EventCardCarousel({
  imageUrls,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  width = DEFAULT_CARD_WIDTH,
  applySkew = false,
}: EventCardCarouselProps) {
  // A zero/negative width (e.g. measured before layout) would make
  // snapToInterval invalid natively and collapse the scale interpolation's
  // input range to [0, 0, 0].
  const safeWidth = width > 0 ? width : DEFAULT_CARD_WIDTH;
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const images = imageUrls.length > 0 ? imageUrls : [''];
  const isPlaceholder = images.length === 1 && !images[0];

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

function CarouselImage({
  uri,
  index,
  scrollX,
  isPlaceholder,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  cardWidth = DEFAULT_CARD_WIDTH,
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
      {uri && !isPlaceholder ? (
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
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
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_IMAGE_HEIGHT,
  },
  imageWrapper: {
    overflow: 'hidden',
    borderRadius: 18,
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
