'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addUser, changeRole, toggleActive, resetPassword, removeUser } from '@/actions/users';
import { type PublicUser, type UserRole, ROLE_LABELS, ROLE_PERMISSIONS } from '@/lib/user-types';

const roleBadgeColors: Record<UserRole, string> = {
  admin: 'bg-rouge-doux/10 text-rouge-doux',
  editorialiste: 'bg-bleu-rep/10 text-bleu-rep',
  lecteur: 'bg-gris-chaud text-gris-texte',
};

export function UsersClient({
  users,
  auditLog,
}: {
  users: PublicUser[];
  auditLog: Array<{ timestamp: string; action: string; detail?: string; result?: string }>;
}) {
  const router = useRouter();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', displayName: '', password: '', role: 'lecteur' as UserRole });
  const [resetForm, setResetForm] = useState<{ username: string; password: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  function showToast(type: 'success' | 'error', text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }

  function handleAdd() {
    if (!newUser.username || !newUser.password || !newUser.displayName) {
      showToast('error', 'Tous les champs sont requis');
      return;
    }
    startTransition(async () => {
      const result = await addUser(newUser.username, newUser.displayName, newUser.password, newUser.role);
      if (result.success) {
        showToast('success', `Utilisateur "${newUser.displayName}" créé`);
        setNewUser({ username: '', displayName: '', password: '', role: 'lecteur' });
        setShowAddForm(false);
        router.refresh();
      } else showToast('error', result.error || 'Erreur');
    });
  }

  function handleToggle(username: string) {
    startTransition(async () => {
      const result = await toggleActive(username);
      if (result.success) { showToast('success', 'Statut modifié'); router.refresh(); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleChangeRole(username: string, role: UserRole) {
    startTransition(async () => {
      const result = await changeRole(username, role);
      if (result.success) { showToast('success', 'Rôle modifié'); router.refresh(); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleReset() {
    if (!resetForm || !resetForm.password) return;
    startTransition(async () => {
      const result = await resetPassword(resetForm!.username, resetForm!.password);
      if (result.success) { showToast('success', 'Mot de passe réinitialisé'); setResetForm(null); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleDelete(username: string) {
    if (!window.confirm(`Supprimer l'utilisateur "${username}" ?`)) return;
    startTransition(async () => {
      const result = await removeUser(username);
      if (result.success) { showToast('success', 'Utilisateur supprimé'); router.refresh(); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  return (
    <div className="p-8">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 font-mono text-[14px] px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-vert text-white' : 'bg-rouge-doux text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Utilisateurs</h1>
          <p className="text-gris-texte text-[14px] mt-1">{users.length} utilisateur{users.length !== 1 ? 's' : ''} · Gestion des accès et des rôles</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAudit(!showAudit)} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-gris-chaud text-gris-texte hover:bg-creme cursor-pointer">
            {showAudit ? 'Masquer le journal' : 'Journal d\'audit'}
          </button>
          <button onClick={() => setShowAddForm(!showAddForm)} className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer">
            {showAddForm ? 'Fermer' : '+ Nouvel utilisateur'}
          </button>
        </div>
      </div>

      {/* Roles legend */}
      <div className="bg-blanc rounded-xl border border-gris-chaud p-4 mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-3">Rôles et permissions</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([role, label]) => (
            <div key={role} className="bg-creme rounded-lg p-3">
              <span className={`inline-block font-mono text-[12px] font-bold uppercase px-2 py-0.5 rounded mb-2 ${roleBadgeColors[role]}`}>{label}</span>
              <div className="space-y-0.5">
                {ROLE_PERMISSIONS[role].map(p => (
                  <div key={p} className="font-mono text-[11px] text-gris-texte">{p}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-blanc rounded-xl border border-bleu-rep/30 p-5 mb-6">
          <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Nouvel utilisateur</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Identifiant *</label>
              <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:border-bleu-rep" placeholder="jdupont" />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Nom affiché *</label>
              <input value={newUser.displayName} onChange={e => setNewUser(u => ({ ...u, displayName: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep" placeholder="Jean Dupont" />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Mot de passe *</label>
              <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:border-bleu-rep" />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Rôle</label>
              <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value as UserRole }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep">
                <option value="lecteur">Lecteur</option>
                <option value="editorialiste">Éditorialiste</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAdd} disabled={isPending} className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-vert text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
              {isPending ? 'Création...' : 'Créer'}
            </button>
            <button onClick={() => setShowAddForm(false)} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-gris-chaud text-gris-texte hover:bg-creme cursor-pointer">Annuler</button>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetForm && (
        <div className="fixed inset-0 bg-noir/50 flex items-center justify-center z-50" onClick={() => setResetForm(null)}>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-mono text-[14px] font-bold mb-3">Nouveau mot de passe pour {resetForm.username}</h3>
            <input type="password" value={resetForm.password} onChange={e => setResetForm(f => f ? { ...f, password: e.target.value } : null)} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono mb-3 focus:outline-none focus:border-bleu-rep" placeholder="Nouveau mot de passe" autoFocus />
            <div className="flex gap-2">
              <button onClick={handleReset} disabled={isPending} className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer disabled:opacity-50">Réinitialiser</button>
              <button onClick={() => setResetForm(null)} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-gris-chaud text-gris-texte cursor-pointer">Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* Users list */}
      <div className="bg-blanc rounded-xl border border-gris-chaud overflow-hidden mb-6">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-gris-chaud bg-creme/50">
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Utilisateur</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Rôle</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Statut</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Dernière connexion</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className={`border-b border-gris-chaud/50 hover:bg-creme/30 ${!user.active ? 'opacity-50' : ''}`}>
                <td className="py-3 px-4">
                  <div className="font-medium text-noir">{user.displayName}</div>
                  <div className="font-mono text-[12px] text-gris-clair">@{user.username}</div>
                </td>
                <td className="py-3 px-4">
                  <select
                    value={user.role}
                    onChange={e => handleChangeRole(user.username, e.target.value as UserRole)}
                    disabled={isPending}
                    className={`font-mono text-[12px] font-bold uppercase px-2 py-0.5 rounded border-0 cursor-pointer ${roleBadgeColors[user.role]}`}
                  >
                    <option value="admin">Admin</option>
                    <option value="editorialiste">Éditorialiste</option>
                    <option value="lecteur">Lecteur</option>
                  </select>
                </td>
                <td className="py-3 px-4">
                  <span className={`font-mono text-[12px] font-bold ${user.active ? 'text-vert' : 'text-gris-clair'}`}>
                    {user.active ? 'Actif' : 'Désactivé'}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-[12px] text-gris-clair">
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('fr-FR') : 'Jamais'}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setResetForm({ username: user.username, password: '' })} className="font-mono text-[11px] text-bleu-rep bg-bleu-clair px-2 py-1 rounded hover:opacity-80 cursor-pointer">MdP</button>
                    <button onClick={() => handleToggle(user.username)} disabled={isPending} className={`font-mono text-[11px] px-2 py-1 rounded cursor-pointer disabled:opacity-50 ${user.active ? 'text-orange bg-orange/10' : 'text-vert bg-vert/10'}`}>
                      {user.active ? 'Désact.' : 'Activer'}
                    </button>
                    <button onClick={() => handleDelete(user.username)} disabled={isPending} className="font-mono text-[11px] text-rouge-doux bg-rouge-doux/10 px-2 py-1 rounded hover:bg-rouge-doux/20 cursor-pointer disabled:opacity-50">Suppr.</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit log */}
      {showAudit && (
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Journal d'audit (dernières 100 entrées)</h2>
          {auditLog.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gris-chaud">
                    <th className="font-mono text-[10px] uppercase tracking-[2px] text-gris-clair text-left py-2">Date</th>
                    <th className="font-mono text-[10px] uppercase tracking-[2px] text-gris-clair text-left py-2">Action</th>
                    <th className="font-mono text-[10px] uppercase tracking-[2px] text-gris-clair text-left py-2">Détail</th>
                    <th className="font-mono text-[10px] uppercase tracking-[2px] text-gris-clair text-left py-2">Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry, i) => (
                    <tr key={i} className="border-b border-gris-chaud/30">
                      <td className="py-1.5 font-mono text-[11px] text-gris-clair whitespace-nowrap">{new Date(entry.timestamp).toLocaleString('fr-FR')}</td>
                      <td className="py-1.5 font-mono text-[12px] text-noir">{entry.action}</td>
                      <td className="py-1.5 text-[12px] text-gris-texte">{entry.detail || '—'}</td>
                      <td className="py-1.5">
                        {entry.result && (
                          <span className={`font-mono text-[11px] font-bold ${entry.result === 'success' ? 'text-vert' : entry.result === 'failed' ? 'text-rouge-doux' : 'text-gris-clair'}`}>
                            {entry.result}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[14px] text-gris-clair">Aucune entrée dans le journal</p>
          )}
        </div>
      )}
    </div>
  );
}
