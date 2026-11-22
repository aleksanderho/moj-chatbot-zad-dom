// Tylko środowisko testowe Node: klient AI SDK i endpoint działają w jednym procesie.
// Nie ustawiaj globalnego --conditions=react-server: usuwa klienckie API Reacta.
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
    }
    return nextResolve(specifier, context);
  },
});
