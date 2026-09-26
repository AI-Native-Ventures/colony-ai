import type * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Globe2,
  History,
  Home,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";

const ICONS = {
  alert: AlertCircle,
  arrow: ArrowRight,
  back: ArrowLeft,
  check: Check,
  chevron: ChevronRight,
  down: ChevronDown,
  document: FileText,
  folder: Folder,
  globe: Globe2,
  history: History,
  home: Home,
  key: KeyRound,
  link: Link2,
  lock: LockKeyhole,
  mail: Mail,
  plus: Plus,
  restart: RefreshCw,
  send: Send,
  subscription: Star,
  team: Users,
  chat: MessageSquare,
  sparkles: Sparkles,
  verified: ShieldCheck,
  x: X,
};

export type GlyphName = keyof typeof ICONS;

export function Glyph({
  name,
  className,
}: {
  name: GlyphName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className={`icon ${className ?? ""}`} />;
}

export function AntMark({ className = "ant" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 466 309"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="14"
      >
        <path d="M198 201Q176 230 163 265M229 211Q226 243 232 274M259 190Q281 221 296 252M327 114Q340 82 371 74M343 126Q367 106 395 105" />
      </g>
      <circle cx="104" cy="172" r="80" />
      <circle cx="226" cy="164" r="52" />
      <circle cx="313" cy="148" r="46" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <AntMark />
      <span>colony</span>
    </div>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  testId,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      className="primary full form-submit"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
      <Glyph name="arrow" />
    </button>
  );
}

export function BackButton({
  children = "Back",
  onClick,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="back" onClick={onClick} type="button">
      <Glyph name="back" />
      {children}
    </button>
  );
}

export function InlineAlert({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-alert" role="alert">
      <Glyph name="alert" />
      <p>{children}</p>
    </div>
  );
}
