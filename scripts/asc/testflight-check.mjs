import { asc } from "./asc.mjs";
const groups = (await asc("GET", "/v1/apps/6820566818/betaGroups")).data;
for (const g of groups) {
  const builds = (await asc("GET", `/v1/betaGroups/${g.id}/builds?limit=10`)).data.map((b) => b.attributes.version);
  console.log("group", g.attributes.name, "builds:", builds.join(", "));
}
