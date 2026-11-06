import type { CreateSocialAccount, Me, SocialAccount } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useCreateSocialAccount, useProducts, useProviderChannels, useSocialAccounts, useUpdateSocialAccount } from "../api/queries";
import { ErrorState, Loading } from "../components/States";
import { isAdmin } from "./BrandKits";

// Social accounts map a product's channel to the account the provider knows.
// Admin-only; an account is never deleted (deliveries point at it), it is
// deactivated. The provider's channel list is fetched on demand to fill the
// external reference without retyping it.

const CHANNELS: SocialAccount["channel"][] = ["linkedin", "x", "instagram", "facebook", "threads"];
const PROVIDERS: SocialAccount["provider"][] = ["buffer", "mock"];

export function SocialAccountsPage({ me }: { me: Me }) {
  const products = useProducts();
  const [productId, setProductId] = useState("");
  if (!isAdmin(me)) return <Navigate to="/today" replace />;
  const chosen = productId || products.data?.[0]?.id || "";

  return (
    <article aria-labelledby="accounts-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <div className="page-head">
        <h1 id="accounts-title" className="page-title">
          Comptes sociaux
        </h1>
      </div>
      {products.isPending ? <Loading label="Chargement des produits…" /> : null}
      {products.isError ? <ErrorState error={products.error} retry={() => void products.refetch()} /> : null}
      {products.data ? (
        <nav className="product-filter" aria-label="Produit">
          {products.data.map((p) => (
            <button key={p.id} type="button" className="chip-btn" aria-pressed={p.id === chosen} onClick={() => setProductId(p.id)}>
              {p.name}
            </button>
          ))}
        </nav>
      ) : null}
      {chosen ? <ProductAccounts key={chosen} productId={chosen} /> : null}
    </article>
  );
}

function ProductAccounts({ productId }: { productId: string }) {
  const accounts = useSocialAccounts(productId);
  const update = useUpdateSocialAccount();
  return (
    <>
      {accounts.isPending ? <Loading label="Chargement des comptes…" /> : null}
      {accounts.isError ? <ErrorState error={accounts.error} retry={() => void accounts.refetch()} /> : null}
      {accounts.data && accounts.data.length === 0 ? (
        <p className="state state-empty" role="status">
          Aucun compte social pour ce produit : aucune publication ne peut être planifiée tant qu'un compte n'est pas relié.
        </p>
      ) : null}
      {update.isError ? <ErrorState error={update.error} /> : null}
      {accounts.data && accounts.data.length > 0 ? (
        <ul className="task-list" aria-label="Comptes">
          {accounts.data.map((a) => (
            <li key={a.id} className={`kit-card${a.active ? "" : " kit-status-retired"}`}>
              <div className="kit-head">
                <div>
                  <p className="task-title">
                    {a.handle} <span className="muted">· {a.displayName}</span>
                  </p>
                  <p className="task-meta">
                    <span className="chip">{a.channel}</span>
                    <span>
                      {a.provider} · {a.externalRef}
                    </span>
                    <span className={`chip ${a.active ? "kit-status-approved" : ""}`}>{a.active ? "actif" : "inactif"}</span>
                  </p>
                </div>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: a.id, active: !a.active, version: a.version })}
                  aria-label={`${a.active ? "Désactiver" : "Activer"} ${a.handle}`}
                >
                  {a.active ? "Désactiver" : "Activer"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <section className="card" aria-labelledby="account-form-title">
        <AccountForm productId={productId} />
      </section>
    </>
  );
}

function AccountForm({ productId }: { productId: string }) {
  const create = useCreateSocialAccount();
  const [lookup, setLookup] = useState(false);
  const channels = useProviderChannels(lookup);
  const [form, setForm] = useState<Omit<CreateSocialAccount, "productId">>({ channel: "linkedin", provider: "buffer", externalRef: "", handle: "", displayName: "" });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pick = (ref: string) => {
    const found = channels.data?.find((c) => c.externalRef === ref);
    setForm((f) => ({
      ...f,
      externalRef: ref,
      displayName: f.displayName || found?.name || "",
      channel: found && CHANNELS.includes(found.service as SocialAccount["channel"]) ? (found.service as SocialAccount["channel"]) : f.channel,
    }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { productId, ...form, externalRef: form.externalRef.trim(), handle: form.handle.trim(), displayName: form.displayName.trim() },
      { onSuccess: () => setForm((f) => ({ ...f, externalRef: "", handle: "", displayName: "" })) },
    );
  };

  return (
    <form className="stack" onSubmit={submit} aria-busy={create.isPending} aria-labelledby="account-form-title">
      <h2 id="account-form-title">Relier un compte</h2>
      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="account-channel">Réseau</label>
          <select id="account-channel" value={form.channel} onChange={(e) => set("channel", e.target.value as SocialAccount["channel"])}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="stack">
          <label htmlFor="account-provider">Fournisseur</label>
          <select id="account-provider" value={form.provider} onChange={(e) => set("provider", e.target.value as SocialAccount["provider"])}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="stack">
          <label htmlFor="account-ref">Identifiant fournisseur</label>
          <input id="account-ref" value={form.externalRef} onChange={(e) => pick(e.target.value)} required maxLength={200} list="provider-channels" />
          {channels.data ? (
            <datalist id="provider-channels">
              {channels.data.map((c) => (
                <option key={c.externalRef} value={c.externalRef}>
                  {c.name} ({c.service})
                </option>
              ))}
            </datalist>
          ) : null}
        </div>
        <button type="button" className="btn" onClick={() => setLookup(true)} disabled={channels.isFetching}>
          Charger les canaux du fournisseur
        </button>
      </div>
      {channels.isError ? <ErrorState error={channels.error} /> : null}
      {channels.data ? (
        <ul className="swatches" aria-label="Canaux du fournisseur">
          {channels.data.map((c) => (
            <li key={c.externalRef}>
              <button type="button" className="chip-btn" onClick={() => pick(c.externalRef)} aria-pressed={form.externalRef === c.externalRef}>
                {c.name} · {c.service}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="account-handle">Identifiant public</label>
          <input id="account-handle" value={form.handle} onChange={(e) => set("handle", e.target.value)} required maxLength={120} placeholder="@trigenys" />
        </div>
        <div className="stack">
          <label htmlFor="account-name">Nom affiché</label>
          <input id="account-name" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required maxLength={200} />
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Relier le compte
        </button>
      </div>
    </form>
  );
}
