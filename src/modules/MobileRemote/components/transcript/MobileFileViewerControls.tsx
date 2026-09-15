import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import IconButton from "@src/components/Button";
import {
  Copy01Icon,
  HugeiconsIcon,
  Loading03Icon,
  TextWrapIcon,
  Tick01Icon,
} from "@src/icons";

import type { MobileFileTarget, mobileFilePreview } from "./mobileFileTool";
import { useMobileCopyText } from "./useMobileCopyText";

interface MobileFileViewerControlsProps {
  target: MobileFileTarget;
  targets: MobileFileTarget[];
  onSelect: (index: number) => void;
  preview: ReturnType<typeof mobileFilePreview>;
  truncated: boolean;
  wrap: boolean;
  onToggleWrap: () => void;
}

/** Local document controls; no transcript, connection or Desktop request ownership. */
export function MobileFileViewerControls({
  target,
  targets,
  onSelect,
  preview,
  truncated,
  wrap,
  onToggleWrap,
}: MobileFileViewerControlsProps) {
  const { t } = useTranslation("mobileRemote");
  const { t: common } = useTranslation("common");
  const previewDescriptionId = useId();
  const source = preview.content;
  const clipboard = useMobileCopyText(source ?? "");
  const copyLabel =
    clipboard.state === "copied"
      ? common("status.copied")
      : preview.kind === "merge"
        ? t("fileViewer.copyModified")
        : preview.kind === "patch"
          ? t("fileViewer.copyPatch")
          : common("actions.copy");
  const previewDescription = [
    truncated ? t("transcript.tools.truncated") : "",
    preview.kind === "patch" ? t("fileViewer.patchFallback") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="shrink-0 border-b border-border-2 px-3 pb-2">
      {targets.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto pt-2"
          aria-label={t("fileViewer.files")}
        >
          {targets.map((file) => (
            <Button
              key={`${file.targetIndex}:${file.filePath}`}
              size="small"
              className="min-h-11 max-w-56 shrink-0"
              appearance={
                target.targetIndex === file.targetIndex ? "solid" : "ghost"
              }
              aria-pressed={target.targetIndex === file.targetIndex}
              onClick={() => onSelect(file.targetIndex)}
              data-mobile-file-target={file.filePath}
            >
              <span className="truncate">{file.fileName}</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex min-h-11 items-center gap-1">
        <span
          className="mobile-type-caption mr-auto min-w-0 text-text-3"
          title={previewDescription || undefined}
          aria-describedby={
            previewDescription ? previewDescriptionId : undefined
          }
        >
          {t(
            preview.kind === "snapshot"
              ? "fileViewer.snapshot"
              : preview.kind === "patch"
                ? "fileViewer.patch"
                : "fileViewer.diff"
          )}
          {truncated && <> · {t("fileViewer.partial")}</>}
        </span>
        <IconButton
          appearance="soft"
          htmlType="button"
          size="large"
          variant={clipboard.state === "copied" ? "success" : "tertiary"}
          className="min-h-11 min-w-11 shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
          disabled={source === undefined || clipboard.state === "pending"}
          aria-busy={clipboard.state === "pending"}
          aria-label={copyLabel}
          title={copyLabel}
          onClick={clipboard.copy}
        >
          <HugeiconsIcon
            icon={
              clipboard.state === "copied"
                ? Tick01Icon
                : clipboard.state === "pending"
                  ? Loading03Icon
                  : Copy01Icon
            }
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
            className={
              clipboard.state === "pending" ? "animate-spin" : undefined
            }
          />
        </IconButton>
        <IconButton
          appearance="soft"
          htmlType="button"
          size="large"
          className="min-h-11 min-w-11 shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
          aria-label={t("fileViewer.wrap")}
          title={t("fileViewer.wrap")}
          aria-pressed={wrap}
          variant={wrap ? "primary" : "tertiary"}
          disabled={source === undefined}
          onClick={onToggleWrap}
        >
          <HugeiconsIcon
            icon={TextWrapIcon}
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </IconButton>
      </div>
      {previewDescription && (
        <span id={previewDescriptionId} className="sr-only">
          {previewDescription}
        </span>
      )}
      <span role="status" className="sr-only">
        {clipboard.state === "copied" ? common("status.copied") : ""}
      </span>
      {clipboard.state === "failed" && (
        <p role="alert" className="mobile-type-caption text-danger-6">
          {common("status.copyFailed")}
        </p>
      )}
    </div>
  );
}
