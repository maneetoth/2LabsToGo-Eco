import Analysis from "@/features/analysis/quantTLC";
import { Suspense } from "react";

export default function Page() {
  return (
    <main className="mx-auto max-w-screen-2xl p-4 md:p-8">
      <Suspense fallback={<p>Loading Quant TLC…</p>}><Analysis /></Suspense>
    </main>
  );
}
