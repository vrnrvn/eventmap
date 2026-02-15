import { useState } from 'react';
import {
  View,
  Image,
  Modal,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
} from 'react-native';
import { X } from 'lucide-react-native';
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
  const [activeIndex, setActiveIndex] = useState(initialIndex);

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
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Image pager */}
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={handleScroll}
          keyExtractor={(_, i) => `viewer-${i}`}
          renderItem={({ item }) => (
            <View style={styles.page}>
              <Image
                source={{ uri: item }}
                style={styles.image}
                resizeMode="contain"
              />
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
