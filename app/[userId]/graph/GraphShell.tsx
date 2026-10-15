"use client";

import { useCallback, useEffect, useState } from "react";
import type { VertexNode } from "@/lib/types";
import { getAllTagsAction, getOrphanIdsAction, searchNodesAction } from "./actions";
import { Sidebar } from "./Sidebar";
import { GraphCanvas } from "./GraphCanvas";
import { DetailPanel } from "./DetailPanel";
import { QuickCreate, type QuickTab } from "./QuickCreate";

const MOBILE_BREAKPOINT = 768;

const s = {
  shell: (mobile: boolean) => ({
    display: "flex",
    flexDirection: mobile ? ("column" as const) : ("row" as const),
    minHeight: "100vh",
    background: "var(--color-surface)",
    position: "relative" as const,
  }),
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
  },
};

type GraphShellProps = {
  userId: string;
  initialNodes: VertexNode[];
  allTags: string[];
  orphanIds: string[];
  initialNodeId: string | null;
};

export function GraphShell({ userId, initialNodes, allTags, orphanIds, initialNodeId }: GraphShellProps) {
  const [nodes, setNodes] = useState(initialNodes);
  const [tags, setTags] = useState(allTags);
  const [orphans, setOrphans] = useState(orphanIds);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodeId);
  const [quickTab, setQuickTab] = useState<QuickTab>("closed");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const refreshAll = useCallback(async () => {
    const [freshNodes, freshTags, freshOrphans] = await Promise.all([
      searchNodesAction(userId, { query: "", include_archived: false }),
      getAllTagsAction(userId),
      getOrphanIdsAction(userId),
    ]);
    setNodes(freshNodes);
    setTags(freshTags);
    setOrphans(freshOrphans);
  }, [userId]);

  const handleNodeCreated = useCallback(
    (node: VertexNode) => {
      setSelectedNodeId(node.id);
      void refreshAll();
    },
    [refreshAll],
  );

  const handleEdgeCreated = useCallback(
    (toNodeId: string) => {
      setSelectedNodeId(toNodeId);
      void refreshAll();
    },
    [refreshAll],
  );

  const handleNodeArchived = useCallback(
    (nodeId: string) => {
      setSelectedNodeId((current) => (current === nodeId ? null : current));
      void refreshAll();
    },
    [refreshAll],
  );

  return (
    <div style={s.shell(isMobile)}>
      <Sidebar
        userId={userId}
        initialNodes={nodes}
        allTags={tags}
        orphanIds={orphans}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        isMobile={isMobile}
      />
      <div style={s.main}>
        <GraphCanvas
          userId={userId}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          isMobile={isMobile}
          graphIsEmpty={nodes.length === 0}
          onLogFirstMeeting={() => setQuickTab("meeting")}
        />
        <QuickCreate
          userId={userId}
          nodes={nodes}
          tab={quickTab}
          onTabChange={setQuickTab}
          onNodeCreated={handleNodeCreated}
          onEdgeCreated={handleEdgeCreated}
        />
      </div>
      <DetailPanel
        userId={userId}
        nodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onArchived={handleNodeArchived}
        onClose={() => setSelectedNodeId(null)}
        isMobile={isMobile}
      />
    </div>
  );
}
