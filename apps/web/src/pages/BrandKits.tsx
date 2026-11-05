import type { BrandKit, BrandPalette, CreateBrandKit, Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useApproveBrandKit, useBlobUrl, useBrandKits, useCreateBrandKit, useProducts } from "../api/queries";
import { ErrorState, Loading } from "../components/States";
import { dateFmt } from "../components/dates";

// One approved kit per product at a time: approving a new one retires the
// previous. Kits are immutable once created; a change is a new kit.

const STATUS_LABELS: Record<BrandKit["status"], string> = { draft: "brouillon", approved: "approuvé", retired: "retiré" };
const LOGO_MIMES = ["image/svg+xml", "image/png"] as const;
const LOGO_MAX_BYTES = 256 * 1024;

export const isAdmin = (me: Me) => me.grants.some((g) => g.role === "admin");

export function BrandKitsPage({ me }: { me: Me }) {
  const products = useProducts();
  const [productId, setProductId] = useState("");
  if (!isAdmin(me)) return <Navigate to="/today" replace />;
  const chosen = productId || products.data?.[0]?.id || "";

  return (
    <article aria-labelledby="kits-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <div className="page-head">
        <h1 id="kits-title" className="page-title">
          Kits de marque
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
      {chosen ? <ProductKits key={chosen} productId={chosen} /> : null}
    </article>
  );
}

function ProductKits({ productId }: { productId: string }) {
  const kits = useBrandKits(productId);
  const approve = useApproveBrandKit(productId);
  return (
    <>
      {kits.isPending ? <Loading label="Chargement des kits…" /> : null}
      {kits.isError ? <ErrorState error={kits.error} retry={() => void kits.refetch()} /> : null}
      {kits.data && kits.data.length === 0 ? (
        <p className="state state-empty" role="status">
          Aucun kit pour ce produit : les visuels ne peuvent pas être rendus tant qu'un kit n'est pas approuvé.
        </p>
      ) : null}
      {approve.isError ? <ErrorState error={approve.error} /> : null}
      {kits.data && kits.data.length > 0 ? (
        <ul className="task-list" aria-label="Kits">
          {kits.data.map((k) => (
            <KitCard key={k.id} kit={k} approve={() => approve.mutate(k.id)} busy={approve.isPending} />
          ))}
        </ul>
      ) : null}
      <section className="card" aria-labelledby="kit-form-title">
        <KitForm productId={productId} />
      </section>
    </>
  );
}

function KitCard({ kit, approve, busy }: { kit: BrandKit; approve: () => void; busy: boolean }) {
  const logo = useBlobUrl(`/brand-kits/${kit.id}/logo`);
  return (
    <li className={`kit-card kit-${kit.status}`}>
      <div className="kit-head">
        {logo.data ? <img className="kit-logo" src={logo.data} alt={`Logo du kit ${kit.name}`} /> : <div className="kit-logo visual-placeholder" aria-hidden="true" />}
        <div>
          <p className="task-title">
            {kit.name} <span className={`chip chip-state kit-status-${kit.status}`}>{STATUS_LABELS[kit.status]}</span>
          </p>
          <p className="task-meta">
            <span>Kit n°{kit.n}</span>
            <span>{kit.fontFamily}</span>
            <span>{dateFmt.format(new Date(kit.createdAt))}</span>
          </p>
        </div>
      </div>
      <ul className="swatches" aria-label={`Palette du kit ${kit.name}`}>
        {(Object.entries(kit.palette) as [keyof BrandPalette, string][]).map(([role, hex]) => (
          <li key={role}>
            <span className="swatch" style={{ background: hex }} aria-hidden="true" />
            {role} {hex}
          </li>
        ))}
      </ul>
      {kit.mentions ? <p className="muted">Mentions : {kit.mentions}</p> : null}
      {kit.status === "draft" ? (
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={approve} aria-label={`Approuver le kit ${kit.name}`}>
            Approuver
          </button>
        </div>
      ) : null}
    </li>
  );
}

const PALETTE_ROLES: { key: keyof BrandPalette; label: string; initial: string }[] = [
  { key: "primary", label: "Primaire", initial: "#1d4ed8" },
  { key: "secondary", label: "Secondaire", initial: "#0f172a" },
  { key: "background", label: "Fond", initial: "#ffffff" },
  { key: "text", label: "Texte", initial: "#111827" },
];

function KitForm({ productId }: { productId: string }) {
  const create = useCreateBrandKit(productId);
  const [name, setName] = useState("");
  const [fontFamily, setFontFamily] = useState("Inter, Arial, sans-serif");
  const [mentions, setMentions] = useState("");
  const [palette, setPalette] = useState<BrandPalette>(Object.fromEntries(PALETTE_ROLES.map((r) => [r.key, r.initial])) as unknown as BrandPalette);
  const [logo, setLogo] = useState<CreateBrandKit["logo"] | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const pickLogo = async (file: File | undefined) => {
    setLogo(null);
    setLogoError(null);
    if (!file) return;
    const mime = file.type === "image/svg+xml" || file.type === "image/png" ? file.type : null;
    if (!mime) return setLogoError("Le logo doit être un SVG ou un PNG.");
    if (file.size > LOGO_MAX_BYTES) return setLogoError("Le logo dépasse 256 Ko.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    setLogo({ mime, base64: btoa(binary) });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logo) return;
    create.mutate(
      { name: name.trim(), palette, fontFamily: fontFamily.trim(), defaultTitle: null, mentions: mentions.trim(), logo },
      {
        onSuccess: () => {
          setName("");
          setMentions("");
          setLogo(null);
        },
      },
    );
  };

  return (
    <form className="stack" onSubmit={submit} aria-busy={create.isPending} aria-labelledby="kit-form-title">
      <h2 id="kit-form-title">Nouveau kit</h2>
      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="kit-name">Nom</label>
          <input id="kit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="stack">
          <label htmlFor="kit-font">Police</label>
          <input id="kit-font" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} maxLength={200} required />
        </div>
      </div>
      <fieldset className="palette-fields">
        <legend>Palette</legend>
        {PALETTE_ROLES.map((r) => (
          <div key={r.key} className="stack">
            <label htmlFor={`kit-${r.key}`}>{r.label}</label>
            <input id={`kit-${r.key}`} type="color" value={palette[r.key]} onChange={(e) => setPalette({ ...palette, [r.key]: e.target.value })} />
          </div>
        ))}
      </fieldset>
      <label htmlFor="kit-mentions">Mentions (facultatif)</label>
      <input id="kit-mentions" value={mentions} onChange={(e) => setMentions(e.target.value)} maxLength={200} />
      <label htmlFor="kit-logo">Logo (SVG ou PNG, 256 Ko max)</label>
      <input id="kit-logo" type="file" accept={LOGO_MIMES.join(",")} onChange={(e) => void pickLogo(e.target.files?.[0])} aria-describedby={logoError ? "kit-logo-error" : undefined} />
      {logoError ? (
        <p id="kit-logo-error" className="state-error-text" role="alert">
          {logoError}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !logo || name.trim() === ""}>
          Créer le kit
        </button>
      </div>
    </form>
  );
}
