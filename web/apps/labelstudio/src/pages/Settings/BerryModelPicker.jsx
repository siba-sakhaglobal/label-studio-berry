// Berry model picker — native LS 1.23 component that lists Berry providers
// and tasks from the provider×task catalog and, on select, atomically swaps
// the project's ML backend via mcp-client's /studio/ls/connect_model endpoint
// (which purges existing Berry backends before creating the new one).
//
// Backing service: mcp-client at /mcp-client/ (same-origin nginx route).
// Endpoints hit:
//   GET  /mcp-client/studio/ls/catalog        → {providers, tasks_by_provider}
//   GET  /mcp-client/studio/ls/current_model  → preselect currently-connected
//   POST /mcp-client/studio/ls/connect_model  → idempotent swap (provider+task)
//
// Rendered on both /settings/ml (top of MachineLearningSettings) and
// /settings/annotation (top of AnnotationSettings) so users can change model
// from either place without hunting for the 3-dot menu on the ml-backend row.

// This file gets symlinked to:
//   LS_SRC/web/apps/labelstudio/src/pages/Settings/BerryModelPicker.jsx
// so import paths are relative to that location (2 levels up = src/).
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Typography, Spinner } from "@humansignal/ui";
import { Select } from "../../components/Form";
import { ProjectContext } from "../../providers/ProjectProvider";

const MCP_CLIENT_BASE =
  (typeof window !== "undefined" && window.location?.hostname === "localhost")
    ? "http://localhost:8080"
    : "/mcp-client";

export const BerryModelPicker = ({ onChanged }) => {
  const { project, fetchProject } = useContext(ProjectContext);
  const [catalog, setCatalog] = useState({ providers: [], tasks_by_provider: {} });
  const [currentProvider, setCurrentProvider] = useState("");
  const [currentTask, setCurrentTask] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedTask, setSelectedTask] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // On mount: fetch /studio/ls/catalog + /studio/ls/current_model in parallel.
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    Promise.all([
      fetch(`${MCP_CLIENT_BASE}/studio/ls/catalog`).then((r) => r.json()),
      fetch(
        `${MCP_CLIENT_BASE}/studio/ls/current_model?ls_project_id=${project.id}&berry_api_key=`,
      ).then((r) => r.json()),
    ])
      .then(([cat, cur]) => {
        if (cancelled) return;
        setCatalog({
          providers: cat?.providers || [],
          tasks_by_provider: cat?.tasks_by_provider || {},
        });
        if (cur?.provider) {
          setCurrentProvider(cur.provider);
          setSelectedProvider(cur.provider);
        }
        if (cur?.task) {
          setCurrentTask(cur.task);
          setSelectedTask(cur.task);
        }
      })
      .catch((e) => !cancelled && setError(e?.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  // When selectedProvider changes, reset task only if it doesn't exist for the
  // new provider (avoids resetting when provider stays the same on re-render).
  useEffect(() => {
    if (!selectedProvider) return;
    const availableTasks = catalog.tasks_by_provider[selectedProvider] || [];
    const taskExists = availableTasks.some((t) => t.id === selectedTask);
    if (!taskExists) {
      setSelectedTask("");
    }
  }, [selectedProvider, catalog]);

  const providerOptions = useMemo(
    () =>
      (catalog.providers || []).map((p) => ({
        value: p.id,
        label: p.display_name,
      })),
    [catalog.providers],
  );

  const taskOptions = useMemo(() => {
    const tasks = catalog.tasks_by_provider[selectedProvider] || [];
    return tasks.map((t) => ({
      value: t.id,
      label: `${t.display_name} (${t.input_type})${
        currentProvider === selectedProvider && currentTask === t.id
          ? "  (current)"
          : ""
      }`,
    }));
  }, [catalog.tasks_by_provider, selectedProvider, currentProvider, currentTask]);

  const handleSave = useCallback(async () => {
    if (!selectedProvider || !selectedTask || !project?.id) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const qs = new URLSearchParams({
        ls_project_id: String(project.id),
        provider: selectedProvider,
        task: selectedTask,
        berry_api_key: "",
      });
      const res = await fetch(
        `${MCP_CLIENT_BASE}/studio/ls/connect_model?${qs}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || "Connect failed");
      setCurrentProvider(selectedProvider);
      setCurrentTask(selectedTask);
      setSaved(true);
      if (fetchProject) fetchProject();
      if (onChanged) onChanged(selectedProvider, selectedTask);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [selectedProvider, selectedTask, project?.id, fetchProject, onChanged]);

  if (loading) {
    return (
      <div className="mb-wide p-wide border border-primary-border-subtler rounded-md bg-primary-background">
        <Spinner size={20} />{" "}
        <span className="text-neutral-content-subtler ml-tight">
          Loading Berry provider catalog…
        </span>
      </div>
    );
  }

  const btnLabel = saving
    ? "Saving…"
    : currentProvider === selectedProvider && currentTask === selectedTask
      ? "Reconnect"
      : currentProvider
        ? "Change"
        : "Connect";

  return (
    // data-berry-native="1" tells the berry-ai iframe interceptor
    // (Annotations.jsx hookButtons) to SKIP this subtree — our Connect
    // button uses the same label ("Connect"/"Change"/"Reconnect") that
    // LS's "+ Add Model" flow uses, and the interceptor was double-firing,
    // opening the berry-ai-side BerryModelPickerModal on top of a
    // successful LS-side connect. User bug 2026-08-17: 'after Connect it
    // again shows a popup to select the model & task type'.
    <div
      data-berry-native="1"
      className="mb-wide p-wide border border-primary-border-subtler rounded-md bg-primary-background">
      <div className="flex items-center justify-between mb-tight">
        <Typography variant="headline" size="small">
          Berry Model
        </Typography>
        <Typography
          variant="label"
          size="small"
          className="text-neutral-content-subtler"
        >
          Powered by Berry Provider Catalog
        </Typography>
      </div>
      <Typography
        size="small"
        className="text-neutral-content-subtler mb-tight"
      >
        Pick a Provider then a Task. Berry auto-selects the best model for that
        combination and atomically swaps the ML backend for this project.
      </Typography>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="text-xs font-medium text-neutral-content-subtler">
            Provider
          </label>
          <Select
            value={selectedProvider}
            onChange={setSelectedProvider}
            options={providerOptions}
            placeholder="Select provider…"
            disabled={saving || loading}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="text-xs font-medium text-neutral-content-subtler">
            Task
          </label>
          <Select
            value={selectedTask}
            onChange={setSelectedTask}
            options={taskOptions}
            placeholder="Select task…"
            disabled={saving || !selectedProvider}
          />
        </div>
        <Button
          look="primary"
          onClick={handleSave}
          disabled={saving || !selectedProvider || !selectedTask}
          aria-label="Save Berry provider and task selection"
        >
          {btnLabel}
        </Button>
      </div>
      {saved && (
        <Typography size="small" className="text-positive-content mt-tight">
          ✓ Model updated — predictions will use the new (provider, task) selection.
        </Typography>
      )}
      {error && (
        <Typography size="small" className="text-negative-content mt-tight">
          Error: {error}
        </Typography>
      )}
    </div>
  );
};
