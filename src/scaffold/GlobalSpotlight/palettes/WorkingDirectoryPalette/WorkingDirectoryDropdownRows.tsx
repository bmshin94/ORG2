/**
 * WorkingDirectoryDropdown — row presenters.
 *
 * One row per `DropdownRepoItem` kind: a saved repo / folder / system path,
 * a multi-repo workspace, and the "open this path" action row. Each row
 * wraps itself in `SpotlightDetailPane` so hovering shows the detail pane.
 */
import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import {
  isSystemHomeRepoItem,
  isSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import type { UseDropdownListNavigationReturn } from "@src/hooks/dropdown";
import { HugeiconsIcon, Tick01Icon } from "@src/icons";
import { REPO_KIND } from "@src/store/repo";

import { SpotlightDetailPane } from "../../components/SpotlightDetailPane";
import { ICONS } from "../../config";
import type { WorkspaceSwitchEntry } from "../../hooks";
import type { RepoItem, SpotlightItem } from "../../types";

interface RepoRowProps {
  repo: RepoItem;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface OpenPathRowProps {
  item: SpotlightItem;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface WorkspaceRowProps {
  entry: WorkspaceSwitchEntry;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

export const RepoRow: React.FC<RepoRowProps> = ({
  repo,
  isCurrent,
  keyboardProps,
}) => {
  const isSystemPath = isSystemPathRepoItem(repo);
  const Icon = isSystemHomeRepoItem(repo)
    ? ICONS.home
    : isSystemPath || repo.kind === REPO_KIND.FOLDER
      ? ICONS.folder
      : ICONS.repo;

  return (
    <SpotlightDetailPane
      item={{
        id: repo.id,
        label: repo.name,
        icon: Icon,
        type: "repo",
        data: { ...repo, isCurrentSelection: isCurrent },
      }}
    >
      <Button
        layout="custom"
        appearance="custom"
        htmlType="button"
        role="menuitem"
        data-testid={`repo-dropdown-row-${repo.id}`}
        {...keyboardProps}
        className={`${DROPDOWN_CLASSES.item} ${
          isCurrent ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
        } w-full justify-start`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {isCurrent ? (
            <HugeiconsIcon
              icon={Tick01Icon}
              data-icon="check"
              size={DROPDOWN_ITEM.iconSize}
              className="text-primary-6"
            />
          ) : (
            <AnyIcon icon={Icon} size={DROPDOWN_ITEM.iconSize} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{repo.name}</span>
      </Button>
    </SpotlightDetailPane>
  );
};

export const WorkspaceRow: React.FC<WorkspaceRowProps> = ({
  entry,
  keyboardProps,
}) => {
  const { workspace, isActive } = entry;

  const row = (
    <Button
      layout="custom"
      appearance="custom"
      htmlType="button"
      role="menuitem"
      data-testid={`repo-dropdown-workspace-row-${workspace.workspaceId}`}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${
        isActive ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
      } w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isActive ? (
          <HugeiconsIcon
            icon={Tick01Icon}
            data-icon="check"
            size={DROPDOWN_ITEM.iconSize}
            className="text-primary-6"
          />
        ) : (
          <HugeiconsIcon icon={ICONS.workspace} size={DROPDOWN_ITEM.iconSize} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">
        {workspace.name}
      </span>
    </Button>
  );
  return (
    <SpotlightDetailPane
      item={{
        id: workspace.workspaceId,
        label: workspace.name,
        icon: ICONS.workspace,
        desc: entry.folderNames.join(", "),
        data: {
          isCurrentSelection: isActive,
          detailFolders: workspace.folders.map((folder, index) => ({
            name: entry.folderNames[index],
            path: folder.folderPath,
          })),
        },
      }}
    >
      {row}
    </SpotlightDetailPane>
  );
};

export const OpenPathRow: React.FC<OpenPathRowProps> = ({
  item,
  keyboardProps,
}) => {
  const Icon = typeof item.icon === "string" ? ICONS.folder : item.icon;

  return (
    <SpotlightDetailPane item={item}>
      <Button
        layout="custom"
        appearance="custom"
        htmlType="button"
        role="menuitem"
        data-testid="repo-dropdown-open-path-row"
        {...keyboardProps}
        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {Icon && <AnyIcon icon={Icon} size={DROPDOWN_ITEM.iconSize} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      </Button>
    </SpotlightDetailPane>
  );
};
