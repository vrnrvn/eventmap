// Metro config: Expo defaults plus one build-time redirect.
//
// With EXPO_PUBLIC_MAP_PROVIDER=google the app renders Google Maps only, but
// GoogleMapView still imports the open-map (Leaflet) page builder, whose
// inlined Leaflet + markercluster is ~200 KB of JS. Metro has no dead-module
// elimination for that import, so in Google builds it is resolved to a tiny
// stub instead. Expo's CLI loads .env before this file runs, so the variable
// is set here exactly as the app code sees it. Switching providers changes
// resolution: restart Metro with `--clear` after changing the variable.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_MAP_PROVIDER === 'google') {
  const openMapStub = path.resolve(__dirname, 'utils/openMapHtml.unavailable.ts');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === '@/utils/openMapHtml') {
      return { type: 'sourceFile', filePath: openMapStub };
    }
    return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
