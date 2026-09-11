import { TemplateType } from "./types";

export const WORLD_THRESHOLD = 5000;
export const DEFAULT_WINDOW_HOURS = 48;

export interface TemplateMeta {
  id: TemplateType;
  index: number;
  name: string;
  useCase: string;
  bullets: string[];
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "fixed",
    index: 1,
    name: "Fixed Delivery",
    useCase: "One deliverable, one price, defined scope.",
    bullets: ["One deliverable", "One price", "Clear deadline"],
  },
  {
    id: "milestone",
    index: 2,
    name: "Milestone",
    useCase: "Longer project split into phases.",
    bullets: ["Phased project", "2–5 checkpoints", "Per-phase release"],
  },
  {
    id: "retainer",
    index: 3,
    name: "Retainer",
    useCase: "Reserved capacity, monthly fee, ongoing relationship.",
    bullets: ["Reserved monthly capacity", "Auto-payments", "Rolls or expires"],
  },
  {
    id: "t-and-m",
    index: 4,
    name: "Time & Materials",
    useCase: "Flexible scope, hourly or daily rate.",
    bullets: ["Hourly/daily rate", "Flexible scope", "Budget ceiling"],
  },
  {
    id: "recurring",
    index: 5,
    name: "Recurring Delivery",
    useCase: "Fixed deliverable on a fixed schedule.",
    bullets: ["Same thing every period", "Auto-release", "1–24 periods"],
  },
  {
    id: "split",
    index: 6,
    name: "Split Delivery",
    useCase: "Two providers, one client, atomic split.",
    bullets: ["Two co-deliverers", "One client payment", "Atomic split"],
  },
];

export const CUSTOM_TEMPLATE: TemplateMeta = {
  id: "custom",
  index: 7,
  name: "Custom Builder",
  useCase: "A guided conversation for everything else.",
  bullets: ["Six questions", "Structured preview", "Same on-chain shape"],
};

export function templateName(id: TemplateType): string {
  if (id === "custom") return "Custom";
  return TEMPLATES.find((t) => t.id === id)?.name ?? id;
}