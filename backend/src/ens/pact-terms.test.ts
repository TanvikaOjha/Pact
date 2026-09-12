import { describe, expect, test } from "vitest";

import {
  canonicalizeEngagementTerms,
  hashEngagementTerms,
  type EngagementTermsInput,
} from "./pact-terms.js";

/**
 * Cross-implementation vectors: produced by running the root CLI package's
 * `src/ens/pact-terms.ts` (upstream source of truth). If any of these fail,
 * the backend hash no longer matches what counterparties verify on-chain.
 */
describe("pact terms V1 parity", () => {
  test("fixed engagement without milestones", () => {
    const input: EngagementTermsInput = {
      templateType: "fixed",
      title: "Logo design",
      scope: "Deliver a logo pack",
      acceptanceCriteria: "Client approves in writing",
      totalAmount: 1200,
      acceptanceWindowHours: 48,
      milestones: [],
      fields: { "pact:type": "fixed", "pact:scope": "Deliver a logo pack" },
    };
    expect(canonicalizeEngagementTerms(input)).toBe(
      '{"version":1,"templateType":"fixed","title":"Logo design","scope":"Deliver a logo pack","acceptanceCriteria":"Client approves in writing","totalAmount":1200,"acceptanceWindowHours":48,"milestones":[],"fields":{"pact:scope":"Deliver a logo pack","pact:type":"fixed"}}',
    );
    expect(hashEngagementTerms(input)).toBe(
      "0x3ff2e681258411d5b301093ed852a3c3755551a31a6a24d1f45fe1f4cd1c0e51",
    );
  });

  test("milestone ordering, date normalization, and locale field sort", () => {
    const input: EngagementTermsInput = {
      templateType: "milestone",
      title: "Website redesign",
      scope: "Redesign marketing site",
      acceptanceCriteria: "Sign-off within 5 days",
      totalAmount: 7500,
      acceptanceWindowHours: 120,
      milestones: [
        { index: 2, name: "Visual", deliverable: "Mockups", due: "2026-11-01", amount: 3000, worldRequired: false },
        { index: 1, name: "Discovery", deliverable: "Wireframes", due: "2026-10-15T00:00:00+05:30", amount: 2000, worldRequired: true },
      ],
      fields: {
        "pact:scope": "Redesign",
        "pact:milestone-count": "2",
        Zebra: "upper-first?",
        apple: "lower",
        "pact:milestone-10": "ten",
        "pact:milestone-2": "two",
        "a-b": "hyphen",
        ab: "plain",
      },
    };
    expect(canonicalizeEngagementTerms(input)).toBe(
      '{"version":1,"templateType":"milestone","title":"Website redesign","scope":"Redesign marketing site","acceptanceCriteria":"Sign-off within 5 days","totalAmount":7500,"acceptanceWindowHours":120,"milestones":[{"index":1,"name":"Discovery","deliverable":"Wireframes","due":"2026-10-14T18:30:00.000Z","amount":2000,"worldRequired":true},{"index":2,"name":"Visual","deliverable":"Mockups","due":"2026-11-01T00:00:00.000Z","amount":3000,"worldRequired":false}],"fields":{"a-b":"hyphen","ab":"plain","apple":"lower","pact:milestone-10":"ten","pact:milestone-2":"two","pact:milestone-count":"2","pact:scope":"Redesign","Zebra":"upper-first?"}}',
    );
    expect(hashEngagementTerms(input)).toBe(
      "0xe21fc671fbe7cfee8ce96c7de5ca559727f27fb50967e45539af6d264a54957a",
    );
  });

  test("split shares append after fields only when present", () => {
    const input: EngagementTermsInput = {
      templateType: "split",
      title: "Co-delivery",
      scope: "Joint launch",
      acceptanceCriteria: "Client pays once",
      totalAmount: 10000,
      acceptanceWindowHours: 72,
      milestones: [],
      splitShareA: 60,
      splitShareB: 40,
      fields: { "pact:type": "split" },
    };
    expect(canonicalizeEngagementTerms(input)).toBe(
      '{"version":1,"templateType":"split","title":"Co-delivery","scope":"Joint launch","acceptanceCriteria":"Client pays once","totalAmount":10000,"acceptanceWindowHours":72,"milestones":[],"fields":{"pact:type":"split"},"splitShareA":60,"splitShareB":40}',
    );
    expect(hashEngagementTerms(input)).toBe(
      "0x6d3a16438f7b1f750aa4767337e876ebd4b6b453acc6f6affa3f82ed96163466",
    );
  });
});
