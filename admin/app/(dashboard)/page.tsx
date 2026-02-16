import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: usersCount },
    { count: eventsCount },
    { count: businessesCount },
    { count: complaintsCount },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('events').select('*', { count: 'exact', head: true }),
    supabase.from('businesses').select('*', { count: 'exact', head: true }),
    supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  const cards = [
    { label: 'Users', count: usersCount ?? 0, href: '/users' },
    { label: 'Events', count: eventsCount ?? 0, href: '/events' },
    { label: 'Businesses', count: businessesCount ?? 0, href: '/businesses' },
    { label: 'Pending Complaints', count: complaintsCount ?? 0, href: '/complaints' },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300"
          >
            <p className="text-sm text-zinc-600">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{card.count}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
