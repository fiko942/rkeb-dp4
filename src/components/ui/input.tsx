"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-12 w-full rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground shadow-inner outline-none transition placeholder:text-muted-foreground focus:border-white/25 focus:bg-white/7",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";

export { Input };
