import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 形はカプセル（角が丸いほど視線が中央に落ち着く、HIG）。高さは指で押しやすい 44px 以上。
  // 押した瞬間に少し縮めて、押せたことを返す
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-base font-semibold whitespace-nowrap transition-all outline-none select-none active:scale-[0.97] focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        // 画面でいちばん押してほしいもの。1 画面に 1〜2 個まで（HIG）
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border bg-card text-foreground hover:bg-accent",
        // 控えめなボタン（iOS の tinted）。メインの青をうすく敷く
        secondary: "bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/15",
        ghost: "text-primary hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 has-[>svg]:px-4",
        xs: "h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-4 text-sm has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-13 px-7 text-[1.0625rem] has-[>svg]:px-5",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-13",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
