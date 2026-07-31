import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/server-dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "document_ocr_api/venv/**",
      "document_ocr_api/venv312/**",
      "document_ocr_api/__pycache__/**",
      "output/**",
      ".playwright-cli/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  }
);
