import { describe, expect, it, vi } from 'vitest';
import { goBackOr } from '@/utils/navigation';

const makeRouter = (canGoBack: boolean) => ({ canGoBack: () => canGoBack, back: vi.fn(), replace: vi.fn() });

describe('goBackOr', () => {
  it('goes back when there is history', () => {
    const r = makeRouter(true);
    goBackOr(r);
    expect(r.back).toHaveBeenCalledOnce();
    expect(r.replace).not.toHaveBeenCalled();
  });

  it('lands on Discover after a deep-link cold start (no history)', () => {
    const r = makeRouter(false);
    goBackOr(r);
    expect(r.back).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith('/(tabs)/discover');
  });

  it('uses the given fallback', () => {
    const r = makeRouter(false);
    goBackOr(r, '/(tabs)/profile');
    expect(r.replace).toHaveBeenCalledWith('/(tabs)/profile');
  });
});
