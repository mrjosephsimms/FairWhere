import { asc } from "./asc.mjs";
const v = process.argv[2];
const b = (await asc("GET", `/v1/builds?filter[app]=6820566818&filter[version]=${v}&limit=1`)).data[0];
console.log(b ? `${v} ${b.attributes.processingState}` : `${v} none`);
