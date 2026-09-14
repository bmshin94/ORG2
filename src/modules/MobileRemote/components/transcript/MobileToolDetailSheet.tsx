import React, { Suspense, lazy, useCallback, useRef, useState } from "react";

import BottomSheet from "@src/components/BottomSheet";
import Button from "@src/components/Button";
import FileTypeIcon from "@src/components/FileTypeIcon";
import { Placeholder } from "@src/components/Placeholder";
import { getToolIcon } from "@src/config/toolIcons";
import { EventBlockHeaderIcon } from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeaderIcon";
import { EventBlockHeaderInfo } from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeaderTextSlots";
import { SESSION_UI_TOKENS } from "@src/engines/ChatPanel/blocks/primitives/config";
import { HugeiconsIcon, SquareArrowUpRight02Icon } from "@src/icons";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import type { MobileFileTarget } from "./mobileFileTool";
import { record, stringValue } from "./mobileToolPresentation";
import { useMobileToolPresentation } from "./useMobileToolPresentation";

const MobileFilePreview = lazy(
  () =>
    import(/* webpackChunkName: "mobile-file-preview" */ "./MobileFilePreview")
);

export interface MobileToolDetailSheetProps {
  item: TranscriptItem;
  open: boolean;
  onClose: () => void;
  onOpenFile?: (target: MobileFileTarget) => Promise<void>;
}

type OpenFileState =
  | { phase: "idle" }
  | { phase: "opening"; targetIndex: number }
  | { phase: "requested"; targetIndex: number }
  | { phase: "failed"; targetIndex: number; message: string };

export function MobileToolDetailSheet({
  item,
  open,
  onClose,
  onOpenFile,
}: MobileToolDetailSheetProps) {
  const {
    t,
    rawName,
    title,
    summary,
    output,
    fileTargets,
    metadataText,
    statusLabel,
    isLoading,
    isFailed,
  } = useMobileToolPresentation(item);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(
    () => fileTargets[0]?.targetIndex ?? 0
  );
  const [openFileState, setOpenFileState] = useState<OpenFileState>({
    phase: "idle",
  });
  const openRequestRef = useRef(0);
  const selectedTarget =
    fileTargets.find((target) => target.targetIndex === selectedTargetIndex) ??
    fileTargets[0];
  const firstTargetIndex = fileTargets[0]?.targetIndex ?? 0;

  const handleClose = useCallback(() => {
    openRequestRef.current += 1;
    setSelectedTargetIndex(firstTargetIndex);
    setOpenFileState({ phase: "idle" });
    onClose();
  }, [firstTargetIndex, onClose]);

  const handleOpenFile = useCallback(
    async (target: MobileFileTarget) => {
      if (!onOpenFile || openFileState.phase === "opening") return;
      const requestId = ++openRequestRef.current;
      setSelectedTargetIndex(target.targetIndex);
      setOpenFileState({ phase: "opening", targetIndex: target.targetIndex });
      try {
        await onOpenFile(target);
        if (openRequestRef.current !== requestId) return;
        setOpenFileState({
          phase: "requested",
          targetIndex: target.targetIndex,
        });
      } catch (error) {
        if (openRequestRef.current !== requestId) return;
        setOpenFileState({
          phase: "failed",
          targetIndex: target.targetIndex,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [onOpenFile, openFileState.phase]
  );

  const renderOpenLabel = (target: MobileFileTarget) => {
    if (
      openFileState.phase === "requested" &&
      openFileState.targetIndex === target.targetIndex
    ) {
      return t("transcript.tools.fileOpenRequested");
    }
    return t("transcript.tools.openFile");
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      showCloseButton
      closeLabel={t("transcript.tools.closeDetails")}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <EventBlockHeaderIcon
            icon={getToolIcon(rawName, {
              size: SESSION_UI_TOKENS.ICON.SIZE_MD,
              className: SESSION_UI_TOKENS.ICON.DEFAULT,
              action: stringValue(record(item.toolData)?.action) || undefined,
            })}
            isCollapsed
            hasContent={false}
            isLoading={isLoading}
            isFailed={isFailed}
          />
          <span className="min-w-0 truncate">{title}</span>
          <EventBlockHeaderInfo
            isLoading={isLoading}
            className={`shrink-0 font-normal ${
              isFailed
                ? "text-danger-6"
                : isLoading
                  ? "text-info-6"
                  : "text-text-3"
            }`}
          >
            {statusLabel}
          </EventBlockHeaderInfo>
        </span>
      }
      bodyClassName="!px-4 !pb-5"
    >
      <div data-mobile-tool-detail={item.id}>
        {summary ? (
          <p className="chat-block-content mb-4 leading-5 break-words text-text-2">
            {summary}
          </p>
        ) : null}
        {fileTargets.length > 0 ? (
          <section className="mb-4" data-mobile-file-targets="true">
            <div className={`${SESSION_UI_TOKENS.TEXT.LABEL_XS} mb-1.5`}>
              {t("transcript.tools.files")}
            </div>
            <div className="flex flex-col gap-2">
              {fileTargets.map((target) => {
                const selected =
                  target.targetIndex === selectedTarget?.targetIndex;
                const opening =
                  openFileState.phase === "opening" &&
                  openFileState.targetIndex === target.targetIndex;
                return (
                  <div
                    key={`${target.targetIndex}:${target.filePath}:${target.line ?? ""}`}
                    className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 ${
                      selected
                        ? "border-primary-5 bg-fill-1"
                        : "border-border-2 bg-bg-2"
                    }`}
                    data-mobile-file-target={target.filePath}
                  >
                    <Button
                      layout="custom"
                      appearance="custom"
                      htmlType="button"
                      className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
                      onClick={() => setSelectedTargetIndex(target.targetIndex)}
                      aria-pressed={selected}
                    >
                      <FileTypeIcon fileName={target.fileName} size="small" />
                      <span className="min-w-0 flex-1">
                        <span className="chat-block-xs block truncate font-medium text-text-1">
                          {target.fileName}
                        </span>
                        <span
                          className="chat-code-sm block truncate text-text-3"
                          title={target.filePath}
                        >
                          {target.filePath}
                          {target.line ? `:${target.line}` : ""}
                        </span>
                      </span>
                    </Button>
                    <Button
                      size="small"
                      variant="primary"
                      appearance="ghost"
                      icon={
                        <HugeiconsIcon
                          icon={SquareArrowUpRight02Icon}
                          size={SESSION_UI_TOKENS.ICON.SIZE_SM}
                        />
                      }
                      loading={opening}
                      disabled={!onOpenFile}
                      aria-label={t("transcript.tools.openFileNamed", {
                        file: target.fileName,
                      })}
                      onClick={() => void handleOpenFile(target)}
                      data-mobile-open-file={target.filePath}
                    >
                      {renderOpenLabel(target)}
                    </Button>
                  </div>
                );
              })}
            </div>
            {!onOpenFile ? (
              <p className="chat-block-xs mt-1.5 text-text-3">
                {t("transcript.tools.openFileUnavailable")}
              </p>
            ) : null}
            {openFileState.phase === "failed" ? (
              <p className="chat-block-xs mt-1.5 text-danger-6" role="alert">
                {t("transcript.tools.openFileFailed", {
                  message: openFileState.message,
                })}
              </p>
            ) : null}
          </section>
        ) : null}
        {selectedTarget?.content || selectedTarget?.diff ? (
          <section className="mb-4" data-mobile-file-highlight="true">
            <div className={`${SESSION_UI_TOKENS.TEXT.LABEL_XS} mb-1.5`}>
              {selectedTarget.diff
                ? t("transcript.tools.changes")
                : t("transcript.tools.preview")}
            </div>
            <Suspense
              fallback={
                <div className="min-h-24 rounded-lg border border-border-2 bg-bg-2">
                  <Placeholder
                    placement="sidebar"
                    variant="loading"
                    title={t("transcript.tools.loadingPreview")}
                  />
                </div>
              }
            >
              <MobileFilePreview target={selectedTarget} />
            </Suspense>
          </section>
        ) : null}
        {fileTargets.length === 0 && metadataText ? (
          <section className="mb-4">
            <div className={`${SESSION_UI_TOKENS.TEXT.LABEL_XS} mb-1.5`}>
              {t("transcript.tools.details")}
            </div>
            <pre className="chat-code-sm overflow-x-auto rounded-lg bg-fill-1 p-3 leading-5 break-words whitespace-pre-wrap text-text-2">
              {metadataText}
            </pre>
          </section>
        ) : null}
        {fileTargets.length === 0 && output ? (
          <section className="mb-4">
            <div className={`${SESSION_UI_TOKENS.TEXT.LABEL_XS} mb-1.5`}>
              {t("transcript.tools.output")}
            </div>
            <pre className="chat-code-sm overflow-x-auto rounded-lg bg-fill-1 p-3 leading-5 break-words whitespace-pre-wrap text-text-2">
              {output}
            </pre>
          </section>
        ) : null}
        {item.toolDataTruncated ? (
          <p className="chat-block-xs text-text-3">
            {t("transcript.tools.truncated")}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}

MobileToolDetailSheet.displayName = "MobileToolDetailSheet";
