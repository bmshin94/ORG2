import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useBrowserAddToConversationAction } from "@src/engines/ChatPanel/hooks/useBrowserAddToConversationAction";
import { useSessionCreator } from "@src/engines/SessionCore/hooks/session/useSessionCreator";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { createLogger } from "@src/hooks/logger";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import { type AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import { gitDependencyInstalledAtom } from "@src/store/platform/gitDependencyAtom";
import {
  SESSION_TARGET_KIND,
  agentIconIdAtom,
  agentNameAtom,
  cliAgentTypeAtom,
  creatorRepoChromePositionAtom,
  dispatchCategoryAtom,
  normalizeAgentOnlySessionCreatorState,
  pinnedActionsVisibleAtom,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionCreatorStateAtom,
  sessionTargetKindAtom,
} from "@src/store/session";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

import ChatPanelHumanSessionHeader from "./ChatPanelHumanSessionHeader";
import SessionCreatorChatPanelView from "./SessionCreatorChatPanelView";
import {
  buildChatPanelEditorAreaProps,
  buildChatPanelSessionInfoProps,
} from "./chatPanelViewProps";
import "./index.scss";
import type { SessionCreatorChatPanelSingleProps } from "./types";
import { useChatPanelAgentPresentation } from "./useChatPanelAgentPresentation";
import { useChatPanelBranchSync } from "./useChatPanelBranchSync";
import { useChatPanelCategoryPicker } from "./useChatPanelCategoryPicker";
import { useChatPanelCliChrome } from "./useChatPanelCliChrome";
import { useChatPanelComposerGate } from "./useChatPanelComposerGate";
import { useChatPanelDraftRestore } from "./useChatPanelDraftRestore";
import { useChatPanelHeroPresentation } from "./useChatPanelHeroPresentation";
import { useChatPanelLaunch } from "./useChatPanelLaunch";
import { useChatPanelLaunchContext } from "./useChatPanelLaunchContext";
import { useChatPanelMultiRunner } from "./useChatPanelMultiRunner";
import { useChatPanelNativeControlItems } from "./useChatPanelNativeControlItems";
import { useChatPanelWorktreeSelection } from "./useChatPanelWorktreeSelection";
import { useCliAgentConfiguration } from "./useCliAgentConfiguration";
import { useSessionCreatorChatPanelHandlers } from "./useSessionCreatorChatPanelHandlers";

export type { SessionCreatorChatPanelProps } from "./types";

const log = createLogger("ChatPanel");

// ── Component ─────────────────────────────────────────────────────────────────

const SessionCreatorChatPanelContent: React.FC<
  SessionCreatorChatPanelSingleProps
> = ({
  centerFullScreenContent = false,
  className = "",
  composerHeaderContent,
  heroFooterSlot,
  pinnedActionsContent,
  innerClassName,
  footerSlot,
  leadingActionSlot,
  headerLayout = "hero",
  spotlight = false,
  hideRepoLine = false,
  hideWorkItemAttachmentControl = false,
  includeHumanSession = true,
  initialContent,
  dropdownDirection = "down",
  multiRunnerLauncher = false,
  onExitMultiRunner,
  onOpenCliTerminal,
  onRegionNoticeChange,
  onSessionStart,
  hidePresenceButton = false,
  launchMode,
  layout = "default",
  launchpadIntent = "build",
  variant = "default",
  workItemContext,
  resolveWorkItemContext,
}) => {
  const { t } = useTranslation("sessions");
  const composerPosition = useAtomValue(creatorComposerPositionAtom);
  const browserAddToConversationNav = useBrowserAddToConversationAction();
  const { orgs } = useAgentOrgs();
  const [repoChromePosition, setRepoChromePositionPreference] = useAtom(
    creatorRepoChromePositionAtom
  );
  const [pinnedActionsVisible, setPinnedActionsVisible] = useAtom(
    pinnedActionsVisibleAtom
  );
  // Read atoms needed before useSessionCreator so we can pass derived values in.
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const isCliMode = dispatchCategory === "cli_agent";
  const isHumanMode = dispatchCategory === "human_session";
  const [humanNoteHasContent, setHumanNoteHasContent] = useState(
    Boolean(initialContent?.trim())
  );
  const cli = useCliAgentConfiguration({ cliAgentType, isCliMode });
  const {
    cliComposerEnabled,
    defaultTuiMode,
    enabledCliAgentList,
    selectedCliAgent,
    setAgentSelectionLaunchMode,
  } = cli;

  const {
    repos: reposList,
    selectedRepoId,
    selectRepo,
    currentRepo,
    currentBranch,
    branchLoading,
    loadBranchList,
    forceRefreshRepos,
  } = useRepoSelection({ autoLoad: true });
  const {
    attachedWorkItemContext,
    setAttachedWorkItemContext,
    chatPanelLaunchContext,
    handleSessionStart,
  } = useChatPanelLaunchContext({
    defaultTuiMode,
    isHumanMode,
    onSessionStart,
  });

  const nativeControlItems = useChatPanelNativeControlItems({
    isHumanMode,
    multiRunnerLauncher,
    t,
  });

  const creator = useSessionCreator({
    extraSlashItems: nativeControlItems,
    initialContent,
    launchMode,
    persistDraft: !initialContent,
    skipDraftLoading: Boolean(initialContent),
    workItemContext:
      attachedWorkItemContext ?? workItemContext ?? chatPanelLaunchContext,
    resolveWorkItemContext,
    onLaunchSuccess: handleSessionStart,
    cliAgentSupportsGui: cliComposerEnabled,
  });
  const {
    fileInputRef,
    composerInputRef,
    isLoading,
    advancedConfig,
    setAdvancedConfig,
    effectiveSource,
    repos,
    handleFileUpload,
    handleContentChange,
    handleLaunch: originalHandleLaunch,
    handleBranchChange,
    attachedImages,
    clearImages,
    editorContent,
    canLaunch,
  } = creator;

  const gitInstalled = useAtomValue(gitDependencyInstalledAtom);
  const showMissingGitAlert = gitInstalled === false;
  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentName = useAtomValue(agentNameAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);

  const worktree = useChatPanelWorktreeSelection({ effectiveSource });
  const {
    runningLocation,
    activeWorktreeSelection,
    clearWorktreeLaunchSelection,
    handleWorktreeLocationChange,
    handleWorktreeSourceSelect,
  } = worktree;

  const agentVariant = getRustAgentType(selectedAgentDefId);
  const isRustMode = dispatchCategory === "rust_agent";
  const isOSMode = isRustMode && agentVariant === "os";
  const isSDEMode = isRustMode && agentVariant === "sde";
  const isWingmanMode = isRustMode && agentVariant === "wingman";
  const isCursorIdeMode = dispatchCategory === "cursor_ide";
  const isCliTuiMode = isCliMode && !cliComposerEnabled;

  const { isCategorySelectorOpen, setIsCategorySelectorOpen, agentHeroRef } =
    useChatPanelCategoryPicker();
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);

  // ── Handlers via extracted hook ───────────────────────────────────────────

  const handlers = useSessionCreatorChatPanelHandlers({
    reposList,
    effectiveSource,
    advancedConfig,
    setAdvancedConfig,
    selectRepo,
    forceRefreshRepos,
    onRepoScopeChange: clearWorktreeLaunchSelection,
  });
  const {
    screenPickerMonitors,
    setScreenPickerMonitors,
    handleShareScreenClick,
    handleScreenPicked,
    handleCategorySelect,
  } = handlers;

  const handleAgentPickerSelect = useCallback(
    (selection: AgentSelection) => {
      if (selection.cliAgentType && selection.cliLaunchMode) {
        setAgentSelectionLaunchMode(selection.cliLaunchMode);
      }
      handleCategorySelect(selection);
    },
    [handleCategorySelect, setAgentSelectionLaunchMode]
  );

  const handleAdvancedConfigChange = useCallback(
    (config: typeof advancedConfig) => {
      setAdvancedConfig(config);
    },
    [setAdvancedConfig]
  );

  useChatPanelBranchSync({
    effectiveSource,
    selectedRepoId,
    currentRepoKind: currentRepo?.kind,
    currentBranch,
    loadBranchList,
  });

  const draft = useChatPanelDraftRestore({
    composerInputRef,
    handleContentChange,
    setHumanNoteHasContent,
  });
  const { handleContentChangeWithTracking } = draft;

  const launch = useChatPanelLaunch({
    isHumanMode,
    hasAttachedImages: attachedImages.length > 0,
    isCliTuiMode,
    composerInputRef,
    effectiveSource,
    handleContentChangeWithTracking,
    handleSessionStart,
    onOpenCliTerminal,
    selectedCliAgent,
    cliAgentType,
    chatPanelLaunchContext,
    originalHandleLaunch,
    setAttachedWorkItemContext,
    t,
  });
  const { handleLaunch, humanTitle, setHumanTitle, humanCreating } = launch;

  // ── Hero section ──────────────────────────────────────────────────────────

  const hero = useChatPanelHeroPresentation({
    effectiveSource,
    repos,
    currentRepo,
    variant,
    isOSMode,
    targetKind,
    selectedAgentOrgId,
    browserAddToConversationNav,
    t,
  });
  const {
    isFullScreenVariant,
    isOrgMembersPanelOpen,
    handleToggleOrgMembers,
    browserElementScrollNav,
  } = hero;

  const {
    allAgentDefinitions,
    compactHeaderIcon,
    heroContent,
    heroIcon,
    selectedOrg,
  } = useChatPanelAgentPresentation({
    advancedConfig,
    agentIconId,
    agentName,
    cliAgentType,
    dispatchCategory,
    isCliMode,
    isCursorIdeMode,
    isOSMode,
    isRustMode,
    onRegionNoticeChange,
    orgs,
    selectedAgentDefId,
    selectedAgentOrgId,
    targetKind,
  });

  const composerImageDataUrls = useMemo(
    () => attachedImages.map((image) => image.dataUrl),
    [attachedImages]
  );

  const multiRunner = useChatPanelMultiRunner({
    enabled: multiRunnerLauncher && !isHumanMode,
    advancedConfig,
    allAgents: allAgentDefinitions,
    cliAgents: enabledCliAgentList,
    cliAgentType,
    composerInputRef,
    dispatchCategory,
    editorContent,
    effectiveSource,
    imageDataUrls: composerImageDataUrls,
    clearImages,
    selectedAgentDefinitionId: selectedAgentDefId,
    sessionName: "",
    workItemContext:
      attachedWorkItemContext ?? workItemContext ?? chatPanelLaunchContext,
    resolveWorkItemContext,
    onWorktreeLocationChange: handleWorktreeLocationChange,
    onExit: onExitMultiRunner ?? (() => undefined),
    t,
  });

  const { composerCanLaunch, handleComposerLaunch } = useChatPanelComposerGate({
    editorContent,
    isHumanMode,
    isCliTuiMode,
    hasAttachedImages: attachedImages.length > 0,
    canLaunch,
    multiRunner,
    handleLaunch,
  });

  const { cliLaunchModeSwitch, cliVersionAlert } = useChatPanelCliChrome({
    cli,
    cliAgentType,
    isCliMode,
    isMultiRunnerActive: multiRunner.isActive,
  });

  return (
    <SessionCreatorChatPanelView
      agentHeroRef={agentHeroRef}
      browserElementScrollNav={browserElementScrollNav}
      canLaunch={isHumanMode ? humanNoteHasContent : composerCanLaunch}
      centerFullScreenContent={centerFullScreenContent}
      composerPosition={composerPosition}
      className={className}
      cliLaunchModeSwitch={cliLaunchModeSwitch}
      cliVersionAlert={cliVersionAlert}
      compactHeaderIcon={compactHeaderIcon}
      composerHeaderContent={
        isHumanMode ? (
          <ChatPanelHumanSessionHeader
            humanTitle={humanTitle}
            setHumanTitle={setHumanTitle}
            humanCreating={humanCreating}
            t={t}
          />
        ) : (
          composerHeaderContent
        )
      }
      heroFooterSlot={heroFooterSlot}
      composerInputRef={composerInputRef}
      editorAreaProps={buildChatPanelEditorAreaProps({
        creator,
        hero,
        multiRunner,
        draft,
        launch,
        handlers,
        isHumanMode,
        isOSMode,
        humanNoteHasContent,
        composerCanLaunch,
        currentRepoKind: currentRepo?.kind,
        repoChromePosition,
        handleComposerLaunch,
        handleAdvancedConfigChange,
        layout,
        hideRepoLine,
        headerLayout,
        initialContent,
        dropdownDirection,
        t,
      })}
      fileInputRef={fileInputRef}
      footerSlot={footerSlot}
      headerLayout={headerLayout}
      spotlight={spotlight}
      heroContent={heroContent}
      heroIcon={heroIcon}
      hidePresenceButton={hidePresenceButton}
      hideRepoLine={hideRepoLine}
      hideWorkItemAttachmentControl={hideWorkItemAttachmentControl}
      innerClassName={innerClassName}
      isCategorySelectorOpen={isCategorySelectorOpen}
      isCliTuiMode={isCliTuiMode}
      isFullScreenVariant={isFullScreenVariant}
      isLoading={
        isHumanMode ? humanCreating : isLoading || multiRunner.isLaunching
      }
      isLaunchpadLayout={layout === "launchpad"}
      launchpadIntent={launchpadIntent}
      isOrgMembersPanelOpen={isOrgMembersPanelOpen}
      isWingmanMode={isWingmanMode}
      leadingActionSlot={leadingActionSlot}
      multiRunnerContent={multiRunner.middleContent}
      onAttachedWorkItemContextChange={setAttachedWorkItemContext}
      onCategoryPickerOpen={() => setIsCategorySelectorOpen(true)}
      onFileUpload={handleFileUpload}
      onLaunch={handleComposerLaunch}
      onPinnedActionsVisibleChange={setPinnedActionsVisible}
      onRepoChromePositionChange={setRepoChromePositionPreference}
      onShareScreen={() => handleShareScreenClick().catch(log.error)}
      onToggleOrgMembers={handleToggleOrgMembers}
      pinnedActionsContent={isHumanMode ? undefined : pinnedActionsContent}
      pinnedActionsVisible={pinnedActionsVisible}
      repoChromePosition={repoChromePosition}
      orgMembersPanelProps={
        selectedOrg
          ? {
              org: selectedOrg,
              advancedConfig,
              onAdvancedConfigChange: handleAdvancedConfigChange,
              allAgents: allAgentDefinitions,
              cliAgents: enabledCliAgentList,
            }
          : undefined
      }
      categoryPickerProps={{
        includeHumanSession,
        modelPickerStyle,
        onClose: () => setIsCategorySelectorOpen(false),
        onSelect: handleAgentPickerSelect,
        currentCategory: dispatchCategory,
        currentAgentDefinitionId: selectedAgentDefId ?? undefined,
        currentAgentOrgId: selectedAgentOrgId ?? undefined,
        currentCliAgentType: cliAgentType ?? undefined,
        anchorRef: agentHeroRef,
      }}
      screenPickerProps={
        screenPickerMonitors
          ? {
              monitors: screenPickerMonitors,
              onSelect: handleScreenPicked,
              onClose: () => setScreenPickerMonitors(null),
            }
          : undefined
      }
      sessionInfoProps={buildChatPanelSessionInfoProps({
        hero,
        handlers,
        worktree: {
          runningLocation,
          activeWorktreeSelection,
          handleWorktreeSourceSelect,
        },
        multiRunner,
        handleBranchChange,
        isOSMode,
        isSDEMode,
        branchLoading,
      })}
      showMissingGitAlert={!isHumanMode && showMissingGitAlert}
      hideSessionSetupControls={isHumanMode}
      workItemContext={attachedWorkItemContext}
    />
  );
};

const SessionCreatorChatPanelSingle: React.FC<
  SessionCreatorChatPanelSingleProps
> = (props) => {
  const creatorState = useAtomValue(sessionCreatorStateAtom);
  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const shouldResetHumanSelection =
    props.includeHumanSession === false &&
    (creatorState.dispatchCategory === "human_session" ||
      creatorState.targetKind === SESSION_TARGET_KIND.HUMAN);

  useLayoutEffect(() => {
    if (!shouldResetHumanSelection) return;
    setCreatorState((previous) =>
      normalizeAgentOnlySessionCreatorState(previous)
    );
  }, [setCreatorState, shouldResetHumanSelection]);

  if (shouldResetHumanSelection) return null;

  return <SessionCreatorChatPanelContent {...props} />;
};

SessionCreatorChatPanelSingle.displayName = "SessionCreatorChatPanelSingle";

export default SessionCreatorChatPanelSingle;
