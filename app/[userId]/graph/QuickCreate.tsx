"use client";

import { useState } from "react";
import { EDGE_TYPES, NODE_TYPES, edgeTypesFor, type EdgeType, type NodeType, type VertexNode } from "@/lib/types";
import { createEdgeAction, createNodeAction } from "./actions";
import { MeetingForm } from "./MeetingForm";

export type QuickTab = "closed" | "meeting" | "node" | "edge";

const s = {
  bar: {
    borderTop: "1.5px solid var(--color-lavender)",
    background: "var(--color-white)",
  },
  tabRow: { display: "flex", gap: 8, padding: "10px 18px", flexWrap: "wrap" as const },
  tabBtn: (active: boolean) => ({
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 16px",
    borderRadius: 9999,
    border: `1.5px solid ${active ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: active ? "var(--color-teal-deep)" : "transparent",
    color: active ? "var(--color-white)" : "var(--color-ink)",
    cursor: "pointer",
  }),
  form: {
    padding: "0 18px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    maxWidth: 480,
  },
  input: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "9px 11px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  textarea: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "9px 11px",
    outline: "none",
    width: "100%",
    minHeight: 60,
    resize: "vertical" as const,
    boxSizing: "border-box" as const,
  },
  row: { display: "flex", gap: 10 },
  submitBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    color: "var(--color-on-light)",
    border: "none",
    borderRadius: 9999,
    padding: "10px 20px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    alignSelf: "flex-start" as const,
  },
  error: {
    fontFamily: "var(--font-body)",
    color: "var(--color-danger)",
    fontSize: 12,
    margin: 0,
  },
};

type QuickCreateProps = {
  userId: string;
  nodes: VertexNode[];
  tab: QuickTab;
  onTabChange: (tab: QuickTab) => void;
  onNodeCreated: (node: VertexNode) => void;
  onEdgeCreated: (toNodeId: string) => void;
};

export function QuickCreate({ userId, nodes, tab, onTabChange: setTab, onNodeCreated, onEdgeCreated }: QuickCreateProps) {
  const [nodeType, setNodeType] = useState<NodeType>("person");
  const [nodeName, setNodeName] = useState("");
  const [nodeDescription, setNodeDescription] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [nodeTags, setNodeTags] = useState("");
  const [nodeError, setNodeError] = useState("");

  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [edgeType, setEdgeType] = useState<EdgeType>("connects_to");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [edgeError, setEdgeError] = useState("");

  const resetNodeForm = () => {
    setNodeName("");
    setNodeDescription("");
    setMeetingDate("");
    setNodeTags("");
    setNodeError("");
  };

  const resetEdgeForm = () => {
    setFromName("");
    setToName("");
    setEvidence("");
    setNotes("");
    setEdgeError("");
  };

  const submitNode = async () => {
    if (nodeType === "meeting" ? !meetingDate : !nodeName.trim()) {
      setNodeError(nodeType === "meeting" ? "Meetings need a date." : "Name is required.");
      return;
    }
    const tags = nodeTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const base = { name: nodeName.trim(), description: nodeDescription.trim(), tags };

    try {
      const node = await createNodeAction(
        userId,
        nodeType === "meeting"
          ? { ...base, type: "meeting", fields: { date: meetingDate } }
          : { ...base, type: nodeType },
      );
      resetNodeForm();
      onNodeCreated(node);
    } catch (e) {
      setNodeError(e instanceof Error ? e.message : "Failed to create node.");
    }
  };

  // Once both ends are real nodes, only offer the edge types that fit that pair
  // (connects_to always does), so the server never has to reject the choice.
  const fromNode = nodes.find((n) => n.name.toLowerCase() === fromName.trim().toLowerCase());
  const toNode = nodes.find((n) => n.name.toLowerCase() === toName.trim().toLowerCase());
  const allowedTypes = fromNode && toNode ? edgeTypesFor(fromNode.type, toNode.type) : EDGE_TYPES;
  const chosenType = allowedTypes.includes(edgeType) ? edgeType : allowedTypes[0];

  const submitEdge = async () => {
    if (!fromNode) {
      setEdgeError(`No node named "${fromName}" — pick one from the list.`);
      return;
    }
    if (!toNode) {
      setEdgeError(`No node named "${toName}" — pick one from the list.`);
      return;
    }
    if (fromNode.id === toNode.id) {
      setEdgeError("From and To must be different nodes.");
      return;
    }

    try {
      const result = await createEdgeAction(userId, {
        from: fromNode.id,
        to: toNode.id,
        type: chosenType,
        evidence: evidence.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        setEdgeError(result.error);
        return;
      }
      resetEdgeForm();
      onEdgeCreated(result.value.to);
    } catch (e) {
      setEdgeError(e instanceof Error ? e.message : "Failed to create edge.");
    }
  };

  return (
    <div style={s.bar}>
      <div style={s.tabRow}>
        <button
          type="button"
          style={s.tabBtn(tab === "meeting")}
          onClick={() => setTab(tab === "meeting" ? "closed" : "meeting")}
        >
          + Log a meeting
        </button>
        <button
          type="button"
          style={s.tabBtn(tab === "node")}
          onClick={() => setTab(tab === "node" ? "closed" : "node")}
        >
          + New Node
        </button>
        <button
          type="button"
          style={s.tabBtn(tab === "edge")}
          onClick={() => setTab(tab === "edge" ? "closed" : "edge")}
        >
          + New Edge
        </button>
      </div>

      {tab === "meeting" && (
        <MeetingForm
          userId={userId}
          nodes={nodes}
          onLogged={(meeting) => {
            setTab("closed");
            onNodeCreated(meeting);
          }}
        />
      )}

      {tab === "node" && (
        <div style={s.form}>
          <select style={s.input} value={nodeType} onChange={(e) => setNodeType(e.target.value as NodeType)}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {nodeType === "meeting" && (
            <input
              style={s.input}
              type="date"
              aria-label="Meeting date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
            />
          )}
          <input
            style={s.input}
            placeholder={nodeType === "meeting" ? "Name (optional — defaults to the date)" : "Name"}
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
          />
          <textarea
            style={s.textarea}
            placeholder="Description (optional)"
            value={nodeDescription}
            onChange={(e) => setNodeDescription(e.target.value)}
          />
          <input
            style={s.input}
            placeholder="Tags, comma-separated (e.g. ud, mentorship)"
            value={nodeTags}
            onChange={(e) => setNodeTags(e.target.value)}
          />
          {nodeError && <p style={s.error}>{nodeError}</p>}
          <button type="button" style={s.submitBtn} onClick={submitNode}>
            Create node
          </button>
        </div>
      )}

      {tab === "edge" && (
        <div style={s.form}>
          <datalist id="quickcreate-node-names">
            {nodes.map((n) => (
              <option key={n.id} value={n.name} />
            ))}
          </datalist>
          <div style={s.row}>
            <input
              style={s.input}
              list="quickcreate-node-names"
              placeholder="From node"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
            <input
              style={s.input}
              list="quickcreate-node-names"
              placeholder="To node"
              value={toName}
              onChange={(e) => setToName(e.target.value)}
            />
          </div>
          <select
            style={s.input}
            value={chosenType}
            onChange={(e) => setEdgeType(e.target.value as EdgeType)}
            aria-label="Edge type"
          >
            {allowedTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            style={s.textarea}
            placeholder="Source (optional) — e.g. where you learned this"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <textarea
            style={s.textarea}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {edgeError && <p style={s.error}>{edgeError}</p>}
          <button type="button" style={s.submitBtn} onClick={submitEdge}>
            Create edge
          </button>
        </div>
      )}
    </div>
  );
}
