"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClass, cx } from "./ui";

/** Submit button that disables itself while its form's action runs. */
export function SubmitButton({ children, pendingText, variant = "primary", size = "md", className, confirm, ...props }: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...props}
      disabled={pending || props.disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        props.onClick?.(e);
      }}
      className={cx(buttonClass(variant, size), className)}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={(e) => {
        void navigator.clipboard.writeText(value);
        const el = e.currentTarget;
        el.textContent = "Copied";
        setTimeout(() => (el.textContent = label), 1500);
      }}
    >
      {label}
    </button>
  );
}

/** Character counter for textareas with a hard platform limit. */
export function CountedTextarea({ max, defaultValue, ...props }: ComponentProps<"textarea"> & { max: number }) {
  return (
    <div>
      <textarea
        rows={6}
        defaultValue={defaultValue}
        {...props}
        onInput={(e) => {
          const n = e.currentTarget.value.length;
          const c = e.currentTarget.nextElementSibling;
          if (c) {
            c.textContent = `${n} / ${max}`;
            c.className = n > max ? "mt-1 text-xs text-red-600" : "mt-1 text-xs text-slate-500";
          }
        }}
        className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
      />
      <p className="mt-1 text-xs text-slate-500">
        {String(defaultValue ?? "").length} / {max}
      </p>
    </div>
  );
}

export function AutoSubmitSelect({ children, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm"
    >
      {children}
    </select>
  );
}
