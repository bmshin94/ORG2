import type { ReactNode } from "react";

import { LIST_PANEL_SECTIONS } from "@src/components/ListPanel";
import { WORKSTATION_TRAIL_SECTION_LABEL } from "@src/config/workstation/tokens";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

export function TeamInboxListSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section data-testid={testId} aria-label={title} className="mb-2 last:mb-0">
      <CollapsibleSection
        title={title}
        compact
        headerRowClassName="mb-px h-7"
        titleButtonClassName="group/section-title h-7 w-full gap-2 pl-2 hover:text-text-1"
        titleClassName={`order-first min-w-0 truncate ${WORKSTATION_TRAIL_SECTION_LABEL}`}
        chevronContainerClassName="order-last hidden shrink-0 items-center leading-none group-hover/section-title:inline-flex group-focus-visible/section-title:inline-flex"
        chevronSize={14}
        chevronStrokeWidth={2}
        chevronClassName="text-text-2"
        titleButtonTestId={`${testId}-toggle`}
      >
        <div className={LIST_PANEL_SECTIONS.sectionGroupItems}>{children}</div>
      </CollapsibleSection>
    </section>
  );
}
