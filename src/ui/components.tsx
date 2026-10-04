/** Shared UI primitives — the Plinth component library. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { USER_BY_ID } from '../core/model/org';
import { formatLength, parseLength, type UnitSystem } from '../core/units';
import { getMaterial, type Material } from '../core/catalog/materials';

export function Avatar({ id, size = 24 }: { id: string; size?: number }) {
  const u = USER_BY_ID[id];
  return (
    <span className="avatar" title={u?.name ?? 'Architect AI'} style={{ background: u?.color ?? '#6b6862', width: size, height: size, fontSize: size * 0.42 }}>
      {u?.initials ?? 'AI'}
    </span>
  );
}

export function Avatars({ ids, max = 4 }: { ids: string[]; max?: number }) {
  return (
    <span className="avatars">
      {ids.slice(0, max).map((id) => <Avatar key={id} id={id} />)}
      {ids.length > max && <span className="avatar" style={{ background: 'var(--ink-4)' }}>+{ids.length - max}</span>}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Seg<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className="seg" role="group" style={size === 'sm' ? { fontSize: 12 } : undefined}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Modal({ onClose, children, width, label }: { onClose: () => void; children: ReactNode; width?: number; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function Popover({ anchor, onClose, children, align = 'left' }: { anchor: ReactNode; onClose?: () => void; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); onClose?.(); } };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open, onClose]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex' }}>{anchor}</span>
      {open && <div className="menu" style={{ top: 'calc(100% + 6px)', [align]: 0 }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function HealthRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? 'var(--ok)' : score >= 75 ? 'var(--warn)' : 'var(--err)';
  return (
    <div className="health-ring" style={{ width: size, height: size }} aria-label={`Design health ${score} of 100`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 400ms var(--ease)' }} />
      </svg>
      <b style={{ fontSize: size * 0.28 }}>{score}</b>
    </div>
  );
}

/** CSS swatch that previews a material's pattern (the same pattern the 3D textures use). */
export function swatchStyle(m: Material): React.CSSProperties {
  const base = m.color;
  const line = 'rgba(0,0,0,0.12)';
  const bg: Record<string, string> = {
    wood: `repeating-linear-gradient(0deg, ${base} 0 5px, ${shade(base, -10)} 5px 6px)`,
    plank: `repeating-linear-gradient(90deg, ${base} 0 5px, ${shade(base, -14)} 5px 6px)`,
    tile: `linear-gradient(${line} 1px, transparent 1px) 0 0/8px 8px, linear-gradient(90deg, ${line} 1px, transparent 1px) 0 0/8px 8px, ${base}`,
    brick: `linear-gradient(${shade(base, 25)} 1px, transparent 1px) 0 0/10px 5px, ${base}`,
    marble: `linear-gradient(125deg, transparent 40%, rgba(120,120,120,0.25) 42%, transparent 46%), ${base}`,
    stone: `radial-gradient(circle at 30% 40%, ${shade(base, 12)} 0 2px, transparent 3px), radial-gradient(circle at 70% 70%, ${shade(base, -12)} 0 2px, transparent 3px), ${base}`,
    grass: `radial-gradient(circle at 40% 40%, ${shade(base, 15)} 0 1px, transparent 2px) 0 0/4px 4px, ${base}`,
    water: `linear-gradient(160deg, ${shade(base, 20)}, ${base})`,
    concrete: `radial-gradient(circle at 20% 30%, rgba(0,0,0,0.06) 0 1px, transparent 2px) 0 0/5px 5px, ${base}`,
    'tiles-roof': `repeating-linear-gradient(0deg, ${base} 0 4px, ${shade(base, -18)} 4px 5px)`,
    none: base,
  };
  return { background: bg[m.pattern] ?? base };
}

export function Swatch({ id, size = 18 }: { id: string; size?: number }) {
  const m = getMaterial(id);
  return <span className="swatch" title={m.name} style={{ ...swatchStyle(m), width: size, height: size }} />;
}

export function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * (pct > 0 ? 255 - v : v))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Length field: accepts 12'6", 3.8m, 450mm …; shows the project's unit system. */
export function LengthInput({ value, units, onCommit, min, ariaLabel, className = 'input num' }: { value: number; units: UnitSystem; onCommit: (mm: number) => void; min?: number; ariaLabel?: string; className?: string }) {
  const [text, setText] = useState(formatLength(value, units));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(formatLength(value, units)); }, [value, units, editing]);
  const commit = () => {
    setEditing(false);
    const v = parseLength(text, units);
    if (v === null || (min !== undefined && v < min)) { setText(formatLength(value, units)); return; }
    if (Math.abs(v - value) > 0.5) onCommit(v);
    else setText(formatLength(value, units));
  };
  return (
    <input className={className} aria-label={ariaLabel} value={text} onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(formatLength(value, units)); setEditing(false); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} />
  );
}

export function NumberInput({ value, onCommit, step = 1, suffix, ariaLabel }: { value: number; onCommit: (v: number) => void; step?: number; suffix?: string; ariaLabel?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div style={{ position: 'relative' }}>
      <input className="input num" aria-label={ariaLabel} value={text} step={step} onChange={(e) => setText(e.target.value)}
        onBlur={() => { const v = parseFloat(text); if (Number.isFinite(v) && v !== value) onCommit(v); else setText(String(value)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
        style={suffix ? { paddingRight: 26 } : undefined} />
      {suffix && <span className="muted small" style={{ position: 'absolute', right: 8, top: 6, pointerEvents: 'none' }}>{suffix}</span>}
    </div>
  );
}

export function TextInput({ value, onCommit, ariaLabel, className = 'input' }: { value: string; onCommit: (v: string) => void; ariaLabel?: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input className={className} aria-label={ariaLabel} value={text} onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() && text !== value) onCommit(text.trim()); else setText(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
  );
}

export function Prop({ label, children }: { label: string; children: ReactNode }) {
  return <div className="prop"><span>{label}</span><div>{children}</div></div>;
}

export function relTime(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`.replace(/^1 hours/, '1 hour');
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`.replace(/^1 days/, 'yesterday').replace('yesterday ago', 'yesterday');
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div style={{ marginBottom: 8, color: 'var(--ink-4)' }}>{icon}</div>}
      <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
      {children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

/** Phone-sized layouts focus on viewing, reviewing and commenting. */
export function useIsMobile(): boolean {
  return useMedia('(max-width: 760px)');
}

/** Tablet / small-laptop widths: panels give the plan room. */
export function useIsNarrow(): boolean {
  return useMedia('(max-width: 1100px)');
}

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}
