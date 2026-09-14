import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CliConfigManagedStatus } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Select from "@src/components/Select";
import Modal, { MODAL_SELECT_Z_INDEX } from "@src/scaffold/ModalSystem";

import {
  type Connection,
  type Entry,
  applyConfig,
  disconnectConfig,
  loadConfig,
  loadEntries,
} from "./rpc";

const WorkspaceLaunch = lazy(() => import("./WorkspaceLaunch"));

export default function ConnectionDialog({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const { t } = useTranslation("integrations");
  const tr = (key: string) => t(`marketConnection.${key}`);
  const [entries, setEntries] = useState<Entry[]>([]),
    [entry, setEntry] = useState(""),
    [model, setModel] = useState("");
  const [config, setConfig] = useState<CliConfigManagedStatus | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [configured, setConfigured] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const supported =
    connection.target === "claude-code" || connection.target === "codex";
  useEffect(() => {
    alive.current = true;
    generation.current++;
    if (!supported) {
      setBusy(false);
      return () => {
        alive.current = false;
      };
    }
    let current = true;
    void Promise.all([loadEntries(connection), loadConfig(connection)])
      .then(([all, status]) => {
        if (!current) return;
        const agent = connection.target === "codex" ? "codex" : "claude";
        const active = all
          .map((e) => ({ ...e, models: e.models_by_agent[agent] }))
          .filter(
            (e) =>
              e.status === "active" &&
              (e.expires_at === null || e.expires_at > Date.now())
          );
        setEntries(active);
        setConfig(status);
        // The profile stores public selection metadata, never credentials.
        if (
          status.mode === "orgii_managed" &&
          status.selectedProvider === "market" &&
          status.selectedKeyId?.startsWith("market:")
        ) {
          try {
            const raw = status.selectedKeyId
              .slice(7)
              .replace(/-/g, "+")
              .replace(/_/g, "/");
            const saved = JSON.parse(atob(raw));
            const metadata = saved.metadata;
            if (
              metadata?.identity_user_id === connection.identity_user_id &&
              metadata.workspace_id === connection.workspace_id &&
              metadata.target === connection.target &&
              active.some((e) => e.entitlement_id === saved.entitlement_id)
            ) {
              setEntry(saved.entitlement_id);
              setModel(status.selectedModel ?? "");
              setConfigured(true);
              return;
            }
          } catch {
            /* An unrecognized profile is never reported configured. */
          }
        }
        if (active.length === 1) {
          setEntry(active[0].entitlement_id);
          setModel(active[0].models[0] ?? "");
        }
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, [connection, supported]);
  const selected = entries.find((e) => e.entitlement_id === entry);
  const run = async (disconnect = false) => {
    if (!entry || !config) return;
    const attempt = generation.current;
    const current = () => alive.current && generation.current === attempt;
    setBusy(true);
    setError(false);
    try {
      if (disconnect) {
        await disconnectConfig(connection, entry);
        window.dispatchEvent(new Event("market-connections-changed"));
        if (current()) onClose();
      } else {
        const hashes = Object.fromEntries(
          config.targetFiles.map((file) => [file.id, file.currentHash ?? null])
        );
        const result = await applyConfig(connection, entry, model, hashes);
        if (current()) {
          setConfig(result);
          setConfigured(true);
        }
      }
    } catch {
      if (current()) setError(true);
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <Modal
      visible
      title={tr("title")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex gap-2">
          <Button disabled={busy} onClick={onClose}>
            {tr("close")}
          </Button>
          {configured ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void run(true)}
            >
              {tr("disconnect")}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !supported || !selected || !model || !config || config.conflict
              }
              onClick={() => void run()}
            >
              {tr("configure")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {configured && (
          <Suspense fallback={null}>
            <WorkspaceLaunch
              connection={connection}
              selection={config?.selectedKeyId ?? null}
              model={model}
              onClose={onClose}
            />
          </Suspense>
        )}
        <p className="text-text-2">
          {connection.workspace_id} · {connection.target}
        </p>
        {!supported ? (
          <p role="status">{tr("adapterPending")}</p>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span>{tr("listing")}</span>
              <Select
                ariaLabel={tr("listing")}
                value={entry}
                disabled={busy || configured}
                options={entries.map((e) => ({
                  value: e.entitlement_id,
                  label: e.service_name,
                }))}
                onChange={(value) => {
                  const id = String(value);
                  setEntry(id);
                  setModel(
                    entries.find((e) => e.entitlement_id === id)?.models[0] ??
                      ""
                  );
                }}
                panelZIndex={MODAL_SELECT_Z_INDEX}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span>{tr("model")}</span>
              <Select
                ariaLabel={tr("model")}
                value={model}
                disabled={busy || configured}
                options={(selected?.models ?? []).map((id) => ({
                  value: id,
                  label: id,
                }))}
                onChange={(value) => setModel(String(value))}
                panelZIndex={MODAL_SELECT_Z_INDEX}
              />
            </label>
            {!busy && !entries.length && (
              <p role="status">{tr("noPurchases")}</p>
            )}
            {config?.conflict && <p role="alert">{tr("conflict")}</p>}
            {configured && <p role="status">{tr("configured")}</p>}
          </>
        )}
        {error && <p role="alert">{tr("failed")}</p>}
      </div>
    </Modal>
  );
}
