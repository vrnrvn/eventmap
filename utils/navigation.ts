/**
 * Back that always goes somewhere. A screen opened from a deep link on a cold
 * start (eventmap://event/<id>, a shared web URL, a push notification) has no
 * history, so router.back() does nothing; land on the fallback instead.
 */
export type BackRouter = {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: never) => void;
};

export function goBackOr(router: BackRouter, fallback: string = '/(tabs)/discover'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}
