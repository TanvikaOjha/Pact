"use client";

import React, {
  createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,
} from "react";
import {
  Business,Engagement,Milestone,PactState, ReputationEvent,Toast,
} from "./types";
import {
  formatDate,isoDaysFromNow,mockAddress,mockTermsHash, mockTxHash, shortId,slugify,wait,
} from "./utils";
import { WORLD_THRESHOLD } from "./templates";

const STORAGE_KEY = "pact.state.v1";

function emptyState(): PactState {
  return {
    currentBusinessId: null,
    businesses: {},
    engagements: {},
    reputationEvents: [],
    toasts: [],
  };
}

// Seed a bit of history on the counterparty side so profile pages never look
// empty and the reputation mechanic reads as real rather than staged.
function seedCounterpartyHistory(slug: string): {
  business: Business;
  events: ReputationEvent[];
} {
  const id = "biz_" + shortId(8);
  const business: Business = {
    id,
    slug,
    ensSubname: `${slug}.pact.eth`,
    walletAddress: mockAddress(),
    worldVerified: true,
    worldSessionId: "wsid_" + shortId(10),
    joinedAt: isoDaysFromNow(-140),
    completedCount: 9,
    disputeCount: 0,
    totalValue: 31400,
  };
  const templates: Array<[string, number]> = [
    ["fixed", 1800],
    ["milestone", 6200],
    ["recurring", 2400],
  ];
  const events: ReputationEvent[] = templates.map(([t, v], i) => ({
    id: "rep_" + shortId(8),
    engagementId: "hist_" + shortId(6),
    engagementEnsSubname: `eng-${shortId(5)}.pact.eth`,
    businessId: id,
    counterpartySlug: ["harbor-studio", "north-supply", "delta-labs"][i % 3],
    templateType: t as Engagement["templateType"],
    totalValue: v,
    onTime: true,
    disputed: false,
    txHash: mockTxHash(),
    emittedAt: isoDaysFromNow(-30 * (i + 1)),
  }));
  return { business, events };
}

interface StoreShape extends PactState {
  currentBusiness: Business | null;
  createBusiness: (
    slug: string,
    onStep?: (step: string) => void
  ) => Promise<Business>;
  createProposal: (
    draft: Omit<
      Engagement,
      | "id"
      | "ensSubname"
      | "termsHash"
      | "status"
      | "createdAt"
      | "partyBId"
    >
  ) => Engagement;
  getEngagement: (id: string) => Engagement | undefined;
  getBusiness: (id: string) => Business | undefined;
  getBusinessBySlug: (slug: string) => Business | undefined;
  signAsCounterparty: (
    engagementId: string,
    onStep?: (step: string) => void
  ) => Promise<void>;
  submitCompletion: (engagementId: string, milestoneIndex: number) => void;
  acceptMilestone: (
    engagementId: string,
    milestoneIndex: number,
    worldVerified?: boolean
  ) => Promise<void>;
  autoRelease: (engagementId: string, milestoneIndex: number) => Promise<void>;
  disputeMilestone: (engagementId: string, milestoneIndex: number) => void;
  resolveDispute: (engagementId: string, milestoneIndex: number) => void;
  engagementsForCurrentBusiness: Engagement[];
  reputationFor: (businessId: string) => ReputationEvent[];
  pushToast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
}

const StoreContext = createContext<StoreShape | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PactState>(emptyState());
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge over defaults so an older/partial saved shape can never
        // leave a required array/field undefined.
        setState((s) => ({ ...emptyState(), ...parsed, toasts: [] }));
      }
    } catch {
      /* ignore corrupt state */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    // Toasts are transient UI, not domain state — never persist them.
    const { toasts: _toasts, ...persisted } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [state]);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "ink") => {
    const id = "toast_" + shortId(6);
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => {
      setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }, []);

  const createBusiness = useCallback(
    async (rawSlug: string, onStep?: (step: string) => void) => {
      const slug = slugify(rawSlug);
      onStep?.("Creating your embedded wallet...");
      await wait(700);
      const walletAddress = mockAddress();

      onStep?.("Minting " + slug + ".pact.eth on ENSv2...");
      await wait(900);

      onStep?.("Running World Selfie Check...");
      await wait(1200);
      const worldSessionId = "wsid_" + shortId(10);

      const id = "biz_" + shortId(8);
      const business: Business = {
        id,
        slug,
        ensSubname: `${slug}.pact.eth`,
        walletAddress,
        worldVerified: true,
        worldSessionId,
        joinedAt: new Date().toISOString(),
        completedCount: 0,
        disputeCount: 0,
        totalValue: 0,
      };

      setState((s) => ({
        ...s,
        businesses: { ...s.businesses, [id]: business },
        currentBusinessId: id,
      }));

      onStep?.("Writing pact:world-verified text record...");
      await wait(500);

      return business;
    },
    []
  );

  const createProposal = useCallback<StoreShape["createProposal"]>((draft) => {
    const id = "eng_" + shortId(8);
    const ensSubname = `eng-${shortId(5)}.pact.eth`;
    const payload = JSON.stringify({ ...draft, id, ensSubname });
    const termsHash = mockTermsHash(payload);
    const engagement: Engagement = {
      ...draft,
      id,
      ensSubname,
      termsHash,
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({
      ...s,
      engagements: { ...s.engagements, [id]: engagement },
    }));
    return engagement;
  }, []);

  const getEngagement = useCallback(
    (id: string) => state.engagements[id],
    [state.engagements]
  );
  const getBusiness = useCallback(
    (id: string) => state.businesses[id],
    [state.businesses]
  );
  const getBusinessBySlug = useCallback(
    (slug: string) =>
      Object.values(state.businesses).find((b) => b.slug === slug),
    [state.businesses]
  );

  const updateMilestone = useCallback(
    (
      engagementId: string,
      milestoneIndex: number,
      patch: Partial<Milestone>
    ) => {
      setState((s) => {
        const eng = s.engagements[engagementId];
        if (!eng) return s;
        const milestones = eng.milestones.map((m) =>
          m.index === milestoneIndex ? { ...m, ...patch } : m
        );
        return {
          ...s,
          engagements: {
            ...s.engagements,
            [engagementId]: { ...eng, milestones },
          },
        };
      });
    },
    []
  );

  const signAsCounterparty = useCallback(
    async (engagementId: string, onStep?: (step: string) => void) => {
      const eng = state.engagements[engagementId];
      if (!eng) return;

      onStep?.(`Resolving ${eng.ensSubname} on ENS...`);
      await wait(900);

      onStep?.("Comparing terms hash to what was shown...");
      await wait(700);

      let counterparty = getBusinessBySlug(eng.partyBSlug);
      const events: ReputationEvent[] = [];
      if (!counterparty) {
        const seeded = seedCounterpartyHistory(eng.partyBSlug);
        counterparty = seeded.business;
        events.push(...seeded.events);
      }

      onStep?.(`${counterparty.ensSubname} signing with embedded wallet...`);
      await wait(800);

      onStep?.(`Funding $${eng.totalAmount.toLocaleString()} USDC to PactEscrow...`);
      await wait(1000);

      setState((s) => ({
        ...s,
        businesses: { ...s.businesses, [counterparty!.id]: counterparty! },
        reputationEvents: [...s.reputationEvents, ...events],
        engagements: {
          ...s.engagements,
          [engagementId]: {
            ...s.engagements[engagementId],
            status: "active",
            partyBId: counterparty!.id,
          },
        },
      }));

      // Fixed Delivery: the upfront 50% releases on signature itself, not
      // through a submit/accept cycle like every other milestone.
      if (eng.templateType === "fixed") {
        const upfront = eng.milestones.find((m) => m.index === 0);
        if (upfront && upfront.status === "pending") {
          updateMilestone(engagementId, 0, {
            status: "released",
            releasedAt: new Date().toISOString(),
          });
          pushToast("Upfront 50% released automatically on signature.", "stamp");
        }
      }
    },
    [state.engagements, getBusinessBySlug, updateMilestone, pushToast]
  );

  const submitCompletion = useCallback(
    (engagementId: string, milestoneIndex: number) => {
      updateMilestone(engagementId, milestoneIndex, {
        status: "submitted",
        submittedAt: new Date().toISOString(),
      });
      pushToast("Completion submitted. Counterparty has an acceptance window.", "ink");
    },
    [updateMilestone, pushToast]
  );

  const finalizeIfComplete = useCallback((engagementId: string) => {
    setState((s) => {
      const eng = s.engagements[engagementId];
      if (!eng) return s;
      const allReleased = eng.milestones.every((m) => m.status === "released");
      if (!allReleased || eng.status === "completed") return s;

      const partyA = s.businesses[eng.partyAId];
      const partyB = eng.partyBId ? s.businesses[eng.partyBId] : undefined;
      const onTime = eng.milestones.every(
        (m) => !m.releasedAt || new Date(m.releasedAt) <= new Date(m.due)
      );

      const txHash = mockTxHash();
      const disputed = !!eng.hadDispute;
      const newEvents: ReputationEvent[] = [];
      const nextBusinesses = { ...s.businesses };

      if (partyA) {
        newEvents.push({
          id: "rep_" + shortId(8),
          engagementId,
          engagementEnsSubname: eng.ensSubname,
          businessId: partyA.id,
          counterpartySlug: eng.partyBSlug,
          templateType: eng.templateType,
          totalValue: eng.totalAmount,
          onTime,
          disputed,
          txHash,
          emittedAt: new Date().toISOString(),
        });
        nextBusinesses[partyA.id] = {
          ...partyA,
          completedCount: partyA.completedCount + 1,
          totalValue: partyA.totalValue + eng.totalAmount,
        };
      }
      if (partyB) {
        newEvents.push({
          id: "rep_" + shortId(8),
          engagementId,
          engagementEnsSubname: eng.ensSubname,
          businessId: partyB.id,
          counterpartySlug: s.businesses[eng.partyAId]?.slug ?? "",
          templateType: eng.templateType,
          totalValue: eng.totalAmount,
          onTime,
          disputed,
          txHash,
          emittedAt: new Date().toISOString(),
        });
        nextBusinesses[partyB.id] = {
          ...partyB,
          completedCount: partyB.completedCount + 1,
          totalValue: partyB.totalValue + eng.totalAmount,
        };
      }

      return {
        ...s,
        businesses: nextBusinesses,
        reputationEvents: [...s.reputationEvents, ...newEvents],
        engagements: {
          ...s.engagements,
          [engagementId]: {
            ...eng,
            status: "completed",
            completedAt: new Date().toISOString(),
          },
        },
      };
    });
  }, []);

  const acceptMilestone = useCallback(
    async (
      engagementId: string,
      milestoneIndex: number,
      worldVerified?: boolean
    ) => {
      const eng = state.engagements[engagementId];
      const milestone = eng?.milestones.find((m) => m.index === milestoneIndex);
      if (!eng || !milestone) return;

      updateMilestone(engagementId, milestoneIndex, {
        status: "released",
        releasedAt: new Date().toISOString(),
        worldVerifiedAt: worldVerified ? new Date().toISOString() : undefined,
      });
      pushToast(
        eng.templateType === "split"
          ? "splitRelease() fired — one tx, two Transfer events."
          : "releaseMilestone() called directly on-chain. USDC released.",
        "stamp"
      );
      await wait(50);
      finalizeIfComplete(engagementId);
    },
    [state.engagements, updateMilestone, pushToast, finalizeIfComplete]
  );

  const autoRelease = useCallback(
    async (engagementId: string, milestoneIndex: number) => {
      pushToast("Privy session signer firing autoRelease()...", "ember");
      await wait(900);
      await acceptMilestone(engagementId, milestoneIndex);
      pushToast("Auto-released — no party action was needed.", "stamp");
    },
    [acceptMilestone, pushToast]
  );

  const disputeMilestone = useCallback(
    (engagementId: string, milestoneIndex: number) => {
      updateMilestone(engagementId, milestoneIndex, { status: "disputed" });
      setState((s) => {
        const eng = s.engagements[engagementId];
        if (!eng) return s;
        const nextBusinesses = { ...s.businesses };
        const partyA = s.businesses[eng.partyAId];
        const partyB = eng.partyBId ? s.businesses[eng.partyBId] : undefined;
        if (partyA) {
          nextBusinesses[partyA.id] = {
            ...partyA,
            disputeCount: partyA.disputeCount + 1,
          };
        }
        if (partyB) {
          nextBusinesses[partyB.id] = {
            ...partyB,
            disputeCount: partyB.disputeCount + 1,
          };
        }
        return {
          ...s,
          businesses: nextBusinesses,
          engagements: {
            ...s.engagements,
            [engagementId]: { ...eng, status: "disputed", hadDispute: true },
          },
        };
      });
      pushToast("Marked disputed. Key quorum co-signature required to resolve.", "ember");
    },
    [updateMilestone, pushToast]
  );

  const resolveDispute = useCallback(
    (engagementId: string, milestoneIndex: number) => {
      updateMilestone(engagementId, milestoneIndex, {
        status: "released",
        releasedAt: new Date().toISOString(),
      });
      setState((s) => {
        const eng = s.engagements[engagementId];
        if (!eng) return s;
        // hadDispute stays true forever — the dispute happened and is
        // permanent history, even though the engagement is active again.
        return {
          ...s,
          engagements: {
            ...s.engagements,
            [engagementId]: { ...eng, status: "active" },
          },
        };
      });
      pushToast("Both parties co-signed. Resolution executed.", "stamp");
      finalizeIfComplete(engagementId);
    },
    [updateMilestone, pushToast, finalizeIfComplete]
  );

  const currentBusiness = state.currentBusinessId
    ? state.businesses[state.currentBusinessId] ?? null
    : null;

  const engagementsForCurrentBusiness = useMemo(() => {
    if (!currentBusiness) return [];
    return Object.values(state.engagements)
      .filter(
        (e) =>
          e.partyAId === currentBusiness.id || e.partyBId === currentBusiness.id
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [state.engagements, currentBusiness]);

  const reputationFor = useCallback(
    (businessId: string) =>
      state.reputationEvents
        .filter((e) => e.businessId === businessId)
        .sort((a, b) => (a.emittedAt < b.emittedAt ? 1 : -1)),
    [state.reputationEvents]
  );

  const value: StoreShape = {
    ...state,
    currentBusiness,
    createBusiness,
    createProposal,
    getEngagement,
    getBusiness,
    getBusinessBySlug,
    signAsCounterparty,
    submitCompletion,
    acceptMilestone,
    autoRelease,
    disputeMilestone,
    resolveDispute,
    engagementsForCurrentBusiness,
    reputationFor,
    pushToast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreShape {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export { WORLD_THRESHOLD, formatDate };