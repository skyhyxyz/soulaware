import Link from "next/link";

type BrandWordmarkProps = {
  href?: string;
  subtitle?: string;
  className?: string;
};

export function BrandWordmark({ href = "/", subtitle, className = "" }: BrandWordmarkProps) {
  return (
    <div className={className}>
      <Link href={href} className="inline-flex items-end gap-1 leading-none" aria-label="SoulAware home">
        <span className="sa-wordmark-soul">Soul</span>
        <span className="sa-wordmark-aware">Aware</span>
      </Link>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
