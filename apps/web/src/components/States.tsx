import type { ApiError } from "../api/client";

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <p className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {label}
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="state state-empty" role="status">
      {children}
    </p>
  );
}

export function ErrorState({ error, retry, retryLabel = "Réessayer" }: { error: ApiError | Error; retry?: () => void; retryLabel?: string }) {
  const problem = "problem" in error ? error.problem : null;
  return (
    <div className="state state-error" role="alert">
      <p>
        <strong>{problem?.title ?? "Une erreur est survenue"}</strong>
        {problem?.detail ? <span className="state-detail">{problem.detail}</span> : null}
        {!problem && error.message ? <span className="state-detail">{error.message}</span> : null}
      </p>
      {retry ? (
        <button type="button" className="btn" onClick={retry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
