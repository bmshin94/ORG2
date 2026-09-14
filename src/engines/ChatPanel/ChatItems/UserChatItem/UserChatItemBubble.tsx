import type { MouseEvent, ReactNode, RefObject, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";

import ClampedContent from "@src/components/ClampedContent";
import ExpandOverlay from "@src/components/ExpandOverlay";
import { ClipboardCheckIcon, HugeiconsIcon, SparklesIcon } from "@src/icons";

import CachedFileChip from "./CachedFileChip";

// Continuous chat leaves roughly ten rendered lines visible before folding.
const USER_MSG_CONTINUOUS_PREVIEW_HEIGHT = 10 * 24;

/**
 * Layout-only; border/hover/focus ring added per-row below.
 *
 * The wrapping message row uses a NAMED group (`group/msg`) so the action
 * toolbar reveals only for its own message. An unnamed `group` would also
 * match bare-group ancestors (e.g. the WorkStation AppShell), revealing every
 * message toolbar whenever the mouse was anywhere in the pane.
 */
const DISPLAY_CONTAINER_BASE =
  "relative w-fit max-w-[min(600px,100%)] rounded-2xl bg-fill-2 px-3 py-2";

interface UserChatItemBubbleProps {
  isEditableDisplay: boolean;
  onEditClick: () => void;
  isRepoSetup: boolean;
  isPlanApproved: boolean;
  planApprovedEdited: boolean;
  fullContent: string;
  messageImages: string[] | undefined;
  compactPreview: boolean;
  messageContent: ReactNode;
  messageContentRef: RefObject<HTMLDivElement | null>;
  isExpanded: boolean;
  displayNeedsTruncation: boolean;
  onToggleTruncation: (event: SyntheticEvent) => void;
  cachedFiles: string[];
  previewFile: string | null;
  onTogglePreview: (event: MouseEvent, file: string) => void;
  onClosePreview: (event: MouseEvent) => void;
}

/** The message bubble: label rows, clamped/expandable text and cached files. */
export function UserChatItemBubble({
  isEditableDisplay,
  onEditClick,
  isRepoSetup,
  isPlanApproved,
  planApprovedEdited,
  fullContent,
  messageImages,
  compactPreview,
  messageContent,
  messageContentRef,
  isExpanded,
  displayNeedsTruncation,
  onToggleTruncation,
  cachedFiles,
  previewFile,
  onTogglePreview,
  onClosePreview,
}: UserChatItemBubbleProps) {
  const { t } = useTranslation("sessions");
  const containerClass = `${DISPLAY_CONTAINER_BASE} ${isEditableDisplay ? "cursor-pointer outline-none" : ""}`;

  return (
    <div
      className={containerClass}
      data-testid="chat-message-user-editable"
      onDoubleClick={isEditableDisplay ? onEditClick : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        {isRepoSetup ? (
          <div className="flex items-center gap-2 py-0.5">
            <HugeiconsIcon
              icon={SparklesIcon}
              data-icon="sparkles"
              size={14}
              className="text-primary-6"
            />
            <span className="chat-block-title font-medium text-text-1">
              {t("chat.repoSetupLabel")}
            </span>
          </div>
        ) : isPlanApproved ? (
          <div className="flex items-center gap-2 py-0.5">
            <HugeiconsIcon
              icon={ClipboardCheckIcon}
              data-icon="clipboard-check"
              size={14}
              className="text-primary-6"
            />
            <span className="chat-block-title font-medium text-text-1">
              {planApprovedEdited
                ? t(
                    "chat.planApprovedEditedLabel",
                    "Implementing approved plan (edited)"
                  )
                : t("chat.planApprovedLabel", "Implementing approved plan")}
            </span>
          </div>
        ) : (
          <>
            {(fullContent || (messageImages && messageImages.length > 0)) &&
              (!compactPreview ? (
                <ClampedContent
                  maxHeight={USER_MSG_CONTINUOUS_PREVIEW_HEIGHT}
                  className="allow-select"
                >
                  {messageContent}
                </ClampedContent>
              ) : (
                <div className="group/expand relative w-full">
                  <div
                    ref={messageContentRef}
                    className={`allow-select ${isExpanded && displayNeedsTruncation ? "scrollbar-hide" : ""}`}
                    style={
                      displayNeedsTruncation && !isExpanded
                        ? { maxHeight: 72, overflow: "hidden" }
                        : isExpanded && displayNeedsTruncation
                          ? {
                              maxHeight: 240,
                              overflowY: "auto",
                              overflowX: "hidden",
                            }
                          : undefined
                    }
                  >
                    {messageContent}

                    {displayNeedsTruncation && isExpanded && (
                      <ExpandOverlay
                        isExpanded
                        onToggle={onToggleTruncation}
                        fadeFrom="from-fill-2"
                      />
                    )}
                  </div>

                  {displayNeedsTruncation && !isExpanded && (
                    <ExpandOverlay
                      isExpanded={false}
                      onToggle={onToggleTruncation}
                      collapsedFadeHeightClass="h-8"
                      fadeFrom="from-fill-2"
                    />
                  )}
                </div>
              ))}

            {cachedFiles.length > 0 && (
              <div className="scrollbar-overlay flex max-w-full flex-nowrap gap-2 overflow-x-auto">
                {cachedFiles.map((file) => (
                  <CachedFileChip
                    key={file}
                    file={file}
                    isPreviewOpen={previewFile === file}
                    onTogglePreview={(event) => onTogglePreview(event, file)}
                    onClosePreview={onClosePreview}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
