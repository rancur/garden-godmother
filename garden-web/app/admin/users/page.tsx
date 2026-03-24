'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-context';
import { getUsers, updateUser, createInvite, getInvites, deleteInvite } from '../../api';
import { useToast } from '../../toast';

interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

interface Invite {
  id: number;
  code: string;
  created_by: number;
  created_by_name: string;
  role: string;
  used_by: number | null;
  used_by_name: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getUsers(), getInvites()])
      .then(([u, i]) => { setUsers(u); setInvites(i); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (currentUser?.role !== 'admin') {
    return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Admin access required</div>;
  }

  const handleRoleChange = async (userId: number, role: string) => {
    try {
      await updateUser(userId, { role });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
      toast('Role updated');
    } catch { toast('Failed to update role'); }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    try {
      await updateUser(userId, { is_active: !isActive });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: isActive ? 0 : 1 } : u));
      toast(isActive ? 'User deactivated' : 'User activated');
    } catch { toast('Failed to update user'); }
  };

  const handleCreateInvite = async () => {
    try {
      const result = await createInvite();
      toast(`Invite code: ${result.code}`);
      const updated = await getInvites();
      setInvites(updated);
    } catch { toast('Failed to create invite'); }
  };

  const handleDeleteInvite = async (id: number) => {
    try {
      await deleteInvite(id);
      setInvites(prev => prev.filter(i => i.id !== id));
      toast('Invite revoked');
    } catch { toast('Failed to revoke invite'); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast('Copied to clipboard');
  };

  if (loading) return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">User Management</h1>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-earth-200 dark:border-gray-700">
          <h2 className="font-bold text-earth-700 dark:text-gray-200">Users</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-earth-50 dark:bg-gray-750 text-earth-500 dark:text-gray-400">
                <th className="text-left px-5 py-2.5 font-medium">User</th>
                <th className="text-left px-5 py-2.5 font-medium">Role</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
                <th className="text-left px-5 py-2.5 font-medium">Last Login</th>
                <th className="text-left px-5 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-earth-100 dark:divide-gray-700">
              {users.map(u => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-earth-800 dark:text-gray-100">{u.display_name}</div>
                    <div className="text-xs text-earth-400 dark:text-gray-500">@{u.username}{u.email ? ` · ${u.email}` : ''}</div>
                  </td>
                  <td className="px-5 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={u.id === currentUser?.id}
                      className="text-xs px-2 py-1 rounded border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
                    >
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-earth-400 dark:text-gray-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-5 py-3">
                    {u.id !== currentUser?.id && (
                      <button
                        onClick={() => handleToggleActive(u.id, !!u.is_active)}
                        className="text-xs text-earth-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Codes */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-earth-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-bold text-earth-700 dark:text-gray-200">Invite Codes</h2>
          <button
            onClick={handleCreateInvite}
            className="bg-garden-600 hover:bg-garden-700 text-white text-sm px-4 py-1.5 rounded-lg font-medium transition-colors"
          >
            Generate Invite
          </button>
        </div>
        {invites.length === 0 ? (
          <div className="px-5 py-8 text-center text-earth-400 dark:text-gray-500 text-sm">No invite codes yet</div>
        ) : (
          <div className="divide-y divide-earth-100 dark:divide-gray-700">
            {invites.map(inv => {
              const expired = new Date(inv.expires_at) < new Date();
              const used = inv.used_by !== null;
              return (
                <div key={inv.id} className={`px-5 py-3 flex items-center justify-between ${used || expired ? 'opacity-50' : ''}`}>
                  <div>
                    <button
                      onClick={() => copyCode(inv.code)}
                      className="font-mono text-sm font-bold text-garden-700 dark:text-garden-400 hover:underline"
                      title="Click to copy"
                    >
                      {inv.code}
                    </button>
                    <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                      Created by {inv.created_by_name}
                      {used ? ` · Used by ${inv.used_by_name}` : expired ? ' · Expired' : ` · Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  {!used && !expired && (
                    <button
                      onClick={() => handleDeleteInvite(inv.id)}
                      className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
