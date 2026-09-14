import { Suspense, lazy, useEffect, useState } from "react";

import { type Connection, connectionSchema } from "./rpc";

const ConnectionDialog = lazy(() => import("./ConnectionDialog"));
export default function ConnectionHost() {
  const [connection, setConnection] = useState<Connection | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const value = connectionSchema.safeParse((event as CustomEvent).detail);
      if (value.success) setConnection(value.data);
    };
    window.addEventListener("market-authorization-saved", open);
    return () => window.removeEventListener("market-authorization-saved", open);
  }, []);
  return connection ? (
    <Suspense fallback={null}>
      <ConnectionDialog
        key={`${connection.identity_user_id}:${connection.workspace_id}:${connection.target}`}
        connection={connection}
        onClose={() => setConnection(null)}
      />
    </Suspense>
  ) : null;
}
