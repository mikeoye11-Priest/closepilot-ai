"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Company, OrgUnit, TenantType } from "@/lib/types";
import { groupByOrgUnit, memberLabel, orgUnitLabel } from "@/lib/org-units";

/**
 * A searchable client picker.
 *
 * This replaced a plain <select> that rendered one <option> per company. At a
 * practice of 15 branches and 100 clients each that is 1,500 options in the
 * DOM with no way to find anything, so the list is filtered by name and capped
 * at RENDER_LIMIT, with the remainder reachable by narrowing the search rather
 * than by scrolling.
 *
 * Results are grouped by org unit, which is what makes 1,500 clients navigable:
 * a partner looks under Manchester, not through an alphabetical wall.
 */
const RENDER_LIMIT = 50;

export function CompanyPicker({
  companies,
  orgUnits,
  tenantType,
  currentCompany,
  busyCompanyId,
  onSelect
}: {
  companies: Company[];
  orgUnits: OrgUnit[];
  tenantType: TenantType;
  currentCompany: Company;
  busyCompanyId: string | null;
  onSelect: (companyId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((company) => company.name.toLowerCase().includes(needle));
  }, [companies, query]);

  const shown = matches.slice(0, RENDER_LIMIT);
  const groups = useMemo(() => groupByOrgUnit(shown, orgUnits), [shown, orgUnits]);
  const hidden = matches.length - shown.length;
  const unitWord = orgUnitLabel(tenantType);
  const memberWord = memberLabel(tenantType, true).toLowerCase();

  const choose = (companyId: string) => {
    setOpen(false);
    setQuery("");
    if (companyId !== currentCompany.id) onSelect(companyId);
  };

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        type="button"
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-bold shadow-sm sm:w-56"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{busyCompanyId ? "Loading..." : currentCompany.name}</span>
        <span className="ml-auto text-muted" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(22rem,90vw)] rounded-lg border border-line bg-white p-2 shadow-panel">
          <input
            ref={searchRef}
            className="h-9 w-full rounded-lg border border-line px-3 text-sm focus:border-brand focus:outline-none"
            placeholder={`Search ${memberWord}...`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="mt-2 max-h-80 overflow-y-auto" role="listbox">
            {!shown.length && <p className="px-2 py-3 text-sm text-muted">No {memberWord} match “{query}”.</p>}

            {groups.map((group) => (
              <div key={group.unit?.id ?? "__ungrouped"}>
                {/* Only label groups when the tenant actually uses units, so a
                    single entity is not given a spurious "Ungrouped" heading. */}
                {orgUnits.length > 0 && (
                  <p className="px-2 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted">
                    {group.unit ? group.unit.name : `No ${unitWord.toLowerCase()}`}
                  </p>
                )}
                {group.companies.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    role="option"
                    aria-selected={company.id === currentCompany.id}
                    className={`block w-full truncate rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${company.id === currentCompany.id ? "font-bold text-brand" : ""}`}
                    onClick={() => choose(company.id)}
                  >
                    {company.name}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {hidden > 0 && (
            <p className="border-t border-line px-2 pt-2 text-xs text-muted">
              Showing {shown.length} of {matches.length}. Keep typing to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
