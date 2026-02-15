import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MapPin, Globe, Compass } from 'lucide-react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export type RegionItem = {
  id: string;
  label: string;
  searchQuery: string;
  icon?: 'flexible' | 'globe' | 'compass';
};

const DEFAULT_REGIONS: RegionItem[] = [
  { id: 'flexible', label: "I'm flexible", searchQuery: '', icon: 'flexible' },
  { id: 'europe', label: 'Europe', searchQuery: 'Europe', icon: 'globe' },
  { id: 'southeast-asia', label: 'Southeast Asia', searchQuery: 'Southeast Asia', icon: 'globe' },
  { id: 'usa', label: 'USA', searchQuery: 'United States', icon: 'globe' },
  { id: 'uk', label: 'United Kingdom', searchQuery: 'United Kingdom', icon: 'globe' },
  { id: 'australia', label: 'Australia', searchQuery: 'Australia', icon: 'globe' },
  { id: 'japan', label: 'Japan', searchQuery: 'Japan', icon: 'globe' },
  { id: 'middle-east', label: 'Middle East', searchQuery: 'Middle East', icon: 'compass' },
];

type RegionGridProps = {
  regions?: RegionItem[];
  onSelect: (region: RegionItem) => void;
};

function RegionIcon({ icon }: { icon?: RegionItem['icon'] }) {
  switch (icon) {
    case 'flexible':
      return <Compass size={20} color={Colors.text.secondary} />;
    case 'globe':
      return <Globe size={20} color={Colors.text.secondary} />;
    case 'compass':
      return <Compass size={20} color={Colors.text.secondary} />;
    default:
      return <MapPin size={20} color={Colors.text.secondary} />;
  }
}

export function RegionGrid({ regions = DEFAULT_REGIONS, onSelect }: RegionGridProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Search by region</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {regions.map((region) => (
          <TouchableOpacity
            key={region.id}
            style={styles.regionCard}
            onPress={() => onSelect(region)}
            activeOpacity={0.8}
          >
            <View style={styles.iconCircle}>
              <RegionIcon icon={region.icon} />
            </View>
            <Text style={styles.regionLabel} numberOfLines={2}>
              {region.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingRight: Spacing.lg,
    gap: Spacing.md,
  },
  regionCard: {
    width: 88,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  regionLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
