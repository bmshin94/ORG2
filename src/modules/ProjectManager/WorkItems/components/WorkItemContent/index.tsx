import { useAtomValue } from "jotai";
import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useWorkItemImageInsert } from "@src/hooks/project";
import { builtInAgentsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import { useEnsureStatusDefinitions } from "@src/modules/ProjectManager/WorkItems/hooks/useStatusDefinitions";
import type { ProjectContentEditorRef } from "@src/modules/ProjectManager/shared";
import {
  DetailPanelContainer,
  ScrollTrailTarget,
} from "@src/modules/shared/layouts/blocks";

import RevisionConflictModal from "../RevisionConflictModal";
import WorkItemContentStack from "../WorkItemContentStack";
import WorkItemSubItems, { useWorkItemFamily } from "../WorkItemSubItems";
import {
  WorkItemThreadLayout,
  WorkItemThreadViewAction,
} from "../WorkItemThread";
import CustomPropertiesSection from "./CustomPropertiesSection";
import GitHubIssueComposer from "./GitHubIssueComposer";
import HistoryTab from "./HistoryTab";
import OutputTab from "./OutputTab";
import QuickActionsSection from "./QuickActionsSection";
import {
  WorkItemTabbedLowerSection,
  WorkItemThreadLowerSection,
} from "./WorkItemContentLowerSections";
import WorkItemDescriptionSection from "./WorkItemDescriptionSection";
import { useWorkItemContentModel } from "./hooks/useWorkItemContentModel";
import { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { WorkItemContentProps } from "./types";

const WorkItemContent: React.FC<WorkItemContentProps> = ({
  workItem,
  presentation = "default",
  onUpdateWorkItem,
  onUpdateWorkItemImmediate,
  currentUser: currentUserProp,
  teamMembers = [],
  availableAgents = [],
  availableOrgs = [],
  headerPath,
  headerProperties,
  flowHeader,
  propertiesRail,
  titleVisible = false,
  repoPath,
  projectSlug,
  shortId,
  githubIssueTimeline,
  githubIssueInteraction,
  orgId,
  onOpenSubItem,
  onOpenSession,
  onOpenFileDiff,
  onReviewAllFiles,
  onRefreshWorkflow,
  onTransitionHandoff,
  activeAgentSessionId,
  onCreatePr,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const editorRef = useRef<ProjectContentEditorRef>(null);
  const builtInAgents = useAtomValue(builtInAgentsAtom);
  const mentionAgents = useMemo(
    () => [...builtInAgents, ...availableAgents],
    [builtInAgents, availableAgents]
  );
  useEnsureStatusDefinitions(orgId ?? "personal-org");

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: projectSlug ?? null,
    editorRef,
  });

  const subItemFamily = useWorkItemFamily(
    shortId ?? workItem.shortId ?? "",
    projectSlug,
    orgId
  );

  const {
    currentUser,
    currentUserMemberIds,
    activeSessionTab,
    setActiveSessionTab,
    commentText,
    setCommentText,
    replyToCommentId,
    setReplyToCommentId,
    mentionRefs,
    setMentionRefs,
    isSubscribed,
    handleToggleSubscription,
    isSubmittingComment,
    triggerPreview,
    sessionTabItems,
    resolvedDescription,
    rawDescription,
    timelineEntries,
    handleTitleChange,
    handleDescriptionChange,
    handleCommentSubmit,
    handleResolveDiscussionThread,
    handleReopenDiscussionThread,
    handleEditDiscussionComment,
    handleDeleteDiscussionComment,
    commentRevisionConflict,
    handleUseLatestComment,
    handleKeepMineComment,
  } = useWorkItemContentState({
    workItem,
    onUpdateWorkItem,
    onUpdateWorkItemImmediate,
    currentUserProp,
    teamMembers,
    availableAgents: mentionAgents,
    availableOrgs,
    projectSlug,
    shortId,
    orgId,
    onRefreshWorkflow,
  });

  const {
    creatorName,
    resolvedFlowHeader,
    normalizedRawDescription,
    displayedDescription,
    isGitHubWorkItem,
    canEditDescription,
    githubTimeline,
    githubTimelineLoading,
    githubTimelineError,
    githubTimelineAlert,
    descriptionEditing,
    setThreadViewSelection,
    sectionPolicy,
    isThread,
    activeThreadView,
    isEditingThreadDescription,
    handoffNotice,
  } = useWorkItemContentModel({
    workItem,
    presentation,
    flowHeader,
    teamMembers,
    githubIssueTimeline,
    githubIssueInteraction,
    repoPath,
    shortId,
    projectSlug,
    onUpdateWorkItem,
    onTransitionHandoff,
    onRefreshWorkflow,
    currentUser,
    currentUserMemberIds,
    rawDescription,
    resolvedDescription,
    handleDescriptionChange,
  });

  const descriptionSection = (
    <WorkItemDescriptionSection
      workItem={workItem}
      isThread={isThread}
      isGitHubWorkItem={isGitHubWorkItem}
      canEditDescription={canEditDescription}
      isEditingThreadDescription={isEditingThreadDescription}
      githubIssueInteraction={githubIssueInteraction}
      githubTimeline={githubTimeline}
      githubTimelineLoading={githubTimelineLoading}
      githubTimelineError={githubTimelineError}
      creatorName={creatorName}
      normalizedRawDescription={normalizedRawDescription}
      displayedDescription={displayedDescription}
      descriptionEditing={descriptionEditing}
      handleTitleChange={handleTitleChange}
      handleImageInsert={handleImageInsert}
      editorRef={editorRef}
      titleVisible={titleVisible}
      repoPath={repoPath}
    />
  );

  const subItemsSection = !isGitHubWorkItem ? (
    <ScrollTrailTarget enabled={isThread} label={t("workItems.subItems.title")}>
      <WorkItemSubItems
        family={subItemFamily}
        parentShortId={shortId ?? workItem.shortId ?? ""}
        projectSlug={projectSlug}
        orgId={orgId}
        onOpenWorkItem={onOpenSubItem}
      />
    </ScrollTrailTarget>
  ) : null;

  const customPropertiesSection = !isGitHubWorkItem ? (
    <ScrollTrailTarget
      enabled={isThread}
      label={t("workItems.properties.title", {
        defaultValue: "Custom properties",
      })}
    >
      <CustomPropertiesSection
        projectSlug={projectSlug}
        orgId={orgId}
        shortId={shortId ?? workItem.shortId}
        members={teamMembers}
        editable={Boolean(onUpdateWorkItem)}
      />
    </ScrollTrailTarget>
  ) : null;

  const quickActionsSection = !isGitHubWorkItem ? (
    <QuickActionsSection
      orgId={orgId || "personal-org"}
      projectSlug={projectSlug ?? null}
      shortId={shortId ?? workItem.shortId ?? ""}
      currentUser={currentUser}
      agents={mentionAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
      agentOrgs={availableOrgs.map((org) => ({ id: org.id, name: org.name }))}
      disabled={!onUpdateWorkItem}
      onInvoked={onRefreshWorkflow}
    />
  ) : null;

  const outputContent = (
    <OutputTab
      workItem={workItem}
      repoPath={repoPath}
      projectSlug={projectSlug}
      shortId={shortId ?? workItem.shortId}
      orgId={orgId}
      onOpenFileDiff={onOpenFileDiff}
      onReviewAllFiles={onReviewAllFiles}
      onCreatePr={onCreatePr}
    />
  );

  const historyContent = (
    <HistoryTab
      key={workItem.session_id}
      timelineEntries={timelineEntries}
      currentUser={currentUser}
      isSubscribed={isSubscribed}
      onToggleSubscribe={handleToggleSubscription}
      commentText={commentText}
      onCommentTextChange={setCommentText}
      mentionRefs={mentionRefs}
      onMentionRefsChange={setMentionRefs}
      agents={mentionAgents}
      agentOrgs={availableOrgs}
      teamMembers={teamMembers}
      onCommentSubmit={handleCommentSubmit}
      isSubmittingComment={isSubmittingComment}
      comments={workItem.comments ?? []}
      replyToCommentId={replyToCommentId}
      onReplyToComment={setReplyToCommentId}
      onResolveThread={handleResolveDiscussionThread}
      onReopenThread={handleReopenDiscussionThread}
      onEditComment={handleEditDiscussionComment}
      onDeleteComment={handleDeleteDiscussionComment}
      presentation={presentation}
      canComment={Boolean(onUpdateWorkItem)}
      triggerPreview={triggerPreview}
      threadNavigation={
        isThread && activeThreadView === "discussion" ? (
          <WorkItemThreadViewAction
            activeView="discussion"
            onChange={(view) =>
              setThreadViewSelection({
                workItemId: workItem.session_id,
                view,
              })
            }
          />
        ) : undefined
      }
    />
  );

  const commentConflictModal = (
    <RevisionConflictModal
      conflict={
        commentRevisionConflict
          ? {
              fieldLabel: t("workItems.revisionConflict.commentField"),
              mine: commentRevisionConflict.mine,
              latest: commentRevisionConflict.latest,
              expectedRevision: commentRevisionConflict.expectedRevision,
              actualRevision: commentRevisionConflict.actualRevision,
            }
          : null
      }
      onUseLatest={handleUseLatestComment}
      onKeepMine={handleKeepMineComment}
    />
  );

  const tabbedLowerSection = (
    <WorkItemTabbedLowerSection
      workItem={workItem}
      shortId={shortId ?? workItem.shortId}
      projectSlug={projectSlug}
      orgId={orgId}
      activeAgentSessionId={activeAgentSessionId}
      onOpenSession={onOpenSession}
      sectionPolicy={sectionPolicy}
      outputContent={outputContent}
      sessionTabItems={sessionTabItems}
      activeSessionTab={activeSessionTab}
      setActiveSessionTab={setActiveSessionTab}
      historyContent={historyContent}
    />
  );

  const threadLowerSection = (
    <WorkItemThreadLowerSection
      workItem={workItem}
      shortId={shortId ?? workItem.shortId}
      projectSlug={projectSlug}
      orgId={orgId}
      activeAgentSessionId={activeAgentSessionId}
      onOpenSession={onOpenSession}
      sectionPolicy={sectionPolicy}
      outputContent={outputContent}
      isThread={isThread}
      isGitHubWorkItem={isGitHubWorkItem}
    />
  );

  if (isThread) {
    const githubIssueComposer =
      activeThreadView === "overview" &&
      isGitHubWorkItem &&
      githubIssueInteraction ? (
        <GitHubIssueComposer interaction={githubIssueInteraction} />
      ) : undefined;

    return (
      <>
        <WorkItemThreadLayout
          path={headerPath}
          properties={headerProperties}
          flowHeader={resolvedFlowHeader}
          alerts={githubTimelineAlert}
          sidebar={propertiesRail}
          floatingFooter={githubIssueComposer}
        >
          {activeThreadView === "overview" ? (
            <>
              {handoffNotice}
              {descriptionSection}
              {quickActionsSection}
              {customPropertiesSection}
              {subItemsSection}
              {threadLowerSection}
              {!isGitHubWorkItem ? (
                <ScrollTrailTarget
                  label={t("workItems.activity.discussionTitle")}
                >
                  <nav
                    className="flex min-h-8 items-center justify-end"
                    aria-label={t("workItems.activity.discussionTitle")}
                    data-testid="work-item-thread-secondary-navigation"
                  >
                    <WorkItemThreadViewAction
                      activeView="overview"
                      onChange={(view) =>
                        setThreadViewSelection({
                          workItemId: workItem.session_id,
                          view,
                        })
                      }
                    />
                  </nav>
                </ScrollTrailTarget>
              ) : null}
            </>
          ) : (
            historyContent
          )}
        </WorkItemThreadLayout>
        {commentConflictModal}
      </>
    );
  }

  return (
    <>
      <DetailPanelContainer className="relative">
        <WorkItemContentStack
          pathContent={headerPath}
          propertiesContent={headerProperties}
          descriptionContent={
            handoffNotice ? (
              <div className="flex flex-col gap-4">
                {handoffNotice}
                {descriptionSection}
              </div>
            ) : (
              descriptionSection
            )
          }
          lowerContent={
            <>
              {quickActionsSection}
              {customPropertiesSection}
              {subItemsSection}
              {sectionPolicy.showTabbedLowerSection
                ? tabbedLowerSection
                : threadLowerSection}
            </>
          }
          scrollable
        />
      </DetailPanelContainer>
      {commentConflictModal}
    </>
  );
};

export default WorkItemContent;
