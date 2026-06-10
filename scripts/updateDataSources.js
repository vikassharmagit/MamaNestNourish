import { refreshSourceChecks, validateTrustedSources } from "../src/dataStore.js";

validateTrustedSources();
const result = await refreshSourceChecks();
console.log(JSON.stringify(result, null, 2));
validateTrustedSources();
