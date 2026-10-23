export function DateRange({ from, to, extra }: { from: string; to: string; extra?: Record<string, string | undefined> }) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input type="date" name="from" defaultValue={from} className="input w-auto py-1.5" />
      <span className="text-slate-400">–</span>
      <input type="date" name="to" defaultValue={to} className="input w-auto py-1.5" />
      <button className="btn-secondary py-1.5">Apply</button>
    </form>
  );
}
