// web/firmware.json (what the configurator compares a connected guitar against) must match the firmware version
import { readFileSync } from 'node:fs';
const cm = readFileSync(new URL('../firmware/CMakeLists.txt', import.meta.url), 'utf8');
const major = +cm.match(/set\(YACC_VERSION_MAJOR (\d+)\)/)[1];
const minor = +cm.match(/set\(YACC_VERSION_MINOR (\d+)\)/)[1];
const fw = JSON.parse(readFileSync(new URL('../web/firmware.json', import.meta.url), 'utf8'));
if (fw.major !== major || fw.minor !== minor) {
  console.error(`web/firmware.json says ${fw.major}.${fw.minor}, firmware/CMakeLists.txt says ${major}.${minor}`);
  process.exit(1);
}
console.log(`firmware version ${major}.${minor} ok`);
