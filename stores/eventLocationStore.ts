export type EventLocationResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

let pendingResult: EventLocationResult | null = null;

export const eventLocationStore = {
  getPending: () => pendingResult,
  setPending: (result: EventLocationResult | null) => {
    pendingResult = result;
  },
  consume: () => {
    const r = pendingResult;
    pendingResult = null;
    return r;
  },
};
