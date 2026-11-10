/**
 * Stub for `lucide-react-native` (see vitest.config.mts).
 *
 * Modules like `constants/categoryIconRegistry.ts` import icons purely as component
 * references held in a config map. Tests read that map's *shape* (which slugs
 * exist, what colour each uses) and never render an icon, so a distinct inert
 * component per name is enough.
 *
 * Exports are explicit rather than proxied because ESM named imports are
 * resolved statically. If a test pulls in a module that imports an icon not
 * listed here, the import fails loudly — add the name below.
 */
const icon = (name: string) => {
  const component = () => null;
  Object.defineProperty(component, 'name', { value: name });
  return component;
};

// Used by constants/categoryIconRegistry.ts
export const Disc3 = icon('Disc3');
export const Flame = icon('Flame');
export const Coffee = icon('Coffee');
export const Dices = icon('Dices');
export const Sparkles = icon('Sparkles');
export const MicVocal = icon('MicVocal');
export const PenTool = icon('PenTool');
export const UtensilsCrossed = icon('UtensilsCrossed');
export const Trophy = icon('Trophy');
export const Palette = icon('Palette');
export const MapPin = icon('MapPin');
export const Users = icon('Users');
export const Baby = icon('Baby');
