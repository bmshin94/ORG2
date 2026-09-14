import React, { useCallback, useMemo, useState } from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import { useProjectOrgCloudPermissions } from "@src/features/Org2Cloud/useProjectOrgCloudPermissions";
import { PROJECT_DETAIL_SURFACE_VIEW } from "@src/store/workstation/tabs";
import type { WorkItemStatus } from "@src/types/core/workItem";

import {
  EmbeddedWorkItemDetail,
  MultiSelectBar,
  WorkItemsPageHeader,
  WorkItemsTabContent,
} from "./components";
import WorkItemsPageDialogs from "./components/WorkItemsPageDialogs";
import type { WorkItemsTableSort } from "./components/WorkItemsTableView";
import { getEffectiveWorkItemPrefix } from "./config";
import { useMultiSelect } from "./hooks/useMultiSelect";
import { useWorkItems } from "./hooks/useWorkItems";
import { useWorkItemsHeaderState } from "./hooks/useWorkItemsHeaderState";
import { useWorkItemsPageActions } from "./hooks/useWorkItemsPageActions";
import { useWorkItemsPageEffects } from "./hooks/useWorkItemsPageEffects";
import { useWorkItemsPageModel } from "./hooks/useWorkItemsPageModel";
import { useWorkItemsProjectPanes } from "./hooks/useWorkItemsProjectPanes";
import { useWorkItemsProjectSyncAdapter } from "./hooks/useWorkItemsProjectSyncAdapter";
import { useWorkItemsPropertyView } from "./hooks/useWorkItemsPropertyView";
import { useWorkItemsSavedViews } from "./hooks/useWorkItemsSavedViews";
import { useWorkItemsSurfaceControls } from "./hooks/useWorkItemsSurfaceControls";
import { useWorkItemsSync } from "./hooks/useWorkItemsSync";
import { useWorkItemsTabBarState } from "./hooks/useWorkItemsTabBarState";
import { WORK_ITEMS_DEFAULT_STATUS } from "./types";
import type { BatchQuickField } from "./workItemPartialUpdate";
import type { WorkItemsPageProps } from "./workItemsPageProps";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
} from "./workItemsViewModel";

// ============================================
// Types
// ============================================

export type { EmbeddedWorkItemDetailState } from "./hooks/useWorkItemsTabBarState";
export type { WorkItemsPageProps } from "./workItemsPageProps";

// ============================================
// Main Component
// ============================================

const WorkItemsPage: React.FC<WorkItemsPageProps> = ({
  breadcrumbSegments,
  projectId,
  projectName: tabProjectName,
  pageTitle,
  cachedProjectSlug,
  repoPath,
  projectView = PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS,
  onProjectViewChange,
  onProjectSlugResolved,
  onOpenProjects,
  onCreateProject,
  onCreateWorkItem,
  onProjectDeleted,
  onSetUnsaved,
  onProjectNameUpdated,
  onOpenRepoSettings,
  onExpandWorkItemToTab,
  onOpenChatSession,
  onEmbeddedWorkItemDetailStateChange,
  isActive = true,
  workStationTabId,
  workstationHeaderHost = "project",
  splitHeaderLeading,
}) => {
  const { canAdminister: canAdministerProjectOrg } =
    useProjectOrgCloudPermissions(isActive);
  const { state, data, projectData, handlers } = useWorkItems({
    projectId,
    cachedProjectSlug,
    initialActiveTab:
      projectView === PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
        ? "Overview"
        : "List",
    isActive,
  });
  const { handleTabChange } = handlers;
  const { statusFilter, setStatusFilter } = state;
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [listFullscreen, setListFullscreen] = useState(false);
  const [kanbanGroupBy, setKanbanGroupBy] = useState<WorkItemsKanbanGroup>(
    WORK_ITEMS_KANBAN_GROUP.STATUS
  );
  // Track work item detail pending changes
  const [hasWorkItemPendingChanges, setHasWorkItemPendingChanges] =
    useState(false);
  const [workItemPropertiesOpen, setWorkItemPropertiesOpen] = useState(true);

  const { projectName, headerTitle, sourceProject } = useWorkItemsHeaderState({
    pageTitle,
    tabProjectName,
    project: projectData.project,
    projectLoading: projectData.loading,
  });

  const {
    interactiveBreadcrumbSegments,
    savedViewPreferenceOwnerId,
    availableRepos,
    pinnedKanbanColumnIds,
    statusFilterKeys,
    resolvedRepoPath,
    resolvedProjectSlug,
    projectIdentityIcon,
    selectedShortId,
    useSplitListHeader,
    activeProjectView,
    isWorkItemsSurface,
  } = useWorkItemsPageModel({
    breadcrumbSegments,
    onOpenProjects,
    isActive,
    activeTab: state.activeTab,
    listFullscreen,
    workItems: data.workItems,
    selectedWorkItem: data.selectedWorkItem,
    getShortId: data.getShortId,
    project: projectData.project,
    rawMembers: projectData.rawMembers,
    sourceProject,
  });

  const { settingsSectionRequest } = useWorkItemsPageEffects({
    statusFilter,
    setStatusFilter,
    statusFilterKeys,
    resolvedSlug: projectData.project?.slug,
    onProjectSlugResolved,
    activeTab: state.activeTab,
    handleTabChange,
  });

  const {
    confirmWorkItemDelete,
    handleDeleteWorkItem,
    handleOpenWorkItem,
    handleCollapseAll,
    handleCloseDetail,
    handleOpenSelectedWorkItemInNewTab,
    handleProjectViewChange,
    handleHeaderTabChange,
    handleStatusFilterChange,
  } = useWorkItemsPageActions({
    handlers,
    activeTab: state.activeTab,
    workItems: data.workItems,
    selectedWorkItem: data.selectedWorkItem,
    setStatusFilter,
    setListFullscreen,
    setCollapseAllSignal,
    setHasWorkItemPendingChanges,
    onProjectViewChange,
    onExpandWorkItemToTab,
  });

  const {
    propertyOrgId,
    propertyScopeKey,
    setPropertyViewSettings,
    propertyFilterPropertyId,
    handlePropertyFilterPropertyChange,
    handlePropertyFilterChange,
    handlePropertyGroupByChange,
    propertyView,
    availablePropertyIds,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
    propertyFilteredWorkItems,
    propertyGroupedWorkItems,
    propertyKanbanTasks,
    propertyGanttTasks,
    propertyCalendarEvents,
  } = useWorkItemsPropertyView({
    project: projectData.project,
    cachedProjectSlug,
    isActive,
    filteredWorkItems: data.filteredWorkItems,
    groupedWorkItems: data.groupedWorkItems,
    kanbanTasks: data.kanbanTasks,
    ganttTasks: data.ganttTasks,
    calendarEvents: data.calendarEvents,
  });

  const {
    selectedIds,
    bulkDeleting,
    handleCheckedChange,
    handleSelectAll,
    handleUnselectAll,
    handleBulkDelete,
  } = useMultiSelect({
    filteredWorkItems: propertyFilteredWorkItems,
    onDelete: handlers.handleDelete,
    projectSlug: projectData.project?.slug,
    getShortId: data.getShortId,
    onBatchDeleteComplete: data.refresh,
    onBeforeDelete: () => confirmWorkItemDelete(),
  });

  const selectedShortIds = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => data.getShortId(id))
        .filter((shortId): shortId is string => Boolean(shortId)),
    [data, selectedIds]
  );

  const { handleDeleteProject } = useWorkItemsSync({
    project: projectData.project,
    projectName,
    rawMembers: projectData.rawMembers,
    workItemCount: data.workItems.length,
    onProjectDeleted,
  });

  const projectSyncAdapterId =
    useWorkItemsProjectSyncAdapter(resolvedProjectSlug);

  const {
    actionsInStationTabBar: tabBarActionsInStationTabBar,
    propertiesActionAvailable,
  } = useWorkItemsTabBarState({
    activeTab: state.activeTab,
    showProperties: state.showProperties,
    isActive,
    workStationTabId,
    projectId,
    projectName,
    resolvedProjectSlug,
    selectedWorkItem: data.selectedWorkItem,
    onToggleProperties: handlers.handleToggleProperties,
    onCreateWorkItem,
    onAddListItem: handlers.handleAddListItem,
    onEmbeddedWorkItemDetailStateChange,
  });

  const detailContent = (
    <EmbeddedWorkItemDetail
      workItem={data.selectedWorkItem ?? null}
      onClose={handleCloseDetail}
      onOpenInNewTab={
        onExpandWorkItemToTab ? handleOpenSelectedWorkItemInNewTab : undefined
      }
      onNavigate={handlers.handleNavigate}
      hasPrev={data.navigation.hasPrev}
      hasNext={data.navigation.hasNext}
      onUpdateWorkItem={handlers.handleUpdate}
      onDeleteWorkItem={handleDeleteWorkItem}
      availableMembers={projectData.availableMembers}
      availableProjects={projectData.availableProjects}
      availableMilestones={projectData.availableMilestones}
      availableLabels={projectData.availableLabels}
      onPendingChangesChange={setHasWorkItemPendingChanges}
      repoPath={resolvedRepoPath}
      projectSlug={resolvedProjectSlug}
      orgId={propertyOrgId}
      shortId={selectedShortId}
      onRefreshWorkItem={data.refresh}
      onOpenSession={onOpenChatSession}
      breadcrumbSegments={interactiveBreadcrumbSegments}
      breadcrumbProjectName={headerTitle}
      breadcrumbIcon={projectIdentityIcon}
      titleEditable={
        projectSyncAdapterId !== undefined &&
        projectSyncAdapterId !== STORY_SYNC_ADAPTER.GITHUB
      }
      propertiesOpen={workItemPropertiesOpen}
      onToggleProperties={() => setWorkItemPropertiesOpen((prev) => !prev)}
      publishHeaderToWorkstation={false}
      workstationHeaderHost={workstationHeaderHost}
    />
  );

  const {
    displayProject,
    handleLocalProjectUpdate,
    handleProjectNameChange,
    handleProjectDescriptionChange,
    overviewPropertiesPanel,
    settingsContent,
    resolvedProjectDescription,
  } = useWorkItemsProjectPanes({
    projectId,
    projectName,
    sourceProject,
    onProjectUpdate: handlers.handleProjectUpdate,
    hasWorkItemPendingChanges,
    onSetUnsaved,
    onProjectNameUpdated,
    projectData,
    availableRepos,
    resolvedProjectSlug,
    canAdministerProjectOrg,
    handleDeleteProject,
    onOpenRepoSettings,
    settingsSectionRequest,
  });

  const [tableColumns, setTableColumns] = useState<string[] | null>(null);
  const [tableSort, setTableSort] = useState<WorkItemsTableSort | null>(null);
  const [batchPropertyOpen, setBatchPropertyOpen] = useState(false);
  const [batchQuickField, setBatchQuickField] =
    useState<BatchQuickField | null>(null);

  const propertiesPanel = state.showProperties && overviewPropertiesPanel;

  const { savedViewsControl } = useWorkItemsSavedViews({
    state,
    isWorkItemsSurface,
    orgId: displayProject.orgId ?? "personal-org",
    resolvedProjectSlug,
    savedViewPreferenceOwnerId,
    propertyScopeKey,
    setPropertyViewSettings,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
    handleHeaderTabChange,
    kanbanGroupBy,
    setKanbanGroupBy,
    tableColumns,
    setTableColumns,
    tableSort,
    setTableSort,
  });

  const {
    projectSurfaceControls,
    workItemsSearchControl,
    workItemsEndControl,
  } = useWorkItemsSurfaceControls({
    state,
    activeProjectView,
    isWorkItemsSurface,
    useSplitListHeader,
    handleProjectViewChange,
    handleHeaderTabChange,
    kanbanGroupBy,
    setKanbanGroupBy,
    listFullscreen,
    setListFullscreen,
    propertyView,
    availablePropertyIds,
    propertyFilterPropertyId,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
    handlePropertyFilterPropertyChange,
    handlePropertyFilterChange,
    handlePropertyGroupByChange,
    availableMembers: projectData.availableMembers,
    savedViewsControl,
  });

  const addListItem = handlers.handleAddListItem;
  const handleCreateWorkItem = useCallback(() => {
    if (onCreateWorkItem) {
      onCreateWorkItem(
        projectId,
        projectName,
        resolvedProjectSlug ?? projectId
      );
      return;
    }
    void addListItem(WORK_ITEMS_DEFAULT_STATUS);
  }, [
    addListItem,
    onCreateWorkItem,
    projectId,
    projectName,
    resolvedProjectSlug,
  ]);
  const addWorkItemAction =
    state.activeTab !== "Settings" ? handleCreateWorkItem : undefined;

  const workItemsHeader = (
    <WorkItemsPageHeader
      projectName={headerTitle}
      breadcrumbSegments={interactiveBreadcrumbSegments}
      identityIcon={projectIdentityIcon}
      onOpenProjects={onOpenProjects}
      activeTab={state.activeTab}
      leadingControls={projectSurfaceControls}
      trailingControls={workItemsSearchControl}
      statusFilter={isWorkItemsSurface ? state.statusFilter : undefined}
      onStatusFilterChange={
        isWorkItemsSurface ? handleStatusFilterChange : undefined
      }
      statusCounts={data.statusCounts}
      statusFilterKeys={statusFilterKeys}
      onCollapseAll={isWorkItemsSurface ? handleCollapseAll : undefined}
      showProperties={
        propertiesActionAvailable ? state.showProperties : undefined
      }
      onToggleProperties={
        propertiesActionAvailable ? handlers.handleToggleProperties : undefined
      }
      onAddProject={
        isWorkItemsSurface && state.activeTab !== "Settings"
          ? onCreateProject
          : undefined
      }
      onAddWorkItem={addWorkItemAction}
      onRefresh={isWorkItemsSurface ? data.refresh : undefined}
      refreshLoading={data.loading}
      endControls={workItemsEndControl}
      splitListHeader={useSplitListHeader}
      splitHeaderLeading={splitHeaderLeading}
      publishToWorkstationHeader={tabBarActionsInStationTabBar && isActive}
      workstationHeaderHost={workstationHeaderHost}
    />
  );

  // The project header stays mounted while the selected work item opens in the
  // reusable right-hand detail pane.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!useSplitListHeader && workItemsHeader}

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkItemsTabContent
          statusOrgId={propertyOrgId}
          activeTab={state.activeTab}
          tableColumns={tableColumns}
          onTableColumnsChange={setTableColumns}
          tableSort={tableSort}
          onTableSortChange={setTableSort}
          tablePropertyDefinitions={propertyView.definitions}
          tablePropertyValues={propertyView.values}
          tablePropertyGroupBy={applicablePropertyGroupBy}
          onTablePropertyGroupByChange={handlePropertyGroupByChange}
          groupedWorkItems={propertyGroupedWorkItems}
          filteredWorkItems={propertyFilteredWorkItems}
          selectedWorkItem={data.selectedWorkItem ?? null}
          selectedWorkItemId={state.selectedWorkItemId}
          workItems={data.workItems}
          projectName={displayProject.name}
          projectDescription={resolvedProjectDescription}
          projectProperties={displayProject}
          hideProjectPropertiesRow={
            projectSyncAdapterId === STORY_SYNC_ADAPTER.GITHUB
          }
          repoPath={repoPath}
          availableMembers={projectData.availableMembers}
          availableTeams={projectData.availableTeams}
          projectLabels={projectData.availableLabels}
          availableRepos={availableRepos}
          availableProjects={projectData.availableProjects}
          availableMilestones={projectData.availableMilestones}
          availableLabels={projectData.availableLabels}
          overviewStats={data.overviewStats}
          checkedWorkItemIds={selectedIds}
          onCheckedChange={handleCheckedChange}
          onSelectWorkItem={handleOpenWorkItem}
          onUpdateWorkItem={handlers.handleUpdate}
          onDeleteWorkItem={handleDeleteWorkItem}
          onRestoreWorkItem={handlers.handleRestore}
          onAddListItem={(status: WorkItemStatus) =>
            handlers.handleAddListItem(status)
          }
          onProjectNameChange={handleProjectNameChange}
          onProjectDescriptionChange={handleProjectDescriptionChange}
          onProjectPropertiesChange={handleLocalProjectUpdate}
          onKanbanTaskMove={handlers.handleKanbanTaskMove}
          onKanbanTaskClick={(task) => handleOpenWorkItem(task.id)}
          onAddKanbanTask={handlers.handleAddTask}
          onGanttTaskClick={(task) => handleOpenWorkItem(task.id)}
          onGanttTaskUpdate={handlers.handleGanttTaskUpdate}
          onCalendarEventClick={(event) => handleOpenWorkItem(event.id)}
          kanbanGroupBy={kanbanGroupBy}
          pinnedKanbanColumnIds={pinnedKanbanColumnIds}
          kanbanTasks={propertyKanbanTasks}
          ganttTasks={propertyGanttTasks}
          calendarEvents={propertyCalendarEvents}
          listFullscreen={listFullscreen}
          listHeader={useSplitListHeader ? workItemsHeader : undefined}
          detailContent={detailContent}
          propertiesPanel={propertiesPanel}
          settingsContent={settingsContent}
          collapseAllSignal={collapseAllSignal}
          workItemPrefix={getEffectiveWorkItemPrefix(
            displayProject.name,
            displayProject.workItemPrefix,
            displayProject.workItemPrefixCustom
          )}
        />
      </div>

      <MultiSelectBar
        selectedCount={selectedIds.size}
        visibleItemCount={propertyFilteredWorkItems.length}
        deleting={bulkDeleting}
        onSelectAll={handleSelectAll}
        onUnselectAll={handleUnselectAll}
        onDelete={handleBulkDelete}
        onSetProperty={() => setBatchPropertyOpen(true)}
        onSetStatus={() => setBatchQuickField("status")}
        onSetPriority={() => setBatchQuickField("priority")}
        onSetAssignee={() => setBatchQuickField("assignee")}
      />
      <WorkItemsPageDialogs
        orgId={displayProject.orgId ?? "personal-org"}
        projectSlug={resolvedProjectSlug ?? null}
        shortIds={selectedShortIds}
        members={projectData.availableMembers}
        batchPropertyOpen={batchPropertyOpen}
        onCloseBatchProperty={() => setBatchPropertyOpen(false)}
        batchQuickField={batchQuickField}
        onCloseBatchQuickField={() => setBatchQuickField(null)}
        onUnselectAll={handleUnselectAll}
        refreshWorkItems={data.refresh}
        refreshPropertyView={propertyView.refresh}
        revisionConflict={data.revisionConflict}
        onUseLatestRevisionConflict={data.useLatestRevisionConflict}
        onKeepMineRevisionConflict={data.keepMineRevisionConflict}
      />
    </div>
  );
};

export default WorkItemsPage;
