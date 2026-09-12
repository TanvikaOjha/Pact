"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toaster";
import {
  TEMPLATES,
  CUSTOM_TEMPLATE,
  WORLD_THRESHOLD,
  DEFAULT_WINDOW_HOURS,
} from "@/lib/templates";
import type { TemplateType } from "@/lib/types";
import {
  formatUSDC,
  isoDaysFromNow,
  slugify,
  saveProposalSnapshot,
  type LocalMilestone,
} from "@/lib/utils";
import { ApiError, type ProposalMilestoneInput } from "@/lib/api";
import TerminalBlock from "@/components/TerminalBlock";

type Stage = "form" | "preview";

interface FormMilestone {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
}

function emptyMilestone(index: number, name = ""): FormMilestone {
  return { index, name, deliverable: "", due: isoDaysFromNow(21).slice(0, 10), amount: 0 };
}

function toLocalMilestone(m: FormMilestone, worldRequired: boolean): LocalMilestone {
  return {
    index: m.index,
    name: m.name,
    deliverable: m.deliverable,
    due: new Date(m.due).toISOString(),
    amount: Number(m.amount) || 0,
    worldRequired,
    submittedAt: null,
    releasedAt: null,
    disputed: false,
    late: false,
    evidenceHash: null,
  };
}

function toApiMilestone(m: LocalMilestone): ProposalMilestoneInput {
  return {
    index: m.index,
    name: m.name,
    deliverable: m.deliverable,
    due: m.due,
    amount: m.amount,
    worldRequired: m.worldRequired,
  };
}

/** Custom builder maps to the nearest template — shipped backend behavior. */
function customTemplateIndex(paymentStructure: string): number {
  if (paymentStructure === "By milestone") return 2;
  if (paymentStructure === "By time") return 4;
  if (paymentStructure === "Recurring") return 5;
  return 1;
}

type InputEvent =
  | ChangeEvent<HTMLInputElement>
  | ChangeEvent<HTMLTextAreaElement>
  | ChangeEvent<HTMLSelectElement>;

export default function TemplateFormPage() {
  const params = useParams();
  const type = params.type as TemplateType;
  const router = useRouter();
  const { api, walletAddress } = useAuth();
  const { pushToast } = useToast();

  const meta =
    type === "custom" ? CUSTOM_TEMPLATE : TEMPLATES.find((t) => t.id === type);

  const [stage, setStage] = useState<Stage>("form");
  const [counterpartySlug, setCounterpartySlug] = useState("");
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS);
  const [sending, setSending] = useState(false);

  const [fixedDeliverable, setFixedDeliverable] = useState("");
  const [fixedDeadline, setFixedDeadline] = useState(isoDaysFromNow(30).slice(0, 10));
  const [fixedAcceptance, setFixedAcceptance] = useState("");
  const [fixedAmount, setFixedAmount] = useState(4000);

  const [msProject, setMsProject] = useState("");
  const [msAcceptance, setMsAcceptance] = useState("");
  const [msRows, setMsRows] = useState<FormMilestone[]>([
    emptyMilestone(0, "Discovery"),
    emptyMilestone(1, "Delivery"),
  ]);

  const [retFee, setRetFee] = useState(2000);
  const [retCapacity, setRetCapacity] = useState("");
  const [retRollover, setRetRollover] = useState<"yes" | "no">("no");
  const [retDuration, setRetDuration] = useState(6);

  const [tmRate, setTmRate] = useState(120);
  const [tmUnit, setTmUnit] = useState<"hour" | "day">("hour");
  const [tmEstHours, setTmEstHours] = useState(80);
  const [tmCeiling, setTmCeiling] = useState(9600);
  const [tmCadence, setTmCadence] = useState<"weekly" | "biweekly" | "monthly">("biweekly");

  const [rcDeliverable, setRcDeliverable] = useState("");
  const [rcPeriod, setRcPeriod] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [rcPerPeriod, setRcPerPeriod] = useState(800);
  const [rcPeriods, setRcPeriods] = useState(6);

  const [spScope, setSpScope] = useState("");
  const [spClientEns, setSpClientEns] = useState("");
  const [spShareA, setSpShareA] = useState(60);
  const [spTotal, setSpTotal] = useState(10000);
  const [spDue, setSpDue] = useState(isoDaysFromNow(30).slice(0, 10));

  const [cQ1, setCQ1] = useState("Service");
  const [cQ2, setCQ2] = useState("On completion");
  const [cQ3, setCQ3] = useState("");
  const [cQ4, setCQ4] = useState("");
  const [cQ5, setCQ5] = useState(4000);
  const [cPhases, setCPhases] = useState(3);
  const [cWorld, setCWorld] = useState<"yes" | "no">("no");

  function updateRow(i: number, patch: Partial<FormMilestone>) {
    setMsRows((rows) => rows.map((r) => (r.index === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    if (msRows.length >= 5) return;
    setMsRows((rows) => [...rows, emptyMilestone(rows.length)]);
  }
  function removeRow(i: number) {
    if (msRows.length <= 2) return;
    setMsRows((rows) =>
      rows.filter((r) => r.index !== i).map((r, idx) => ({ ...r, index: idx }))
    );
  }

  const draft = useMemo(() => {
    let title = "";
    let scope = "";
    let acceptance = "";
    let milestones: LocalMilestone[] = [];
    let total = 0;
    let fields: Record<string, string> = {};
    let splitShareA: number | undefined;
    let splitShareB: number | undefined;
    let templateIndex = meta?.index ?? 1;

    if (type === "fixed") {
      total = Number(fixedAmount) || 0;
      title = fixedDeliverable || "Fixed delivery";
      scope = fixedDeliverable;
      acceptance = fixedAcceptance;
      milestones = [
        toLocalMilestone(
          { index: 0, name: "Upfront (50%)", deliverable: "Released on mutual signature", due: new Date().toISOString(), amount: total * 0.5 },
          false,
        ),
        toLocalMilestone(
          { index: 1, name: "Delivery (50%)", deliverable: fixedDeliverable, due: fixedDeadline, amount: total * 0.5 },
          total * 0.5 >= WORLD_THRESHOLD,
        ),
      ];
      fields = {
        "pact:type": "fixed",
        "pact:scope": fixedDeliverable,
        "pact:deadline": fixedDeadline,
        "pact:acceptance": fixedAcceptance,
        "pact:amount": String(total),
      };
    } else if (type === "milestone") {
      title = msProject || "Milestone engagement";
      scope = msProject;
      acceptance = msAcceptance;
      milestones = msRows.map((r) =>
        toLocalMilestone(r, (Number(r.amount) || 0) >= WORLD_THRESHOLD)
      );
      total = milestones.reduce((s, m) => s + m.amount, 0);
      fields = {
        "pact:type": "milestone",
        "pact:milestone-count": String(msRows.length),
        ...Object.fromEntries(
          milestones.map((m, i) => [
            `pact:milestone-${i + 1}`,
            `${m.name} / ${m.due.slice(0, 10)} / ${formatUSDC(m.amount)}`,
          ])
        ),
        "pact:acceptance": msAcceptance,
      };
    } else if (type === "retainer") {
      title = "Retainer — " + (retCapacity || "reserved capacity");
      scope = retCapacity;
      acceptance = "Capacity reserved for the period; " + (retRollover === "yes" ? "unused hours roll over." : "unused hours expire.");
      milestones = Array.from({ length: retDuration }, (_, i) =>
        toLocalMilestone(
          { index: i, name: `Month ${i + 1}`, deliverable: retCapacity, due: isoDaysFromNow(30 * (i + 1)), amount: Number(retFee) || 0 },
          false,
        )
      );
      total = (Number(retFee) || 0) * retDuration;
      fields = {
        "pact:type": "retainer",
        "pact:monthly": String(retFee),
        "pact:capacity": retCapacity,
        "pact:rollover": retRollover,
        "pact:duration": String(retDuration),
      };
    } else if (type === "t-and-m") {
      title = "Time & Materials";
      scope = `${tmRate} USDC / ${tmUnit}, est. ${tmEstHours} ${tmUnit}s`;
      acceptance = "48h window per billing period; auto-releases if not disputed.";
      const periods = 4;
      milestones = Array.from({ length: periods }, (_, i) =>
        toLocalMilestone(
          { index: i, name: `Billing period ${i + 1}`, deliverable: "Time log for the period", due: isoDaysFromNow((i + 1) * (tmCadence === "weekly" ? 7 : tmCadence === "biweekly" ? 14 : 30)), amount: (Number(tmCeiling) || 0) / periods },
          false,
        )
      );
      total = Number(tmCeiling) || 0;
      fields = {
        "pact:type": "t-and-m",
        "pact:rate": `${tmRate}/${tmUnit}`,
        "pact:ceiling": String(tmCeiling),
        "pact:cadence": tmCadence,
      };
    } else if (type === "recurring") {
      title = "Recurring — " + (rcDeliverable || "delivery");
      scope = rcDeliverable;
      acceptance = "48h acceptance window per period; auto-releases if not disputed.";
      const rows = Math.min(rcPeriods, 24);
      milestones = Array.from({ length: rows }, (_, i) =>
        toLocalMilestone(
          { index: i, name: `Delivery period ${i + 1}`, deliverable: rcDeliverable, due: isoDaysFromNow((i + 1) * (rcPeriod === "weekly" ? 7 : rcPeriod === "monthly" ? 30 : 90)), amount: Number(rcPerPeriod) || 0 },
          false,
        )
      );
      total = (Number(rcPerPeriod) || 0) * rows;
      fields = {
        "pact:type": "recurring",
        "pact:deliverable": rcDeliverable,
        "pact:period": rcPeriod,
        "pact:per-period": String(rcPerPeriod),
        "pact:periods": String(rcPeriods),
      };
    } else if (type === "split") {
      title = "Split — " + (spScope || "joint delivery");
      scope = spScope;
      acceptance = "Client accepts joint delivery; split fires atomically.";
      total = Number(spTotal) || 0;
      splitShareA = spShareA * 100;
      splitShareB = (100 - spShareA) * 100;
      milestones = [
        toLocalMilestone(
          { index: 0, name: "Joint delivery", deliverable: spScope, due: spDue, amount: total },
          total >= WORLD_THRESHOLD,
        ),
      ];
      fields = {
        "pact:type": "split",
        "pact:joint-scope": spScope,
        "pact:party-a": `${spShareA}%`,
        "pact:party-b": `${100 - spShareA}%`,
        "pact:total": String(total),
        "pact:client": spClientEns,
      };
    } else {
      templateIndex = customTemplateIndex(cQ2);
      title = cQ3 ? cQ3.slice(0, 48) : "Custom engagement";
      scope = cQ3;
      acceptance = cQ4;
      total = Number(cQ5) || 0;
      if (cQ2 === "By milestone") {
        const per = total / Math.max(cPhases, 1);
        milestones = Array.from({ length: cPhases }, (_, i) =>
          toLocalMilestone(
            { index: i, name: `Phase ${i + 1}`, deliverable: cQ3, due: isoDaysFromNow((i + 1) * 14), amount: per },
            cWorld === "yes",
          )
        );
      } else if (cQ2 === "By time" || cQ2 === "Recurring") {
        const periods = 4;
        const per = total / periods;
        milestones = Array.from({ length: periods }, (_, i) =>
          toLocalMilestone(
            { index: i, name: `Period ${i + 1}`, deliverable: cQ3, due: isoDaysFromNow((i + 1) * 14), amount: per },
            cWorld === "yes",
          )
        );
      } else {
        milestones = [
          toLocalMilestone(
            { index: 0, name: "Delivery", deliverable: cQ3, due: isoDaysFromNow(21), amount: total },
            cWorld === "yes" || total >= WORLD_THRESHOLD,
          ),
        ];
      }
      fields = {
        "pact:type": "custom",
        "pact:work-kind": cQ1,
        "pact:payment-structure": cQ2,
        "pact:scope": cQ3,
        "pact:acceptance": cQ4,
        "pact:amount": String(total),
      };
    }

    return { title, scope, acceptance, milestones, total, fields, splitShareA, splitShareB, templateIndex };
  }, [
    type, meta,
    fixedDeliverable, fixedDeadline, fixedAcceptance, fixedAmount,
    msProject, msAcceptance, msRows,
    retFee, retCapacity, retRollover, retDuration,
    tmRate, tmUnit, tmEstHours, tmCeiling, tmCadence,
    rcDeliverable, rcPeriod, rcPerPeriod, rcPeriods,
    spScope, spClientEns, spShareA, spTotal, spDue,
    cQ1, cQ2, cQ3, cQ4, cQ5, cPhases, cWorld,
  ]);

  if (!walletAddress) {
    return (
      <div className="py-16">
        <p className="text-ink-body">You need an identity first.</p>
        <button onClick={() => router.push("/identity")} className="btn-primary mt-4">
          Set up identity
        </button>
      </div>
    );
  }

  if (!meta) return <div className="py-16 text-ink-body">Unknown template.</div>;

  const canPreview =
    draft.total > 0 && draft.scope.trim().length > 0;

  async function sendProposal() {
    if (!walletAddress) return;
    setSending(true);
    try {
      const res = await api.createProposal({
        templateType: draft.templateIndex,
        title: draft.title,
        scope: draft.scope,
        acceptanceCriteria: draft.acceptance,
        totalAmount: draft.total,
        acceptanceWindowHours: windowHours,
        milestones: draft.milestones.map(toApiMilestone),
        fields: {
          ...draft.fields,
          "pact:party-b": `${slugify(counterpartySlug || "counterparty")}.pact.eth`,
        },
        splitShareA: draft.splitShareA,
        splitShareB: draft.splitShareB,
      });
      saveProposalSnapshot({
        token: res.token,
        title: draft.title,
        scope: draft.scope,
        acceptanceCriteria: draft.acceptance,
        totalAmount: draft.total,
        termsHash: res.termsHash,
        templateType: draft.templateIndex,
        templateName: meta?.name ?? type,
        counterparty: slugify(counterpartySlug || "counterparty"),
        proposerWallet: walletAddress,
        visibility: "public",
        milestones: draft.milestones,
      });
      pushToast("Proposal created — link ready to share.", "accent");
      router.push(`/proposal/${res.token}`);
    } catch (err) {
      pushToast(
        err instanceof ApiError ? `Proposal failed (${err.code ?? err.status}).` : "Proposal failed.",
        "danger",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="py-14 max-w-3xl">
      <p className="mono-tag text-accent mb-2">Template {meta.index}</p>
      <h1 className="text-3xl font-medium tracking-[-0.8px] mb-8 text-ink">{meta.name}</h1>

      {stage === "form" && (
        <div className="space-y-8">
          <TemplateFields
            type={type}
            state={{
              fixedDeliverable, setFixedDeliverable,
              fixedDeadline, setFixedDeadline,
              fixedAcceptance, setFixedAcceptance,
              fixedAmount, setFixedAmount,
              msProject, setMsProject,
              msAcceptance, setMsAcceptance,
              msRows, updateRow, addRow, removeRow,
              retFee, setRetFee,
              retCapacity, setRetCapacity,
              retRollover, setRetRollover,
              retDuration, setRetDuration,
              tmRate, setTmRate,
              tmUnit, setTmUnit,
              tmEstHours, setTmEstHours,
              tmCeiling, setTmCeiling,
              tmCadence, setTmCadence,
              rcDeliverable, setRcDeliverable,
              rcPeriod, setRcPeriod,
              rcPerPeriod, setRcPerPeriod,
              rcPeriods, setRcPeriods,
              spScope, setSpScope,
              spClientEns, setSpClientEns,
              spShareA, setSpShareA,
              spTotal, setSpTotal,
              spDue, setSpDue,
              cQ1, setCQ1,
              cQ2, setCQ2,
              cQ3, setCQ3,
              cQ4, setCQ4,
              cQ5, setCQ5,
              cPhases, setCPhases,
              cWorld, setCWorld,
            }}
          />

          <div className="border-t border-line pt-6">
            <label className="block text-sm mb-2 text-ink-body">Counterparty ENS slug</label>
            <input
              className="field-input"
              placeholder="e.g. north-supply"
              value={counterpartySlug}
              onChange={(e) => setCounterpartySlug(e.target.value)}
            />
            <p className="mono-tag text-accent mt-2">
              {slugify(counterpartySlug || "counterparty")}.pact.eth
            </p>
          </div>

          {(type === "fixed" || type === "milestone" || type === "split") && (
            <div>
              <label className="block text-sm mb-2 text-ink-body">Acceptance window before auto-release fallback</label>
              <select
                className="field-input"
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
              >
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
                <option value={168}>7 days</option>
              </select>
            </div>
          )}

          <div className="flex justify-between items-center pt-4">
            <p className="text-sm text-ink-mute">
              Total: <span className="font-mono text-ink">{formatUSDC(draft.total)} USDC</span>
            </p>
            <button
              disabled={!canPreview}
              onClick={() => setStage("preview")}
              className="btn-primary"
            >
              Preview terms →
            </button>
          </div>
        </div>
      )}

      {stage === "preview" && (
        <div className="space-y-6">
          <p className="text-sm text-ink-body">
            These are the exact terms going on-chain. Both parties can verify
            them at any time by resolving the ENS name.
          </p>
          <TerminalBlock
            records={Object.entries({
              ...draft.fields,
              "pact:party-b": `${slugify(counterpartySlug || "counterparty")}.pact.eth (set when they sign)`,
              "pact:status": "proposed",
            })}
          />
          <div className="flex justify-between items-center">
            <button onClick={() => setStage("form")} className="btn-ghost">
              ← Edit
            </button>
            <button onClick={() => void sendProposal()} disabled={sending} className="btn-primary">
              {sending ? "Sending..." : "Send proposal →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

interface FormState {
  fixedDeliverable: string; setFixedDeliverable: (v: string) => void;
  fixedDeadline: string; setFixedDeadline: (v: string) => void;
  fixedAcceptance: string; setFixedAcceptance: (v: string) => void;
  fixedAmount: number; setFixedAmount: (v: number) => void;
  msProject: string; setMsProject: (v: string) => void;
  msAcceptance: string; setMsAcceptance: (v: string) => void;
  msRows: FormMilestone[];
  updateRow: (i: number, patch: Partial<FormMilestone>) => void;
  addRow: () => void; removeRow: (i: number) => void;
  retFee: number; setRetFee: (v: number) => void;
  retCapacity: string; setRetCapacity: (v: string) => void;
  retRollover: "yes" | "no"; setRetRollover: (v: "yes" | "no") => void;
  retDuration: number; setRetDuration: (v: number) => void;
  tmRate: number; setTmRate: (v: number) => void;
  tmUnit: "hour" | "day"; setTmUnit: (v: "hour" | "day") => void;
  tmEstHours: number; setTmEstHours: (v: number) => void;
  tmCeiling: number; setTmCeiling: (v: number) => void;
  tmCadence: "weekly" | "biweekly" | "monthly"; setTmCadence: (v: "weekly" | "biweekly" | "monthly") => void;
  rcDeliverable: string; setRcDeliverable: (v: string) => void;
  rcPeriod: "weekly" | "monthly" | "quarterly"; setRcPeriod: (v: "weekly" | "monthly" | "quarterly") => void;
  rcPerPeriod: number; setRcPerPeriod: (v: number) => void;
  rcPeriods: number; setRcPeriods: (v: number) => void;
  spScope: string; setSpScope: (v: string) => void;
  spClientEns: string; setSpClientEns: (v: string) => void;
  spShareA: number; setSpShareA: (v: number) => void;
  spTotal: number; setSpTotal: (v: number) => void;
  spDue: string; setSpDue: (v: string) => void;
  cQ1: string; setCQ1: (v: string) => void;
  cQ2: string; setCQ2: (v: string) => void;
  cQ3: string; setCQ3: (v: string) => void;
  cQ4: string; setCQ4: (v: string) => void;
  cQ5: number; setCQ5: (v: number) => void;
  cPhases: number; setCPhases: (v: number) => void;
  cWorld: "yes" | "no"; setCWorld: (v: "yes" | "no") => void;
}

function TemplateFields({ type, state }: { type: TemplateType; state: FormState }) {
  const num = (fn: (v: number) => void) => (e: InputEvent) =>
    fn(Number((e.target as HTMLInputElement).value));
  const str = (fn: (v: string) => void) => (e: InputEvent) =>
    fn((e.target as HTMLInputElement).value);

  if (type === "fixed") {
    return (
      <div className="space-y-5">
        <Field label="What are you delivering?">
          <textarea
            className="field-input"
            maxLength={500}
            rows={3}
            value={state.fixedDeliverable}
            onChange={str(state.setFixedDeliverable)}
            placeholder="Full brand identity: logo, type system, color, guidelines PDF"
          />
        </Field>
        <Field label="When is it due?">
          <input
            type="date"
            className="field-input"
            value={state.fixedDeadline}
            onChange={str(state.setFixedDeadline)}
          />
        </Field>
        <Field label="How do both parties know it's done?">
          <textarea
            className="field-input"
            maxLength={300}
            rows={2}
            value={state.fixedAcceptance}
            onChange={str(state.setFixedAcceptance)}
            placeholder="Client approves final files in writing within 5 business days"
          />
        </Field>
        <Field label="Total USDC amount">
          <input
            type="number"
            className="field-input"
            value={state.fixedAmount}
            onChange={num(state.setFixedAmount)}
          />
        </Field>
        <p className="text-xs text-ink-mute">50% escrows on signature, 50% releases on delivery acceptance.</p>
      </div>
    );
  }

  if (type === "milestone") {
    return (
      <div className="space-y-5">
        <Field label="Project name">
          <input
            className="field-input"
            value={state.msProject}
            onChange={str(state.setMsProject)}
            placeholder="Website redesign"
          />
        </Field>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-ink-body">Milestones ({state.msRows.length}/5)</label>
            <button type="button" onClick={state.addRow} className="text-xs text-accent">
              + Add milestone
            </button>
          </div>
          <div className="space-y-3">
            {state.msRows.map((m) => (
              <div key={m.index} className="grid grid-cols-12 gap-2 items-start">
                <input
                  className="field-input col-span-4"
                  placeholder="Milestone name"
                  value={m.name}
                  onChange={(e) => state.updateRow(m.index, { name: e.target.value })}
                />
                <input
                  className="field-input col-span-3"
                  placeholder="Deliverable"
                  value={m.deliverable}
                  onChange={(e) => state.updateRow(m.index, { deliverable: e.target.value })}
                />
                <input
                  type="date"
                  className="field-input col-span-2"
                  value={m.due.slice(0, 10)}
                  onChange={(e) => state.updateRow(m.index, { due: e.target.value })}
                />
                <input
                  type="number"
                  className="field-input col-span-2"
                  placeholder="USDC"
                  value={m.amount}
                  onChange={(e) => state.updateRow(m.index, { amount: Number(e.target.value) })}
                />
                <button
                  type="button"
                  onClick={() => state.removeRow(m.index)}
                  className="col-span-1 text-ink-mute text-sm hover:text-danger"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
        <Field label="Acceptance criteria (shared across milestones)">
          <textarea
            className="field-input"
            rows={2}
            value={state.msAcceptance}
            onChange={str(state.setMsAcceptance)}
            placeholder="Client reviews and signs off within 5 days of delivery"
          />
        </Field>
        <p className="text-xs text-ink-mute">
          Milestones at or above {formatUSDC(WORLD_THRESHOLD)} require a World selfie at acceptance.
        </p>
      </div>
    );
  }

  if (type === "retainer") {
    return (
      <div className="space-y-5">
        <Field label="Monthly USDC fee">
          <input
            type="number"
            className="field-input"
            value={state.retFee}
            onChange={num(state.setRetFee)}
          />
        </Field>
        <Field label="What capacity is reserved?">
          <input
            className="field-input"
            value={state.retCapacity}
            onChange={str(state.setRetCapacity)}
            placeholder="20 hours/month of design support"
          />
        </Field>
        <Field label="Unused capacity">
          <select
            className="field-input"
            value={state.retRollover}
            onChange={(e) => state.setRetRollover(e.target.value as "yes" | "no")}
          >
            <option value="no">Expires</option>
            <option value="yes">Rolls over</option>
          </select>
        </Field>
        <Field label="Duration (months)">
          <input
            type="number"
            min={1}
            max={12}
            className="field-input"
            value={state.retDuration}
            onChange={num(state.setRetDuration)}
          />
        </Field>
        <p className="text-xs text-ink-mute">
          First month escrows on signature. A session signer auto-releases each following month.
        </p>
      </div>
    );
  }

  if (type === "t-and-m") {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (USDC)">
            <input
              type="number"
              className="field-input"
              value={state.tmRate}
              onChange={num(state.setTmRate)}
            />
          </Field>
          <Field label="Per">
            <select
              className="field-input"
              value={state.tmUnit}
              onChange={(e) => state.setTmUnit(e.target.value as "hour" | "day")}
            >
              <option value="hour">Hour</option>
              <option value="day">Day</option>
            </select>
          </Field>
        </div>
        <Field label="Estimated total (soft cap, not enforced)">
          <input
            type="number"
            className="field-input"
            value={state.tmEstHours}
            onChange={num(state.setTmEstHours)}
          />
        </Field>
        <Field label="Hard budget ceiling (USDC — pre-funded to this amount)">
          <input
            type="number"
            className="field-input"
            value={state.tmCeiling}
            onChange={num(state.setTmCeiling)}
          />
        </Field>
        <Field label="Billing cadence">
          <select
            className="field-input"
            value={state.tmCadence}
            onChange={(e) => state.setTmCadence(e.target.value as "weekly" | "biweekly" | "monthly")}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <p className="text-xs text-ink-mute">
          Client has 48h to dispute each period; otherwise a session signer auto-releases.
        </p>
      </div>
    );
  }

  if (type === "recurring") {
    return (
      <div className="space-y-5">
        <Field label="What is delivered each period?">
          <input
            className="field-input"
            value={state.rcDeliverable}
            onChange={str(state.setRcDeliverable)}
            placeholder="Weekly performance report"
          />
        </Field>
        <Field label="Period">
          <select
            className="field-input"
            value={state.rcPeriod}
            onChange={(e) => state.setRcPeriod(e.target.value as "weekly" | "monthly" | "quarterly")}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="USDC per period">
            <input
              type="number"
              className="field-input"
              value={state.rcPerPeriod}
              onChange={num(state.setRcPerPeriod)}
            />
          </Field>
          <Field label="Duration (periods, 1-24)">
            <input
              type="number"
              min={1}
              max={24}
              className="field-input"
              value={state.rcPeriods}
              onChange={num(state.setRcPeriods)}
            />
          </Field>
        </div>
      </div>
    );
  }

  if (type === "split") {
    return (
      <div className="space-y-5">
        <Field label="What is being delivered jointly?">
          <textarea
            className="field-input"
            rows={2}
            value={state.spScope}
            onChange={str(state.setSpScope)}
            placeholder="Joint pitch and delivery of a rebrand + microsite for the client"
          />
        </Field>
        <Field label="Client ENS name (the paying party)">
          <input
            className="field-input"
            value={state.spClientEns}
            onChange={str(state.setSpClientEns)}
            placeholder="reef-client.pact.eth"
          />
        </Field>
        <Field label={`Your share: ${state.spShareA}% · Co-provider: ${100 - state.spShareA}%`}>
          <input
            type="range"
            min={1}
            max={99}
            className="w-full accent-[#2DD4BF]"
            value={state.spShareA}
            onChange={num(state.setSpShareA)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total USDC">
            <input
              type="number"
              className="field-input"
              value={state.spTotal}
              onChange={num(state.setSpTotal)}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              className="field-input"
              value={state.spDue}
              onChange={str(state.setSpDue)}
            />
          </Field>
        </div>
        <p className="text-xs text-ink-mute">
          Counterparty ENS slug below is your co-provider — the peer you&rsquo;re splitting with, not the client.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Field label="Q1 — What kind of work is this?">
        <select className="field-input" value={state.cQ1} onChange={str(state.setCQ1)}>
          <option>Service</option>
          <option>Product</option>
          <option>Joint delivery</option>
          <option>Ongoing</option>
          <option>Other</option>
        </select>
      </Field>
      <Field label="Q2 — How is payment structured?">
        <select className="field-input" value={state.cQ2} onChange={str(state.setCQ2)}>
          <option>All upfront</option>
          <option>On completion</option>
          <option>By milestone</option>
          <option>By time</option>
          <option>Recurring</option>
        </select>
      </Field>
      <Field label="Q3 — What are you delivering?" hint="Be specific. Vague scope is the #1 cause of payment disputes.">
        <textarea
          className="field-input"
          maxLength={800}
          rows={3}
          value={state.cQ3}
          onChange={str(state.setCQ3)}
        />
      </Field>
      <Field
        label="Q4 — How does the receiving party know it's done?"
        hint={`Name something observable. "Client is satisfied" is not an acceptance criterion.`}
      >
        <textarea
          className="field-input"
          maxLength={400}
          rows={2}
          value={state.cQ4}
          onChange={str(state.setCQ4)}
        />
      </Field>
      <Field label="Q5 — Total USDC amount">
        <input
          type="number"
          className="field-input"
          value={state.cQ5}
          onChange={num(state.setCQ5)}
        />
      </Field>
      {state.cQ2 === "By milestone" && (
        <Field label="How many phases? (2-5)">
          <input
            type="number"
            min={2}
            max={5}
            className="field-input"
            value={state.cPhases}
            onChange={num(state.setCPhases)}
          />
        </Field>
      )}
      <Field label="Q6 — World selfie required on acceptance?">
        <select className="field-input" value={state.cWorld} onChange={(e) => state.setCWorld(e.target.value as "yes" | "no")}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm mb-2 text-ink-body">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-mute mt-1">{hint}</p>}
    </div>
  );
}
