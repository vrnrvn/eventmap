import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventDeleteButton } from './EventDeleteButton';

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc('get_event_details', { event_uuid: id });
  if (!data) notFound();

  const event = (data as { event: Record<string, unknown> }).event;
  const business = (data as { business: Record<string, unknown> }).business;

  if (!event || typeof event !== 'object') notFound();

  const ev = event as Record<string, unknown>;

  return (
    <div>
      <Link href="/events" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Events
      </Link>
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-zinc-900">{String(ev.title ?? '')}</h1>
          <EventDeleteButton eventId={id} />
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-zinc-500">Description</dt>
            <dd className="whitespace-pre-wrap">{String(ev.description ?? '')}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Start</dt>
            <dd>{ev.start_datetime ? new Date(String(ev.start_datetime)).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">End</dt>
            <dd>{ev.end_datetime ? new Date(String(ev.end_datetime)).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Business</dt>
            <dd>
              {business && typeof business === 'object' && 'id' in business ? (
                <Link
                  href={`/businesses/${business.id}`}
                  className="text-blue-600 hover:underline"
                >
                  {String((business as { name?: string }).name ?? '')}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Address</dt>
            <dd>{String(ev.address ?? '')}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
