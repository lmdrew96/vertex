import { redis } from "./redis";
import { allEdgesKey } from "./keys";
import { getEdge } from "./edges";
import { listNodes } from "./nodes";
import type { Edge, MeetingNode, VertexNode } from "./types";

const RECENT_MEETINGS = 5;

type Ref = { id: string; name: string };

export type RecentMeeting = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD, local calendar date
  kind?: "meeting" | "event";
  attendees: Ref[];
  group?: Ref;
};

export type Thread = {
  id: string;
  name: string;
  peopleCount: number;
  meetingCount: number;
  lastMeetingDate: string;
};

export type Dashboard = {
  nodes: VertexNode[]; // active nodes, for the meeting form's suggestions
  recentMeetings: RecentMeeting[];
  threads: Thread[];
};

const listEdges = async (userId: string): Promise<Edge[]> => {
  const ids = (await redis.smembers(allEdgesKey(userId))) as string[];
  return (await Promise.all(ids.map((id) => getEdge(userId, id)))).filter((e): e is Edge => e !== null);
};

const byName = (a: Ref, b: Ref): number => a.name.localeCompare(b.name);

/**
 * The signed-in home page: the last few meetings, and topics ("threads") that meetings were about.
 * A thread's people are anyone linked to the topic directly plus everyone who attended one of its
 * meetings, counted once each.
 */
export const getDashboard = async (userId: string): Promise<Dashboard> => {
  const [allNodes, edges] = await Promise.all([listNodes(userId), listEdges(userId)]);
  const nodes = allNodes.filter((n) => n.status === "active");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ref = (n: VertexNode): Ref => ({ id: n.id, name: n.name });

  // Only edges whose ends are both active.
  const live = edges.filter((e) => byId.has(e.from) && byId.has(e.to));

  const attendeesOf = new Map<string, VertexNode[]>();
  const groupOf = new Map<string, VertexNode>();
  for (const e of live) {
    if (e.type === "attended") {
      const list = attendeesOf.get(e.to) ?? [];
      list.push(byId.get(e.from)!);
      attendeesOf.set(e.to, list);
    } else if (e.type === "held_by" && !groupOf.has(e.from)) {
      groupOf.set(e.from, byId.get(e.to)!);
    }
  }

  const meetings = nodes
    .filter((n): n is MeetingNode => n.type === "meeting")
    .sort((a, b) => b.fields.date.localeCompare(a.fields.date) || a.name.localeCompare(b.name));

  const recentMeetings = meetings.slice(0, RECENT_MEETINGS).map((m) => {
    const group = groupOf.get(m.id);
    return {
      id: m.id,
      name: m.name,
      date: m.fields.date,
      ...(m.fields.kind ? { kind: m.fields.kind } : {}),
      attendees: (attendeesOf.get(m.id) ?? []).map(ref).sort(byName),
      ...(group ? { group: ref(group) } : {}),
    };
  });

  const threads: Thread[] = [];
  for (const topic of nodes) {
    if (topic.type !== "topic") continue;
    const people = new Set<string>();
    const topicMeetings: MeetingNode[] = [];
    for (const e of live) {
      if (e.from !== topic.id && e.to !== topic.id) continue;
      const other = byId.get(e.from === topic.id ? e.to : e.from)!;
      if (other.type === "person") people.add(other.id);
      if (other.type === "meeting" && !topicMeetings.some((m) => m.id === other.id)) topicMeetings.push(other);
    }
    if (topicMeetings.length === 0) continue;
    for (const m of topicMeetings) for (const p of attendeesOf.get(m.id) ?? []) people.add(p.id);
    threads.push({
      id: topic.id,
      name: topic.name,
      peopleCount: people.size,
      meetingCount: topicMeetings.length,
      lastMeetingDate: topicMeetings.reduce((max, m) => (m.fields.date > max ? m.fields.date : max), ""),
    });
  }
  threads.sort((a, b) => b.lastMeetingDate.localeCompare(a.lastMeetingDate) || a.name.localeCompare(b.name));

  return { nodes, recentMeetings, threads };
};
