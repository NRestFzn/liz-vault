import type React from 'react';
import { useEffect, useRef, useState } from 'react';

interface TruncatedLabelProps {
  text: string;
  className?: string;
  position?: 'above' | 'below';
  maxWidthClass?: string;
}

export const TruncatedLabel: React.FC<TruncatedLabelProps> = ({ text, className = '', position = 'above', maxWidthClass }) => {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placement = position === 'below'
    ? 'top-full mt-1.5'
    : 'bottom-full mb-1.5';

  return (
    <span className="group/trunc relative block min-w-0 flex-1">
      <span ref={labelRef} className={`block min-w-0 truncate ${className}`}>{text}</span>
      {truncated && (
        <span
          role="tooltip"
          className={`pointer-events-none invisible absolute left-0 z-[130] ${placement} w-max ${maxWidthClass ?? 'max-w-[200px]'} -translate-y-1 break-words rounded bg-[#333] px-2.5 py-1.5 text-[12px] font-medium leading-relaxed text-white opacity-0 shadow-lg transition-all delay-300 group-hover/trunc:visible group-hover/trunc:translate-y-0 group-hover/trunc:opacity-100`}
        >
          {text}
        </span>
      )}
    </span>
  );
};
