import { formatSearchQuerySubtitle } from "@src/engines/ChatPanel/blocks/ToolCallBlock/helpers/argsSummary";
import { isSearchTool } from "@src/engines/SessionCore/rendering/registry/toolCategories";

import type {
  MobileToolData,
  TranscriptItem,
} from "../../lib/transcriptReducer";

type ToolLifecycle = "running" | "done" | "failed";

const GENERIC_TOOL_NAMES = new Set(["", "tool", "tool_call"]);

const TOOL_KIND_TO_CANONICAL: Record<string, string> = {
  file: "read_file",
  edit: "edit_file",
  deleteFile: "delete_file",
  shell: "run_shell",
  search: "code_search",
  glob: "glob_file_search",
  listDir: "list_dir",
  webSearch: "web_search",
  todo: "manage_todo",
  subagent: "subagent",
  orgTask: "task_update",
  await: "await_output",
};

const TOOL_LABEL_KEYS: Record<string, string> = {
  read_file: "readFile",
  edit_file: "editFile",
  edit_file_by_replace: "editFile",
  apply_patch: "editFile",
  write_file: "editFile",
  delete_file: "deleteFile",
  run_shell: "runCommand",
  run_command_line: "runCommand",
  shell: "runCommand",
  code_search: "searchCode",
  grep: "searchCode",
  glob_file_search: "findFiles",
  find_files: "findFiles",
  list_dir: "listDirectory",
  web_search: "searchWeb",
  manage_todo: "updateTodos",
  subagent: "delegateTask",
  agent: "delegateTask",
  task_create: "manageTask",
  task_update: "manageTask",
  task_list: "manageTask",
  task_get: "manageTask",
  await_output: "waitForOutput",
};

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function normalizeMobileToolLifecycle(status?: string): ToolLifecycle {
  const normalized = status?.toLowerCase() ?? "";
  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("cancel")
  ) {
    return "failed";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("pending") ||
    normalized.includes("waiting") ||
    normalized.includes("streaming")
  ) {
    return "running";
  }
  return "done";
}

function toolKind(data?: MobileToolData): string {
  return stringValue(data?.kind);
}

function summaryFromToolData(data?: MobileToolData): string {
  const payload = record(data);
  if (!payload) return "";
  const kind = toolKind(data);
  const keysByKind: Record<string, string[]> = {
    file: ["filePath", "fileName"],
    edit: ["filePath", "fileName"],
    deleteFile: ["filePath", "fileName"],
    shell: ["command", "description", "cwd"],
    search: ["query"],
    glob: ["pattern"],
    listDir: ["directory"],
    webSearch: ["query"],
    subagent: ["description", "subagentType"],
    orgTask: ["action"],
    await: ["handle"],
    message: ["content"],
  };
  const keys = keysByKind[kind] ?? [
    "filePath",
    "command",
    "query",
    "pattern",
    "directory",
    "description",
    "action",
  ];
  return keys.map((key) => stringValue(payload[key])).find(Boolean) ?? "";
}

function isMobileSearchTool(item: TranscriptItem): boolean {
  if (toolKind(item.toolData) === "search") return true;
  return isSearchTool(resolveMobileToolIconName(item));
}

function formatMobileToolSubtitleValue(
  item: TranscriptItem,
  summary: string
): string {
  if (!summary) return "";
  return isMobileSearchTool(item)
    ? formatSearchQuerySubtitle(summary)
    : summary;
}

export function mobileToolSummary(item: TranscriptItem): string {
  const projected = item.toolSummary?.trim();
  if (projected) return formatMobileToolSubtitleValue(item, projected);
  const structured = summaryFromToolData(item.toolData);
  if (structured) return formatMobileToolSubtitleValue(item, structured);
  if (item.toolFilePath?.trim()) return item.toolFilePath.trim();
  if (item.toolCommand?.trim()) return item.toolCommand.trim();
  const fallback = item.text.trim();
  return fallback !== item.toolName
    ? formatMobileToolSubtitleValue(item, fallback)
    : "";
}

export function outputFromToolData(data?: MobileToolData): string {
  const payload = record(data);
  if (!payload) return "";
  const kind = toolKind(data);

  if (kind === "shell") {
    return (
      stringValue(payload.output) ||
      stringValue(payload.streamOutput) ||
      stringValue(payload.errorMessage)
    );
  }
  if (kind === "file") return stringValue(payload.content);
  if (kind === "edit") {
    return stringValue(payload.diff) || stringValue(payload.content);
  }
  if (kind === "await") return stringValue(payload.resultText);
  if (kind === "message") return stringValue(payload.content);
  if (kind === "subagent") {
    return (
      stringValue(payload.errorMessage) ||
      stringValue(payload.resultSummary) ||
      stringValue(payload.resultContent)
    );
  }
  if (kind === "orgTask") {
    return stringValue(payload.errorMessage) || stringValue(payload.guidance);
  }

  if (kind === "search" && Array.isArray(payload.results)) {
    return payload.results
      .map((entry) => {
        const match = record(entry);
        if (!match) return "";
        const file = stringValue(match.file);
        const line = numberValue(match.line);
        const content = stringValue(match.content);
        return `${file}${line == null ? "" : `:${line}`}${content ? `  ${content}` : ""}`;
      })
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "glob" && Array.isArray(payload.files)) {
    return payload.files.map(stringValue).filter(Boolean).join("\n");
  }
  if (kind === "listDir" && Array.isArray(payload.entries)) {
    return payload.entries
      .map((entry) => {
        const row = record(entry);
        if (!row) return "";
        const name = stringValue(row.name);
        return row.isDirectory === true ? `${name}/` : name;
      })
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "webSearch" && Array.isArray(payload.results)) {
    return payload.results
      .map((entry) => stringValue(record(entry)?.title))
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "todo" && Array.isArray(payload.todos)) {
    return payload.todos
      .map((entry) => {
        const todo = record(entry);
        if (!todo) return "";
        const content = stringValue(todo.content);
        const status = stringValue(todo.status);
        return content ? `${status ? `[${status}] ` : ""}${content}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function compactMetadata(
  data?: MobileToolData
): Record<string, unknown> {
  const payload = record(data);
  if (!payload) return {};
  const hidden = new Set([
    "content",
    "diff",
    "output",
    "streamOutput",
    "resultContent",
    "resultSummary",
    "errorMessage",
    "results",
    "files",
    "entries",
    "todos",
    "tasks",
    "fileName",
    "filePath",
    "language",
    "lineCount",
    "startLine",
    "oldContent",
    "newContent",
    "oldStartLine",
    "newStartLine",
    "linesAdded",
    "linesRemoved",
    "isDeleted",
    "applyPatchSegments",
  ]);
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => key !== "kind" && !hidden.has(key) && value != null
    )
  );
}

function isResolvableToolName(name: string): boolean {
  return !GENERIC_TOOL_NAMES.has(name.toLowerCase());
}

/** Resolve the tool name passed to `getToolIcon`, aligned with `toolLabelKey`. */
export function resolveMobileToolIconName(item: TranscriptItem): string {
  const canonical = stringValue(item.toolCanonical);
  const name = stringValue(item.toolName);

  if (canonical && isResolvableToolName(canonical)) return canonical;
  if (name && isResolvableToolName(name)) return name;

  const kind = toolKind(item.toolData);
  const fromKind = TOOL_KIND_TO_CANONICAL[kind];
  if (fromKind) return fromKind;

  return canonical || name || "tool";
}

export function toolLabelKey(item: TranscriptItem): string | undefined {
  const name = (item.toolCanonical || item.toolName || "").toLowerCase();
  const exact = TOOL_LABEL_KEYS[name];
  if (exact) return exact;
  const kind = toolKind(item.toolData);
  const byKind: Record<string, string> = {
    file: "readFile",
    edit: "editFile",
    deleteFile: "deleteFile",
    shell: "runCommand",
    search: "searchCode",
    glob: "findFiles",
    listDir: "listDirectory",
    webSearch: "searchWeb",
    todo: "updateTodos",
    subagent: "delegateTask",
    orgTask: "manageTask",
    await: "waitForOutput",
  };
  return byKind[kind];
}
