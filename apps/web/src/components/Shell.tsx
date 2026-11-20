import type { Me } from "@trigenys/studio-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { authClient } from "../api/client";
import { useAlerts } from "../api/queries";
import { AlertsIcon, CalendarIcon, InboxIcon, ReportsIcon, TodayIcon } from "./icons";

// The main sections, shared by the desktop sidebar and the mobile tab bar.
const SECTIONS = [
  { to: "/today", label: "Ma journée", Icon: TodayIcon },
  { to: "/imports", label: "Entrées", Icon: InboxIcon },
  { to: "/calendar", label: "Calendrier", Icon: CalendarIcon },
  { to: "/reports", label: "Rapports", Icon: ReportsIcon },
  { to: "/alerts", label: "Alertes", Icon: AlertsIcon, alerts: true },
] as const;

const SETTINGS = [
  { to: "/brand-kits", label: "Kits de marque" },
  { to: "/social-accounts", label: "Comptes sociaux" },
] as const;

function AlertCount({ n }: { n: number }) {
  if (!n) return null;
  return (
    <>
      <span className="count">{n}</span>
      <span className="visually-hidden"> à traiter</span>
    </>
  );
}

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} className="nav-link">
              {s.label}
              {"alerts" in s ? <AlertCount n={openAlerts} /> : null}
            </NavLink>
          ))}
          {admin ? (
            <>
              <p className="nav-section" aria-hidden="true">
                Réglages
              </p>
              {SETTINGS.map((s) => (
                <NavLink key={s.to} to={s.to} className="nav-link">
                  {s.label}
                </NavLink>
              ))}
            </>
          ) : null}
        </nav>
        {/* Phones: account, settings and sign-out move from the sidebar to a
            header menu. Keyed on the path so that it closes after a navigation. */}
        <details className="account-menu" key={pathname}>
          <summary className="btn btn-ghost">Compte</summary>
          <div className="account-menu-panel">
            <p className="account-menu-name" title={me.email}>
              {me.name || me.email}
            </p>
            {admin ? (
              <nav aria-label="Réglages">
                {SETTINGS.map((s) => (
                  <NavLink key={s.to} to={s.to} className="nav-link">
                    {s.label}
                  </NavLink>
                ))}
              </nav>
            ) : null}
            <button type="button" className="btn" onClick={signOut}>
              Se déconnecter
            </button>
          </div>
        </details>
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
      <nav className="tab-bar" aria-label="Navigation principale">
        {SECTIONS.map(({ to, label, Icon, ...s }) => (
          <NavLink key={to} to={to} className="tab-link">
            <span className="tab-icon">
              <Icon />
            </span>
            <span className="tab-label">{label}</span>
            {"alerts" in s ? <AlertCount n={openAlerts} /> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
