"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import {
  TEMPLATES,
  CUSTOM_TEMPLATE,
  WORLD_THRESHOLD,
  DEFAULT_WINDOW_HOURS,
} from "@/lib/templates";
import { Engagement, Milestone, TemplateType } from "@/lib/types";
import { formatUSDC, isoDaysFromNow, slugify } from "@/lib/utils";
import TerminalBlock from "@/components/TerminalBlock";

type Stage = "form" | "preview";

function emptyMilestone(index: number, name = ""): Milestone {
  return {
    index,
    name,
    deliverable: "",
    due: isoDaysFromNow(21),
    amount: 0,
    status: "pending",
    worldRequired: false,
  };
}

export default function TemplateFormPage() {
  const params = useParams();
  const type = params.type as TemplateType;
  const router = useRouter();
  const { currentBusiness, createProposal, pushToast } = useStore();

  const meta =
    type === "custom" ? CUSTOM_TEMPLATE : TEMPLATES.find((t) => t.id === type);

  const [stage, setStage] = useState<Stage>("form");
  const [counterpartySlug, setCounterpartySlug] = useState("");
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS);

  // Fixed
  const [fixedDeliverable, setFixedDeliverable] = useState("");
  const [fixedDeadline, setFixedDeadline] = useState(isoDaysFromNow(30).slice(0, 10));
  const [fixedAcceptance, setFixedAcceptance] = useState("");
  const [fixedAmount, setFixedAmount] = useState(4000);

  // Milestone
  const [msProject, setMsProject] = useState("");
  const [msAcceptance, setMsAcceptance] = useState("");
  const [msRows, setMsRows] = useState<Milestone[]>([
    emptyMilestone(0, "Discovery"),
    emptyMilestone(1, "Delivery"),
  ]);

  // Retainer
  const [retFee, setRetFee] = useState(2000);
  const [retCapacity, setRetCapacity] = useState("");
  const [retRollover, setRetRollover] = useState<"yes" | "no">("no");
  const [retDuration, setRetDuration] = useState(6);

  // T&M
  const [tmRate, setTmRate] = useState(120);
  const [tmUnit, setTmUnit] = useState<"hour" | "day">("hour");
  const [tmEstHours, setTmEstHours] = useState(80);
  const [tmCeiling, setTmCeiling] = useState(9600);
  const [tmCadence, setTmCadence] = useState<"weekly" | "biweekly" | "monthly">("biweekly");

  // Recurring
  const [rcDeliverable, setRcDeliverable] = useState("");
  const [rcPeriod, setRcPeriod] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [rcPerPeriod, setRcPerPeriod] = useState(800);
  const [rcPeriods, setRcPeriods] = useState(6);

  // Split
  const [spScope, setSpScope] = useState("");
  const [spClientEns, setSpClientEns] = useState("");
  const [spShareA, setSpShareA] = useState(60);
  const [spTotal, setSpTotal] = useState(10000);
  const [spDue, setSpDue] = useState(isoDaysFromNow(30).slice(0, 10));

  // Custom
  const [cQ1, setCQ1] = useState("Service");
  const [cQ2, setCQ2] = useState("On completion");
  const [cQ3, setCQ3] = useState("");
  const [cQ4, setCQ4] = useState("");
  const [cQ5, setCQ5] = useState(4000);
  const [cPhases, setCPhases] = useState(3);
  const [cWorld, setCWorld] = useState<"yes" | "no">("no");

  function updateRow(i: number, patch: Partial<Milestone>) {
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

  // Derive the draft engagement from whichever template's fields are filled.
  const draft = useMemo(() => {
    let title = "";
    let scope = "";
    let acceptance = "";
    let milestones: Milestone[] = [];
    let total = 0;
    let fields: Record<string, string> = {};
    let splitShareA: number | undefined;
    let splitShareB: number | undefined;

    if (type === "fixed") {
      total = Number(fixedAmount) || 0;
      title = fixedDeliverable || "Fixed delivery";
      scope = fixedDeliverable;
      acceptance = fixedAcceptance;
      milestones = [
        {
          ...emptyMilestone(0, "Upfront (50%)"),
          deliverable: "Released on mutual signature",
          due: new Date().toISOString(),
          amount: total * 0.5,
        },
        {
          ...emptyMilestone(1, "Delivery (50%)"),
          deliverable: fixedDeliverable,
          due: new Date(fixedDeadline).toISOString(),
          amount: total * 0.5,
          worldRequired: total * 0.5 >= WORLD_THRESHOLD,
        },
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
      milestones = msRows.map((r) => ({
        ...r,
        worldRequired: r.amount >= WORLD_THRESHOLD,
        due: new Date(r.due).toISOString(),
      }));
      total = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
      fields = {
        "pact:type": "milestone",
        "pact:milestone-count": String(msRows.length),
        ...Object.fromEntries(
          milestones.map((m, i) => [
            `pact:milestone-${i + 1}`,
            `${m.name} / ${new Date(m.due).toISOString().slice(0, 10)} / ${formatUSDC(m.amount)}`,
          ])
        ),
        "pact:acceptance": msAcceptance,
      };
    } else if (type === "retainer") {
      title = "Retainer — " + (retCapacity || "reserved capacity");
      scope = retCapacity;
      acceptance = "Capacity reserved for the period; " + (retRollover === "yes" ? "unused hours roll over." : "unused hours expire.");
      milestones = Array.from({ length: retDuration }, (_, i) => ({
        ...emptyMilestone(i, `Month ${i + 1}`),
        deliverable: retCapacity,
        due: isoDaysFromNow(30 * (i + 1)),
        amount: Number(retFee) || 0,
      }));
      total = Number(retFee) * retDuration;
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
      milestones = Array.from({ length: periods }, (_, i) => ({
        ...emptyMilestone(i, `Billing period ${i + 1}`),
        deliverable: "Time log for the period",
        due: isoDaysFromNow((i + 1) * (tmCadence === "weekly" ? 7 : tmCadence === "biweekly" ? 14 : 30)),
        amount: Number(tmCeiling) / periods,
      }));
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
      milestones = Array.from({ length: rows }, (_, i) => ({
        ...emptyMilestone(i, `Delivery period ${i + 1}`),
        deliverable: rcDeliverable,
        due: isoDaysFromNow((i + 1) * (rcPeriod === "weekly" ? 7 : rcPeriod === "monthly" ? 30 : 90)),
        amount: Number(rcPerPeriod) || 0,
      }));
      total = Number(rcPerPeriod) * rows;
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
        {
          ...emptyMilestone(0, "Joint delivery"),
          deliverable: spScope,
          due: new Date(spDue).toISOString(),
          amount: total,
          worldRequired: total >= WORLD_THRESHOLD,
        },
      ];
      fields = {
        "pact:type": "split",
        "pact:joint-scope": spScope,
        "pact:party-a": `${currentBusiness?.ensSubname} / ${spShareA}%`,
        "pact:party-b": `${slugify(counterpartySlug)}.pact-hack.eth / ${100 - spShareA}%`,
        "pact:total": String(total),
        "pact:client": spClientEns,
      };
    } else {
      // custom
      title = cQ3 ? cQ3.slice(0, 48) : "Custom engagement";
      scope = cQ3;
      acceptance = cQ4;
      total = Number(cQ5) || 0;
      if (cQ2 === "By milestone") {
        const per = total / Math.max(cPhases, 1);
        milestones = Array.from({ length: cPhases }, (_, i) => ({
          ...emptyMilestone(i, `Phase ${i + 1}`),
          deliverable: cQ3,
          due: isoDaysFromNow((i + 1) * 14),
          amount: per,
          worldRequired: cWorld === "yes",
        }));
      } else if (cQ2 === "By time" || cQ2 === "Recurring") {
        const periods = 4;
        const per = total / periods;
        milestones = Array.from({ length: periods }, (_, i) => ({
          ...emptyMilestone(i, `Period ${i + 1}`),
          deliverable: cQ3,
          due: isoDaysFromNow((i + 1) * 14),
          amount: per,
          worldRequired: cWorld === "yes",
        }));
      } else {
        milestones = [
          {
            ...emptyMilestone(0, "Delivery"),
            deliverable: cQ3,
            due: isoDaysFromNow(21),
            amount: total,
            worldRequired: cWorld === "yes" || total >= WORLD_THRESHOLD,
          },
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

    return { title, scope, acceptance, milestones, total, fields, splitShareA, splitShareB };
  }, [
    type,
    fixedDeliverable,
    fixedDeadline,
    fixedAcceptance,
    fixedAmount,
    msProject,
    msAcceptance,
    msRows,
    retFee,
    retCapacity,
    retRollover,
    retDuration,
    tmRate,
    tmUnit,
    tmEstHours,
    tmCeiling,
    tmCadence,
    rcDeliverable,
    rcPeriod,
    rcPerPeriod,
    rcPeriods,
    spScope,
    spClientEns,
    spShareA,
    spTotal,
    spDue,
    cQ1,
    cQ2,
    cQ3,
    cQ4,
    cQ5,
    cPhases,
    cWorld,
    counterpartySlug,
    currentBusiness,
  ]);

  if (!currentBusiness) {
    return (
      <div className="py-16">
        <p>You need an identity first.</p>
        <button onClick={() => router.push("/identity")} className="btn-primary mt-4">
          Set up identity
        </button>
      </div>
    );
  }

  if (!meta) return <div className="py-16">Unknown template.</div>;

  const canPreview =
    counterpartySlug.trim().length > 1 && draft.total > 0 && draft.scope.trim().length > 0;

  function sendProposal() {
    const engagement = createProposal({
      title: draft.title,
      scope: draft.scope,
      acceptanceCriteria: draft.acceptance,
      partyAId: currentBusiness!.id,
      partyBSlug: slugify(counterpartySlug),
      totalAmount: draft.total,
      milestones: draft.milestones,
      acceptanceWindowHours: windowHours,
      templateType: type,
      splitShareA: draft.splitShareA,
      splitShareB: draft.splitShareB,
      fields: draft.fields,
    });
    pushToast("Proposal created. Terms are staged for ENS.", "ink");
    router.push(`/proposal/${engagement.id}`);
  }

  return (
    <div className="py-14 max-w-3xl">
      <p className="mono-tag text-ink-faint mb-2">Template {meta.index}</p>
      <h1 className="font-serif text-3xl mb-8">{meta.name}</h1>

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

          <div className="border-t border-rule pt-6">
            <label className="block text-sm mb-2">Counterparty ENS slug</label>
            <input
              className="field-input"
              placeholder="e.g. north-supply"
              value={counterpartySlug}
              onChange={(e) => setCounterpartySlug(e.target.value)}
            />
            <p className="mono-tag text-ink-faint mt-1">
              {slugify(counterpartySlug || "counterparty")}.pact-hack.eth
            </p>
          </div>

          {(type === "fixed" || type === "milestone" || type === "split") && (
            <div>
              <label className="block text-sm mb-2">Acceptance window before auto-release fallback</label>
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
            <p className="text-sm text-ink-faint">
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
          <p className="text-sm text-ink-soft">
            These are the exact terms going on-chain. Both parties can verify
            them at any time by resolving the ENS name.
          </p>
          <TerminalBlock
            records={Object.entries({
              ...draft.fields,
              "pact:party-a": currentBusiness.ensSubname,
              "pact:party-b": `${slugify(counterpartySlug)}.pact-hack.eth (set when they sign)`,
              "pact:status": "proposed",
            })}
          />
          <div className="flex justify-between items-center">
            <button onClick={() => setStage("form")} className="btn-ghost">
              ← Edit
            </button>
            <button onClick={sendProposal} className="btn-primary">
              Send proposal →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Field sets per template. Kept in one file since each is small and the  */
/* branching lives entirely on the discriminant `type`.                   */
/* ---------------------------------------------------------------------- */

function TemplateFields({ type, state }: { type: TemplateType; state: any }) {
  if (type === "fixed") {
    return (
      <div className="space-y-5">
        <Field label="What are you delivering?">
          <textarea
            className="field-input"
            maxLength={500}
            rows={3}
            value={state.fixedDeliverable}
            onChange={(e: any) => state.setFixedDeliverable(e.target.value)}
            placeholder="Full brand identity: logo, type system, color, guidelines PDF"
          />
        </Field>
        <Field label="When is it due?">
          <input
            type="date"
            className="field-input"
            value={state.fixedDeadline}
            onChange={(e: any) => state.setFixedDeadline(e.target.value)}
          />
        </Field>
        <Field label="How do both parties know it's done?">
          <textarea
            className="field-input"
            maxLength={300}
            rows={2}
            value={state.fixedAcceptance}
            onChange={(e: any) => state.setFixedAcceptance(e.target.value)}
            placeholder="Client approves final files in writing within 5 business days"
          />
        </Field>
        <Field label="Total USDC amount">
          <input
            type="number"
            className="field-input"
            value={state.fixedAmount}
            onChange={(e: any) => state.setFixedAmount(Number(e.target.value))}
          />
        </Field>
        <p className="text-xs text-ink-faint">50% escrows on signature, 50% releases on delivery acceptance.</p>
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
            onChange={(e: any) => state.setMsProject(e.target.value)}
            placeholder="Website redesign"
          />
        </Field>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm">Milestones ({state.msRows.length}/5)</label>
            <button type="button" onClick={state.addRow} className="text-xs text-slate">
              + Add milestone
            </button>
          </div>
          <div className="space-y-3">
            {state.msRows.map((m: Milestone) => (
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
                  className="col-span-1 text-ink-faint text-sm hover:text-danger"
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
            onChange={(e: any) => state.setMsAcceptance(e.target.value)}
            placeholder="Client reviews and signs off within 5 days of delivery"
          />
        </Field>
        <p className="text-xs text-ink-faint">
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
            onChange={(e: any) => state.setRetFee(Number(e.target.value))}
          />
        </Field>
        <Field label="What capacity is reserved?">
          <input
            className="field-input"
            value={state.retCapacity}
            onChange={(e: any) => state.setRetCapacity(e.target.value)}
            placeholder="20 hours/month of design support"
          />
        </Field>
        <Field label="Unused capacity">
          <select
            className="field-input"
            value={state.retRollover}
            onChange={(e: any) => state.setRetRollover(e.target.value)}
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
            onChange={(e: any) => state.setRetDuration(Number(e.target.value))}
          />
        </Field>
        <p className="text-xs text-ink-faint">
          First month escrows on signature. A Privy session signer auto-releases each following month.
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
              onChange={(e: any) => state.setTmRate(Number(e.target.value))}
            />
          </Field>
          <Field label="Per">
            <select
              className="field-input"
              value={state.tmUnit}
              onChange={(e: any) => state.setTmUnit(e.target.value)}
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
            onChange={(e: any) => state.setTmEstHours(Number(e.target.value))}
          />
        </Field>
        <Field label="Hard budget ceiling (USDC — pre-funded to this amount)">
          <input
            type="number"
            className="field-input"
            value={state.tmCeiling}
            onChange={(e: any) => state.setTmCeiling(Number(e.target.value))}
          />
        </Field>
        <Field label="Billing cadence">
          <select
            className="field-input"
            value={state.tmCadence}
            onChange={(e: any) => state.setTmCadence(e.target.value)}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <p className="text-xs text-ink-faint">
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
            onChange={(e: any) => state.setRcDeliverable(e.target.value)}
            placeholder="Weekly performance report"
          />
        </Field>
        <Field label="Period">
          <select
            className="field-input"
            value={state.rcPeriod}
            onChange={(e: any) => state.setRcPeriod(e.target.value)}
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
              onChange={(e: any) => state.setRcPerPeriod(Number(e.target.value))}
            />
          </Field>
          <Field label="Duration (periods, 1-24)">
            <input
              type="number"
              min={1}
              max={24}
              className="field-input"
              value={state.rcPeriods}
              onChange={(e: any) => state.setRcPeriods(Number(e.target.value))}
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
            onChange={(e: any) => state.setSpScope(e.target.value)}
            placeholder="Joint pitch and delivery of a rebrand + microsite for the client"
          />
        </Field>
        <Field label="Client ENS name (the paying party)">
          <input
            className="field-input"
            value={state.spClientEns}
            onChange={(e: any) => state.setSpClientEns(e.target.value)}
            placeholder="reef-client.pact-hack.eth"
          />
        </Field>
        <Field label={`Your share: ${state.spShareA}% · Co-provider: ${100 - state.spShareA}%`}>
          <input
            type="range"
            min={1}
            max={99}
            className="w-full"
            value={state.spShareA}
            onChange={(e: any) => state.setSpShareA(Number(e.target.value))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total USDC">
            <input
              type="number"
              className="field-input"
              value={state.spTotal}
              onChange={(e: any) => state.setSpTotal(Number(e.target.value))}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              className="field-input"
              value={state.spDue}
              onChange={(e: any) => state.setSpDue(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-ink-faint">
          Counterparty ENS slug below is your co-provider — the peer you're splitting with, not the client.
        </p>
      </div>
    );
  }

  // custom builder
  return (
    <div className="space-y-5">
      <Field label="Q1 — What kind of work is this?">
        <select className="field-input" value={state.cQ1} onChange={(e: any) => state.setCQ1(e.target.value)}>
          <option>Service</option>
          <option>Product</option>
          <option>Joint delivery</option>
          <option>Ongoing</option>
          <option>Other</option>
        </select>
      </Field>
      <Field label="Q2 — How is payment structured?">
        <select className="field-input" value={state.cQ2} onChange={(e: any) => state.setCQ2(e.target.value)}>
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
          onChange={(e: any) => state.setCQ3(e.target.value)}
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
          onChange={(e: any) => state.setCQ4(e.target.value)}
        />
      </Field>
      <Field label="Q5 — Total USDC amount">
        <input
          type="number"
          className="field-input"
          value={state.cQ5}
          onChange={(e: any) => state.setCQ5(Number(e.target.value))}
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
            onChange={(e: any) => state.setCPhases(Number(e.target.value))}
          />
        </Field>
      )}
      <Field label="Q6 — World selfie required on acceptance?">
        <select className="field-input" value={state.cWorld} onChange={(e: any) => state.setCWorld(e.target.value)}>
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
      <label className="block text-sm mb-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-faint mt-1">{hint}</p>}
    </div>
  );
}
