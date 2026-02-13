import { RankedEvent, Category } from './database';

export type UserMode = 'user' | 'business';

export type FilterOptions = {
  categories: string[];
  startDate: Date | null;
  endDate: Date | null;
  radiusKm: number;
  searchQuery: string;
};

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type EventPin = {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  event: RankedEvent;
  category: Category;
};

export type SubscriptionPlan = {
  id: 'monthly' | 'yearly';
  name: string;
  price: number;
  period: string;
  features: string[];
  eventsPerMonth: number;
};

export type CreateEventFormData = {
  title: string;
  categoryId: string;
  startDatetime: Date;
  endDatetime: Date;
  address: string;
  lat: number;
  lng: number;
  description: string;
  coverImage: string | null;
  photos: string[];
  links: Array<{ label: string; url: string }>;
};

export type CreateBusinessFormData = {
  name: string;
  description: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  logoUrl: string | null;
};
