import type { Me } from "@trigenys/studio-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { authClient } from "../api/client";

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/login", { replace: true });
  };
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <header className="topbar">
        <Link to="/today" className="brand">
          Trigenys <span>Studio</span>
        </Link>
        <div className="account">
          <span className="account-name" title={me.email}>
            {me.name || me.email}
          </span>
          <button type="button" className="btn btn-ghost" onClick={signOut}>
            Se déconnecter
          </button>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
