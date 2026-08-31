import { describe, it, expect } from "vitest";
import { extractLinkedIssueKeys } from "../release-readiness";

describe("extractLinkedIssueKeys", () => {
  it("extracts issue keys listed in a real RC-22-shaped description", () => {
    // Matches this session's real RC-22 description for Olimpo's "Contrato por Custodia" release.
    const description = `**Paquete de Paso a Producción (PAP)**
**Release**: Orvix-2026.09.02 - Chile
**Proyecto**: OLP (Orvix)

**3. Tarjetas Informadas**
Historias de Usuario: OLP-3592, OLP-3868, OLP-3591, OLP-3590, OLP-3867, OLP-3641, OLP-3751, OLP-3922, OLP-3926, OLP-3730, OLP-3705, OLP-3658, OLP-3750, OLP-3706, OLP-3846, OLP-3866, OLP-3915.
Tareas Técnicas: OLP-3660, OLP-3661, OLP-3664.
Spikes: OLP-3451.

Ver [RC-22](https://nxtaraspa.atlassian.net/browse/RC-22) y [OP-1193](https://nxtaraspa.atlassian.net/browse/OP-1193).`;

    const keys = extractLinkedIssueKeys(description);

    expect(keys).toContain("OLP-3592");
    expect(keys).toContain("OLP-3660");
    expect(keys).toContain("OLP-3451");
    expect(keys).toContain("OP-1193");
    // The epic's own key and self-references must not appear in its own linked list.
    expect(keys).not.toContain("RC-22");
  });

  it("deduplicates repeated keys", () => {
    const keys = extractLinkedIssueKeys("See OLP-100 and again OLP-100.");
    expect(keys.filter((k) => k === "OLP-100")).toHaveLength(1);
  });

  it("returns an empty array for null or empty description", () => {
    expect(extractLinkedIssueKeys(null)).toEqual([]);
    expect(extractLinkedIssueKeys("")).toEqual([]);
  });

  it("excludes the RC project's own keys (RC-*) since those are the epic itself, not linked work", () => {
    const keys = extractLinkedIssueKeys("Related to RC-21 and RC-18, implements OLP-3592.");
    expect(keys).toEqual(["OLP-3592"]);
  });
});
