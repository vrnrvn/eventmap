'use client';

type BannerFormProps = {
  action: (formData: FormData) => Promise<void>;
  banner?: {
    type: string;
    title: string;
    content: string;
    image_url: string | null;
    link_url: string | null;
    placement: string;
    is_active: boolean;
    sort_order: number;
  };
};

export function BannerForm({ action, banner }: BannerFormProps) {
  return (
    <form action={action} className="max-w-xl space-y-4">
      <div>
        <label htmlFor="type" className="mb-1 block text-sm font-medium text-zinc-700">
          Type
        </label>
        <select
          id="type"
          name="type"
          defaultValue={banner?.type ?? 'banner'}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="header">Header</option>
          <option value="banner">Banner</option>
          <option value="ad">Ad</option>
        </select>
      </div>
      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium text-zinc-700">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          defaultValue={banner?.title ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="content" className="mb-1 block text-sm font-medium text-zinc-700">
          Content
        </label>
        <textarea
          id="content"
          name="content"
          rows={3}
          defaultValue={banner?.content ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="image_url" className="mb-1 block text-sm font-medium text-zinc-700">
          Image URL
        </label>
        <input
          id="image_url"
          name="image_url"
          type="url"
          defaultValue={banner?.image_url ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="link_url" className="mb-1 block text-sm font-medium text-zinc-700">
          Link URL
        </label>
        <input
          id="link_url"
          name="link_url"
          type="url"
          defaultValue={banner?.link_url ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="placement" className="mb-1 block text-sm font-medium text-zinc-700">
          Placement
        </label>
        <select
          id="placement"
          name="placement"
          defaultValue={banner?.placement ?? 'discover'}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="discover">Discover</option>
          <option value="home">Home</option>
        </select>
      </div>
      <div>
        <label htmlFor="sort_order" className="mb-1 block text-sm font-medium text-zinc-700">
          Sort Order
        </label>
        <input
          id="sort_order"
          name="sort_order"
          type="number"
          defaultValue={banner?.sort_order ?? 0}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="is_active"
          name="is_active"
          type="checkbox"
          defaultChecked={banner?.is_active ?? true}
          className="h-4 w-4 rounded border-zinc-300"
        />
        <label htmlFor="is_active" className="text-sm text-zinc-700">
          Active
        </label>
      </div>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        {banner ? 'Update' : 'Create'}
      </button>
    </form>
  );
}
