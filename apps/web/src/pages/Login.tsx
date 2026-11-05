import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { authClient } from "../api/client";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const navigate = useNavigate();

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "busy" });
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: `${window.location.origin}/today`,
      errorCallbackURL: `${window.location.origin}/login?error=link`,
    });
    setStatus(error ? { kind: "error", message: error.message ?? "Envoi impossible" } : { kind: "sent", email });
  };

  const usePasskey = async () => {
    setStatus({ kind: "busy" });
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setStatus({ kind: "error", message: result.error.message ?? "Passkey refusée" });
      return;
    }
    navigate("/today", { replace: true });
  };

  const busy = status.kind === "busy";
  return (
    <main className="login" id="main">
      <section className="card login-card" aria-labelledby="login-title">
        <p className="eyebrow">Trigenys Studio</p>
        <h1 id="login-title">Connexion</h1>
        <p className="lede">Pas de mot de passe : un lien par e-mail, ou votre passkey.</p>
        <form onSubmit={sendLink} className="stack">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email webauthn"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Recevoir un lien de connexion
          </button>
        </form>
        <button type="button" className="btn" onClick={usePasskey} disabled={busy}>
          Utiliser une passkey
        </button>
        <p className="login-link">
          <Link to="/today">Déjà connecté ? Ouvrir Ma journée</Link>
        </p>
        <p role="status" aria-live="polite" className="login-status">
          {status.kind === "sent" ? `Lien envoyé à ${status.email}. Il est valable 15 minutes.` : null}
          {status.kind === "error" ? status.message : null}
        </p>
      </section>
    </main>
  );
}
