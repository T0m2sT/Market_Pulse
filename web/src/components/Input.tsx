import type { InputHTMLAttributes } from "react";

export function Input({ style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--hairline)",
        background: "var(--bg-elevated-1)",
        color: "var(--text-primary)",
        fontSize: 15,
        lineHeight: 1.4,
        ...style,
      }}
    />
  );
}
