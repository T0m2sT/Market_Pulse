import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  align?: "center" | "left" | "between";
}

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--accent)", color: "var(--bg-base)" },
  secondary: { background: "var(--bg-elevated-2)", color: "var(--text-primary)", border: "1px solid var(--hairline)" },
  ghost: { background: "none", color: "var(--accent)", padding: 0 },
};

export function Button({ variant = "secondary", fullWidth, align = "center", style, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : align === "between" ? "space-between" : "flex-start",
        width: fullWidth ? "100%" : undefined,
        padding: variant === "ghost" ? undefined : "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-sm)",
        border: "none",
        fontWeight: 600,
        fontSize: 15,
        lineHeight: 1,
        cursor: "pointer",
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    />
  );
}
