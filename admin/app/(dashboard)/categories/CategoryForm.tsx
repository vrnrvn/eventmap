'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { CATEGORY_ICON_KEYS } from '@/lib/categoryIcons';
import { formatSynonyms, normalizeHex, slugify, whiteContrast, type CategoryInput } from '@/lib/categoryForm';
import { CategoryGlyph } from './CategoryGlyph';
import { INITIAL_CATEGORY_STATE, type CategoryActionState } from './actions';
import { FALLBACK_COLOR, type AdminCategory } from './shared';

type Props = {
  action: (prev: CategoryActionState, formData: FormData) => Promise<CategoryActionState>;
  category?: AdminCategory;
  /** Existing slugs are locked: events link to /category/<slug>. */
  lockSlug?: boolean;
};

const inputClass = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

export function CategoryForm({ action, category, lockSlug = false }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL_CATEGORY_STATE);
  const initial: CategoryInput = state.values ?? {
    slug: category?.slug ?? '',
    label: category?.label ?? '',
    description: category?.description ?? '',
    icon_key: category?.icon_key && CATEGORY_ICON_KEYS.includes(category.icon_key) ? category.icon_key : CATEGORY_ICON_KEYS[0],
    color: category?.color ?? FALLBACK_COLOR,
    synonyms: category?.synonyms ?? [],
    is_active: category?.is_active ?? true,
  };

  const [label, setLabel] = useState(initial.label);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const [iconKey, setIconKey] = useState(initial.icon_key);
  const [color, setColor] = useState(initial.color);

  const hex = useMemo(() => normalizeHex(color), [color]);
  const contrast = hex ? whiteContrast(hex) : null;
  const lowContrast = contrast != null && contrast < 4.5;
  const previewColor = hex ?? FALLBACK_COLOR;

  return (
    <form action={formAction} className="grid max-w-4xl gap-8 md:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        {state.message ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.message}
          </p>
        ) : null}

        <div>
          <label htmlFor="label" className={labelClass}>Label</label>
          <input
            id="label"
            name="label"
            type="text"
            required
            maxLength={40}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (!slugTouched && !lockSlug) setSlug(slugify(e.target.value));
            }}
            className={inputClass}
            aria-invalid={Boolean(state.errors.label)}
            aria-describedby={state.errors.label ? 'label-error' : undefined}
          />
          {state.errors.label ? <p id="label-error" className="mt-1 text-sm text-red-700">{state.errors.label}</p> : null}
        </div>

        <div>
          <label htmlFor="slug" className={labelClass}>
            Slug <span className="font-normal text-zinc-500">— used in links: /category/{slug || '…'}</span>
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            value={slug}
            readOnly={lockSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={`${inputClass} ${lockSlug ? 'bg-zinc-100 text-zinc-500' : ''}`}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-invalid={Boolean(state.errors.slug)}
            aria-describedby={state.errors.slug ? 'slug-error' : 'slug-help'}
          />
          {state.errors.slug ? (
            <p id="slug-error" className="mt-1 text-sm text-red-700">{state.errors.slug}</p>
          ) : (
            <p id="slug-help" className="mt-1 text-xs text-zinc-500">
              {lockSlug ? 'Slugs are permanent once created: shared links and the app depend on them.' : 'Lower-case letters, digits and hyphens.'}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>Description</label>
          <input
            id="description"
            name="description"
            type="text"
            maxLength={120}
            defaultValue={initial.description}
            placeholder="One line shown in the app's pickers and browse header"
            className={inputClass}
            aria-invalid={Boolean(state.errors.description)}
          />
          {state.errors.description ? <p className="mt-1 text-sm text-red-700">{state.errors.description}</p> : null}
        </div>

        <fieldset>
          <legend className={labelClass}>Icon</legend>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
            {CATEGORY_ICON_KEYS.map((key) => {
              const selected = iconKey === key;
              return (
                <label
                  key={key}
                  title={key}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border p-2 text-[10px] text-zinc-600 ${
                    selected ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="icon_key"
                    value={key}
                    checked={selected}
                    onChange={() => setIconKey(key)}
                    className="sr-only"
                  />
                  <CategoryGlyph iconKey={key} color={previewColor} size={28} />
                  <span className="truncate">{key}</span>
                </label>
              );
            })}
          </div>
          {state.errors.icon_key ? <p className="mt-1 text-sm text-red-700">{state.errors.icon_key}</p> : null}
        </fieldset>

        <div>
          <label htmlFor="color" className={labelClass}>Colour</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick colour"
              value={hex ?? FALLBACK_COLOR}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-zinc-300 bg-white"
            />
            <input
              id="color"
              name="color"
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#1d4ed8"
              className={`${inputClass} font-mono`}
              aria-invalid={Boolean(state.errors.color) || lowContrast}
              aria-describedby="color-help"
            />
          </div>
          <p id="color-help" className={`mt-1 text-xs ${lowContrast ? 'text-amber-700' : 'text-zinc-500'}`}>
            {state.errors.color
              ? state.errors.color
              : contrast == null
                ? 'Hex colour used for chips, badges and map pins.'
                : lowContrast
                  ? `White text on this colour is ${contrast.toFixed(1)}:1 — below the 4.5:1 the app requires. Pick a darker shade.`
                  : `White text contrast ${contrast.toFixed(1)}:1 ✓`}
          </p>
        </div>

        <div>
          <label htmlFor="synonyms" className={labelClass}>
            Search terms <span className="font-normal text-zinc-500">— comma separated</span>
          </label>
          <textarea
            id="synonyms"
            name="synonyms"
            rows={2}
            defaultValue={formatSynonyms(initial.synonyms)}
            placeholder="concert, gig, band, open mic"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Typing one of these in the app&apos;s search suggests this category and finds its events.
          </p>
          {state.errors.synonyms ? <p className="mt-1 text-sm text-red-700">{state.errors.synonyms}</p> : null}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" name="is_active" defaultChecked={initial.is_active} className="h-4 w-4" />
          Active (shown in pickers and Discover chips). Retired categories stay on their events.
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : category ? 'Save changes' : 'Create category'}
          </button>
          <Link href="/categories" className="text-sm text-zinc-600 hover:text-zinc-900">
            Cancel
          </Link>
        </div>
      </div>

      <aside className="h-fit rounded-lg border border-zinc-200 bg-white p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Preview</p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: '#e4e4e7', color: '#18181b', backgroundColor: '#fff' }}
          >
            <CategoryGlyph iconKey={iconKey} color={previewColor} size={18} />
            {label || 'Label'}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: previewColor }}
          >
            <CategoryGlyph iconKey={iconKey} color={previewColor} size={18} filled />
            {label || 'Label'}
          </span>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-md border border-zinc-200 p-3">
          <CategoryGlyph iconKey={iconKey} color={previewColor} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">{label || 'Label'}</p>
            <p className="text-xs text-zinc-500">Shown in Create / Edit and the browse header</p>
          </div>
        </div>
      </aside>
    </form>
  );
}
