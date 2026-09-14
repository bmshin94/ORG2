/**
 * SessionInfoLine — branch actions.
 *
 * Guarded checkout on branch pick, plus the create / delete handlers the
 * Spotlight `BranchPalette` exposes. Every path reports through the shared
 * git action dialog and closes the branch selector on success.
 */
import { useCallback } from "react";

import { gitApi } from "@src/api/http/git";
import { CheckoutBlockedDialog } from "@src/components/GitDialogs/CheckoutBlockedDialog";
import { CheckoutConflictDialog } from "@src/components/GitDialogs/CheckoutConflictDialog";
import { runGuardedCheckout } from "@src/services/git/operations/guardedCheckout";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

interface UseSessionInfoBranchActionsOptions {
  repoId?: string;
  branchRepoPath: string;
  repoKind?: RepoKind;
  onBranchChange?: (branch: string) => void;
  setIsBranchSelectorOpen: (open: boolean) => void;
}

export function useSessionInfoBranchActions({
  repoId,
  branchRepoPath,
  repoKind,
  onBranchChange,
  setIsBranchSelectorOpen,
}: UseSessionInfoBranchActionsOptions) {
  const handleBranchSelect = useCallback(
    async (branch: string) => {
      if (!repoId || !branchRepoPath || repoKind === REPO_KIND.FOLDER) {
        onBranchChange?.(branch);
        setIsBranchSelectorOpen(false);
        return true;
      }

      const result = await runGuardedCheckout({
        repoId,
        repoPath: branchRepoPath,
        ref: branch,
        onConflict: (name) => CheckoutConflictDialog.open({ branchName: name }),
        onBlocked: ({ branch: name, errorType, message }) =>
          CheckoutBlockedDialog.open({
            branchName: name,
            errorType,
            message,
          }),
      });

      if (result.success) {
        onBranchChange?.(branch);
        if (result.outcome !== "checked-out" && result.message) {
          showGitActionDialogSafely(result.message, "info");
        }
        setIsBranchSelectorOpen(false);
        return true;
      }

      if (result.outcome !== "cancelled" && !result.blocked) {
        showGitActionDialogSafely(
          result.message || `Failed to checkout branch "${branch}"`,
          "error"
        );
      }
      return false;
    },
    [branchRepoPath, onBranchChange, repoId, repoKind, setIsBranchSelectorOpen]
  );

  const handleBranchPaletteSelect = useCallback(
    async (branch: string) => {
      return handleBranchSelect(branch);
    },
    [handleBranchSelect]
  );

  const handleCreateBranch = useCallback(
    async (branch: string, startPoint?: string) => {
      if (!repoId || !branchRepoPath) return;
      const result = await gitApi.gitCreateBranch({
        repo_id: repoId,
        repo_path: branchRepoPath,
        name: branch,
        start_point: startPoint ?? null,
        checkout: false,
      });
      if (!result.success) {
        showGitActionDialogSafely(
          result.error || `Failed to create branch "${branch}"`,
          "error"
        );
        return;
      }
      await handleBranchSelect(branch);
    },
    [branchRepoPath, handleBranchSelect, repoId]
  );

  const handleDeleteBranch = useCallback(
    async (
      branch: string,
      options?: { silent?: boolean; skipRefresh?: boolean }
    ) => {
      if (!repoId || !branchRepoPath) {
        const message = "No repo selected";
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      const result = await gitApi.gitDeleteBranch({
        repo_id: repoId,
        repo_path: branchRepoPath,
        branch_name: branch,
      });

      if (!result.success) {
        const message = result.error || `Failed to delete branch "${branch}"`;
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      if (!options?.silent) {
        showGitActionDialogSafely(`Branch "${branch}" deleted`, "info");
      }
      return { success: true };
    },
    [branchRepoPath, repoId]
  );

  return {
    handleBranchSelect,
    handleBranchPaletteSelect,
    handleCreateBranch,
    handleDeleteBranch,
  };
}
