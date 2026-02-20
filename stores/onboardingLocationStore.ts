export type OnboardingLocationResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

let pendingResult: OnboardingLocationResult | null = null;

export const onboardingLocationStore = {
  getPending: () => pendingResult,
  setPending: (result: OnboardingLocationResult | null) => {
    pendingResult = result;
  },
  consume: () => {
    const r = pendingResult;
    pendingResult = null;
    return r;
  },
};
