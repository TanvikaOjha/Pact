"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import { TEMPLATES, CUSTOM_TEMPLATE } from "@/lib/templates";
import TemplateIcon from "../../components/TemplateIcon";
import RevealOnScroll from "../../components/RevealOnScroll";

const ACCENTS: Record<string, string> = {
  fixed: "text-stamp border-stamp/40",
  milestone: "text-slate border-slate/40",
  retainer: "text-ember border-ember/40",
  "t-and-m": "text-slate border-slate/40",
  recurring: "text-stamp border-stamp/40",
  split: "text-ember border-ember/40",
};

export default function TemplatePicker() {
  const { currentBusiness, engagementsForCurrentBusiness } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (!currentBusiness) router.replace("/identity");
  }, [currentBusiness, router]);

  if (!currentBusiness) return null;

  return (
    <div className="py-14">
      <p className="mono-tag text-ink-faint mb-2">{currentBusiness.ensSubname}</p>
      <h1 className="font-serif text-3xl mb-8">Start an engagement</h1>

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {TEMPLATES.map((t, i) => (
          <RevealOnScroll key={t.id} delay={i * 0.06}>
            <Link href={`/templates/${t.id}`} className="block h-full">
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ duration: 0.15 }}
                className="plate p-5 h-full relative overflow-hidden"
              >
                <span className="absolute top-0 right-0 w-6 h-6 bg-paper border-l border-b border-rule" />
                <div
                  className={`w-10 h-10 flex items-center justify-center border mb-4 ${ACCENTS[t.id]}`}
                >
                  <TemplateIcon id={t.id} size={22} />
                </div>
                <p className="mb-2">{t.name}</p>
                <p className="text-sm text-ink-soft mb-4">{t.useCase}</p>
                <ul className="text-xs text-ink-faint space-y-1">
                  {t.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </motion.div>
            </Link>
          </RevealOnScroll>
        ))}
      </div>

      <RevealOnScroll delay={0.24}>
        <Link href={`/templates/${CUSTOM_TEMPLATE.id}`} className="block">
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ duration: 0.15 }}
            className="plate p-5 text-center flex items-center justify-center gap-3"
          >
            <TemplateIcon id="custom" size={20} className="text-ink-faint" />
            <div>
              <p>Build something custom →</p>
              <p className="text-sm text-ink-soft mt-1">
                A six-question guided flow for the other ~10%.
              </p>
            </div>
          </motion.div>
        </Link>
      </RevealOnScroll>

      {engagementsForCurrentBusiness.length > 0 && (
        <div className="mt-14 pt-8 border-t border-rule">
          <p className="text-sm text-ink-faint mb-4">Your engagements</p>
          {engagementsForCurrentBusiness.map((e) => (
            <Link
              key={e.id}
              href={
                e.status === "proposed" && e.partyAId === currentBusiness.id
                  ? `/proposal/${e.id}`
                  : `/engagement/${e.id}`
              }
              className="registry-row py-3 flex items-center gap-4 text-sm block hover:bg-paper-bright"
            >
              <TemplateIcon id={e.templateType} size={16} className="text-ink-faint shrink-0" />
              <span className="w-40 truncate">{e.title}</span>
              <span className="font-mono text-ink-faint w-40 truncate">
                {e.ensSubname}
              </span>
              <span className="text-ink-faint w-24 capitalize">{e.status}</span>
              <span className="font-mono ml-auto">
                ${e.totalAmount.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
