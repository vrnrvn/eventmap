import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
} from 'react-native';
import { X } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type ImageViewerProps = {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
};

export function ImageViewer({ visible, images, initialIndex = 0, onClose }: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  // Clamp: the photos array may have shrunk between opens, and
  // scrollToIndex/initialScrollIndex throw when index > length - 1.
  const safeInitialIndex =
    images.length > 0 ? Math.min(Math.max(0, initialIndex), images.length - 1) : 0;
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex);
  // Photos that failed to load (offline): a message instead of a black page.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const listRef = useRef<FlatList<string>>(null);

  // The viewer stays mounted between opens, so re-sync the active image
  // whenever it becomes visible (possibly with a different initialIndex).
  useEffect(() => {
    if (visible) {
      setActiveIndex(safeInitialIndex);
      if (images.length > 0) {
        listRef.current?.scrollToIndex({ index: safeInitialIndex, animated: false });
      }
    }
  }, [visible, safeInitialIndex, images.length]);

  const handleScroll = (e: any) => {
    const offset = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offset / SCREEN_WIDTH);
    if (idx !== activeIndex && idx >= 0 && idx < images.length) {
      setActiveIndex(idx);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        {/* Close button */}
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Image pager */}
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={safeInitialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={handleScroll}
          keyExtractor={(_, i) => `viewer-${i}`}
          renderItem={({ item }) => (
            <View style={styles.page}>
              {failed.has(item) ? (
                <Text style={styles.unavailable}>This photo can&apos;t load right now.</Text>
              ) : (
                <Image
                  source={{ uri: item }}
                  style={styles.image}
                  resizeMode="contain"
                  onError={() => setFailed((prev) => new Set(prev).add(item))}
                />
              )}
            </View>
          )}
        />

        {/* Dots */}
        {images.length > 1 && (
          <View style={[styles.dotsRow, { bottom: insets.bottom + 24 }]}>
            {images.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === activeIndex && styles.dotActive]}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  unavailable: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  dotsRow: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: 20,
  },
});
