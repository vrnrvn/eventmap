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
const IMAGE_HEIGHT = 180;

type EventCardCarouselProps = {
  imageUrls: string[];
};

export function EventCardCarousel({ imageUrls }: EventCardCarouselProps) {
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const images = imageUrls.length > 0 ? imageUrls : [''];
  const isPlaceholder = images.length === 1 && !images[0];

  return (
    <View style={styles.container}>
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
}: {
  uri: string;
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  isPlaceholder: boolean;
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
    return { transform: [{ scale }] };
  });

  return (
    <Animated.View style={[styles.imageWrapper, animatedStyle]}>
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
    height: IMAGE_HEIGHT,
  },
  imageWrapper: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    overflow: 'hidden',
    borderRadius: 12,
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
