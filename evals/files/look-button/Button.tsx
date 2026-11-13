import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" };

export function Button({ variant = "primary", className = "", ...rest }: Props) {
  const base = "inline-flex items-center justify-center text-sm font-medium";
  const primary = "bg-blue-600 text-white px-2 py-1 rounded-sm shadow-none hover:bg-blue-700";
  const ghost = "bg-transparent text-blue-600 px-2 py-1 rounded-sm hover:bg-blue-50";
  return <button className={`${base} ${variant === "primary" ? primary : ghost} ${className}`} {...rest} />;
}
