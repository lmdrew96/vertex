import { getAllTags, getOrphanIds, searchNodes } from "@/lib/nodes";
import { GraphShell } from "./GraphShell";

export const runtime = "edge";

type PageProps = { params: Promise<{ userId: string }> };

export default async function GraphPage({ params }: PageProps) {
  const { userId } = await params;

  const [initialNodes, allTags, orphanIds] = await Promise.all([
    searchNodes(userId, { query: "", include_archived: false }),
    getAllTags(userId),
    getOrphanIds(userId),
  ]);

  return (
    <GraphShell
      userId={userId}
      initialNodes={initialNodes}
      allTags={allTags}
      orphanIds={orphanIds}
    />
  );
}
