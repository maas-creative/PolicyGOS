import {
  Renderer
} from "@openuidev/react-lang";
import type { PolicyDataset } from "@policygos/policy-schema";
import { useEffect, useMemo } from "react";
import { parseAllowedPolicyAction, type AllowedPolicyAction } from "./actions.js";
import { PolicyDatasetProvider } from "./context.js";
import {
  policyOpenUiLibrary,
  validatePolicyOpenUiResponse
} from "./library.js";

export function SafePolicyRenderer({
  dataset,
  response,
  isStreaming = false,
  onAction,
  onRejected
}: {
  dataset: PolicyDataset;
  response: string;
  isStreaming?: boolean;
  onAction: (action: AllowedPolicyAction) => void;
  onRejected?: (
    errors: ReadonlyArray<{ code: string; message: string }>
  ) => void;
}) {
  const validation = useMemo(
    () => validatePolicyOpenUiResponse(response, isStreaming),
    [response, isStreaming]
  );
  useEffect(() => {
    if (!validation.valid) {
      onRejected?.(validation.result.meta.errors);
    }
  }, [onRejected, validation]);
  if (!validation.valid) {
    return (
      <div className="openui-render-error" role="alert">
        生成された表示仕様を安全に検証できませんでした。
      </div>
    );
  }
  return (
    <PolicyDatasetProvider dataset={dataset}>
      <Renderer
        response={response}
        library={policyOpenUiLibrary}
        isStreaming={isStreaming}
        onAction={(event) => {
          const allowed = parseAllowedPolicyAction(event);
          if (allowed) {
            onAction(allowed);
          }
        }}
      />
    </PolicyDatasetProvider>
  );
}
