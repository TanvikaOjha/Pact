import { describe, expect, test } from "vitest";

import { verifyWorldProof, type OpaqueProof, type WorldFetch } from "./world.js";

function stubFetch<T extends OpaqueProof>(payload: T): WorldFetch {
  return async () => ({ json: async () => payload });
}

function failingFetch(): WorldFetch {
  return async () => {
    throw new Error("network down");
  };
}

function nonJsonFetch(): WorldFetch {
  return async () => ({
    json: async () => {
      throw new Error("not json");
    },
  });
}

const OPTIONS = { rpId: "rp_test", expectedAction: undefined };

describe("verifyWorldProof", () => {
  test("passes with top-level session and nullifier", async () => {
    const result = await verifyWorldProof(
      { responses: [] },
      {
        ...OPTIONS,
        fetchImpl: stubFetch({
          success: true,
          action: "pact-activate",
          session_id: "session_abc123",
          nullifier: "0xabc123",
          results: [],
        }),
      },
    );
    expect(result).toEqual({
      pass: true,
      sessionId: "session_abc123",
      nullifier: "0xabc123",
      code: null,
    });
  });

  test("extracts the nullifier from results when top-level is absent", async () => {
    const result = await verifyWorldProof(
      { responses: [] },
      {
        ...OPTIONS,
        fetchImpl: stubFetch({
          success: true,
          results: [{ identifier: "selfie", success: true, nullifier: "0xdef456" }],
        }),
      },
    );
    expect(result).toEqual({ pass: true, sessionId: null, nullifier: "0xdef456", code: null });
  });

  test("maps portal rejections to pass:false with the portal code", async () => {
    const result = await verifyWorldProof(
      { responses: [] },
      {
        ...OPTIONS,
        fetchImpl: stubFetch({ success: false, code: "invalid_proof", detail: "stale" }),
      },
    );
    expect(result).toEqual({ pass: false, sessionId: null, nullifier: null, code: "invalid_proof" });
  });

  test("rejects action mismatches and accepts matches", async () => {
    const payload = { success: true, action: "other-action", results: [] };
    const mismatch = await verifyWorldProof(
      { responses: [] },
      { rpId: "rp_test", expectedAction: "pact-activate", fetchImpl: stubFetch(payload) },
    );
    expect(mismatch).toEqual({
      pass: false,
      sessionId: null,
      nullifier: null,
      code: "action_mismatch",
    });
    const match = await verifyWorldProof(
      { responses: [] },
      { rpId: "rp_test", expectedAction: "other-action", fetchImpl: stubFetch(payload) },
    );
    expect(match.pass).toBe(true);
  });

  test("maps transport and payload failures without throwing", async () => {
    const failed = await verifyWorldProof({ responses: [] }, { ...OPTIONS, fetchImpl: failingFetch() });
    expect(failed).toEqual({
      pass: false,
      sessionId: null,
      nullifier: null,
      code: "request_failed",
    });
    const nonJson = await verifyWorldProof({ responses: [] }, { ...OPTIONS, fetchImpl: nonJsonFetch() });
    expect(nonJson.code).toBe("bad_response");
    const garbage = await verifyWorldProof(
      { responses: [] },
      { ...OPTIONS, fetchImpl: stubFetch({ hello: "world" }) },
    );
    expect(garbage).toEqual({ pass: false, sessionId: null, nullifier: null, code: "bad_response" });
  });
});
