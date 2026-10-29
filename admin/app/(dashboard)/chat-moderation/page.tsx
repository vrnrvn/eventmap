import { createClient } from '@/lib/supabase/server';
import { ChatModerationQueue, type ChatReport, type ModerationLogEntry } from './ChatModerationQueue';

export default async function ChatModerationPage() {
  const supabase = await createClient();
  const [{ data: reports }, { data: log }] = await Promise.all([
    supabase.rpc('admin_get_chat_reports', { p_status: 'all' }),
    supabase.rpc('admin_get_chat_moderation_log', { p_limit: 50 }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Chat moderation</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Reported event-chat messages. A message is hidden automatically after three
            independent pending reports; confirm or restore it here. Hosts can also delete
            and block within their own chats.
          </p>
        </div>
      </div>
      <ChatModerationQueue
        reports={(reports ?? []) as ChatReport[]}
        log={(log ?? []) as ModerationLogEntry[]}
      />
    </div>
  );
}
