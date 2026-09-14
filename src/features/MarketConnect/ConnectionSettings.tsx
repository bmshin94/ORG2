import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Select from "@src/components/Select";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { handleMarketConnectionUrl } from "./deepLink";
import { type Connection, agentFor, loadConnections } from "./rpc";

type Saved = Connection & {
  phase: "authorization_saved" | "reauthorization_required";
};
export default function ConnectionSettings({
  agentName,
}: {
  agentName: string;
}) {
  const { t } = useTranslation("integrations");
  const [connections, setConnections] = useState<Saved[]>([]),
    [index, setIndex] = useState("0"),
    [enabled, setEnabled] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const reload = () => {
      const attempt = ++generation;
      void loadConnections()
        .then((status) => {
          if (active && attempt === generation) {
            setEnabled(status.enabled);
            setConnections(
              status.connections.filter((c) => agentFor(c) === agentName)
            );
            setError(false);
          }
        })
        .catch(() => {
          if (active && attempt === generation) setError(true);
        });
    };
    reload();
    window.addEventListener("market-authorization-saved", reload);
    window.addEventListener("market-connections-changed", reload);
    return () => {
      active = false;
      window.removeEventListener("market-authorization-saved", reload);
      window.removeEventListener("market-connections-changed", reload);
    };
  }, [agentName]);
  if ((!enabled || !connections.length) && !error) return null;
  const selected = connections[Number(index)];
  return (
    <SectionContainer title="Market">
      <SectionRow label={t("marketConnection.title")} layout="vertical">
        {connections.length > 1 && (
          <Select
            ariaLabel={t("marketConnection.title")}
            value={index}
            options={connections.map((c, i) => ({
              value: String(i),
              label: c.workspace_id,
            }))}
            onChange={(value) => setIndex(String(value))}
          />
        )}
        {selected && (
          <Button
            onClick={() => {
              if (selected.phase === "reauthorization_required")
                handleMarketConnectionUrl(
                  `orgii://market/connect?workspace_id=${encodeURIComponent(selected.workspace_id)}&target=${selected.target}`
                );
              else
                window.dispatchEvent(
                  new CustomEvent("market-authorization-saved", {
                    detail: selected,
                  })
                );
            }}
          >
            {t("marketConnection.title")}
          </Button>
        )}
        {error && <p role="alert">{t("marketConnection.failed")}</p>}
      </SectionRow>
    </SectionContainer>
  );
}
