
import js from "@eslint/js";
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { window: "readonly", document: "readonly", console: "readonly",
                 require: "readonly", module: "readonly", process: "readonly",
                 __dirname: "readonly", exports: "readonly", global: "readonly",
                 React: "readonly" }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-cond-assign": "error",
      "no-constant-condition": "warn",
      "no-fallthrough": "warn",
      "no-self-compare": "error",
      "use-isnan": "error",
      "no-unsafe-negation": "error",
    }
  }
];
