import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";

const openClient = defineProcedure("market_connection_open_client")
  .input(
    z.object({
      agent: z.string(),
      selection: z.string(),
      model: z.string(),
    })
  )
  .output(z.null())
  .build();

export const openConfiguredMarketClient = (
  agent: "claude_code" | "claude_desktop" | "codex",
  selection: string,
  model: string
) => typedInvoke(openClient, { agent, selection, model });
