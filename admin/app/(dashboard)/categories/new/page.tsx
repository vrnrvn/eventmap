import Link from 'next/link';
import { CategoryForm } from '../CategoryForm';
import { saveCategory } from '../actions';

export default function NewCategoryPage() {
  const create = saveCategory.bind(null, null);
  return (
    <div>
      <Link href="/categories" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Categories
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">New category</h1>
      <CategoryForm action={create} />
    </div>
  );
}
