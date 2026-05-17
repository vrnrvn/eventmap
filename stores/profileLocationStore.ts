export type ProfileLocationResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

let pendingResult: ProfileLocationResult | null = null;

export const profileLocationStore = {
  getPending: () => pendingResult,
  setPending: (result: ProfileLocationResult | null) => {
    pendingResult = result;
  },
  consume: () => {
    const r = pendingResult;
    pendingResult = null;
    return r;
  },
};
