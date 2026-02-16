import { View, Image, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 32;
const DEFAULT_IMAGE_HEIGHT = 180;

type EventCardCarouselProps = {
  imageUrls: string[];
  imageHeight?: number;
  /** Optional: subtle skew on images for editorial feel (e.g. alternating cards) */
  applySkew?: boolean;
};

export function EventCardCarousel({ imageUrls, imageHeight = DEFAULT_IMAGE_HEIGHT, applySkew = false }: EventCardCarouselProps) {
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const images = imageUrls.length > 0 ? imageUrls : [''];
  const isPlaceholder = images.length === 1 && !images[0];

  return (
    <View style={[styles.container, { height: imageHeight }]}>
      <Animated.FlatList
        data={images}
        horizontal
        pagingEnabled={images.length > 1}
        snapToInterval={CARD_WIDTH}
        snapToAlignment="start"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        keyExtractor={(_, i) => `img-${i}`}
        renderItem={({ item, index }) => (
          <CarouselImage
            uri={item}
            index={index}
            scrollX={scrollX}
            isPlaceholder={isPlaceholder}
            imageHeight={imageHeight}
            applySkew={applySkew}
          />
        )}
      />
    </View>
  );
}

function CarouselImage({
  uri,
  index,
  scrollX,
  isPlaceholder,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  applySkew = false,
}: {
  uri: string;
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  isPlaceholder: boolean;
  imageHeight?: number;
  applySkew?: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * CARD_WIDTH,
      index * CARD_WIDTH,
      (index + 1) * CARD_WIDTH,
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
    <Animated.View style={[styles.imageWrapper, { width: CARD_WIDTH, height: imageHeight }, animatedStyle]}>
      {uri && !isPlaceholder ? (
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <Text style={styles.placeholderIcon}>📸</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
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
  placeholderIcon: {
    fontSize: 48,
  },
});
