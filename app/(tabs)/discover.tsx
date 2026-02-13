import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { RankedEvent, Category } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Search, MapPin, Calendar, Users, Filter } from 'lucide-react-native';

export default function DiscoverScreen() {
  const [events, setEvents] = useState<RankedEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [userLocation] = useState({ lat: 37.7749, lng: -122.4194 });

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadEvents();
  }, [searchQuery, selectedCategories]);

  const loadInitialData = async () => {
    try {
      const categoriesData = await categoriesService.getAllCategories();
      setCategories(categoriesData);
      await loadEvents();
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await eventsService.getRankedEvents(
        userLocation.lat,
        userLocation.lng,
        {
          radiusKm: 50,
          searchQuery: searchQuery || undefined,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        }
      );
      setEvents(data);
    } catch (err: any) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSearchQuery('');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover Events</Text>

        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events or businesses..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.text.tertiary}
          />
        </View>

        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={20} color={Colors.primary} />
          <Text style={styles.filterButtonText}>
            Filters {selectedCategories.length > 0 && `(${selectedCategories.length})`}
          </Text>
        </TouchableOpacity>

        {showFilters && (
          <View style={styles.filtersContainer}>
            <View style={styles.filtersHeader}>
              <Text style={styles.filtersTitle}>Categories</Text>
              {selectedCategories.length > 0 && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={styles.clearText}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.categoriesGrid}>
              {categories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.categoryChip,
                    selectedCategories.includes(category.id) &&
                      styles.categoryChipSelected,
                  ]}
                  onPress={() => toggleCategory(category.id)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      selectedCategories.includes(category.id) &&
                        styles.categoryChipTextSelected,
                    ]}
                  >
                    {category.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {events.length === 0 ? (
            <View style={styles.emptyState}>
              <MapPin size={48} color={Colors.text.tertiary} />
              <Text style={styles.emptyTitle}>No events found</Text>
              <Text style={styles.emptySubtitle}>
                Try adjusting your filters or search query
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.resultsText}>
                {events.length} event{events.length !== 1 ? 's' : ''} found
              </Text>
              {events.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.eventCard}
                  onPress={() => router.push(`/event/${event.id}` as any)}
                >
                  {event.cover_image_url && (
                    <View style={styles.eventImage}>
                      <Text style={styles.imagePlaceholder}>📸</Text>
                    </View>
                  )}

                  <View style={styles.eventContent}>
                    <View style={styles.eventHeader}>
                      <Text style={styles.eventTitle} numberOfLines={2}>
                        {event.title}
                      </Text>
                      {event.is_premium && (
                        <View style={styles.premiumBadge}>
                          <Text style={styles.premiumText}>★</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.eventMeta}>
                      <View style={styles.metaRow}>
                        <Calendar size={14} color={Colors.text.secondary} />
                        <Text style={styles.metaText}>
                          {formatDate(event.start_datetime)}
                        </Text>
                      </View>

                      <View style={styles.metaRow}>
                        <MapPin size={14} color={Colors.text.secondary} />
                        <Text style={styles.metaText}>
                          {event.distance_km.toFixed(1)} km away
                        </Text>
                      </View>

                      {event.rsvp_count > 0 && (
                        <View style={styles.metaRow}>
                          <Users size={14} color={Colors.text.secondary} />
                          <Text style={styles.metaText}>
                            {event.rsvp_count} going
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.categoryBadge}>
                      <Text style={styles.categoryText}>
                        {event.category_label}
                      </Text>
                    </View>

                    <Text style={styles.businessName}>{event.business_name}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.secondary,
  },
  header: {
    backgroundColor: Colors.background.primary,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xxl + Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  headerTitle: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    marginLeft: Spacing.sm,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  filterButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.primary,
    fontWeight: Typography.weights.medium,
  },
  filtersContainer: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  filtersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  filtersTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  clearText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  categoryChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontWeight: Typography.weights.medium,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
  },
  resultsText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
  },
  eventCard: {
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    ...Shadows.md,
  },
  eventImage: {
    height: 150,
    backgroundColor: Colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholder: {
    fontSize: 48,
  },
  eventContent: {
    padding: Spacing.md,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  eventTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  premiumBadge: {
    backgroundColor: Colors.premium,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginLeft: Spacing.sm,
  },
  premiumText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
  },
  eventMeta: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  metaText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.background.secondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  categoryText: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    fontWeight: Typography.weights.medium,
  },
  businessName: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
});
