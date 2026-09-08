// Berry KG-only replacement for LS's "Data Import" tab.
//
// Replaces upstream's file-upload / URL-paste / sample-data UI with a single
// dropdown of Berry Knowledge Graphs. On Save, we intercept the outgoing
// project-create round-trip (LS calls PATCH /api/projects/<id> to finalize
// the draft) and POST /studio/ls/import_from_kg to hydrate the fresh
// project with tasks pulled from the selected KG.
//
// Why the fetch monkey-patch: LS's CreateProject.jsx (line ~140) calls
//   updateProject(id, {is_draft: false})  →  finishUpload()  →  redirect.
// finishUpload is our injected `onFinishUpload` callback (see useImportPage
// override below), so we hook there — no monkey-patch needed on `fetch`.
//
// Copied by patches/web/install-source-forks.sh into:
//   LS_SRC/apps/labelstudio/src/pages/CreateProject/Import/Import.jsx
//
// Ignore the upstream props we don't need (highlightCsvHandling, csvHandling,
// setCsvHandling, addColumns, onSampleDatasetSelect, onFileListUpdate,
// dontCommitToProject) — destructured with defaults so LS doesn't crash.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Typography } from "@humansignal/ui";
import { cn } from "../../../utils/bem";
import "./Import.prefix.css";

const importClass = cn("upload_page");

// mcp-client is proxied at /mcp-client/ by nginx (same-origin as the LS SPA);
// falls back to localhost:8080 for dev.
const MCP_CLIENT_BASE =
  typeof window !== "undefined" && window.location?.hostname === "localhost"
    ? "http://localhost:8080"
    : "/mcp-client";

// Stashed on window so the parent CreateProject wrapper (which owns the Save
// click) can read the selected KG name without prop-drilling through
// useImportPage. Set on selection, read (and consumed) after project create.
const WINDOW_KG_KEY = "__berry_kg_to_import";

// Hook that fires POST /studio/ls/import_from_kg once we know the finalized
// project id. Called from a fetch monkey-patch that watches for LS's
// PATCH /api/projects/<id> completion during Save.
async function importKgIntoProject(projectId, kgName) {
  if (!projectId || !kgName) return;
  const url =
    `${MCP_CLIENT_BASE}/studio/ls/import_from_kg` +
    `?ls_project_id=${encodeURIComponent(projectId)}` +
    `&database_name=${encodeURIComponent(kgName)}` +
    `&berry_api_key=`;
  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("[Berry] KG import failed:", res.status, await res.text());
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Berry] KG import network error:", err);
  }
  // ALWAYS navigate to the task list after the import attempt. LS's own
  // onCreate would push('/projects/<id>/data') only if finishUpload()
  // returned truthy — but finishUpload calls reimportFiles with our
  // synthetic ['berry-kg://…'] fileIds, which the LS backend rejects,
  // so imported=null and LS's push never fires. Result: user ends up
  // stranded on /projects/ (the list). User bug 2026-08-17: 'when we
  // import and select a KG it imports but comes back to the project
  // list page, it should stay in task list'.
  try {
    if (typeof window !== "undefined" && window.location) {
      const prefix = window.location.pathname.startsWith("/label-studio")
        ? "/label-studio"
        : "";
      // Small delay so LS's own re-render / route settle before we override.
      setTimeout(() => {
        window.location.assign(`${prefix}/projects/${projectId}/data`);
      }, 150);
    }
  } catch (_e) { /* ignore */ }
}

// Install a fetch monkey-patch ONCE per page load. Watches for LS's
// PATCH /api/projects/<id> (with `is_draft: false` body) — that's the request
// that flips a draft project into a real project during CreateProject's Save
// flow. On success, fire the KG import.
function installKgSaveHook() {
  if (typeof window === "undefined") return;
  if (window.__berry_kg_hook_installed) return;
  window.__berry_kg_hook_installed = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = async function berryFetchInterceptor(input, init) {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = (init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
      // LS uses PATCH for updateProject in CreateProject.onCreate.
      const isProjectPatch =
        (method === "PATCH" || method === "POST") &&
        /\/api\/projects\/\d+\/?(\?|$)/.test(url);
      if (!isProjectPatch || !res.ok) return res;

      const kgName = window[WINDOW_KG_KEY];
      if (!kgName) return res;

      // Extract project id from URL first, then confirm via response body if possible.
      const m = url.match(/\/api\/projects\/(\d+)/);
      const projectId = m ? Number(m[1]) : null;
      if (!projectId) return res;

      // Consume the sentinel so a subsequent PATCH (e.g. from settings edit)
      // doesn't re-trigger the import.
      window[WINDOW_KG_KEY] = null;

      // Fire-and-forget; don't block LS's own success path.
      importKgIntoProject(projectId, kgName);
    } catch (_err) {
      // Never let the interceptor break the underlying fetch.
    }
    return res;
  };
}

export const ImportPage = ({
  project,
  show = true,
  onWaiting,
  onFileListUpdate,
  // Upstream props we ignore — destructured to swallow, avoid unused warnings.
  // eslint-disable-next-line no-unused-vars
  sample,
  // eslint-disable-next-line no-unused-vars
  onSampleDatasetSelect,
  // eslint-disable-next-line no-unused-vars
  highlightCsvHandling,
  // eslint-disable-next-line no-unused-vars
  dontCommitToProject = false,
  // eslint-disable-next-line no-unused-vars
  csvHandling,
  // eslint-disable-next-line no-unused-vars
  setCsvHandling,
  addColumns,
  // eslint-disable-next-line no-unused-vars
  openLabelingConfig,
}) => {
  const [kgs, setKgs] = useState([]);
  const [loadingKgs, setLoadingKgs] = useState(false);
  const [selectedKG, setSelectedKG] = useState(
    (typeof window !== "undefined" && window[WINDOW_KG_KEY]) || "",
  );
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  // Install the fetch hook exactly once per page (idempotent).
  useEffect(() => {
    installKgSaveHook();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load KG list on mount.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setLoadingKgs(true);
    setError("");
    fetch(`${MCP_CLIENT_BASE}/studio/ls/list_kgs?berry_api_key=`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success === false) {
          setError(data.error || "Failed to load Knowledge Graphs");
          setKgs([]);
        } else {
          setKgs(data?.knowledge_graphs || []);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || String(err));
        setKgs([]);
      })
      .finally(() => !cancelled && setLoadingKgs(false));
    return () => {
      cancelled = true;
    };
  }, [show]);

  // When the user picks a KG, flip `uploadDisabled` false so the Save button
  // enables. We reuse LS's `onFileListUpdate` (destined for useImportPage's
  // setFileIds) to hand it a synthetic non-empty list — but the real
  // `uploadDisabled` gate in useImportPage is `csvHandling === "choose"`, so
  // that flag is fine as-is (undefined = not blocked). We still call the
  // callback so downstream state is coherent.
  const onSelect = useCallback(
    (name) => {
      setSelectedKG(name);
      window[WINDOW_KG_KEY] = name || null;
      if (name) {
        // Synthetic file id so downstream UI shows "1 file selected".
        onFileListUpdate?.([`berry-kg://${name}`]);
        // Add a placeholder column so ConfigPage doesn't show "no data" —
        // LS templates need `$undefined$` or actual columns.
        addColumns?.(["$undefined$"]);
      } else {
        onFileListUpdate?.([]);
      }
      onWaiting?.(false);
    },
    [onFileListUpdate, addColumns, onWaiting],
  );

  if (!project) return null;
  if (!show) return null;

  return (
    <div className={importClass} style={{ padding: "24px", overflow: "auto" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Typography variant="headline" size="small">
            Import from Knowledge Graph
          </Typography>
          <Typography variant="body" size="small" style={{ marginTop: 6, color: "var(--color-neutral-content-subtle)" }}>
            Pick a BerryDB Knowledge Graph. On Save, its documents are pulled in as Label Studio tasks for this project.
          </Typography>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            htmlFor="berry-kg-select"
            style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em" }}
          >
            Knowledge Graph
          </label>
          <select
            id="berry-kg-select"
            value={selectedKG}
            onChange={(e) => onSelect(e.target.value)}
            disabled={loadingKgs}
            style={{
              height: 40,
              padding: "0 12px",
              border: "1px solid var(--color-neutral-border, #d0d0d0)",
              borderRadius: 6,
              fontSize: 14,
              background: "var(--color-neutral-background, #fff)",
            }}
          >
            <option value="">
              {loadingKgs ? "Loading Knowledge Graphs..." : `Select from ${kgs.length} KG${kgs.length === 1 ? "" : "s"}...`}
            </option>
            {kgs.map((kg) => (
              <option key={kg.name} value={kg.name}>
                {kg.name}
                {kg.schema ? ` (${kg.schema})` : ""}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              background: "var(--color-negative-background, #fef2f2)",
              color: "var(--color-negative-content, #991b1b)",
              fontSize: 13,
              border: "1px solid var(--color-negative-border-subtle, #fecaca)",
            }}
          >
            {error}
          </div>
        )}

        {selectedKG && !error && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              background: "var(--color-positive-background, #f0fdf4)",
              color: "var(--color-positive-content, #166534)",
              fontSize: 13,
              border: "1px solid var(--color-positive-border-subtle, #bbf7d0)",
            }}
          >
            Selected: <b>{selectedKG}</b>. Click <b>Save</b> to create the project and import its tasks.
          </div>
        )}
      </div>
    </div>
  );
};

// Preserved for parity with upstream — nothing else in the LS tree imports
// non-default symbols from this module (verified via grep of Import/Import").
// If a future upstream sync introduces a new named import, add it here.
