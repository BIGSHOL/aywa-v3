"use client";

import { useMemo } from "react";
import { DashboardEditorLazy } from "@/app/(shell)/owner/_components/dashboard/dashboard-editor-lazy";
import type { DashboardEditorProps } from "@/app/(shell)/owner/_components/dashboard/dashboard-editor";

export type OwnerDashboardData = Omit<DashboardEditorProps, "preview"> & { viewerId: string };

export function OwnerDashboardFace({ d }: { d: OwnerDashboardData }) {
  const preview = useMemo<DashboardEditorProps["preview"]>(() =>
    fetch(`/api/v2/owner?tab=dashboard&read=dashboard_preview&viewer=${encodeURIComponent(d.viewerId)}`, { headers: { Accept: "application/json" } })
      .then(async response => {
        if (!response.ok) return null;
        const result = await response.json();
        return result.route === "read" ? result.preview ?? null : null;
      }).catch(() => null), [d.viewerId]);
  return <DashboardEditorLazy initial={d.initial} roleMenus={d.roleMenus} subjects={d.subjects} members={d.members} preview={preview} />;
}
