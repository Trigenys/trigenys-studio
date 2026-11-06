import type { Me } from "@trigenys/studio-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useNavigate } from "react-router";
import { authClient } from "../api/client";
import { useAlerts } from "../api/queries";

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const alerts = useAlerts({ state: "open" });
  const openAlerts = alerts.data?.length ?? 0;
  const admin = me.grants.some((g) => g.role === "admin");
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
      <header className="sidebar">
        <Link to="/today" className="brand">
          Trigenys <span>Studio</span>
        </Link>
        <nav className="global-nav" aria-label="Navigation principale">
          <NavLink to="/today" className="nav-link">
            Ma journée
          </NavLink>
          <NavLink to="/imports" className="nav-link">
            Entrées
          </NavLink>
          <NavLink to="/calendar" className="nav-link">
            Calendrier
          </NavLink>
          <NavLink to="/reports" className="nav-link">
            Rapports
          </NavLink>
          <NavLink to="/alerts" className="nav-link" aria-label={`Alertes, ${openAlerts} à traiter`}>
            Alertes
            {openAlerts ? <span className="count">{openAlerts}</span> : null}
          </NavLink>
          {admin ? (
            <>
              <p className="nav-section" aria-hidden="true">
                Réglages
              </p>
              <NavLink to="/brand-kits" className="nav-link">
                Kits de marque
              </NavLink>
              <NavLink to="/social-accounts" className="nav-link">
                Comptes sociaux
              </NavLink>
            </>
          ) : null}
        </nav>
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
