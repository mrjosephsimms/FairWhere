import { asc } from "./asc.mjs";
const VER = "6271937a-a7f2-4888-9227-c698852f7e4d", n = process.argv[2];
const b = (await asc("GET", `/v1/builds?filter[app]=6820566818&filter[version]=${n}&limit=1`)).data[0];
await asc("PATCH", `/v1/appStoreVersions/${VER}/relationships/build`, { data: { type: "builds", id: b.id } });
const v = await asc("GET", `/v1/appStoreVersions/${VER}?include=build`);
const at = v.included?.find((x) => x.type === "builds");
console.log("version 1.0:", v.data.attributes.appStoreState, "| attached build:", at?.attributes.version, at?.attributes.processingState);
