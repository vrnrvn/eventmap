import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Plus, Star, X } from '@/components/icons.generated';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { notify } from '@/utils/notify';
import {
  columnsForWidth,
  gridHeight,
  moveItem,
  slotIndexAt,
  slotPosition,
} from '@/utils/reorder';

export type ImageAsset = {
  uri: string;
  name: string;
  type: string;
  /** Remote URL if this is an existing photo already uploaded */
  remoteUrl?: string;
  /** Database photo id if this is an existing photo */
  photoId?: string;
};

type ImagePickerButtonProps = {
  images: ImageAsset[];
  onChange: (images: ImageAsset[]) => void;
  maxImages?: number;
};

const THUMB_SIZE = 100;
const GRID_GAP = Spacing.sm;
/** Hold before a drag takes over, so the form can still be scrolled. */
const DRAG_HOLD_MS = 220;

/** Stable identity for animation and reordering; remote photos carry an id. */
const keyOf = (img: ImageAsset) => img.photoId ?? img.uri;

/**
 * Checks if a URI or MIME type indicates HEIC/HEIF format
 */
/** Longest edge after resize; plenty for a 480pt hero at 3x. */
const MAX_EDGE_PX = 1600;

/**
 * Converts any image to JPEG and bounds its size with expo-image-manipulator.
 * Guarantees a proper JPEG regardless of input (HEIC, PNG) and keeps a 12 MP
 * phone photo from being uploaded (and base64-encoded in JS) at full size.
 */
async function convertToJpeg(uri: string, width?: number, height?: number): Promise<string> {
  const longest = Math.max(width ?? 0, height ?? 0);
  const actions: ImageManipulator.Action[] =
    longest > MAX_EDGE_PX
      ? [width! >= height! ? { resize: { width: MAX_EDGE_PX } } : { resize: { height: MAX_EDGE_PX } }]
      : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/**
 * Generates a safe file name with .jpg extension
 */
function generateFileName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `photo-${timestamp}-${random}.jpg`;
}

export function ImagePickerButton({
  images,
  onChange,
  maxImages = 5,
}: ImagePickerButtonProps) {
  const handleAdd = async () => {
    if (images.length >= maxImages) {
      notify.error(`You can upload up to ${maxImages} images.`);
      return;
    }

    const remaining = maxImages - images.length;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const newAssets: ImageAsset[] = [];

    for (const asset of result.assets) {
      let uri = asset.uri;

      // Always convert to JPEG to avoid HEIC/unsupported format issues
      // This also normalizes PNGs and other formats for consistency
      try {
        uri = await convertToJpeg(uri, asset.width, asset.height);
      } catch (err) {
        console.warn('Image conversion failed, using original:', err);
      }

      newAssets.push({
        uri,
        name: generateFileName(),
        type: 'image/jpeg',
      });
    }

    onChange([...images, ...newAssets].slice(0, maxImages));
  };

  const handleRemove = (index: number) => {
    const updated = [...images];
    updated.splice(index, 1);
    onChange(updated);
  };

  /**
   * Promote a photo to position 0, which is what both forms treat as the
   * cover. Previously the only way to change the cover was to remove the
   * first photo and re-upload it.
   */
  const handleMakeCover = (index: number) => {
    if (index === 0) return;
    const updated = [...images];
    const [picked] = updated.splice(index, 1);
    onChange([picked, ...updated]);
  };

  /**
   * Live order while a drag is in progress. Null when idle, so props stay the
   * source of truth outside a drag.
   */
  const [dragOrder, setDragOrder] = useState<ImageAsset[] | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const order = dragOrder ?? images;
  const orderRef = useRef(order);
  orderRef.current = order;

  const columns = columnsForWidth(containerWidth, THUMB_SIZE, GRID_GAP);
  const canAdd = images.length < maxImages;
  const slotCount = order.length + (canAdd ? 1 : 0);
  const height = gridHeight(slotCount, columns, THUMB_SIZE, GRID_GAP);

  // Shared across thumbnails: which one is airborne and where it has moved to.
  const draggingKey = useSharedValue<string | null>(null);
  const dragBaseX = useSharedValue(0);
  const dragBaseY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const onMeasure = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const beginDrag = useCallback(() => {
    setDragOrder(orderRef.current);
  }, []);

  /**
   * Called only when the drag crosses into a different slot. The ref is
   * updated synchronously so a drop that lands before React has flushed the
   * preview still commits the order the user saw.
   */
  const previewMove = useCallback((key: string, target: number) => {
    const list = orderRef.current;
    const from = list.findIndex((img) => keyOf(img) === key);
    if (from < 0) return;
    const next = moveItem(list, from, target);
    if (next === list) return;
    orderRef.current = next;
    setDragOrder(next);
  }, []);

  const commitDrag = useCallback(() => {
    const next = orderRef.current;
    setDragOrder(null);
    // The parent replaced the list mid-drag (e.g. uploads finished): the
    // preview is stale, so drop it rather than clobber the newer list.
    if (next.length !== images.length) return;
    const changed = next.some((img, i) => keyOf(img) !== keyOf(images[i]));
    if (changed) onChange(next);
  }, [images, onChange]);

  // If the parent swaps `images` while a drag is in flight, abandon the
  // preview; the gesture's finalize sees draggingKey cleared and won't commit.
  const imagesRef = useRef(images);
  useEffect(() => {
    if (imagesRef.current !== images) {
      imagesRef.current = images;
      if (dragOrder) {
        setDragOrder(null);
        draggingKey.value = null;
      }
    }
  }, [images, dragOrder, draggingKey]);

  /** Keyboard / screen-reader path: drag is pointer-only. */
  const nudge = useCallback(
    (index: number, delta: number) => {
      onChange(moveItem(images, index, index + delta));
    },
    [images, onChange]
  );

  return (
    <View style={styles.container} onLayout={onMeasure}>
      {containerWidth > 0 ? (
        <View style={{ height }}>
          {order.map((img, index) => (
            <DraggableThumb
              key={keyOf(img)}
              itemKey={keyOf(img)}
              img={img}
              index={index}
              total={order.length}
              columns={columns}
              draggingKey={draggingKey}
              dragBaseX={dragBaseX}
              dragBaseY={dragBaseY}
              dragX={dragX}
              dragY={dragY}
              onDragStart={beginDrag}
              onPreviewMove={previewMove}
              onDragEnd={commitDrag}
              onRemove={handleRemove}
              onMakeCover={handleMakeCover}
              onNudge={nudge}
            />
          ))}

          {canAdd ? (
            <View
              style={[
                styles.slot,
                {
                  transform: [
                    { translateX: slotPosition(order.length, columns, THUMB_SIZE, GRID_GAP).x },
                    { translateY: slotPosition(order.length, columns, THUMB_SIZE, GRID_GAP).y },
                  ],
                },
              ]}
            >
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAdd}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Add photo"
              >
                <Plus size={24} color={Colors.text.tertiary} />
                <Text style={styles.addText}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {order.length > 1 ? (
        <Text style={styles.reorderHint}>
          Hold and drag a photo to reorder. The first one is the cover.
        </Text>
      ) : null}
    </View>
  );
}

type DraggableThumbProps = {
  itemKey: string;
  img: ImageAsset;
  index: number;
  total: number;
  columns: number;
  draggingKey: ReturnType<typeof useSharedValue<string | null>>;
  dragBaseX: ReturnType<typeof useSharedValue<number>>;
  dragBaseY: ReturnType<typeof useSharedValue<number>>;
  dragX: ReturnType<typeof useSharedValue<number>>;
  dragY: ReturnType<typeof useSharedValue<number>>;
  onDragStart: () => void;
  onPreviewMove: (key: string, target: number) => void;
  onDragEnd: () => void;
  onRemove: (index: number) => void;
  onMakeCover: (index: number) => void;
  onNudge: (index: number, delta: number) => void;
};

function DraggableThumb({
  itemKey,
  img,
  index,
  total,
  columns,
  draggingKey,
  dragBaseX,
  dragBaseY,
  dragX,
  dragY,
  onDragStart,
  onPreviewMove,
  onDragEnd,
  onRemove,
  onMakeCover,
  onNudge,
}: DraggableThumbProps) {
  const slot = slotPosition(index, columns, THUMB_SIZE, GRID_GAP);
  // Mirrored into shared values so the gesture can read the current slot
  // without being rebuilt when the index changes mid-drag.
  const slotX = useSharedValue(slot.x);
  const slotY = useSharedValue(slot.y);
  const indexSv = useSharedValue(index);
  useEffect(() => {
    slotX.value = slot.x;
    slotY.value = slot.y;
    indexSv.value = index;
  }, [slot.x, slot.y, index, slotX, slotY, indexSv]);

  // Last slot this drag reported, so the JS reorder only runs on a crossing
  // rather than on every frame.
  const lastTarget = useSharedValue(index);

  // Memoised on values that are stable for the duration of a drag. (Parents
  // pass inline onChange handlers, so the gesture object is still rebuilt on
  // their renders — gesture-handler only re-attaches when the handler *type*
  // changes, so an in-flight drag survives that; the memo mainly avoids
  // rebuilding on every preview reorder.)
  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Long-press activation keeps vertical scrolling of the form intact.
        .activateAfterLongPress(DRAG_HOLD_MS)
        .onStart(() => {
          dragBaseX.value = slotX.value;
          dragBaseY.value = slotY.value;
          dragX.value = 0;
          dragY.value = 0;
          lastTarget.value = indexSv.value;
          draggingKey.value = itemKey;
          runOnJS(onDragStart)();
        })
        .onUpdate((e) => {
          dragX.value = e.translationX;
          dragY.value = e.translationY;
          const centerX = dragBaseX.value + dragX.value + THUMB_SIZE / 2;
          const centerY = dragBaseY.value + dragY.value + THUMB_SIZE / 2;
          const target = slotIndexAt(centerX, centerY, columns, THUMB_SIZE, GRID_GAP, total);
          if (target !== lastTarget.value) {
            lastTarget.value = target;
            runOnJS(onPreviewMove)(itemKey, target);
          }
        })
        .onFinalize(() => {
          if (draggingKey.value !== itemKey) return;
          draggingKey.value = null;
          runOnJS(onDragEnd)();
        }),
    [
      itemKey,
      columns,
      total,
      onDragStart,
      onPreviewMove,
      onDragEnd,
      draggingKey,
      dragBaseX,
      dragBaseY,
      dragX,
      dragY,
      lastTarget,
      slotX,
      slotY,
      indexSv,
    ]
  );

  const animatedStyle = useAnimatedStyle(() => {
    const dragging = draggingKey.value === itemKey;
    if (dragging) {
      // Stays under the finger: based on the slot captured at drag start, so
      // the live reordering of the other cells doesn't move it.
      return {
        transform: [
          { translateX: dragBaseX.value + dragX.value },
          { translateY: dragBaseY.value + dragY.value },
          { scale: 1.06 },
        ],
        zIndex: 20,
        opacity: 0.95,
      };
    }
    return {
      transform: [
        { translateX: withTiming(slot.x, { duration: 160 }) },
        { translateY: withTiming(slot.y, { duration: 160 }) },
        { scale: withTiming(1, { duration: 160 }) },
      ],
      zIndex: 1,
      opacity: 1,
    };
  }, [slot.x, slot.y, itemKey]);

  const isCover = index === 0;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.slot, styles.draggable, animatedStyle]}
        // `accessible` makes the cell a focusable element on iOS (without it
        // VoiceOver skips the view and never exposes the actions). An
        // accessible container swallows its children there, so Remove and
        // Make cover are offered as actions too, alongside the inner buttons
        // pointer users tap.
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Photo ${index + 1} of ${total}${isCover ? ', cover photo' : ''}`}
        accessibilityHint="Double-tap and hold, then drag to reorder. Actions available."
        accessibilityActions={[
          { name: 'moveUp' as const, label: 'Move earlier' },
          { name: 'moveDown' as const, label: 'Move later' },
          ...(isCover ? [] : [{ name: 'makeCover' as const, label: 'Make cover photo' }]),
          { name: 'remove' as const, label: 'Remove photo' },
        ]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === 'moveUp') onNudge(index, -1);
          else if (action === 'moveDown') onNudge(index, 1);
          else if (action === 'makeCover') onMakeCover(index);
          else if (action === 'remove') onRemove(index);
        }}
      >
        <Image
          source={{ uri: img.remoteUrl || img.uri }}
          style={styles.thumb}
          contentFit="cover"
          recyclingKey={img.remoteUrl || img.uri}
        />
        {isCover ? (
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeText}>Cover</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.coverBadge, styles.makeCoverBadge]}
            onPress={() => onMakeCover(index)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Make photo ${index + 1} the cover`}
          >
            <Star size={10} color="#FFFFFF" />
            <Text style={styles.coverBadgeText}>Cover</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => onRemove(index)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove photo ${index + 1}`}
        >
          <X size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.sm,
  },
  /** Cells are absolutely positioned so they can animate between slots. */
  slot: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  draggable: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  reorderHint: {
    marginTop: Spacing.sm,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
  },
  coverBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  makeCoverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  coverBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border.light,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  addText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
});