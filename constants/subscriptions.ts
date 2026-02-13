import { SubscriptionPlan } from '@/types/app';

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'Premium Monthly',
    price: 6.99,
    period: 'month',
    eventsPerMonth: 30,
    features: [
      'Up to 30 events per month',
      'Boosted visibility on map',
      'Priority placement in listings',
      'Featured business badge',
      'Advanced analytics',
      'Priority support',
    ],
  },
  {
    id: 'yearly',
    name: 'Premium Yearly',
    price: 69.99,
    period: 'year',
    eventsPerMonth: 30,
    features: [
      'Up to 30 events per month',
      'Boosted visibility on map',
      'Priority placement in listings',
      'Featured business badge',
      'Advanced analytics',
      'Priority support',
      'Save 17% vs monthly',
    ],
  },
];

export const FREE_TIER_EVENT_LIMIT = 2;
export const PREMIUM_TIER_EVENT_LIMIT = 30;

export const TIER_FEATURES = {
  free: [
    'Up to 2 events per month',
    'Basic event listing',
    'Map visibility',
    'Business profile',
  ],
  premium: [
    'Up to 30 events per month',
    'Boosted visibility on map',
    'Priority placement in listings',
    'Featured business badge',
    'Advanced analytics',
    'Priority support',
  ],
};
