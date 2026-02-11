"use client";

import { useEffect, useState } from "react";

interface AdminUsersResponse {
  totals: {
    userCount: number;
    activeUsers: number;
    balanceCents: number;
    lifetimeSpentCents: number;
    lifetimeGrantedCents: number;
  };
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    role: "admin" | "member";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
    wallet: {
      balanceCents: number;
      lifetimeSpentCents: number;
      lifetimeGrantedCents: number;
    };
  }>;
}

interface Invite {
  id: string;
  email: string;
  role: "admin" | "member";
  initialCreditCents: number;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: {
    email: string;
    name: string | null;
  };
  acceptedBy: {
    email: string;
    name: string | null;
  } | null;
}

interface InvitesResponse {
  invites: Invite[];
}

interface Candidate {
  id: string;
  sourceType: "thread" | "message";
  status: "pending" | "approved" | "rejected";
  summary: string;
  createdAt: string;
  createdBy: {
    email: string;
    name: string | null;
  };
  thread: {
    id: string;
    title: string;
  } | null;
  message: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  } | null;
}

interface CandidatesResponse {
  candidates: Candidate[];
}

export function AdminConsole() {
  const [users, setUsers] = useState<AdminUsersResponse | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteCredit, setInviteCredit] = useState<number>(200);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);

      const [usersRes, invitesRes, candidatesRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/invites"),
        fetch("/api/admin/ingestion-candidates?status=pending"),
      ]);

      if (!usersRes.ok || !invitesRes.ok || !candidatesRes.ok) {
        throw new Error("Failed to load admin data.");
      }

      const usersPayload = (await usersRes.json()) as AdminUsersResponse;
      const invitesPayload = (await invitesRes.json()) as InvitesResponse;
      const candidatesPayload = (await candidatesRes.json()) as CandidatesResponse;

      setUsers(usersPayload);
      setInvites(invitesPayload.invites);
      setCandidates(candidatesPayload.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin load failed.");
    } finally {
      setLoading(false);
    }
  }

  async function updateUser(userId: string, payload: { role?: "admin" | "member"; status?: "active" | "disabled" }) {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error || "Failed to update user.");
    }
  }

  async function addCredit(userId: string) {
    const amountRaw = window.prompt("Credit amount in cents", "200");
    if (!amountRaw) {
      return;
    }

    const amountCents = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error("Invalid credit amount.");
    }

    const response = await fetch(`/api/admin/users/${userId}/credit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amountCents,
        reason: "Admin top-up",
      }),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error || "Failed to add credit.");
    }
  }

  async function createInvite() {
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: inviteEmail,
        role: inviteRole,
        initialCreditCents: inviteCredit,
      }),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error || "Failed to create invite.");
    }

    setInviteEmail("");
  }

  async function updateInvite(inviteId: string, action: "revoke" | "resend") {
    const response = await fetch(`/api/admin/invites/${inviteId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error || "Failed to update invite.");
    }
  }

  async function reviewCandidate(candidateId: string, status: "approved" | "rejected") {
    const response = await fetch(`/api/admin/ingestion-candidates/${candidateId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error || "Failed to review candidate.");
    }
  }

  async function perform(action: () => Promise<void>) {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  }

  if (loading) {
    return (
      <main className="admin-shell">
        <p>Loading admin data...</p>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Operations Console</h1>
          <p className="subtitle">Manage users, invites, credits, and ingestion approvals.</p>
        </div>
        <div className="header-stats">
          <div className="stat-pill">
            <span>Users</span>
            <strong>{users?.totals.userCount ?? 0}</strong>
          </div>
          <div className="stat-pill">
            <span>Active</span>
            <strong>{users?.totals.activeUsers ?? 0}</strong>
          </div>
          <div className="stat-pill">
            <span>Total Balance</span>
            <strong>{usd(users?.totals.balanceCents ?? 0)}</strong>
          </div>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel admin-panel">
        <h2>Users</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Balance</th>
                <th>Created</th>
                <th>Last active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <span className={`role-badge ${user.role}`}>{user.role}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${user.status}`}>{user.status}</span>
                  </td>
                  <td>{usd(user.wallet.balanceCents)}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>{user.lastActiveAt ? formatDate(user.lastActiveAt) : "-"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          void perform(() =>
                            updateUser(user.id, {
                              role: user.role === "admin" ? "member" : "admin",
                            })
                          )
                        }
                      >
                        {user.role === "admin" ? "Demote to member" : "Promote to admin"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          void perform(() =>
                            updateUser(user.id, {
                              status: user.status === "active" ? "disabled" : "active",
                            })
                          )
                        }
                      >
                        {user.status === "active" ? "Disable" : "Activate"}
                      </button>
                      <button type="button" className="ghost-button" onClick={() => void perform(() => addCredit(user.id))}>
                        Top up
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section >

      <section className="panel admin-panel">
        <h2>Invites</h2>
        <div className="invite-form">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="user@example.com"
          />
          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <input
            type="number"
            min={0}
            value={inviteCredit}
            onChange={(event) => setInviteCredit(Number(event.target.value) || 0)}
          />
          <button type="button" onClick={() => void perform(() => createInvite())} className="ghost-button">
            Create invite
          </button>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Initial credit</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>{invite.role}</td>
                  <td>{invite.status}</td>
                  <td>{usd(invite.initialCreditCents)}</td>
                  <td>{formatDate(invite.expiresAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="ghost-button" onClick={() => void perform(() => updateInvite(invite.id, "resend"))}>
                        Resend
                      </button>
                      <button type="button" className="ghost-button" onClick={() => void perform(() => updateInvite(invite.id, "revoke"))}>
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel admin-panel">
        <h2>Ingestion Candidates</h2>
        {candidates.length === 0 ? <p className="muted">No pending candidates.</p> : null}
        <div className="candidate-list">
          {candidates.map((candidate) => (
            <article key={candidate.id} className="candidate-card">
              <p className="candidate-meta">
                {candidate.sourceType} · {formatDate(candidate.createdAt)} · by {candidate.createdBy.email}
              </p>
              <pre>{candidate.summary}</pre>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void perform(() => reviewCandidate(candidate.id, "approved"))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void perform(() => reviewCandidate(candidate.id, "rejected"))}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main >
  );
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}
