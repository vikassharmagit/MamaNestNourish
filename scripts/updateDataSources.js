import { refreshSourceChecks } from "../src/dataStore.js";

const result = await refreshSourceChecks();
console.log(JSON.stringify(result, null, 2));
