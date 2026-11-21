// shadcn/ui の部品が使う、クラス名を合成する関数（Tailwind の衝突するクラスは後勝ちにする）
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
