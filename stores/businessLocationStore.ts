export type BusinessLocationResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

let pendingResult: BusinessLocationResult | null = null;

export const businessLocationStore = {
  getPending: () => pendingResult,
  setPending: (result: BusinessLocationResult | null) => {
    pendingResult = result;
  },
  consume: () => {
    const r = pendingResult;
    pendingResult = null;
    return r;
  },
};
