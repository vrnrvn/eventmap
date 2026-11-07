// lucide-react-native only ships types for its barrel entry; the deep
// per-icon imports in components/icons.generated.ts (one module per icon, so
// Metro bundles only the icons the app uses) need this wildcard declaration.
declare module 'lucide-react-native/dist/esm/icons/*' {
  import type { LucideIcon } from 'lucide-react-native';
  const icon: LucideIcon;
  export default icon;
}
