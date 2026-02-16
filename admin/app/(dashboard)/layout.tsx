import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

const navItems = [
  { href: '/users', label: 'Users' },
  { href: '/events', label: 'Events' },
  { href: '/businesses', label: 'Businesses' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/complaints', label: 'Complaints' },
  { href: '/banners', label: 'Banners/Ads' },
  { href: '/refunds', label: 'Refunds' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) redirect('/unauthorized');

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="flex h-16 items-center border-b border-zinc-200 px-4">
          <Link href="/" className="font-semibold text-zinc-900">
            EventMap Admin
          </Link>
        </div>
        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 p-4">
          <p className="truncate text-xs text-zinc-500">{profile.name}</p>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="mt-1 text-xs text-zinc-600 hover:text-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
