import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

const api = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  response: {} as Record<string, unknown>,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  class Anthropic {
    static APIError = APIError;
    messages = {
      create: async (params: Record<string, unknown>) => {
        api.calls.push(params);
        return api.response;
      },
    };
  }
  return { default: Anthropic };
});

import { docxText, EXTRACTION_MODEL, extractFileText } from "./extract";

beforeEach(() => {
  api.calls.length = 0;
  api.response = { stop_reason: "end_turn", content: [{ type: "text", text: "Call Dana re: survey\n[Non-text content: none]" }] };
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

// Minimal one-page PDF; `text` null makes a page with no text layer (like a scan).
const makePdf = (text: string | null): Uint8Array => {
  const stream = text ? `BT /F1 24 Tf 72 720 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
};

const makeDocx = (bodyXml: string): Uint8Array =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });

describe("plain text and markdown", () => {
  it("returns the file as-is", async () => {
    const md = "# PSAC\n\n- alum survey";
    expect(await extractFileText(strToU8(md), "text/markdown")).toBe(md);
  });
});

describe("docxText", () => {
  it("turns paragraphs into lines and decodes entities", () => {
    const bytes = makeDocx(
      "<w:p><w:r><w:t>Agenda &amp; notes</w:t></w:r></w:p><w:p><w:r><w:t>1.</w:t><w:tab/><w:t>Mentorship</w:t></w:r></w:p>",
    );
    expect(docxText(bytes)).toBe("Agenda & notes\n1.\tMentorship");
  });

  it("fails clearly on a zip that isn't a Word document", () => {
    expect(() => docxText(zipSync({ "a.txt": strToU8("x") }))).toThrow(/word\/document.xml/);
  });
});

describe("PDF", () => {
  it("reads the text layer without calling the model", async () => {
    const text = await extractFileText(makePdf("Mentorship pilot notes"), "application/pdf");
    expect(text).toContain("Mentorship pilot notes");
    expect(api.calls).toHaveLength(0);
  });

  it("sends a scan (no text layer) to the model as a document", async () => {
    const text = await extractFileText(makePdf(null), "application/pdf");
    expect(text).toContain("Call Dana");
    const content = (api.calls[0].messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content[0].type).toBe("document");
  });
});

describe("images", () => {
  it("makes one transcription call with the configured model", async () => {
    const text = await extractFileText(new Uint8Array([1, 2, 3]), "image/png");
    expect(text).toBe("Call Dana re: survey\n[Non-text content: none]");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ model: EXTRACTION_MODEL, output_config: { effort: "low" } });
    const content = (api.calls[0].messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]
      .content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } });
    expect(content[1].text).toMatch(/exactly as written, including handwriting/);
  });

  it("reports a refusal instead of storing it as text", async () => {
    api.response = { stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] };
    await expect(extractFileText(new Uint8Array([1]), "image/jpeg")).rejects.toThrow(/declined.*cyber/);
  });

  it("fails clearly without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(extractFileText(new Uint8Array([1]), "image/webp")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
