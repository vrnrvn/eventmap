'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type User = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export function UsersTable({
  users,
  bannedSet,
}: {
  users: User[];
  bannedSet: Set<string>;
}) {
  const [filter, setFilter] = useState('');
  const [banned, setBanned] = useState(bannedSet);
  const [loading, setLoading] = useState<string | null>(null);

  const filtered = users.filter(
    (u) =>
      !filter ||
      u.name?.toLowerCase().includes(filter.toLowerCase()) ||
      u.id.toLowerCase().includes(filter.toLowerCase())
  );

  const handleBan = async (userId: string, reason: string) => {
    setLoading(userId);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_ban_user', {
        p_user_id: userId,
        p_reason: reason || null,
      });
      if (error) throw error;
      setBanned((prev) => new Set(prev).add(userId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  const handleUnban = async (userId: string) => {
    setLoading(userId);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_unban_user', {
        p_user_id: userId,
      });
      if (error) throw error;
      setBanned((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <input
        type="search"
        placeholder="Search by name or ID..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Name</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">ID</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Created</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => {
              const isBanned = banned.has(user.id);
              return (
                <tr key={user.id} className="border-t border-zinc-200">
                  <td className="px-4 py-3">
                    <Link href={`/users/${user.id}`} className="font-medium text-zinc-900 hover:underline">
                      {user.name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{user.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {isBanned ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Banned</span>
                    ) : (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {loading === user.id ? (
                      <span className="text-zinc-400">...</span>
                    ) : isBanned ? (
                      <button
                        onClick={() => handleUnban(user.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        Unban
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          const reason = prompt('Ban reason (optional):');
                          if (reason !== null) handleBan(user.id, reason);
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        Ban
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
