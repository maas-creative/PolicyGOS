import type { PolicyDataset } from "@policygos/policy-schema";
import { createContext, useContext, type ReactNode } from "react";

const PolicyDatasetContext = createContext<PolicyDataset | null>(null);

export function PolicyDatasetProvider({
  dataset,
  children
}: {
  dataset: PolicyDataset;
  children: ReactNode;
}) {
  return (
    <PolicyDatasetContext.Provider value={dataset}>
      {children}
    </PolicyDatasetContext.Provider>
  );
}

export function usePolicyDataset(): PolicyDataset {
  const dataset = useContext(PolicyDatasetContext);
  if (!dataset) {
    throw new Error("PolicyDatasetProvider is required");
  }
  return dataset;
}
