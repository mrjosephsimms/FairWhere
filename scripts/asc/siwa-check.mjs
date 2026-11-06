import { asc } from "./asc.mjs";
for (const id of ["com.sunnysimms.fairwhere", "club.yardsale.app"]) {
  const b = (await asc("GET", `/v1/bundleIds?filter[identifier]=${id}`)).data.find((x) => x.attributes.identifier === id);
  const caps = (await asc("GET", `/v1/bundleIds/${b.id}/bundleIdCapabilities`)).data;
  for (const c of caps) console.log(id, c.attributes.capabilityType, JSON.stringify(c.attributes.settings ?? null));
}
