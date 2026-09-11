"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { TEMPLATES, CUSTOM_TEMPLATE } from "@/lib/templates";

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
        {TEMPLATES.map((t) => (
          <Link key={t.id} href={`/templates/${t.id}`} className="plate p-5 block">
            <p className="mb-2">{t.name}</p>
            <p className="text-sm text-ink-soft mb-4">{t.useCase}</p>
            <ul className="text-xs text-ink-faint space-y-1">
              {t.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Link>
        ))}
      </div>

      <Link
        href={`/templates/${CUSTOM_TEMPLATE.id}`}
        className="plate p-5 block text-center"
      >
        <p>Build something custom →</p>
        <p className="text-sm text-ink-soft mt-1">
          A six-question guided flow for the other ~10%.
        </p>
      </Link>

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
